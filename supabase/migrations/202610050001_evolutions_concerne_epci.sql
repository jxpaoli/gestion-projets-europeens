-- Évolutions : distinguer ce qui concerne l'EPCI de Corse (ou la CCI de Corse avant sa reprise) de ce qui ne vise
-- qu'un autre partenaire. Le rapport direction grise les secondes ; rien n'est supprimé. Vrai par défaut.
alter table gestion_projets.evolutions add column concerne_epci boolean not null default true;
notify pgrst, 'reload schema';
