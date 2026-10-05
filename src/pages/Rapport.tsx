import { useState } from "react";
import { Link } from "react-router-dom";
import { useDonnees } from "../donnees";
import { ajouterJours, aujourdhui, date, LIB_STATUT_LIVRABLE, LIB_TYPE_ECHEANCE, montant, pourcent } from "../format";
import { calculer, dateRealisation, debutProjet } from "../indicateurs";
import { LIB_STATUT_EVO, LIB_TYPE_EVO } from "../Evolutions";
import { BudgetPeriodes, GanttProjets } from "../GraphiquesRapport";
import type { Action, Periode } from "../types";

const somme = (ps: Periode[], k: "prevu" | "declare" | "certifie" | "paye") => {
  const v = ps.map((p) => p[k]).filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const libMois = (iso: string) => `${MOIS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

// Rapport pour la direction, à la demande : une page propre à imprimer ou enregistrer en PDF.
// Période : depuis le début de chaque projet (bilan) ou depuis une date choisie.
export default function Rapport() {
  const { donnees } = useDonnees();
  const auj = aujourdhui();
  const [mode, setMode] = useState<"debut" | "date">("debut");
  const [depuisChoisi, setDepuis] = useState(ajouterJours(auj, -30));
  const [horizon, setHorizon] = useState(30);
  const [choix, setChoix] = useState<string[]>([]);
  if (!donnees) return null;

  const projets = donnees.projets.filter((p) => p.actif && (choix.length === 0 || choix.includes(p.id)));
  const fin = ajouterJours(auj, horizon);
  const basculer = (id: string) => setChoix((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  // Début de la période pour un projet ; null = aucune trace (tout est pris).
  const depuisDe = (id: string) => (mode === "debut" ? debutProjet(donnees, id).date : depuisChoisi);
  const faitesDe = (id: string) => {
    const depuis = depuisDe(id);
    return donnees.actions
      .filter((a) => a.projet_id === id)
      .map((a) => ({ a, le: dateRealisation(a, donnees.sources) }))
      .filter((x): x is { a: Action; le: string } => !!x.le && (!depuis || x.le >= depuis))
      .sort((x, y) => x.le.localeCompare(y.le));
  };
  const libPeriode = mode === "debut" ? "depuis le début" : `depuis le ${date(depuisChoisi)}`;

  return (
    <div className="rapport">
      <div className="rapport-reglages no-print">
        <Link to="/" className="btn-lien">← Retour</Link>
        <div className="titre">Rapport pour la direction</div>
        <label>Période couverte</label>
        <div className="chips">
          <button className={`chip${mode === "debut" ? " on" : ""}`} onClick={() => setMode("debut")}>Depuis le début de chaque projet</button>
          <button className={`chip${mode === "date" ? " on" : ""}`} onClick={() => setMode("date")}>Depuis une date</button>
        </div>
        <div className="grille2">
          {mode === "date"
            ? <div><label htmlFor="r-depuis">Réalisations depuis le</label><input id="r-depuis" type="date" value={depuisChoisi} onChange={(e) => setDepuis(e.target.value)} /></div>
            : <div className="muted" style={{ fontSize: 13, alignSelf: "end" }}>Chaque projet part de sa date de début (à défaut, de sa plus ancienne trace : réunion ou mail).</div>}
          <div>
            <label htmlFor="r-horizon">Échéances à venir</label>
            <select id="r-horizon" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
              <option value={30}>1 mois</option><option value={60}>2 mois</option><option value={90}>3 mois</option>
            </select>
          </div>
        </div>
        <label>Projets</label>
        <div className="chips">
          <button className={`chip${choix.length === 0 ? " on" : ""}`} onClick={() => setChoix([])}>Tous</button>
          {donnees.projets.filter((p) => p.actif).map((p) => (
            <button key={p.id} className={`chip${choix.includes(p.id) ? " on" : ""}`} onClick={() => basculer(p.id)}>{p.acronyme}</button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => window.print()}>🖨️ Imprimer / enregistrer en PDF</button>
      </div>

      <article className="feuille">
        <header className="feuille-tete">
          <img src="/logo-192.png" alt="" />
          <div>
            <h1>Projets européens – {mode === "debut" ? "bilan d’avancement" : "point d’avancement"}</h1>
            <div>EPCI de Corse – Ports de Haute-Corse · au {date(auj)}{mode === "date" ? ` · période du ${date(depuisChoisi)}` : ""}</div>
          </div>
        </header>

        <section>
          <h2>Synthèse</h2>
          <table className="tab">
            <thead><tr><th>Projet</th>{mode === "debut" && <th>Début</th>}<th>Réalisées {libPeriode}</th><th>Ouvertes</th><th>En retard</th><th>Livrables approuvés</th><th>Budget déclaré</th><th>Prochain CdP</th></tr></thead>
            <tbody>
              {projets.map((p) => {
                const ind = calculer(donnees, p.id);
                const debut = debutProjet(donnees, p.id);
                const cdp = donnees.echeances.find((e) => e.projet_id === p.id && e.type === "cdp" && e.statut === "prevu" && e.date >= auj);
                return (
                  <tr key={p.id}>
                    <td><b>{p.acronyme}</b></td>
                    {mode === "debut" && <td>{debut.date ? `${date(debut.date)}${debut.estime ? " *" : ""}` : "—"}</td>}
                    <td>{faitesDe(p.id).length}</td>
                    <td>{ind.ouvertes}</td>
                    <td className={ind.retards ? "alerte" : ""}>{ind.retards}</td>
                    <td>{ind.livrablesApprouves} / {ind.livrablesTotal}</td>
                    <td>{ind.budget ? pourcent((ind.declare ?? 0) / ind.budget) : "—"}</td>
                    <td>{cdp ? date(cdp.date) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {mode === "debut" && projets.some((p) => debutProjet(donnees, p.id).estime) && (
            <p className="muted" style={{ fontSize: 11.5 }}>* Date de début non saisie : plus ancienne trace du projet dans l’appli (réunion ou mail).</p>
          )}
        </section>

        <section>
          <h2>Calendrier des projets</h2>
          <GanttProjets projets={projets} periodes={donnees.periodes} />
        </section>

        {projets.map((p) => {
          const depuis = depuisDe(p.id);
          const ps = donnees.periodes.filter((x) => x.projet_id === p.id);
          const faites = faitesDe(p.id);
          const retards = donnees.actions.filter((a) => a.projet_id === p.id && (a.statut === "a_faire" || a.statut === "en_cours") && a.echeance && a.echeance < auj)
            .sort((a, b) => (a.echeance ?? "").localeCompare(b.echeance ?? ""));
          const tenues = donnees.echeances.filter((e) => e.projet_id === p.id && e.statut !== "annule" && e.date < auj && (!depuis || e.date >= depuis));
          const aVenir = donnees.echeances.filter((e) => e.projet_id === p.id && e.statut === "prevu" && e.date >= auj && e.date <= fin);
          const livrables = donnees.livrables.filter((l) => l.projet_id === p.id);
          const evolutions = donnees.evolutions.filter((e) => e.projet_id === p.id && e.statut !== "abandonne" && (!depuis || e.date_evolution >= depuis));
          const declare = somme(ps, "declare");
          const debut = debutProjet(donnees, p.id);
          // Réalisations regroupées par mois : c'est la chronologie du projet.
          const parMois = new Map<string, typeof faites>();
          for (const x of faites) parMois.set(x.le.slice(0, 7), [...(parMois.get(x.le.slice(0, 7)) ?? []), x]);
          return (
            <section key={p.id} className="projet-rapport">
              <h2>{p.acronyme}{p.titre ? <span className="sous"> – {p.titre}</span> : null}</h2>
              <div className="fiche-ligne">
                {p.programme && <span>{p.programme}</span>}
                {p.chef_de_file && <span>Chef de file : {p.chef_de_file}</span>}
                <span>{p.date_debut ? date(p.date_debut) : debut.date ? `1re trace le ${date(debut.date)}` : "—"} → {date(p.date_fin)}</span>
                <span>Budget EPCI de Corse : {montant(p.budget_epci)}</span>
                <span>Déclaré : {montant(declare)}{p.budget_epci && declare != null ? ` (${pourcent(declare / p.budget_epci)})` : ""}</span>
              </div>

              <h3>Réalisé {mode === "debut" ? "depuis le début" : `depuis le ${date(depuis)}`} ({faites.length})</h3>
              {faites.length === 0 ? <p className="muted">Rien d’enregistré sur la période.</p>
                : mode === "debut" ? (
                  [...parMois].map(([m, xs]) => (
                    <div key={m} className="mois-rapport">
                      <div className="mois-lib">{libMois(m)}</div>
                      <ul>{xs.map(({ a, le }) => <li key={a.id}>{a.libelle} <span className="muted">({date(le)})</span></li>)}</ul>
                    </div>
                  ))
                ) : <ul>{faites.map(({ a, le }) => <li key={a.id}>{a.libelle} <span className="muted">({date(le)})</span></li>)}</ul>}

              {tenues.length > 0 && (
                <>
                  <h3>Réunions et étapes passées ({tenues.length})</h3>
                  <ul className="compact">{tenues.map((e) => <li key={e.id}><b>{date(e.date)}</b> – {LIB_TYPE_ECHEANCE[e.type]} : {e.libelle}{e.lieu_nom || e.lieu ? ` (${e.lieu_nom || e.lieu})` : ""}</li>)}</ul>
                </>
              )}

              {evolutions.length > 0 && (
                <>
                  <h3>Écarts par rapport au formulaire ({evolutions.length})</h3>
                  <ul>{evolutions.map((e) => (
                    <li key={e.id}>{LIB_TYPE_EVO[e.type].replace(/^\S+\s/, "")}{e.element ? ` ${e.element}` : ""} : {e.titre}
                      <span className="muted"> ({LIB_STATUT_EVO[e.statut].toLowerCase()}, {date(e.date_evolution)})</span></li>
                  ))}</ul>
                </>
              )}

              <h3>Points d’attention : actions en retard ({retards.length})</h3>
              {retards.length ? <ul>{retards.slice(0, 10).map((a) => <li key={a.id}>{a.libelle} <span className="muted">(prévu le {date(a.echeance)}{a.responsable ? `, ${a.responsable}` : ""})</span></li>)}</ul> : <p className="muted">Aucune.</p>}
              {retards.length > 10 && <p className="muted">… et {retards.length - 10} autre(s).</p>}

              <h3>Échéances à venir</h3>
              {aVenir.length ? (
                <ul>{aVenir.map((e) => <li key={e.id}><b>{date(e.date)}</b> – {LIB_TYPE_ECHEANCE[e.type]} : {e.libelle}{e.lieu_nom || e.lieu ? ` (${e.lieu_nom || e.lieu})` : ""}</li>)}</ul>
              ) : <p className="muted">Aucune sur la période.</p>}

              {livrables.length > 0 && (
                <>
                  <h3>Livrables</h3>
                  <table className="tab">
                    <thead><tr><th>Code</th><th>Livrable</th><th>Échéance</th><th>État</th></tr></thead>
                    <tbody>{livrables.map((l) => <tr key={l.id}><td>{l.code ?? ""}</td><td>{l.titre}</td><td>{date(l.echeance)}</td><td>{LIB_STATUT_LIVRABLE[l.statut]}</td></tr>)}</tbody>
                  </table>
                </>
              )}

              {ps.some((x) => x.prevu != null || x.declare != null) && (
                <>
                  <h3>Finances par période (part EPCI de Corse)</h3>
                  <BudgetPeriodes periodes={ps} couleur={p.couleur} />
                  <table className="tab">
                    <thead><tr><th>Période</th><th>Prévu</th><th>Déclaré</th><th>Certifié</th><th>Payé</th></tr></thead>
                    <tbody>{ps.map((x) => <tr key={x.id}><td>P{x.numero}</td><td>{montant(x.prevu)}</td><td>{montant(x.declare)}</td><td>{montant(x.certifie)}</td><td>{montant(x.paye)}</td></tr>)}</tbody>
                  </table>
                </>
              )}
            </section>
          );
        })}
        <footer className="feuille-pied">Source : appli Projets européens (europa.master.corsica), données au {date(auj)}. Dates de réalisation : mail le plus récent relié à l’action, sinon date de validation.</footer>
      </article>
    </div>
  );
}
