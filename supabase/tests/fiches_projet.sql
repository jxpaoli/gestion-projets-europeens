-- Test des fiches projet : lecture par tous les membres, règles du secrétaire (version, PDF, fiche corrigée).
-- Une seule transaction, annulée à la fin (raise exception) : rien ne reste en base.

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000f001', 'test-admin@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000f002', 'test-secretaire@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000f003', 'test-lecteur@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000f004', 'test-inconnu@test.invalid', 'authenticated', 'authenticated');
insert into gestion_projets.roles_appli (user_id, email, role) values
  ('00000000-0000-0000-0000-00000000f001', 'test-admin@test.invalid', 'admin'),
  ('00000000-0000-0000-0000-00000000f002', 'test-secretaire@test.invalid', 'secretaire'),
  ('00000000-0000-0000-0000-00000000f003', 'test-lecteur@test.invalid', 'lecteur');

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

-- ADMIN : projet et PDF de test
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000f001');
insert into gestion_projets.projets (acronyme) values ('TEST-FICHE');
insert into gestion_projets.documents (projet_id, dossier, chemin, nom, extension)
  select id, '01-administratif', 'test-fiche/01-administratif/AF_V1.pdf', 'AF_V1.pdf', 'pdf' from gestion_projets.projets where acronyme = 'TEST-FICHE';

-- SECRÉTAIRE
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000f002');
insert into gestion_projets.fiches_projet (projet_id, version, document_id, contenu, ajoute_par, modifie_par_admin)
  select p.id, 1.0, d.id, '{"recap": {"titre": "V1"}}', 'admin', true
  from gestion_projets.projets p, gestion_projets.documents d where p.acronyme = 'TEST-FICHE' and d.nom = 'AF_V1.pdf';
select pg_temp.note('secrétaire dépose une fiche (auteur = secretaire, non protégée)',
  (select ajoute_par = 'secretaire' and not modifie_par_admin from gestion_projets.fiches_projet where contenu -> 'recap' ->> 'titre' = 'V1'));
select pg_temp.refuse('secrétaire : fiche sans PDF source refusée',
  $q$insert into gestion_projets.fiches_projet (projet_id, version, contenu) select id, 2.0, '{"recap": {}}' from gestion_projets.projets where acronyme = 'TEST-FICHE'$q$);
select pg_temp.refuse('secrétaire : même version refusée',
  $q$insert into gestion_projets.fiches_projet (projet_id, version, document_id, contenu) select p.id, 1.0, d.id, '{"recap": {}}' from gestion_projets.projets p, gestion_projets.documents d where p.acronyme = 'TEST-FICHE' and d.nom = 'AF_V1.pdf'$q$);
select pg_temp.refuse('secrétaire : version plus ancienne refusée',
  $q$insert into gestion_projets.fiches_projet (projet_id, version, document_id, contenu) select p.id, 0.5, d.id, '{"recap": {}}' from gestion_projets.projets p, gestion_projets.documents d where p.acronyme = 'TEST-FICHE' and d.nom = 'AF_V1.pdf'$q$);
select pg_temp.refuse('secrétaire : contenu sans récap refusé',
  $q$insert into gestion_projets.fiches_projet (projet_id, version, document_id, contenu) select p.id, 3.0, d.id, '{"lots": []}' from gestion_projets.projets p, gestion_projets.documents d where p.acronyme = 'TEST-FICHE' and d.nom = 'AF_V1.pdf'$q$);
update gestion_projets.fiches_projet set contenu = '{"recap": {"titre": "V1 relue"}}' where version = 1.0
  and projet_id = (select id from gestion_projets.projets where acronyme = 'TEST-FICHE');
select pg_temp.note('secrétaire corrige sa propre fiche', (select count(*) = 1 from gestion_projets.fiches_projet where contenu -> 'recap' ->> 'titre' = 'V1 relue'));
select pg_temp.refuse('secrétaire : changer la version refusé',
  $q$do $d$ begin update gestion_projets.fiches_projet set version = 9.0 where contenu -> 'recap' ->> 'titre' = 'V1 relue'; if not found then raise exception 'rien modifié'; end if; end $d$$q$);
select pg_temp.refuse('secrétaire : suppression refusée',
  $q$do $d$ begin delete from gestion_projets.fiches_projet where contenu -> 'recap' ->> 'titre' = 'V1 relue'; if not found then raise exception 'rien supprimé'; end if; end $d$$q$);

-- ADMIN corrige : la fiche devient protégée
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000f001');
update gestion_projets.fiches_projet set contenu = '{"recap": {"titre": "V1 Joseph"}}' where contenu -> 'recap' ->> 'titre' = 'V1 relue';
select pg_temp.note('correction de Joseph : fiche protégée',
  (select modifie_par_admin and ajoute_par = 'secretaire' from gestion_projets.fiches_projet where contenu -> 'recap' ->> 'titre' = 'V1 Joseph'));

-- SECRÉTAIRE : fiche protégée, nouvelle version acceptée
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000f002');
select pg_temp.refuse('secrétaire : fiche corrigée par Joseph non modifiable',
  $q$do $d$ begin update gestion_projets.fiches_projet set contenu = '{"recap": {"titre": "écrasée"}}' where contenu -> 'recap' ->> 'titre' = 'V1 Joseph'; if not found then raise exception 'rien modifié'; end if; end $d$$q$);
insert into gestion_projets.fiches_projet (projet_id, version, document_id, contenu)
  select p.id, 2.0, d.id, '{"recap": {"titre": "V2"}}' from gestion_projets.projets p, gestion_projets.documents d where p.acronyme = 'TEST-FICHE' and d.nom = 'AF_V1.pdf';
select pg_temp.note('secrétaire dépose une version plus récente', (select count(*) = 2 from gestion_projets.fiches_projet f join gestion_projets.projets p on p.id = f.projet_id where p.acronyme = 'TEST-FICHE'));

-- LECTEUR
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000f003');
select pg_temp.note('lecteur voit les fiches', (select count(*) = 2 from gestion_projets.fiches_projet f join gestion_projets.projets p on p.id = f.projet_id where p.acronyme = 'TEST-FICHE'));
select pg_temp.refuse('lecteur : ajout refusé',
  $q$insert into gestion_projets.fiches_projet (projet_id, version, contenu) select id, 5.0, '{"recap": {}}' from gestion_projets.projets where acronyme = 'TEST-FICHE'$q$);
select pg_temp.refuse('lecteur : modification refusée',
  $q$do $d$ begin update gestion_projets.fiches_projet set contenu = '{"recap": {}}' where contenu -> 'recap' ->> 'titre' = 'V2'; if not found then raise exception 'rien modifié'; end if; end $d$$q$);

-- COMPTE NON INSCRIT
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000f004');
select pg_temp.note('compte non inscrit : ne voit aucune fiche', (select count(*) = 0 from gestion_projets.fiches_projet));

-- ADMIN supprime ; suppression en cascade avec le projet
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000f001');
delete from gestion_projets.fiches_projet where contenu -> 'recap' ->> 'titre' = 'V2';
select pg_temp.note('admin supprime une fiche', (select count(*) = 0 from gestion_projets.fiches_projet where contenu -> 'recap' ->> 'titre' = 'V2'));
delete from gestion_projets.projets where acronyme = 'TEST-FICHE';
select pg_temp.note('fiches supprimées avec leur projet', (select count(*) = 0 from gestion_projets.fiches_projet where contenu -> 'recap' ->> 'titre' = 'V1 Joseph'));

reset role;
do $$ begin raise exception 'RESULTATS:%', current_setting('test.res', true); end $$;
