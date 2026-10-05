"""Génère le SQL qui charge, depuis les extraction-calendrier.json, les dates des projets et des périodes dans l'appli.
Usage : python charger-calendrier.py [--ecrire]  puis  .\scripts\sql.ps1 -File <sortie>.sql
Sans --ecrire : requête de lecture seule qui liste ce qui serait changé. Avec --ecrire : applique.
Règles : projets approuvés seulement (pas ICON ni APPRODO, candidatures en cours d'examen) ;
dates : remplies si absentes, corrigées si différentes (signalées) ; prévu : rempli seulement s'il est vide,
jamais écrasé ; déclaré / certifié / payé / observations : jamais touchés (CDINNOV et Joseph font foi).
GREENBAY : les périodes sont celles de l'EPCI (PP6 seul : P4 24 000, P5 36 801,22, P6 29 597,52 ; P1 à P3 sans prévu).
"""
import json, sys, os

RACINE = r"C:\Users\jxpao\OneDrive - EPCI DE CORSE\Projets européens"
PROJETS = {"EASY2LOG": "easy2log", "JASON": "JASON", "BLUE HUB": "blu hub", "H2MOVE": "H2MOVE", "GREENBAY": "GREENBAY"}
ecrire = "--ecrire" in sys.argv

# EASY2LOG : l'extraction (PP8 d'origine, budget V5.0 approuvé) diffère des prévus déjà saisis ; on ne charge que les dates.
SANS_PREVU = {"EASY2LOG"}
GREENBAY_PP6 = {4: 24000.00, 5: 36801.22, 6: 29597.52}

lignes_p, lignes_pe = [], []
for acr, dossier in PROJETS.items():
    j = json.load(open(os.path.join(RACINE, dossier, "data", "extraction-calendrier.json"), encoding="utf-8-sig"))
    d = j["projet_dates"]
    lignes_p.append({"acronyme": acr, "date_debut": d["debut"], "date_fin": d["fin"]})
    for p in j["periodes"]:
        prevu = p.get("prevu_epci")
        if acr == "GREENBAY":
            prevu = GREENBAY_PP6.get(p["numero"])
        if acr in SANS_PREVU:
            prevu = None
        lignes_pe.append({"acronyme": acr, "numero": p["numero"], "date_debut": p["date_debut"],
                          "date_fin": p["date_fin"], "prevu": prevu})

payload = json.dumps({"projets": lignes_p, "periodes": lignes_pe}, ensure_ascii=False)
assert "$ch$" not in payload

base = f"""
with d as (select $ch${payload}$ch$::jsonb as j),
pj as (
  select r.acronyme, r.date_debut, r.date_fin from d, jsonb_to_recordset(d.j -> 'projets') as r(acronyme text, date_debut date, date_fin date)
),
pe as (
  select r.acronyme, r.numero, r.date_debut, r.date_fin, r.prevu
  from d, jsonb_to_recordset(d.j -> 'periodes') as r(acronyme text, numero int, date_debut date, date_fin date, prevu numeric)
)
"""

if not ecrire:
    sql = base + """
select 'projet' as quoi, p.acronyme, null::int as numero,
       concat_ws(' | ', case when p.date_debut is distinct from pj.date_debut then 'debut ' || coalesce(p.date_debut::text,'vide') || ' -> ' || pj.date_debut end,
                        case when p.date_fin is distinct from pj.date_fin then 'fin ' || coalesce(p.date_fin::text,'vide') || ' -> ' || pj.date_fin end) as changement
from gestion_projets.projets p join pj using (acronyme)
where p.date_debut is distinct from pj.date_debut or p.date_fin is distinct from pj.date_fin
union all
select 'periode', pe.acronyme, pe.numero,
       case when x.id is null then 'NOUVELLE ' || pe.date_debut || ' -> ' || pe.date_fin || ' prevu ' || coalesce(pe.prevu::text,'vide')
       else concat_ws(' | ',
         case when x.date_debut is distinct from pe.date_debut then 'debut ' || coalesce(x.date_debut::text,'vide') || ' -> ' || pe.date_debut end,
         case when x.date_fin is distinct from pe.date_fin then 'fin ' || coalesce(x.date_fin::text,'vide') || ' -> ' || pe.date_fin end,
         case when x.prevu is null and pe.prevu is not null then 'prevu vide -> ' || pe.prevu
              when x.prevu is not null and pe.prevu is not null and x.prevu <> pe.prevu then 'prevu GARDE ' || x.prevu || ' (extraction ' || pe.prevu || ')' end) end
from pe join gestion_projets.projets p on p.acronyme = pe.acronyme
left join gestion_projets.periodes x on x.projet_id = p.id and x.numero = pe.numero
where x.id is null or x.date_debut is distinct from pe.date_debut or x.date_fin is distinct from pe.date_fin
   or (x.prevu is null and pe.prevu is not null) or (x.prevu is not null and pe.prevu is not null and x.prevu <> pe.prevu)
order by 2, 1, 3;
"""
else:
    sql = base + """,
u1 as (
  update gestion_projets.projets p set date_debut = pj.date_debut, date_fin = pj.date_fin, updated_at = now()
  from pj where p.acronyme = pj.acronyme and (p.date_debut is distinct from pj.date_debut or p.date_fin is distinct from pj.date_fin)
  returning p.acronyme
),
u2 as (
  update gestion_projets.periodes x set date_debut = pe.date_debut, date_fin = pe.date_fin,
         prevu = coalesce(x.prevu, pe.prevu), updated_at = now()
  from pe join gestion_projets.projets p on p.acronyme = pe.acronyme
  where x.projet_id = p.id and x.numero = pe.numero
    and (x.date_debut is distinct from pe.date_debut or x.date_fin is distinct from pe.date_fin or (x.prevu is null and pe.prevu is not null))
  returning x.id
),
i2 as (
  insert into gestion_projets.periodes (projet_id, numero, date_debut, date_fin, prevu)
  select p.id, pe.numero, pe.date_debut, pe.date_fin, pe.prevu
  from pe join gestion_projets.projets p on p.acronyme = pe.acronyme
  where not exists (select 1 from gestion_projets.periodes x where x.projet_id = p.id and x.numero = pe.numero)
  returning id
)
select (select count(*) from u1) as projets_maj, (select count(*) from u2) as periodes_maj, (select count(*) from i2) as periodes_ajoutees;
"""

sortie = os.path.join(os.path.dirname(os.path.abspath(__file__)), "charger-calendrier-" + ("ecrire" if ecrire else "essai") + ".sql")
open(sortie, "w", encoding="utf-8").write(sql)
print(sortie)
