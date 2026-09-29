-- Le secrétaire peut créer les réunions (CdP, événements) annoncées par mail (validé par Joseph le 29/09/2026),
-- pour en remplir ensuite la fiche. Garde-fous appliqués par la base :
-- - création : type cdp ou evenement, statut « prévu », référence du mail obligatoire (mail_ref, citée ensuite
--   en source) ; pas deux réunions du même type pour le même projet le même jour ;
-- - modification : seulement les réunions qu'il a créées et que Joseph n'a pas touchées (date, lieu, horaires…) ;
--   jamais le projet, le type ni le statut ;
-- - jamais d'annulation ni de suppression (réservées à Joseph).
-- Ne touche que les schémas gestion_projets et gestion_projets_private.

alter table gestion_projets.echeances
  add column origine           text not null default 'import' check (origine in ('admin', 'secretaire', 'import')),
  add column modifie_par_admin boolean not null default false,
  add column mail_ref          text;

create or replace function gestion_projets_private.echeances_regles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := gestion_projets_private.role_courant();
begin
  if v_role = 'admin' then
    if tg_op = 'INSERT' then
      new.origine := 'admin';
      new.modifie_par_admin := true;
    else
      new.origine := old.origine;
      -- Toute modification de Joseph protège la réunion ; il peut la rendre au secrétaire (drapeau à false).
      if new.modifie_par_admin is not distinct from old.modifie_par_admin then
        new.modifie_par_admin := true;
      end if;
    end if;
  elsif v_role = 'secretaire' then
    if tg_op = 'INSERT' then
      new.origine := 'secretaire';
      new.modifie_par_admin := false;
      if new.type not in ('cdp', 'evenement') then
        raise exception 'Secrétaire : seules les réunions (CdP, événements) peuvent être créées';
      end if;
      if new.statut <> 'prevu' then
        raise exception 'Secrétaire : une réunion est créée au statut « prévu »';
      end if;
      if nullif(trim(new.mail_ref), '') is null then
        raise exception 'Secrétaire : la référence du mail qui annonce la réunion (mail_ref) est obligatoire';
      end if;
      if exists (select 1 from gestion_projets.echeances e
                 where e.projet_id = new.projet_id and e.type = new.type and e.date = new.date and e.statut <> 'annule') then
        raise exception 'Secrétaire : une réunion de ce type existe déjà pour ce projet à cette date';
      end if;
    else
      if old.origine <> 'secretaire' or old.modifie_par_admin then
        raise exception 'Secrétaire : réunion créée ou modifiée par Joseph, seule sa fiche peut être complétée';
      end if;
      if new.projet_id is distinct from old.projet_id or new.type is distinct from old.type
         or new.statut is distinct from old.statut then
        raise exception 'Secrétaire : projet, type et statut d''une réunion réservés à Joseph';
      end if;
      new.origine := old.origine;
      new.modifie_par_admin := false;
      new.mail_ref := old.mail_ref;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function gestion_projets_private.echeances_regles() from public;
create trigger echeances_regles before insert or update on gestion_projets.echeances
  for each row execute function gestion_projets_private.echeances_regles();

drop policy echeances_ajout on gestion_projets.echeances;
drop policy echeances_modif on gestion_projets.echeances;
create policy echeances_ajout on gestion_projets.echeances for insert to authenticated
  with check ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()));
create policy echeances_modif on gestion_projets.echeances for update to authenticated
  using ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()))
  with check ((select gestion_projets_private.est_admin()) or (select gestion_projets_private.est_secretaire()));

notify pgrst, 'reload schema';
