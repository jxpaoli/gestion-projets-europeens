import { useState } from "react";
import { Link } from "react-router-dom";
import { useDonnees } from "../donnees";
import { ajouterJours, aujourdhui, date, horaire, jourMois } from "../format";
import { quandSuivi } from "./MonSuivi";
import type { Action } from "../types";

// Semaine en cours : grille de 8h à 18h. Ce qui tombe avant 8h ou après 18h reste visible dans une case à part.
const DEBUT = 8 * 60;
const FIN = 18 * 60;
const PX_HEURE = 56;
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const ouverte = (s: string) => s === "a_faire" || s === "en_cours";

const minutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
// Lundi de la semaine qui contient le jour donné (AAAA-MM-JJ).
const lundi = (iso: string) => {
  const j = (new Date(`${iso}T12:00:00`).getDay() + 6) % 7;
  return ajouterJours(iso, -j);
};

interface Item {
  cle: string;
  titre: string;
  detail: string;
  lien?: string;
  action?: Action;
}
interface Bloc extends Item {
  debut: number;
  fin: number;
  suivi: boolean;
  couleur: string | null;
}
interface Journee {
  journee: Item[];
  blocs: Bloc[];
  avant: Item[];
  apres: Item[];
}

// Place les cases qui se chevauchent côte à côte : une voie par cases simultanées.
function voies(blocs: Bloc[]) {
  const fins: number[] = [];
  const placees = [...blocs].sort((a, b) => a.debut - b.debut).map((b) => {
    let v = fins.findIndex((f) => f <= b.debut);
    if (v === -1) { v = fins.length; fins.push(b.fin); } else fins[v] = b.fin;
    return { ...b, voie: v };
  });
  return { placees, nb: Math.max(1, fins.length) };
}

export default function Semaine() {
  const { donnees, projet, estAdmin, setEditer } = useDonnees();
  const [ancre, setAncre] = useState(aujourdhui());
  const auj = aujourdhui();
  const debut = lundi(ancre);
  const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(debut, i));
  const fin = jours[6];
  const dansLaSemaine = (iso: string | null | undefined): iso is string => !!iso && iso >= debut && iso <= fin;

  // Calcul à chaque affichage : quelques centaines d'éléments au plus pour une semaine.
  const parJour = (() => {
    const vue = new Map<string, Journee>(jours.map((j) => [j, { journee: [], blocs: [], avant: [], apres: [] }]));
    if (!donnees) return vue;

    // Case horaire : dans la grille, avant 8h ou après 18h selon l'heure de début.
    const placer = (jour: string, debutHeure: string | null, finHeure: string | null, item: Item, suivi: boolean, couleur: string | null) => {
      const j = vue.get(jour);
      if (!j) return;
      if (!debutHeure) { j.journee.push(item); return; }
      const d = minutes(debutHeure);
      const f = finHeure ? Math.max(minutes(finHeure), d + 30) : d + 60;
      if (d < DEBUT) j.avant.push({ ...item, detail: `${debutHeure.slice(0, 5)} · ${item.detail}` });
      else if (d >= FIN) j.apres.push({ ...item, detail: `${debutHeure.slice(0, 5)} · ${item.detail}` });
      else j.blocs.push({ ...item, debut: d, fin: Math.min(f, FIN), suivi, couleur });
    };

    for (const e of donnees.echeances) {
      if (e.statut !== "prevu" || !dansLaSemaine(e.date)) continue;
      placer(e.date, e.heure_debut, e.heure_fin,
        { cle: `e${e.id}`, titre: e.libelle, detail: [horaire(e.heure_debut, e.heure_fin), e.lieu_nom || e.lieu].filter(Boolean).join(" · "), lien: `/reunions/${e.id}` },
        false, projet(e.projet_id)?.couleur ?? null);
    }
    for (const a of donnees.actions) {
      if (!ouverte(a.statut) || !dansLaSemaine(a.echeance)) continue;
      vue.get(a.echeance)?.journee.push({ cle: `a${a.id}`, titre: a.libelle, detail: `Action · ${projet(a.projet_id)?.acronyme ?? ""}`, action: a });
    }
    for (const v of donnees.livrables) {
      if (!ouverte(v.statut) || !dansLaSemaine(v.echeance)) continue;
      vue.get(v.echeance)?.journee.push({ cle: `l${v.id}`, titre: [v.code, v.titre].filter(Boolean).join(" – "), detail: `Livrable · ${projet(v.projet_id)?.acronyme ?? ""}`, lien: v.lien ?? undefined });
    }
    // « Mon suivi » : admin seulement (la liste est vide pour un lecteur).
    for (const s of donnees.suivi) {
      const quand = quandSuivi(s);
      if (s.statut !== "a_faire" || !dansLaSemaine(quand)) continue;
      placer(quand, s.heure_debut, s.heure_fin,
        { cle: `s${s.id}`, titre: s.libelle, detail: [horaire(s.heure_debut, s.heure_fin), s.lieu].filter(Boolean).join(" · "), lien: "/suivi" },
        true, null);
    }
    return vue;
  })();

  const hauteur = ((FIN - DEBUT) / 60) * PX_HEURE;
  const heures = Array.from({ length: (FIN - DEBUT) / 60 }, (_, i) => DEBUT / 60 + i);

  // Une case : lien si elle en a un, action cliquable pour l'admin, sinon texte.
  const contenu = (it: Item, classe: string) => {
    const texte = (
      <>
        <div className="semaine-titre">{it.titre}</div>
        {it.detail && <div className="semaine-detail">{it.detail}</div>}
      </>
    );
    if (it.lien) return <Link to={it.lien} className={classe} key={it.cle}>{texte}</Link>;
    if (it.action && estAdmin) return <div className={`${classe} cliquable`} key={it.cle} onClick={() => setEditer(it.action!)}>{texte}</div>;
    return <div className={classe} key={it.cle}>{texte}</div>;
  };

  return (
    <>
      <div className="titre">Semaine</div>
      <div className="semaine-nav">
        <button className="btn" onClick={() => setAncre(ajouterJours(debut, -7))}>‹ Précédente</button>
        <button className="btn" onClick={() => setAncre(auj)}>Cette semaine</button>
        <button className="btn" onClick={() => setAncre(ajouterJours(debut, 7))}>Suivante ›</button>
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Du {date(debut)} au {date(fin)}</div>

      <div className="semaine-scroll">
        <div className="semaine-grille">
          <div className="semaine-coin" />
          {jours.map((j, i) => (
            <div key={j} className={`semaine-entete${j === auj ? " auj" : ""}`}>
              <b>{JOURS[i]}</b> {jourMois(j).jour} {jourMois(j).mois}
            </div>
          ))}

          <div className="semaine-ligne-lib">Journée</div>
          {jours.map((j) => (
            <div key={j} className="semaine-journee">
              {parJour.get(j)!.journee.map((it) => contenu(it, "semaine-case"))}
            </div>
          ))}

          <div className="semaine-ligne-lib">Avant 8h</div>
          {jours.map((j) => (
            <div key={j} className="semaine-deborde">
              {parJour.get(j)!.avant.map((it) => contenu(it, "semaine-case"))}
            </div>
          ))}

          <div className="semaine-heures" style={{ height: hauteur }}>
            {heures.map((h) => <span key={h} style={{ top: (h - DEBUT / 60) * PX_HEURE }}>{h}h</span>)}
          </div>
          {jours.map((j) => {
            const { placees, nb } = voies(parJour.get(j)!.blocs);
            return (
              <div key={j} className="semaine-colonne" style={{ height: hauteur }}>
                {placees.map((b) => (
                  <div key={b.cle} className={`semaine-bloc${b.suivi ? " suivi" : ""}`}
                    style={{
                      top: ((b.debut - DEBUT) / 60) * PX_HEURE,
                      height: ((b.fin - b.debut) / 60) * PX_HEURE - 2,
                      left: `${(b.voie * 100) / nb}%`,
                      width: `calc(${100 / nb}% - 2px)`,
                      background: b.couleur ?? undefined,
                    }}>
                    {b.lien
                      ? <Link to={b.lien} className="semaine-bloc-lien">{b.titre}<span>{b.detail}</span></Link>
                      : <>{b.titre}<span>{b.detail}</span></>}
                  </div>
                ))}
              </div>
            );
          })}

          <div className="semaine-ligne-lib">Après 18h</div>
          {jours.map((j) => (
            <div key={j} className="semaine-deborde">
              {parJour.get(j)!.apres.map((it) => contenu(it, "semaine-case"))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
