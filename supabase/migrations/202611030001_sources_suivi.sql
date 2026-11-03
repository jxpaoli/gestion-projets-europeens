-- Sources pour « Mon suivi » (validé par Joseph le 03/11/2026) : un élément de « Mon suivi » peut citer
-- plusieurs sources, comme une action ou une réunion. Réservé à Joseph et au secrétaire : un lecteur ne voit
-- jamais ces sources. Le mail source déjà saisi sur un élément (date, expéditeur, objet, mail_ref) devient
-- une source « mail » ; un élément créé avec un mail source en reçoit une automatiquement.
-- Ne touche que les schémas gestion_projets et gestion_projets_private.

alter table gestion_projets.sources
  add column suivi_id uuid references gestion_projets.suivi_perso (id) on delete cascade;

-- Une seule cible par source : les sept colonnes, evolution_id comprise (ajoutée le 28/09/2026).
alter table gestion_projets.sources drop constraint sources_une_cible;
alter table gestion_projets.sources add constraint sources_une_cible
  check (num_nonnulls(action_id, echeance_id, livrable_id, periode_id, point_id, info_id, evolution_id, suivi_id) = 1);
create index sources_suivi_idx on gestion_projets.sources (suivi_id) where suivi_id is not null;

-- Pas deux fois le même mail sur le même élément, y compris « Mon suivi ».
drop index gestion_projets.sources_mail_unique;
create unique index sources_mail_unique on gestion_projets.sources
  (coalesce(action_id, echeance_id, livrable_id, periode_id, point_id, info_id, evolution_id, suivi_id), mail_ref) where mail_ref is not null;

-- Lecture : les sources de « Mon suivi » sont réservées à Joseph et au secrétaire.
drop policy sources_lecture on gestion_projets.sources;
create policy sources_lecture on gestion_projets.sources for select to authenticated
  using (
    (suivi_id is null and (select gestion_projets_private.est_membre()))
    or (suivi_id is not null and ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire())))
  );

-- Mail source d'un élément de « Mon suivi » : une source « mail » la reprend, à la création.
create or replace function gestion_projets_private.suivi_source_mail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(new.source_objet), '') is not null then
    insert into gestion_projets.sources (suivi_id, type, date_source, expediteur, objet, mail_ref)
    values (new.id, 'mail', new.source_date, new.source_expediteur, new.source_objet, new.mail_ref);
  end if;
  return new;
end;
$$;
revoke all on function gestion_projets_private.suivi_source_mail() from public;

create trigger suivi_perso_source after insert on gestion_projets.suivi_perso
  for each row execute function gestion_projets_private.suivi_source_mail();

-- Reprise : le mail source déjà saisi sur les éléments existants devient une source « mail ».
insert into gestion_projets.sources (suivi_id, type, date_source, expediteur, objet, mail_ref, ajoute_par)
select s.id, 'mail', s.source_date, s.source_expediteur, s.source_objet, s.mail_ref, 'systeme'
from gestion_projets.suivi_perso s
where nullif(trim(s.source_objet), '') is not null
  and not exists (select 1 from gestion_projets.sources x where x.suivi_id = s.id);

notify pgrst, 'reload schema';
