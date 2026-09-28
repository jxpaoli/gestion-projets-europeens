-- Fiches projet (validé par Joseph le 28/09/2026) : synthèse en français du dernier formulaire de candidature
-- (Jems), rédigée par le secrétaire à partir du PDF, pour consultation sur PC.
-- Une ligne par projet et par version du formulaire ; l'appli affiche la version la plus récente.
-- Contenu (jsonb), textes en français, « page » = page du PDF d'origine :
--   recap        : titre, titre_origine, chef_de_file, priorite, objectif_specifique, duree, dates, budget_total,
--                  feder_total, taux_feder, resume, notre_role, notre_budget, notre_feder, a_retenir[]
--   partenaires  : [{ code, nom, pays, budget, feder, nous }]
--   commune      : [{ titre, page, texte }]            partie commune à tous les partenaires
--   lots         : [{ code, titre, page, resume, activites: [{ code, titre, page, texte, nous, notre_tache }],
--                     livrables: [{ code, titre, periode, nous, role }] }]
--   notre_partie : [{ titre, page, texte }]            fiche partenaire et ce qui ne concerne que nous
--   budget       : { page, categories: [{ libelle, montant }], periodes: [{ periode, montant }] }
--   ecarts       : [{ titre, texte, source }]          écarts avec d'autres pièces (annexe 5…)
-- Textes : paragraphes séparés par une ligne vide, lignes « - » pour les listes.
-- Règles du secrétaire : seulement une version plus récente que celles en base, PDF source obligatoire,
-- jamais de modification d'une fiche corrigée par Joseph. Lecture : tous les membres (admin, lecteurs, secrétaire).
-- Ne touche que les schémas gestion_projets et gestion_projets_private.

create table gestion_projets.fiches_projet (
  id                uuid primary key default gen_random_uuid(),
  projet_id         uuid not null references gestion_projets.projets (id) on delete cascade,
  version           numeric(6, 2) not null check (version > 0),
  date_export       date,
  langue_origine    text,
  partenaire        text,
  document_id       uuid references gestion_projets.documents (id) on delete set null,
  document_nom      text,
  contenu           jsonb not null,
  modifie_par_admin boolean not null default false,
  ajoute_par        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fiches_projet_version_unique unique (projet_id, version),
  constraint fiches_projet_contenu check (coalesce(jsonb_typeof(contenu -> 'recap') = 'object', false))
);

create or replace function gestion_projets_private.fiches_projet_regles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := gestion_projets_private.role_courant();
begin
  if tg_op = 'INSERT' and v_role is not null then
    new.ajoute_par := v_role;
  elsif tg_op = 'UPDATE' then
    new.ajoute_par := old.ajoute_par;
    new.created_at := old.created_at;
  end if;

  if v_role = 'admin' then
    -- Toute correction de Joseph protège la fiche ; il peut la rendre au secrétaire en remettant le drapeau à false.
    if tg_op = 'INSERT' then
      new.modifie_par_admin := true;
    elsif new.modifie_par_admin is not distinct from old.modifie_par_admin then
      new.modifie_par_admin := true;
    end if;
  elsif v_role = 'secretaire' then
    if new.document_id is null then
      raise exception 'Secrétaire : le PDF du formulaire (document source) est obligatoire';
    end if;
    if tg_op = 'INSERT' then
      new.modifie_par_admin := false;
      if exists (select 1 from gestion_projets.fiches_projet f where f.projet_id = new.projet_id and f.version >= new.version) then
        raise exception 'Secrétaire : une fiche de version égale ou plus récente existe déjà pour ce projet';
      end if;
    else
      if old.modifie_par_admin then
        raise exception 'Secrétaire : fiche corrigée par Joseph, modification refusée';
      end if;
      if new.projet_id is distinct from old.projet_id or new.version is distinct from old.version then
        raise exception 'Secrétaire : changement de projet ou de version interdit (déposer une nouvelle fiche)';
      end if;
      new.modifie_par_admin := false;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function gestion_projets_private.fiches_projet_regles() from public;

create trigger fiches_projet_regles before insert or update on gestion_projets.fiches_projet
  for each row execute function gestion_projets_private.fiches_projet_regles();
create trigger fiches_projet_updated_at before update on gestion_projets.fiches_projet
  for each row execute function gestion_projets_private.maj_updated_at();
create trigger fiches_projet_journal after insert or update or delete on gestion_projets.fiches_projet
  for each row execute function gestion_projets_private.journaliser();

grant select, insert, update, delete on gestion_projets.fiches_projet to authenticated;
grant all on gestion_projets.fiches_projet to service_role;
alter table gestion_projets.fiches_projet enable row level security;

create policy fiches_projet_lecture on gestion_projets.fiches_projet for select to authenticated
  using ((select gestion_projets_private.est_membre()));
create policy fiches_projet_ajout on gestion_projets.fiches_projet for insert to authenticated
  with check ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()));
create policy fiches_projet_modif on gestion_projets.fiches_projet for update to authenticated
  using ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()))
  with check ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()));
create policy fiches_projet_suppr on gestion_projets.fiches_projet for delete to authenticated
  using ((select gestion_projets_private.est_admin()));

notify pgrst, 'reload schema';
