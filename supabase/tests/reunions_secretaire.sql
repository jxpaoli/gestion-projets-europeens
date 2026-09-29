-- Test : création de réunions par le secrétaire et garde-fous.
-- Une seule transaction, annulée à la fin (raise exception) : rien ne reste en base.

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000d001', 'test-admin@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000d002', 'test-secretaire@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000d003', 'test-lecteur@test.invalid', 'authenticated', 'authenticated');
insert into gestion_projets.roles_appli (user_id, email, role) values
  ('00000000-0000-0000-0000-00000000d001', 'test-admin@test.invalid', 'admin'),
  ('00000000-0000-0000-0000-00000000d002', 'test-secretaire@test.invalid', 'secretaire'),
  ('00000000-0000-0000-0000-00000000d003', 'test-lecteur@test.invalid', 'lecteur');

create function pg_temp.note(t text, ok boolean) returns void language sql as $$
  select set_config('test.res', coalesce(current_setting('test.res', true), '') || E'\n' || case when ok then 'OK    ' else 'ECHEC ' end || t, true);
$$;
create function pg_temp.en_tant_que(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', uid)::text, true);
$$;
create function pg_temp.refuse(t text, cmd text) returns void language plpgsql as $$
begin
  execute cmd;
  perform pg_temp.note(t, false);
exception when others then
  perform pg_temp.note(t, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;

-- ADMIN : projet et une réunion de Joseph
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000d001');
insert into gestion_projets.projets (acronyme) values ('TEST-REU');
insert into gestion_projets.echeances (projet_id, type, libelle, date, modifie_par_admin)
  select id, 'cdp', 'CdP de Joseph', '2026-11-05', false from gestion_projets.projets where acronyme = 'TEST-REU';
select pg_temp.note('réunion de Joseph : origine admin, protégée',
  (select origine = 'admin' and modifie_par_admin from gestion_projets.echeances where libelle = 'CdP de Joseph'));

-- SECRÉTAIRE
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000d002');
insert into gestion_projets.echeances (projet_id, type, libelle, date, lieu_nom, mail_ref, origine, modifie_par_admin)
  select id, 'cdp', 'CdP Portoferraio', '2026-10-21', 'Portoferraio', 'VERSE-REU1', 'admin', true from gestion_projets.projets where acronyme = 'TEST-REU';
select pg_temp.note('secrétaire crée un CdP (origine secretaire, non protégé)',
  (select origine = 'secretaire' and not modifie_par_admin from gestion_projets.echeances where libelle = 'CdP Portoferraio'));
select pg_temp.refuse('secrétaire : réunion sans mail refusée',
  $q$insert into gestion_projets.echeances (projet_id, type, libelle, date) select id, 'evenement', 'Sans mail', '2026-12-01' from gestion_projets.projets where acronyme = 'TEST-REU'$q$);
select pg_temp.refuse('secrétaire : doublon même projet, type et date refusé',
  $q$insert into gestion_projets.echeances (projet_id, type, libelle, date, mail_ref) select id, 'cdp', 'Doublon', '2026-10-21', 'VERSE-REU2' from gestion_projets.projets where acronyme = 'TEST-REU'$q$);
select pg_temp.refuse('secrétaire : échéance de rapport refusée',
  $q$insert into gestion_projets.echeances (projet_id, type, libelle, date, mail_ref) select id, 'rapport', 'Rapport', '2026-12-01', 'VERSE-REU3' from gestion_projets.projets where acronyme = 'TEST-REU'$q$);
select pg_temp.refuse('secrétaire : réunion créée annulée refusée',
  $q$insert into gestion_projets.echeances (projet_id, type, libelle, date, mail_ref, statut) select id, 'evenement', 'Annulée', '2026-12-02', 'VERSE-REU4', 'annule' from gestion_projets.projets where acronyme = 'TEST-REU'$q$);
update gestion_projets.echeances set heure_debut = '09:30', adresse = 'Autorité portuaire' where libelle = 'CdP Portoferraio';
select pg_temp.note('secrétaire complète sa propre réunion', (select heure_debut = '09:30' from gestion_projets.echeances where libelle = 'CdP Portoferraio'));
select pg_temp.refuse('secrétaire : annuler sa réunion refusé',
  $q$do $d$ begin update gestion_projets.echeances set statut = 'annule' where libelle = 'CdP Portoferraio'; if not found then raise exception 'rien modifié'; end if; end $d$$q$);
select pg_temp.refuse('secrétaire : modifier une réunion de Joseph refusé',
  $q$do $d$ begin update gestion_projets.echeances set lieu_nom = 'Ailleurs' where libelle = 'CdP de Joseph'; if not found then raise exception 'rien modifié'; end if; end $d$$q$);
select pg_temp.refuse('secrétaire : suppression refusée',
  $q$do $d$ begin delete from gestion_projets.echeances where libelle = 'CdP Portoferraio'; if not found then raise exception 'rien supprimé'; end if; end $d$$q$);
insert into gestion_projets.sources (echeance_id, type, date_source, expediteur, objet, mail_ref)
  select id, 'mail', '2026-09-28', 'Chef de file', 'Convocazione CdP Portoferraio', 'VERSE-REU1' from gestion_projets.echeances where libelle = 'CdP Portoferraio';
select pg_temp.note('secrétaire cite le mail source de la réunion',
  (select count(*) = 1 from gestion_projets.sources s join gestion_projets.echeances e on e.id = s.echeance_id where e.libelle = 'CdP Portoferraio'));

-- ADMIN touche la réunion du secrétaire : elle devient protégée
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000d001');
update gestion_projets.echeances set heure_fin = '17:00' where libelle = 'CdP Portoferraio';
select pg_temp.note('modification de Joseph : réunion protégée, origine conservée',
  (select modifie_par_admin and origine = 'secretaire' from gestion_projets.echeances where libelle = 'CdP Portoferraio'));
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000d002');
select pg_temp.refuse('secrétaire : réunion touchée par Joseph non modifiable',
  $q$do $d$ begin update gestion_projets.echeances set heure_debut = '10:00' where libelle = 'CdP Portoferraio'; if not found then raise exception 'rien modifié'; end if; end $d$$q$);

-- LECTEUR
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000d003');
select pg_temp.note('lecteur voit la réunion', (select count(*) = 1 from gestion_projets.echeances where libelle = 'CdP Portoferraio'));
select pg_temp.refuse('lecteur : création refusée',
  $q$insert into gestion_projets.echeances (projet_id, type, libelle, date, mail_ref) select id, 'cdp', 'Lecteur', '2026-12-10', 'X' from gestion_projets.projets where acronyme = 'TEST-REU'$q$);

-- ADMIN annule et supprime
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000d001');
update gestion_projets.echeances set statut = 'annule' where libelle = 'CdP de Joseph';
select pg_temp.note('Joseph annule une réunion', (select statut = 'annule' from gestion_projets.echeances where libelle = 'CdP de Joseph'));
delete from gestion_projets.projets where acronyme = 'TEST-REU';
select pg_temp.note('réunions supprimées avec leur projet', (select count(*) = 0 from gestion_projets.echeances where libelle in ('CdP Portoferraio', 'CdP de Joseph')));

reset role;
do $$ begin raise exception 'RESULTATS:%', current_setting('test.res', true); end $$;
