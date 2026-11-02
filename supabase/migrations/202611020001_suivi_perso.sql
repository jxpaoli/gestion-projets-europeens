-- « Mon suivi » (validé par Joseph le 02/11/2026) : tout ce qui engage Joseph hors projets européens
-- (CSE, CSE Central, CSSCT, NAO, RH, port et QSE, EPCI de Corse, rencontres, démarches personnelles).
-- Réservé à Joseph : lu et écrit par l'admin et le secrétaire seulement, jamais par un lecteur (direction, CDINNOV).
-- On n'y garde que la date, l'heure, le lieu, l'action attendue et la référence du mail (expéditeur, date, objet),
-- jamais le contenu d'un mail.
-- Garde-fous du secrétaire, appliqués par la base :
-- - création : référence du mail obligatoire (mail_ref), statut « à faire », pas deux fois le même mail pour le
--   même type d'élément ;
-- - modification : seulement ses propres éléments que Joseph n'a pas touchés ; « fait » seulement avec la preuve
--   (fait_source) ; jamais d'annulation ;
-- - jamais de suppression (réservée à Joseph).
-- Ne touche que les schémas gestion_projets et gestion_projets_private.

create table gestion_projets.suivi_perso (
  id                uuid primary key default gen_random_uuid(),
  type              text not null check (type in ('reunion', 'convocation', 'rendez_vous', 'action', 'echeance', 'info')),
  domaine           text not null default 'autre'
                    check (domaine in ('cse', 'cse_central', 'cssct', 'nao', 'rh', 'port_qse', 'epci', 'perso', 'autre')),
  libelle           text not null check (length(trim(libelle)) > 0),
  date              date,
  heure_debut       time,
  heure_fin         time,
  lieu              text,
  lien              text,
  action_attendue   text,
  echeance          date,
  statut            text not null default 'a_faire' check (statut in ('a_faire', 'fait', 'annule')),
  fait_source       text,
  source_date       date,
  source_expediteur text,
  source_objet      text,
  mail_ref          text,
  notes             text,
  origine           text not null default 'admin' check (origine in ('admin', 'secretaire')),
  modifie_par_admin boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index suivi_perso_date_idx on gestion_projets.suivi_perso (coalesce(date, echeance));
create unique index suivi_perso_mail_unique on gestion_projets.suivi_perso (mail_ref, type) where mail_ref is not null;

create or replace function gestion_projets_private.suivi_perso_regles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := gestion_projets_private.role_courant();
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  if v_role = 'admin' then
    if tg_op = 'INSERT' then
      new.origine := 'admin';
      new.modifie_par_admin := true;
    else
      new.origine := old.origine;
      -- Toute modification de Joseph protège l'élément ; il peut le rendre au secrétaire (drapeau à false).
      if new.modifie_par_admin is not distinct from old.modifie_par_admin then
        new.modifie_par_admin := true;
      end if;
    end if;
  elsif v_role = 'secretaire' then
    if tg_op = 'INSERT' then
      new.origine := 'secretaire';
      new.modifie_par_admin := false;
      if nullif(trim(new.mail_ref), '') is null then
        raise exception 'Secrétaire : la référence du mail (mail_ref) est obligatoire';
      end if;
      if new.source_date is null or nullif(trim(new.source_expediteur), '') is null or nullif(trim(new.source_objet), '') is null then
        raise exception 'Secrétaire : date, expéditeur et objet du mail source sont obligatoires';
      end if;
      if new.statut <> 'a_faire' then
        raise exception 'Secrétaire : un élément est créé au statut « à faire »';
      end if;
    else
      if old.origine <> 'secretaire' or old.modifie_par_admin then
        raise exception 'Secrétaire : élément saisi ou modifié par Joseph, modification refusée';
      end if;
      if new.statut = 'annule' and old.statut <> 'annule' then
        raise exception 'Secrétaire : seul Joseph peut annuler';
      end if;
      if new.statut = 'fait' and old.statut <> 'fait' and nullif(trim(new.fait_source), '') is null then
        raise exception 'Secrétaire : « fait » seulement avec la preuve (fait_source)';
      end if;
      if new.statut = 'a_faire' and old.statut = 'fait' then
        raise exception 'Secrétaire : réouverture réservée à Joseph';
      end if;
      new.origine := old.origine;
      new.modifie_par_admin := false;
      new.mail_ref := old.mail_ref;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function gestion_projets_private.suivi_perso_regles() from public;

create trigger suivi_perso_regles before insert or update on gestion_projets.suivi_perso
  for each row execute function gestion_projets_private.suivi_perso_regles();
create trigger suivi_perso_updated_at before update on gestion_projets.suivi_perso
  for each row execute function gestion_projets_private.maj_updated_at();
create trigger suivi_perso_journal after insert or update or delete on gestion_projets.suivi_perso
  for each row execute function gestion_projets_private.journaliser();

grant select, insert, update, delete on gestion_projets.suivi_perso to authenticated;
grant all on gestion_projets.suivi_perso to service_role;
alter table gestion_projets.suivi_perso enable row level security;

-- Pas de est_membre() ici : un lecteur ne voit rien.
create policy suivi_perso_lecture on gestion_projets.suivi_perso for select to authenticated
  using ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()));
create policy suivi_perso_ajout on gestion_projets.suivi_perso for insert to authenticated
  with check ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()));
create policy suivi_perso_modif on gestion_projets.suivi_perso for update to authenticated
  using ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()))
  with check ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()));
create policy suivi_perso_suppr on gestion_projets.suivi_perso for delete to authenticated
  using ((select gestion_projets_private.est_admin()));

notify pgrst, 'reload schema';
