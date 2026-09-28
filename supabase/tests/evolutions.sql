-- Test du journal des évolutions : lecture par tous les membres, règles du secrétaire, sources rattachées.
-- Une seule transaction, annulée à la fin (raise exception) : rien ne reste en base.

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000e001', 'test-admin@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000e002', 'test-secretaire@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000e003', 'test-lecteur@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000e004', 'test-inconnu@test.invalid', 'authenticated', 'authenticated');
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
insert into gestion_projets.projets (acronyme) values ('TEST-EVO');
insert into gestion_projets.evolutions (projet_id, date_evolution, type, element, titre, avant, apres, modifie_par_admin)
  select id, '2026-05-10', 'retard', 'D1.3.1', 'Rapport de cartographie repoussé', 'P3', 'P4', false from gestion_projets.projets where acronyme = 'TEST-EVO';
select pg_temp.note('saisie de Joseph : protégée d''office (auteur = admin)',
  (select modifie_par_admin and ajoute_par = 'admin' from gestion_projets.evolutions where titre = 'Rapport de cartographie repoussé'));
select pg_temp.refuse('type inconnu refusé',
  $q$insert into gestion_projets.evolutions (projet_id, date_evolution, type, titre) select id, '2026-05-10', 'n_importe', 'x' from gestion_projets.projets where acronyme = 'TEST-EVO'$q$);
select pg_temp.refuse('titre vide refusé',
  $q$insert into gestion_projets.evolutions (projet_id, date_evolution, type, titre) select id, '2026-05-10', 'autre', '  ' from gestion_projets.projets where acronyme = 'TEST-EVO'$q$);

-- SECRÉTAIRE
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000e002');
insert into gestion_projets.evolutions (projet_id, date_evolution, type, element, titre, statut, modifie_par_admin)
  select id, '2026-06-01', 'decision', null, 'CdP 3 : report de l''événement de Bastia', 'valide_cdp', true from gestion_projets.projets where acronyme = 'TEST-EVO';
select pg_temp.note('secrétaire ajoute une évolution (auteur = secretaire, non protégée)',
  (select ajoute_par = 'secretaire' and not modifie_par_admin from gestion_projets.evolutions where titre like 'CdP 3%'));
update gestion_projets.evolutions set statut = 'approuve' where titre like 'CdP 3%';
select pg_temp.note('secrétaire fait avancer le statut de sa propre entrée', (select statut = 'approuve' from gestion_projets.evolutions where titre like 'CdP 3%'));
select pg_temp.refuse('secrétaire : modifier une entrée de Joseph refusé',
  $q$do $d$ begin update gestion_projets.evolutions set statut = 'propose' where titre = 'Rapport de cartographie repoussé'; if not found then raise exception 'rien modifié'; end if; end $d$$q$);
select pg_temp.refuse('secrétaire : abandonner refusé',
  $q$do $d$ begin update gestion_projets.evolutions set statut = 'abandonne' where titre like 'CdP 3%'; if not found then raise exception 'rien modifié'; end if; end $d$$q$);
select pg_temp.refuse('secrétaire : suppression refusée',
  $q$do $d$ begin delete from gestion_projets.evolutions where titre like 'CdP 3%'; if not found then raise exception 'rien supprimé'; end if; end $d$$q$);
insert into gestion_projets.sources (evolution_id, type, date_source, expediteur, objet, mail_ref)
  select id, 'mail', '2026-06-02', 'Chef de file', 'PV CdP 3', 'VERSE-EVO1' from gestion_projets.evolutions where titre like 'CdP 3%';
select pg_temp.note('secrétaire cite un mail source sur une évolution',
  (select count(*) = 1 from gestion_projets.sources s join gestion_projets.evolutions e on e.id = s.evolution_id where e.titre like 'CdP 3%'));
select pg_temp.refuse('secrétaire : même mail deux fois sur la même évolution refusé',
  $q$insert into gestion_projets.sources (evolution_id, type, date_source, expediteur, objet, mail_ref) select id, 'mail', '2026-06-02', 'Chef de file', 'PV CdP 3', 'VERSE-EVO1' from gestion_projets.evolutions where titre like 'CdP 3%'$q$);

-- ADMIN corrige l'entrée du secrétaire : elle devient protégée
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000e001');
update gestion_projets.evolutions set motif = 'Salle indisponible' where titre like 'CdP 3%';
select pg_temp.note('correction de Joseph : entrée protégée, auteur conservé',
  (select modifie_par_admin and ajoute_par = 'secretaire' from gestion_projets.evolutions where titre like 'CdP 3%'));
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000e002');
select pg_temp.refuse('secrétaire : entrée corrigée par Joseph non modifiable',
  $q$do $d$ begin update gestion_projets.evolutions set motif = 'autre' where titre like 'CdP 3%'; if not found then raise exception 'rien modifié'; end if; end $d$$q$);

-- LECTEUR
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000e003');
select pg_temp.note('lecteur voit tout le journal', (select count(*) = 2 from gestion_projets.evolutions e join gestion_projets.projets p on p.id = e.projet_id where p.acronyme = 'TEST-EVO'));
select pg_temp.note('lecteur voit les sources d''une évolution', (select count(*) = 1 from gestion_projets.sources where evolution_id is not null and mail_ref = 'VERSE-EVO1'));
select pg_temp.refuse('lecteur : ajout refusé',
  $q$insert into gestion_projets.evolutions (projet_id, date_evolution, type, titre) select id, '2026-05-10', 'autre', 'x' from gestion_projets.projets where acronyme = 'TEST-EVO'$q$);
select pg_temp.refuse('lecteur : modification refusée',
  $q$do $d$ begin update gestion_projets.evolutions set titre = 'x' where titre like 'CdP 3%'; if not found then raise exception 'rien modifié'; end if; end $d$$q$);

-- COMPTE NON INSCRIT
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000e004');
select pg_temp.note('compte non inscrit : ne voit aucune évolution', (select count(*) = 0 from gestion_projets.evolutions));

-- ADMIN : abandon, suppression, cascade
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000e001');
update gestion_projets.evolutions set statut = 'abandonne' where titre = 'Rapport de cartographie repoussé';
select pg_temp.note('Joseph abandonne une évolution', (select statut = 'abandonne' from gestion_projets.evolutions where titre = 'Rapport de cartographie repoussé'));
delete from gestion_projets.evolutions where titre like 'CdP 3%';
select pg_temp.note('sources supprimées avec leur évolution', (select count(*) = 0 from gestion_projets.sources where mail_ref = 'VERSE-EVO1'));
delete from gestion_projets.projets where acronyme = 'TEST-EVO';
select pg_temp.note('évolutions supprimées avec leur projet', (select count(*) = 0 from gestion_projets.evolutions where titre = 'Rapport de cartographie repoussé'));

reset role;
do $$ begin raise exception 'RESULTATS:%', current_setting('test.res', true); end $$;
