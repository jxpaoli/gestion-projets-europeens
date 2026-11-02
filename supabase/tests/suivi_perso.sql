-- Test : « Mon suivi » réservé à Joseph et au secrétaire, garde-fous du secrétaire.
-- Une seule transaction, annulée à la fin (raise exception) : rien ne reste en base.

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000e001', 'test-admin@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000e002', 'test-secretaire@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000e003', 'test-lecteur@test.invalid', 'authenticated', 'authenticated');
insert into gestion_projets.roles_appli (user_id, email, role) values
  ('00000000-0000-0000-0000-00000000e001', 'test-admin@test.invalid', 'admin'),
  ('00000000-0000-0000-0000-00000000e002', 'test-secretaire@test.invalid', 'secretaire'),
  ('00000000-0000-0000-0000-00000000e003', 'test-lecteur@test.invalid', 'lecteur');

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

-- ADMIN
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000e001');
insert into gestion_projets.suivi_perso (type, domaine, libelle, date, modifie_par_admin)
  values ('rendez_vous', 'perso', 'TEST RDV de Joseph', '2026-11-20', false);
select pg_temp.note('élément de Joseph : origine admin, protégé',
  (select origine = 'admin' and modifie_par_admin from gestion_projets.suivi_perso where libelle = 'TEST RDV de Joseph'));

-- SECRÉTAIRE
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000e002');
insert into gestion_projets.suivi_perso (type, domaine, libelle, date, heure_debut, lieu, source_date, source_expediteur, source_objet, mail_ref, origine, modifie_par_admin)
  values ('convocation', 'cse_central', 'TEST CSE Central', '2026-11-06', '10:00', 'Hôtel Consulaire', '2026-10-21', 'Direction', 'Convocation CSE Central', 'VERSE-SP1', 'admin', true);
select pg_temp.note('secrétaire crée une convocation (origine secretaire, non protégée)',
  (select origine = 'secretaire' and not modifie_par_admin from gestion_projets.suivi_perso where libelle = 'TEST CSE Central'));
select pg_temp.note('secrétaire voit les éléments (dont ceux de Joseph)',
  (select count(*) = 2 from gestion_projets.suivi_perso where libelle like 'TEST %'));
select pg_temp.refuse('secrétaire : sans mail refusé',
  $q$insert into gestion_projets.suivi_perso (type, libelle, source_date, source_expediteur, source_objet) values ('action', 'Sans mail', '2026-10-21', 'X', 'Y')$q$);
select pg_temp.refuse('secrétaire : sans objet du mail refusé',
  $q$insert into gestion_projets.suivi_perso (type, libelle, mail_ref, source_date, source_expediteur) values ('action', 'Sans objet', 'VERSE-SP2', '2026-10-21', 'X')$q$);
select pg_temp.refuse('secrétaire : même mail, même type refusé',
  $q$insert into gestion_projets.suivi_perso (type, libelle, mail_ref, source_date, source_expediteur, source_objet) values ('convocation', 'Doublon', 'VERSE-SP1', '2026-10-21', 'X', 'Y')$q$);
insert into gestion_projets.suivi_perso (type, domaine, libelle, mail_ref, source_date, source_expediteur, source_objet)
  values ('action', 'cse_central', 'TEST Lire les pièces du CSE', 'VERSE-SP1', '2026-10-21', 'Direction', 'Convocation CSE Central');
select pg_temp.note('même mail, autre type accepté', (select count(*) = 1 from gestion_projets.suivi_perso where libelle = 'TEST Lire les pièces du CSE'));
select pg_temp.refuse('secrétaire : créé déjà fait refusé',
  $q$insert into gestion_projets.suivi_perso (type, libelle, mail_ref, source_date, source_expediteur, source_objet, statut) values ('action', 'Fait', 'VERSE-SP3', '2026-10-21', 'X', 'Y', 'fait')$q$);
update gestion_projets.suivi_perso set heure_fin = '12:00' where libelle = 'TEST CSE Central';
select pg_temp.note('secrétaire complète son élément', (select heure_fin = '12:00' from gestion_projets.suivi_perso where libelle = 'TEST CSE Central'));
select pg_temp.refuse('secrétaire : fait sans preuve refusé',
  $q$do $d$ begin update gestion_projets.suivi_perso set statut = 'fait' where libelle = 'TEST Lire les pièces du CSE'; if not found then raise exception 'rien'; end if; end $d$$q$);
update gestion_projets.suivi_perso set statut = 'fait', fait_source = 'Mail du 05/11' where libelle = 'TEST Lire les pièces du CSE';
select pg_temp.note('secrétaire coche avec preuve', (select statut = 'fait' from gestion_projets.suivi_perso where libelle = 'TEST Lire les pièces du CSE'));
select pg_temp.refuse('secrétaire : annuler refusé',
  $q$do $d$ begin update gestion_projets.suivi_perso set statut = 'annule' where libelle = 'TEST CSE Central'; if not found then raise exception 'rien'; end if; end $d$$q$);
select pg_temp.refuse('secrétaire : modifier un élément de Joseph refusé',
  $q$do $d$ begin update gestion_projets.suivi_perso set lieu = 'Ailleurs' where libelle = 'TEST RDV de Joseph'; if not found then raise exception 'rien'; end if; end $d$$q$);
select pg_temp.refuse('secrétaire : suppression refusée',
  $q$do $d$ begin delete from gestion_projets.suivi_perso where libelle = 'TEST CSE Central'; if not found then raise exception 'rien'; end if; end $d$$q$);

-- LECTEUR : ne voit rien, n'écrit rien
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000e003');
select pg_temp.note('lecteur ne voit rien', (select count(*) = 0 from gestion_projets.suivi_perso));
select pg_temp.refuse('lecteur : création refusée',
  $q$insert into gestion_projets.suivi_perso (type, libelle) values ('info', 'Lecteur')$q$);
select pg_temp.refuse('lecteur : modification refusée',
  $q$do $d$ begin update gestion_projets.suivi_perso set lieu = 'X'; if not found then raise exception 'rien'; end if; end $d$$q$);

-- ADMIN touche l'élément du secrétaire : il devient protégé ; Joseph annule et supprime
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000e001');
update gestion_projets.suivi_perso set notes = 'ok' where libelle = 'TEST CSE Central';
select pg_temp.note('modification de Joseph : élément protégé, origine conservée',
  (select modifie_par_admin and origine = 'secretaire' from gestion_projets.suivi_perso where libelle = 'TEST CSE Central'));
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000e002');
select pg_temp.refuse('secrétaire : élément touché par Joseph non modifiable',
  $q$do $d$ begin update gestion_projets.suivi_perso set heure_debut = '09:00' where libelle = 'TEST CSE Central'; if not found then raise exception 'rien'; end if; end $d$$q$);
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000e001');
update gestion_projets.suivi_perso set statut = 'annule' where libelle = 'TEST RDV de Joseph';
select pg_temp.note('Joseph annule', (select statut = 'annule' from gestion_projets.suivi_perso where libelle = 'TEST RDV de Joseph'));
delete from gestion_projets.suivi_perso where libelle like 'TEST %';
select pg_temp.note('Joseph supprime', (select count(*) = 0 from gestion_projets.suivi_perso where libelle like 'TEST %'));

reset role;
do $$ begin raise exception 'RESULTATS:%', current_setting('test.res', true); end $$;
