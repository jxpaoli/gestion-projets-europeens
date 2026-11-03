import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useDonnees } from "./donnees";
import { dateRealisation } from "./indicateurs";
import { date, jourMois } from "./format";
import type { Action, Evenement, Projet } from "./types";

// Bandeau du bas d'écran : un avis (erreur, « terminée », « supprimée »…) avec « Annuler » quand c'est possible.
export function Bandeau() {
  const { avis, fermerAvis } = useDonnees();
  if (!avis) return null;
  return (
    <div className="bandeau" role="status" aria-live="polite">
      <span className="bandeau-texte">{avis.texte}</span>
      {avis.annuler && (
        <button type="button" className="bandeau-action" onClick={() => { avis.annuler?.(); fermerAvis(); }}>Annuler</button>
      )}
      <button type="button" className="bandeau-fermer" aria-label="Fermer le message" onClick={fermerAvis}>×</button>
    </div>
  );
}

// Action destructive en deux temps, sans fenêtre native : le premier clic arme le bouton, le second exécute.
// Le bouton se désarme seul au bout de 4 secondes.
export function BoutonConfirmer({ onConfirmer, children, confirmation = "Confirmer ?", className = "btn danger", style, disabled = false }: {
  onConfirmer: () => void; children: ReactNode; confirmation?: string; className?: string; style?: CSSProperties; disabled?: boolean;
}) {
  const [arme, setArme] = useState(false);
  useEffect(() => {
    if (!arme) return;
    const minuterie = window.setTimeout(() => setArme(false), 4000);
    return () => window.clearTimeout(minuterie);
  }, [arme]);
  return (
    <button type="button" className={`${className}${arme ? " arme" : ""}`} style={style} disabled={disabled}
      onClick={() => { if (arme) { setArme(false); onConfirmer(); } else setArme(true); }}>
      {arme ? confirmation : children}
    </button>
  );
}

export function PastilleProjet({ projet }: { projet: Projet | undefined }) {
  if (!projet) return null;
  return <span className="pastille" style={{ background: projet.couleur || "var(--marine)" }}>{projet.acronyme}</span>;
}

export function BlocDate({ iso, retard }: { iso: string | null; retard?: boolean }) {
  if (!iso) return <div className="date"><b>—</b><span>sans date</span></div>;
  const { jour, mois } = jourMois(iso);
  return <div className={`date${retard ? " retard" : ""}`}><b>{jour}</b><span>{mois}</span></div>;
}

// Case ronde « réalisé » devant une action (admin seulement).
export function CaseFait({ fait, onClick }: { fait: boolean; onClick: () => void }) {
  return (
    <button
      className={`case-fait${fait ? " on" : ""}`}
      onClick={onClick}
      role="checkbox"
      aria-checked={fait}
      aria-label={fait ? "Réalisée – décocher" : "Marquer comme réalisée"}
      title={fait ? "Réalisée – décocher" : "Marquer comme réalisée"}
    >
      {fait && <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>}
    </button>
  );
}

export function LienDoc({ href, children = "Ouvrir le document" }: { href: string | null; children?: ReactNode }) {
  if (!href) return null;
  return <a className="doc" href={href} target="_blank" rel="noreferrer">{children}</a>;
}

const QUI: Record<string, string> = { admin: "Joseph", secretaire: "le secrétaire", systeme: "import", lecteur: "lecteur" };
export const libQui = (r: string | null) => QUI[r ?? ""] ?? "—";

// Une action est « rouverte » si son dernier changement de statut l'a fait sortir de « fait ».
export function derniereRouverture(a: Action, evenements: Evenement[]): Evenement | null {
  if (a.statut === "fait") return null;
  const statuts = evenements.filter((e) => e.action_id === a.id && e.type === "statut");
  const dernier = statuts[statuts.length - 1];
  return dernier && dernier.statut_avant === "fait" ? dernier : null;
}

// Badges « ticket » : validateur d'une action faite, ou réouverture.
export function BadgesTicket({ a }: { a: Action }) {
  const { donnees } = useDonnees();
  const rouv = donnees ? derniereRouverture(a, donnees.evenements) : null;
  if (rouv) return <span className="badge rouge" title={rouv.source ?? ""}>🔄 Rouverte par {libQui(rouv.qui_role)}</span>;
  if (a.statut === "fait" && a.valide_par) {
    const fait = donnees ? dateRealisation(a, donnees.sources) : a.valide_le;
    return <span className={`badge ${a.valide_par === "secretaire" ? "bleu" : "vert"}`} title={a.valide_source ?? ""}>
      ✓ validé par {libQui(a.valide_par)}{fait ? ` · fait le ${date(fait)}` : ""}
    </span>;
  }
  if (a.origine === "secretaire" && !a.modifie_par_admin) return <span className="badge bleu">✉ proposé par le secrétaire</span>;
  return null;
}

export const HORIZONS: { jours: number | null; libelle: string }[] = [
  { jours: 7, libelle: "7 jours" },
  { jours: 15, libelle: "15 jours" },
  { jours: 30, libelle: "1 mois" },
  { jours: 90, libelle: "3 mois" },
  { jours: null, libelle: "Tout" },
];

export function ChoixHorizon({ valeur, onChange }: { valeur: number | null; onChange: (j: number | null) => void }) {
  return (
    <div className="chips">
      {HORIZONS.map((h) => (
        <button key={h.libelle} className={`chip${valeur === h.jours ? " on" : ""}`} onClick={() => onChange(h.jours)}>{h.libelle}</button>
      ))}
    </div>
  );
}

export function FiltreProjets({ projets, valeur, onChange }: {
  projets: Projet[]; valeur: string; onChange: (id: string) => void;
}) {
  return (
    <div className="chips">
      <button className={`chip${valeur === "" ? " on" : ""}`} onClick={() => onChange("")}>Tous</button>
      {projets.map((p) => (
        <button key={p.id} className={`chip${valeur === p.id ? " on" : ""}`} onClick={() => onChange(p.id)}>{p.acronyme}</button>
      ))}
    </div>
  );
}
