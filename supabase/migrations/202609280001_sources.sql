-- Sources des éléments de l'appli (validé par Joseph le 28/09/2026) : d'où vient une action, une échéance,
-- un livrable, une période, un point ou une info de réunion. Plusieurs sources possibles par élément.
-- - mail     : date, expéditeur, objet (pas d'accès aux mails depuis l'appli : l'objet sert à le retrouver
--              dans la messagerie) ; mail_ref = identifiant du mail (unid) ; numero = n° dans index-mails.csv ;
-- - document : document OneDrive indexé (lien calculé par l'appli), nom gardé dans objet ;
-- - reunion  : réunion de l'appli (échéance) ;
-- - autre    : texte libre, lien facultatif.
-- Le champ texte « source » existant reste en place (ancienne saisie libre).
-- Ne touche que les schémas gestion_projets et gestion_projets_private.

create table gestion_projets.sources (
  id          uuid primary key default gen_random_uuid(),
  -- Élément concerné : exactement un des six.
  action_id   uuid references gestion_projets.actions (id) on delete cascade,
  echeance_id uuid references gestion_projets.echeances (id) on delete cascade,
  livrable_id uuid references gestion_projets.livrables (id) on delete cascade,
  periode_id  uuid references gestion_projets.periodes (id) on delete cascade,
  point_id    uuid references gestion_projets.reunion_points (id) on delete cascade,
  info_id     uuid references gestion_projets.reunion_infos (id) on delete cascade,
  type        text not null check (type in ('mail', 'document', 'reunion', 'autre')),
  date_source date,
  expediteur  text,
  objet       text,
  lien        text,
  mail_ref    text,
  numero      integer,
  document_id uuid references gestion_projets.documents (id) on delete set null,
  reunion_id  uuid references gestion_projets.echeances (id) on delete set null,
  ajoute_par  text,
  created_at  timestamptz not null default now(),
  constraint sources_une_cible check (num_nonnulls(action_id, echeance_id, livrable_id, periode_id, point_id, info_id) = 1),
  constraint sources_contenu check (coalesce(objet, lien, mail_ref, document_id::text, reunion_id::text) is not null)
);
create index sources_action_idx on gestion_projets.sources (action_id) where action_id is not null;
create index sources_echeance_idx on gestion_projets.sources (echeance_id) where echeance_id is not null;
create index sources_livrable_idx on gestion_projets.sources (livrable_id) where livrable_id is not null;
create index sources_periode_idx on gestion_projets.sources (periode_id) where periode_id is not null;
create index sources_point_idx on gestion_projets.sources (point_id) where point_id is not null;
create index sources_info_idx on gestion_projets.sources (info_id) where info_id is not null;
-- Pas deux fois le même mail sur le même élément.
create unique index sources_mail_unique on gestion_projets.sources
  (coalesce(action_id, echeance_id, livrable_id, periode_id, point_id, info_id), mail_ref) where mail_ref is not null;

-- Règles : auteur imposé ; le secrétaire donne toujours date, expéditeur et objet d'un mail,
-- et n'ajoute des sources qu'aux actions, réunions (échéances), points et infos.
create or replace function gestion_projets_private.sources_regles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := gestion_projets_private.role_courant();
begin
  if v_role is not null then
    new.ajoute_par := v_role;
  end if;
  if v_role = 'secretaire' then
    if new.livrable_id is not null or new.periode_id is not null then
      raise exception 'Secrétaire : sources de livrables et de périodes réservées à Joseph';
    end if;
    if new.type = 'mail' and (new.date_source is null or nullif(trim(new.expediteur), '') is null or nullif(trim(new.objet), '') is null) then
      raise exception 'Secrétaire : pour un mail, la date, l''expéditeur et l''objet sont obligatoires';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function gestion_projets_private.sources_regles() from public;
create trigger sources_regles before insert on gestion_projets.sources
  for each row execute function gestion_projets_private.sources_regles();
create trigger sources_journal after insert or update or delete on gestion_projets.sources
  for each row execute function gestion_projets_private.journaliser();

grant select, insert, update, delete on gestion_projets.sources to authenticated;
grant all on gestion_projets.sources to service_role;
alter table gestion_projets.sources enable row level security;

create policy sources_lecture on gestion_projets.sources for select to authenticated
  using ((select gestion_projets_private.est_membre()));
create policy sources_ajout on gestion_projets.sources for insert to authenticated
  with check ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()));
create policy sources_modif on gestion_projets.sources for update to authenticated
  using ((select gestion_projets_private.est_admin())) with check ((select gestion_projets_private.est_admin()));
create policy sources_suppr on gestion_projets.sources for delete to authenticated
  using ((select gestion_projets_private.est_admin()));

-- Reprise : les dossiers de préparation cités en source deviennent des sources « document ».
insert into gestion_projets.sources (action_id, type, objet, document_id, ajoute_par)
select a.id, 'document', a.source, d.id, 'systeme'
from gestion_projets.actions a
left join lateral (select id from gestion_projets.documents where nom = a.source and present order by modifie_le desc nulls last limit 1) d on true
where a.source ~* '\.(docx?|xlsx?|pptx?|pdf)$';

insert into gestion_projets.sources (point_id, type, objet, document_id, ajoute_par)
select p.id, 'document', p.source, d.id, 'systeme'
from gestion_projets.reunion_points p
left join lateral (select id from gestion_projets.documents where nom = p.source and present order by modifie_le desc nulls last limit 1) d on true
where p.source ~* '\.(docx?|xlsx?|pptx?|pdf)$';

insert into gestion_projets.sources (info_id, type, objet, document_id, ajoute_par)
select i.id, 'document', i.source, d.id, 'systeme'
from gestion_projets.reunion_infos i
left join lateral (select id from gestion_projets.documents where nom = i.source and present order by modifie_le desc nulls last limit 1) d on true
where i.source ~* '\.(docx?|xlsx?|pptx?|pdf)$';

notify pgrst, 'reload schema';
