-- Journal des évolutions des projets (validé par Joseph le 28/09/2026) : ce qui a bougé par rapport au formulaire
-- de candidature pendant la mise en œuvre (retards, calendrier, budget, activités, livrables, partenariat,
-- décisions de CdP), sans toucher à la fiche projet d'origine.
-- Tout est noté, officiel ou non, avec un statut : constaté → proposé → validé en CdP → approuvé par le programme
-- → intégré dans une nouvelle version du formulaire (ou abandonné).
-- « element » = code de l'élément concerné tel qu'il apparaît dans le formulaire (WP2, A4.2, D1.3.1, P3…) ou vide.
-- Écriture : Joseph et le secrétaire (qui ne modifie jamais une entrée touchée par Joseph, ni ne l'abandonne) ;
-- lecture : tous les membres. Sources : table sources (colonne evolution_id).
-- Ne touche que les schémas gestion_projets et gestion_projets_private.

create table gestion_projets.evolutions (
  id                uuid primary key default gen_random_uuid(),
  projet_id         uuid not null references gestion_projets.projets (id) on delete cascade,
  date_evolution    date not null,
  type              text not null check (type in ('retard', 'calendrier', 'budget', 'activite', 'livrable', 'partenariat', 'decision', 'autre')),
  element           text,
  titre             text not null check (length(trim(titre)) > 0),
  avant             text,
  apres             text,
  motif             text,
  statut            text not null default 'constate'
                    check (statut in ('constate', 'propose', 'valide_cdp', 'approuve', 'integre', 'abandonne')),
  version_integree  numeric(6, 2),
  modifie_par_admin boolean not null default false,
  ajoute_par        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index evolutions_projet_idx on gestion_projets.evolutions (projet_id, date_evolution);

create or replace function gestion_projets_private.evolutions_regles()
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
    -- Toute saisie ou correction de Joseph protège l'entrée ; il peut la rendre au secrétaire (drapeau à false).
    if tg_op = 'INSERT' or new.modifie_par_admin is not distinct from old.modifie_par_admin then
      new.modifie_par_admin := true;
    end if;
  elsif v_role = 'secretaire' then
    if new.statut = 'abandonne' and (tg_op = 'INSERT' or old.statut <> 'abandonne') then
      raise exception 'Secrétaire : seul Joseph peut abandonner une évolution';
    end if;
    if tg_op = 'INSERT' then
      new.modifie_par_admin := false;
    else
      if old.modifie_par_admin then
        raise exception 'Secrétaire : évolution saisie ou corrigée par Joseph, modification refusée';
      end if;
      if new.projet_id is distinct from old.projet_id then
        raise exception 'Secrétaire : changement de projet interdit';
      end if;
      new.modifie_par_admin := false;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function gestion_projets_private.evolutions_regles() from public;

create trigger evolutions_regles before insert or update on gestion_projets.evolutions
  for each row execute function gestion_projets_private.evolutions_regles();
create trigger evolutions_updated_at before update on gestion_projets.evolutions
  for each row execute function gestion_projets_private.maj_updated_at();
create trigger evolutions_journal after insert or update or delete on gestion_projets.evolutions
  for each row execute function gestion_projets_private.journaliser();

grant select, insert, update, delete on gestion_projets.evolutions to authenticated;
grant all on gestion_projets.evolutions to service_role;
alter table gestion_projets.evolutions enable row level security;

create policy evolutions_lecture on gestion_projets.evolutions for select to authenticated
  using ((select gestion_projets_private.est_membre()));
create policy evolutions_ajout on gestion_projets.evolutions for insert to authenticated
  with check ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()));
create policy evolutions_modif on gestion_projets.evolutions for update to authenticated
  using ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()))
  with check ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()));
create policy evolutions_suppr on gestion_projets.evolutions for delete to authenticated
  using ((select gestion_projets_private.est_admin()));

-- Sources : une évolution peut avoir ses sources (PV de CdP, demande de modification, mail…).
alter table gestion_projets.sources
  add column evolution_id uuid references gestion_projets.evolutions (id) on delete cascade;
create index sources_evolution_idx on gestion_projets.sources (evolution_id) where evolution_id is not null;
alter table gestion_projets.sources drop constraint sources_une_cible;
alter table gestion_projets.sources add constraint sources_une_cible
  check (num_nonnulls(action_id, echeance_id, livrable_id, periode_id, point_id, info_id, evolution_id) = 1);
drop index gestion_projets.sources_mail_unique;
create unique index sources_mail_unique on gestion_projets.sources
  (coalesce(action_id, echeance_id, livrable_id, periode_id, point_id, info_id, evolution_id), mail_ref) where mail_ref is not null;

notify pgrst, 'reload schema';
