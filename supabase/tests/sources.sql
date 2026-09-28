-- Test des sources (mail, document, réunion, autre) : droits et règles du secrétaire.
-- Une seule transaction, annulée à la fin (raise exception) : rien ne reste en base.

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000c001', 'test-admin@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000c002', 'test-secretaire@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000c003', 'test-lecteur@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000c004', 'test-inconnu@test.invalid', 'authenticated', 'authenticated');
insert into gestion_projets.roles_appli (user_id, email, role) values
  ('00000000-0000-0000-0000-00000000c001', 'test-admin@test.invalid', 'admin'),
  ('00000000-0000-0000-0000-00000000c002', 'test-secretaire@test.invalid', 'secretaire'),
  ('00000000-0000-0000-0000-00000000c003', 'test-lecteur@test.invalid', 'lecteur');

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
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000c001');
insert into gestion_projets.projets (acronyme) values ('TEST-SRC');
insert into gestion_projets.actions (projet_id, libelle) select id, 'Action sourcée' from gestion_projets.projets where acronyme = 'TEST-SRC';
insert into gestion_projets.livrables (projet_id, titre) select id, 'Livrable sourcé' from gestion_projets.projets where acronyme = 'TEST-SRC';
insert into gestion_projets.echeances (projet_id, libelle, date, type) select id, 'CdP test', '2026-10-15', 'cdp' from gestion_projets.projets where acronyme = 'TEST-SRC';
insert into gestion_projets.sources (action_id, type, date_source, expediteur, objet)
  select id, 'mail', '2026-09-24', 'M. Scarsi', 'RE: EASY2LOG – WP3' from gestion_projets.actions where libelle = 'Action sourcée';
select pg_temp.note('admin ajoute une source mail (auteur = admin)',
  (select ajoute_par = 'admin' from gestion_projets.sources where objet = 'RE: EASY2LOG – WP3'));
insert into gestion_projets.sources (livrable_id, type, objet, lien)
  select id, 'autre', 'Plateforme JEMS', 'https://jems.example.invalid' from gestion_projets.livrables where titre = 'Livrable sourcé';
select pg_temp.note('admin ajoute une source à un livrable', (select count(*) = 1 from gestion_projets.sources where objet = 'Plateforme JEMS'));
insert into gestion_projets.sources (action_id, type, reunion_id)
  select a.id, 'reunion', e.id from gestion_projets.actions a, gestion_projets.echeances e where a.libelle = 'Action sourcée' and e.libelle = 'CdP test';
select pg_temp.note('admin relie une action à une réunion source', (select count(*) = 1 from gestion_projets.sources where type = 'reunion' and reunion_id is not null));
select pg_temp.refuse('source sans élément refusée',
  $q$insert into gestion_projets.sources (type, objet) values ('autre', 'orpheline')$q$);
select pg_temp.refuse('source rattachée à deux éléments refusée',
  $q$insert into gestion_projets.sources (action_id, livrable_id, type, objet) select a.id, l.id, 'autre', 'double' from gestion_projets.actions a, gestion_projets.livrables l where a.libelle = 'Action sourcée' and l.titre = 'Livrable sourcé'$q$);
select pg_temp.refuse('source vide refusée',
  $q$insert into gestion_projets.sources (action_id, type) select id, 'autre' from gestion_projets.actions where libelle = 'Action sourcée'$q$);

-- SECRÉTAIRE
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000c002');
insert into gestion_projets.sources (action_id, type, date_source, expediteur, objet, mail_ref)
  select id, 'mail', '2026-09-25', 'P. Quilici', 'Devis MFI', 'VERSE-TEST1' from gestion_projets.actions where libelle = 'Action sourcée';
select pg_temp.note('secrétaire ajoute un mail complet (auteur = secretaire)',
  (select ajoute_par = 'secretaire' from gestion_projets.sources where mail_ref = 'VERSE-TEST1'));
select pg_temp.refuse('secrétaire : mail sans objet refusé',
  $q$insert into gestion_projets.sources (action_id, type, date_source, expediteur, mail_ref) select id, 'mail', '2026-09-25', 'X', 'VERSE-TEST2' from gestion_projets.actions where libelle = 'Action sourcée'$q$);
select pg_temp.refuse('secrétaire : mail sans date refusé',
  $q$insert into gestion_projets.sources (action_id, type, expediteur, objet) select id, 'mail', 'X', 'Objet' from gestion_projets.actions where libelle = 'Action sourcée'$q$);
select pg_temp.refuse('secrétaire : même mail deux fois sur la même action refusé',
  $q$insert into gestion_projets.sources (action_id, type, date_source, expediteur, objet, mail_ref) select id, 'mail', '2026-09-25', 'P. Quilici', 'Devis MFI', 'VERSE-TEST1' from gestion_projets.actions where libelle = 'Action sourcée'$q$);
select pg_temp.refuse('secrétaire : source sur un livrable refusée',
  $q$insert into gestion_projets.sources (livrable_id, type, date_source, expediteur, objet) select id, 'mail', '2026-09-25', 'X', 'Objet' from gestion_projets.livrables where titre = 'Livrable sourcé'$q$);
select pg_temp.refuse('secrétaire : se faire passer pour Joseph refusé',
  $q$do $d$ begin insert into gestion_projets.sources (action_id, type, date_source, expediteur, objet, ajoute_par) select id, 'mail', '2026-09-26', 'X', 'Forgé', 'admin' from gestion_projets.actions where libelle = 'Action sourcée'; if (select ajoute_par from gestion_projets.sources where objet = 'Forgé') = 'admin' then return; end if; raise exception 'forgé refusé'; end $d$$q$);
select pg_temp.refuse('secrétaire : modifier une source refusé',
  $q$do $d$ begin update gestion_projets.sources set objet = 'Modifié' where objet = 'RE: EASY2LOG – WP3'; if not found then raise exception 'rien modifié'; end if; end $d$$q$);
select pg_temp.refuse('secrétaire : supprimer une source refusé',
  $q$do $d$ begin delete from gestion_projets.sources where objet = 'RE: EASY2LOG – WP3'; if not found then raise exception 'rien supprimé'; end if; end $d$$q$);

-- LECTEUR
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000c003');
select pg_temp.note('lecteur voit les sources', (select count(*) >= 3 from gestion_projets.sources s join gestion_projets.actions a on a.id = s.action_id where a.libelle = 'Action sourcée'));
select pg_temp.refuse('lecteur : ajout refusé',
  $q$insert into gestion_projets.sources (action_id, type, objet) select id, 'autre', 'x' from gestion_projets.actions where libelle = 'Action sourcée'$q$);
select pg_temp.refuse('lecteur : suppression refusée',
  $q$do $d$ begin delete from gestion_projets.sources where objet = 'Devis MFI'; if not found then raise exception 'rien supprimé'; end if; end $d$$q$);

-- COMPTE NON INSCRIT
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000c004');
select pg_temp.note('compte non inscrit : ne voit aucune source', (select count(*) = 0 from gestion_projets.sources));

-- ADMIN supprime ; suppression en cascade avec l'action
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000c001');
delete from gestion_projets.sources where objet = 'Plateforme JEMS';
select pg_temp.note('admin supprime une source', (select count(*) = 0 from gestion_projets.sources where objet = 'Plateforme JEMS'));
delete from gestion_projets.actions where libelle = 'Action sourcée';
select pg_temp.note('sources supprimées avec leur action', (select count(*) = 0 from gestion_projets.sources where objet in ('RE: EASY2LOG – WP3', 'Devis MFI')));

reset role;
do $$ begin raise exception 'RESULTATS:%', current_setting('test.res', true); end $$;
