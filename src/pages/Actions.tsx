import { useMemo, useState } from "react";
import { useDonnees } from "../donnees";
import { aujourdhui, date, LIB_PRIORITE, LIB_STATUT_ACTION } from "../format";
import { BadgesTicket, BlocDate, CaseFait, FiltreProjets, PastilleProjet } from "../composants";
import { BoutonSources } from "../Sources";
import { MON_NOM, usePreference } from "../preferences";
import { telechargerCsv } from "../csv";
import type { Action } from "../types";

const ouverte = (a: Action, cocheesIci: Set<string>) => a.statut === "a_faire" || a.statut === "en_cours" || cocheesIci.has(a.id);
// Priorité haute en tête ; à priorité égale, l'ordre par échéance est conservé (tri stable).
const parPriorite = (x: Action, y: Action) => (x.priorite === "haute" ? 0 : 1) - (y.priorite === "haute" ? 0 : 1);

// projetId : intégré à l'espace projet (filtre imposé, sans titre ni choix du projet).
export default function Actions({ projetId }: { projetId?: string }) {
  const { donnees, projet, estAdmin, cocherAction, setEditer } = useDonnees();
  const [choix, setFiltre] = useState("");
  const filtre = projetId ?? choix;
  const [responsable, setResponsable] = useState("");
  // « Mon travail » : même principe que l'Agenda (admin seulement, espace projet compris à part).
  const [mesActions, setMesActions] = usePreference("actions.mes", estAdmin);
  const [recherche, setRecherche] = useState("");
  const [voirFaites, setVoirFaites] = useState(false);
  // Une action cochée reste visible à sa place jusqu'au prochain changement d'écran : on peut la décocher.
  const [cocheesIci, setCocheesIci] = useState<Set<string>>(new Set());
  const auj = aujourdhui();
  const moi = estAdmin && mesActions && !projetId;

  const responsables = useMemo(
    () => [...new Set((donnees?.actions ?? []).map((a) => a.responsable).filter((r): r is string => !!r))].sort((a, b) => a.localeCompare(b, "fr")),
    [donnees],
  );

  if (!donnees) return null;
  const requete = recherche.trim().toLowerCase();
  // Un responsable choisi dans la liste l'emporte sur « Mon travail ».
  const selection = donnees.actions.filter((a) =>
    (!filtre || a.projet_id === filtre)
    && (responsable ? a.responsable === responsable : !moi || !a.responsable || a.responsable === MON_NOM)
    && (!requete || [a.libelle, a.notes, a.source, a.responsable].some((t) => t?.toLowerCase().includes(requete))));
  const ouvertes = selection.filter((a) => ouverte(a, cocheesIci));
  const enRetard = ouvertes.filter((a) => a.echeance && a.echeance < auj).sort(parPriorite);
  const aVenir = ouvertes.filter((a) => !a.echeance || a.echeance >= auj).sort(parPriorite);
  const faites = selection.filter((a) => !ouverte(a, cocheesIci));

  const cocher = (a: Action) => {
    if (a.statut !== "fait") setCocheesIci((s) => new Set(s).add(a.id));
    void cocherAction(a);
  };

  const exporter = () => {
    telechargerCsv(`actions-${auj}.csv`, [
      ["Projet", "Action", "Responsable", "Échéance", "Statut", "Priorité", "Source", "Notes"],
      ...selection.map((a) => [projet(a.projet_id)?.acronyme ?? "", a.libelle, a.responsable, a.echeance ? date(a.echeance) : "",
        LIB_STATUT_ACTION[a.statut], LIB_PRIORITE[a.priorite], a.source, a.notes]),
    ]);
  };

  const ligne = (a: Action, retard = false) => (
    <div className={`item${a.statut === "fait" ? " fait" : ""}`} key={a.id}>
      {estAdmin && a.statut !== "abandonne" && <CaseFait fait={a.statut === "fait"} onClick={() => cocher(a)} />}
      <BlocDate iso={a.echeance} retard={retard && a.statut !== "fait"} />
      <div className="corps">
        {estAdmin
          ? <div className="libelle cliquable" onClick={() => setEditer(a)}>{a.libelle}</div>
          : <div className="libelle">{a.libelle}</div>}
        <div className="meta">
          <PastilleProjet projet={projet(a.projet_id)} />
          {a.priorite === "haute" && a.statut !== "fait" && <span className="badge rouge">Priorité haute</span>}
          {a.statut !== "fait" && <span className={`badge${a.statut === "en_cours" ? " orange" : ""}`}>{LIB_STATUT_ACTION[a.statut]}</span>}
          <BadgesTicket a={a} />
          {a.responsable && <span>{a.responsable}</span>}
          <BoutonSources cible={{ champ: "action_id", id: a.id, titre: a.libelle, projetId: a.projet_id, texte: a.source }} />
        </div>
        {a.notes && <div className="meta">{a.notes}</div>}
      </div>
    </div>
  );

  return (
    <>
      {!projetId && <div className="titre">Actions</div>}
      {!projetId && <FiltreProjets projets={donnees.projets.filter((p) => p.actif)} valeur={filtre} onChange={setFiltre} />}
      {estAdmin && !projetId && (
        <div className="chips">
          <button className={`chip${mesActions ? " on" : ""}`} onClick={() => setMesActions(true)}>Mon travail</button>
          <button className={`chip${!mesActions ? " on" : ""}`} onClick={() => setMesActions(false)}>Tout le monde</button>
        </div>
      )}
      <div className="filtres">
        <input type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label="Rechercher une action"
          placeholder="Rechercher (libellé, source, notes…)" />
        <select value={responsable} onChange={(e) => setResponsable(e.target.value)} aria-label="Responsable">
          <option value="">Tous les responsables</option>
          {responsables.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" className="btn" onClick={exporter} disabled={selection.length === 0} title="Exporter la liste affichée (CSV, Excel)">⤓ CSV</button>
      </div>

      <div className="sec">En retard ({enRetard.filter((a) => a.statut !== "fait").length})</div>
      {enRetard.length ? <div className="liste">{enRetard.map((a) => ligne(a, true))}</div> : <div className="vide">Aucune action en retard.</div>}

      <div className="sec">À venir ({aVenir.filter((a) => a.statut !== "fait").length})</div>
      {aVenir.length ? <div className="liste">{aVenir.map((a) => ligne(a))}</div> : <div className="vide">Aucune action à venir.</div>}

      <div className="sec">Terminées ({faites.length})</div>
      {voirFaites
        ? <div className="liste">{faites.map((a) => ligne(a))}</div>
        : <button className="btn-lien" onClick={() => setVoirFaites(true)}>Afficher les actions terminées</button>}
      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>Au {date(auj)}.</p>
    </>
  );
}
