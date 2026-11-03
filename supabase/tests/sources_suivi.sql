-- Test : sources de « Mon suivi » réservées à Joseph et au secrétaire ; mail source repris automatiquement.
-- Une seule transaction, annulée à la fin (raise exception) : rien ne reste en base.

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000f001', 'test-admin@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000f002', 'test-secretaire@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000f003', 'test-lecteur@test.invalid', 'authenticated', 'authenticated');
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

-- ADMIN : un élément créé avec un mail source reçoit sa source « mail » tout de suite
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000f001');
insert into gestion_projets.suivi_perso (type, domaine, libelle, date, source_date, source_expediteur, source_objet, mail_ref)
  values ('convocation', 'cse_central', 'TEST SRC CSE', '2026-11-06', '2026-10-21', 'Direction', 'TEST Convocation CSE', 'TEST-SRC-1');
select pg_temp.note('mail source repris automatiquement',
  (select count(*) = 1 from gestion_projets.sources s join gestion_projets.suivi_perso p on p.id = s.suivi_id
   where p.libelle = 'TEST SRC CSE' and s.type = 'mail' and s.objet = 'TEST Convocation CSE' and s.expediteur = 'Direction'));
select set_config('test.suivi_id', (select id::text from gestion_projets.suivi_perso where libelle = 'TEST SRC CSE'), true);

insert into gestion_projets.sources (suivi_id, type, objet) values (current_setting('test.suivi_id')::uuid, 'autre', 'TEST note');
select pg_temp.note('admin ajoute une autre source',
  (select count(*) = 2 from gestion_projets.sources where suivi_id = current_setting('test.suivi_id')::uuid));

-- SECRÉTAIRE : crée un élément avec son mail ; la source suit, et il la voit
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000f002');
insert into gestion_projets.suivi_perso (type, domaine, libelle, date, lieu, source_date, source_expediteur, source_objet, mail_ref)
  values ('rendez_vous', 'perso', 'TEST SRC SECR', '2026-11-07', 'Ajaccio', '2026-10-22', 'Secrétariat', 'TEST RDV secr', 'TEST-SRC-2');
select pg_temp.note('secrétaire voit la source de son élément',
  (select count(*) = 1 from gestion_projets.sources s join gestion_projets.suivi_perso p on p.id = s.suivi_id where p.libelle = 'TEST SRC SECR'));

-- LECTEUR : ne voit aucune source de « Mon suivi », n'en ajoute pas
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000f003');
select pg_temp.note('lecteur ne voit aucune source de suivi',
  (select count(*) = 0 from gestion_projets.sources where suivi_id is not null));
select pg_temp.refuse('lecteur : ajout de source sur un suivi refusé',
  $q$insert into gestion_projets.sources (suivi_id, type, objet) values (current_setting('test.suivi_id')::uuid, 'autre', 'X')$q$);

-- Suppression de l'élément : ses sources partent avec lui
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000f001');
delete from gestion_projets.suivi_perso where libelle like 'TEST SRC %';
select pg_temp.note('suppression de l''élément supprime ses sources',
  (select count(*) = 0 from gestion_projets.sources where suivi_id = current_setting('test.suivi_id')::uuid));

reset role;
do $$ begin raise exception 'RESULTATS:%', current_setting('test.res', true); end $$;
