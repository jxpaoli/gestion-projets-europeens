update gestion_projets.evolutions e set concerne_epci = false
from gestion_projets.projets p
where p.id = e.projet_id and (
  (p.acronyme='GREENBAY' and (e.titre like 'AdSP MLO%' or e.titre like 'Chef de file : %' or e.titre like 'AdSP MTS : 26%'))
  or (p.acronyme='EASY2LOG' and (e.titre like 'PP7 : %'))
  or (p.acronyme='H2MOVE' and e.titre like 'Transfert de 75 000%')
  or (p.acronyme='JASON' and (e.titre like 'CCI du Var remplac%' or e.titre like 'CIMA : %'))
)
returning p.acronyme, left(e.titre,60) as titre;
