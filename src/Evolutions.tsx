import { useMemo, useState } from "react";
import { useDonnees } from "./donnees";
import { ajouterJours, aujourdhui, date } from "./format";
import { BoutonSources } from "./Sources";
import type { ContenuFiche, Evolution, Projet, StatutEvolution, TypeEvolution } from "./types";

// Journal des évolutions d'un projet par rapport au formulaire : la fiche d'origine ne bouge pas,
// les écarts (retards, changements, décisions) s'affichent à côté, avec leur statut et leurs sources.

export const LIB_TYPE_EVO: Record<TypeEvolution, string> = {
  retard: "⏱ Retard", calendrier: "📅 Calendrier", budget: "💶 Budget", activite: "🛠 Activité",
  livrable: "📦 Livrable", partenariat: "🤝 Partenariat", decision: "🗳 Décision", autre: "✎ Autre",
};
export const LIB_STATUT_EVO: Record<StatutEvolution, string> = {
  constate: "Constaté", propose: "Proposé", valide_cdp: "Validé en CdP", approuve: "Approuvé par le programme",
  integre: "Intégré au formulaire", abandonne: "Abandonné",
};
const COULEUR_STATUT: Record<StatutEvolution, string> = {
  constate: "orange", propose: "orange", valide_cdp: "bleu", approuve: "vert", integre: "vert", abandonne: "",
};

// D.1.3.1, D1.3.1, d1_3_1 → D131 : les codes du formulaire et ceux saisis ailleurs se retrouvent.
export const normCode = (c: string | null | undefined) => (c ?? "").toUpperCase().replace(/[\s._-]/g, "");

export function useEvolutions(projetId: string) {
  const { donnees } = useDonnees();
  return useMemo(() => (donnees?.evolutions ?? []).filter((e) => e.projet_id === projetId)
    .sort((a, b) => b.date_evolution.localeCompare(a.date_evolution)), [donnees, projetId]);
}

export interface RetardAuto { code: string; titre?: string; periode: string; fin: string; message: string }

// Fin d'une période : date saisie dans Finances, sinon début du projet + n × 6 mois.
function finPeriode(n: number, projet: Projet, periodes: { projet_id: string; numero: number; date_fin: string | null }[]): string | null {
  const p = periodes.find((x) => x.projet_id === projet.id && x.numero === n);
  if (p?.date_fin) return p.date_fin;
  if (!projet.date_debut) return null;
  const [a, m, j] = projet.date_debut.split("-").map(Number);
  const d = new Date(a, m - 1 + 6 * n, j);
  return ajouterJours(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, -1);
}

// Retards détectés sans saisie : livrable du formulaire comparé au livrable suivi dans l'appli (même code).
export function useRetardsAuto(projet: Projet, contenu: ContenuFiche): RetardAuto[] {
  const { donnees } = useDonnees();
  return useMemo(() => {
    if (!donnees) return [];
    const auj = aujourdhui();
    const res: RetardAuto[] = [];
    for (const lot of contenu.lots ?? []) {
      for (const d of lot.livrables ?? []) {
        const n = Number(d.periode?.match(/\d+/)?.[0]);
        if (!n) continue;
        const suivi = donnees.livrables.find((l) => l.projet_id === projet.id && normCode(l.code) === normCode(d.code));
        if (!suivi) continue;
        const fin = finPeriode(n, projet, donnees.periodes);
        if (!fin) continue;
        const fini = suivi.statut === "envoye" || suivi.statut === "approuve";
        if (suivi.echeance && suivi.echeance > fin) {
          res.push({ code: d.code, titre: d.titre, periode: `P${n}`, fin, message: `prévu le ${date(suivi.echeance)}, après la fin de P${n} (${date(fin)})` });
        } else if (!fini && auj > fin) {
          res.push({ code: d.code, titre: d.titre, periode: `P${n}`, fin, message: `pas encore envoyé, P${n} terminée le ${date(fin)}` });
        }
      }
    }
    return res;
  }, [donnees, projet, contenu]);
}

// Badge à côté d'un élément de la fiche : évolutions notées et retard détecté ; clic = journal filtré.
export function BadgeEvolutions({ code, evolutions, retards, onVoir }: {
  code: string; evolutions: Evolution[]; retards: RetardAuto[]; onVoir: (code: string) => void;
}) {
  const k = normCode(code);
  const notees = evolutions.filter((e) => normCode(e.element) === k && e.statut !== "abandonne");
  const retard = retards.find((r) => normCode(r.code) === k);
  if (!notees.length && !retard) return null;
  return (
    <button type="button" className="evo-badge" onClick={() => onVoir(code)}
      title={[retard ? `Retard détecté : ${retard.message}` : "", ...notees.map((e) => `${date(e.date_evolution)} · ${e.titre}`)].filter(Boolean).join("\n")}>
      {retard && <span className="evo-retard">⏱ retard</span>}
      {notees.length > 0 && <span>✎ {notees.length} évolution{notees.length > 1 ? "s" : ""}</span>}
    </button>
  );
}

const vide = (projetId: string): Partial<Evolution> & Pick<Evolution, "projet_id" | "titre"> => ({
  projet_id: projetId, date_evolution: aujourdhui(), type: "retard", element: "", titre: "", avant: "", apres: "", motif: "", statut: "constate",
});

function FormEvolution({ initial, codes, onFin }: {
  initial: Partial<Evolution> & Pick<Evolution, "projet_id" | "titre">; codes: string[]; onFin: () => void;
}) {
  const { enregistrerEvolution } = useDonnees();
  const [e, setE] = useState(initial);
  const [err, setErr] = useState("");
  const [occupe, setOccupe] = useState(false);
  const maj = (champs: Partial<Evolution>) => setE((x) => ({ ...x, ...champs }));
  const valider = async () => {
    if (!e.titre?.trim()) { setErr("Un titre, s'il te plaît."); return; }
    setOccupe(true);
    const nettoye = Object.fromEntries(Object.entries(e).map(([k, v]) => [k, typeof v === "string" && k !== "titre" ? (v.trim() || null) : v]));
    const m = await enregistrerEvolution({ ...nettoye, titre: e.titre.trim() } as typeof e);
    setOccupe(false);
    if (m) setErr(m); else onFin();
  };
  return (
    <div className="card evo-form">
      <div className="grille2">
        <div><label htmlFor="evo-date">Date</label><input id="evo-date" type="date" value={e.date_evolution ?? ""} onChange={(x) => maj({ date_evolution: x.target.value })} /></div>
        <div><label htmlFor="evo-type">Type</label>
          <select id="evo-type" value={e.type} onChange={(x) => maj({ type: x.target.value as TypeEvolution })}>
            {(Object.keys(LIB_TYPE_EVO) as TypeEvolution[]).map((t) => <option key={t} value={t}>{LIB_TYPE_EVO[t]}</option>)}
          </select></div>
        <div><label htmlFor="evo-el">Élément concerné</label>
          <input id="evo-el" list="evo-codes" value={e.element ?? ""} onChange={(x) => maj({ element: x.target.value })} placeholder="D1.3.1, A4.2, WP2, P3…" />
          <datalist id="evo-codes">{codes.map((c) => <option key={c} value={c} />)}</datalist></div>
        <div><label htmlFor="evo-statut">Statut</label>
          <select id="evo-statut" value={e.statut} onChange={(x) => maj({ statut: x.target.value as StatutEvolution })}>
            {(Object.keys(LIB_STATUT_EVO) as StatutEvolution[]).map((s) => <option key={s} value={s}>{LIB_STATUT_EVO[s]}</option>)}
          </select></div>
      </div>
      <label htmlFor="evo-titre">Titre</label>
      <input id="evo-titre" value={e.titre} onChange={(x) => maj({ titre: x.target.value })} placeholder="Ex. Rapport de cartographie repoussé" />
      <div className="grille2">
        <div><label htmlFor="evo-avant">Avant (formulaire)</label><input id="evo-avant" value={e.avant ?? ""} onChange={(x) => maj({ avant: x.target.value })} placeholder="Ex. P3" /></div>
        <div><label htmlFor="evo-apres">Après</label><input id="evo-apres" value={e.apres ?? ""} onChange={(x) => maj({ apres: x.target.value })} placeholder="Ex. P4" /></div>
      </div>
      <label htmlFor="evo-motif">Motif</label>
      <textarea id="evo-motif" rows={3} value={e.motif ?? ""} onChange={(x) => maj({ motif: x.target.value })} />
      {e.statut === "integre" && (
        <><label htmlFor="evo-v">Intégré dans la version</label>
          <input id="evo-v" type="number" step="0.1" value={e.version_integree ?? ""} onChange={(x) => maj({ version_integree: x.target.value ? Number(x.target.value) : null })} placeholder="5.0" /></>
      )}
      {err && <div className="login-err">{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" className="btn plein" disabled={occupe} onClick={() => void valider()}>{occupe ? "…" : "Enregistrer"}</button>
        <button type="button" className="btn" onClick={onFin}>Annuler</button>
      </div>
    </div>
  );
}

// Section « Évolutions depuis le formulaire » de la fiche projet.
export function JournalEvolutions({ projet, evolutions, retards, codes, filtre, setFiltre }: {
  projet: Projet; evolutions: Evolution[]; retards: RetardAuto[]; codes: string[];
  filtre: string | null; setFiltre: (c: string | null) => void;
}) {
  const { estAdmin, supprimerEvolution } = useDonnees();
  const [edition, setEdition] = useState<(Partial<Evolution> & Pick<Evolution, "projet_id" | "titre">) | null>(null);
  const liste = filtre ? evolutions.filter((e) => normCode(e.element) === normCode(filtre)) : evolutions;
  const retardsVus = filtre ? retards.filter((r) => normCode(r.code) === normCode(filtre)) : retards;
  const supprimer = async (e: Evolution) => {
    if (!confirm(`Supprimer « ${e.titre} » du journal ?`)) return;
    const m = await supprimerEvolution(e.id);
    if (m) alert(m);
  };

  return (
    <details className="card fp-partie" id="evolutions" open>
      <summary>Évolutions depuis le formulaire <span className="fp-legende evo-legende">{evolutions.length}</span></summary>
      <div className="fp-corps">
        {filtre && (
          <div className="evo-filtre">Filtré sur <b>{filtre}</b> <button type="button" className="btn-lien" onClick={() => setFiltre(null)}>tout voir</button></div>
        )}
        {retardsVus.length > 0 && (
          <div className="evo-auto">
            <div className="sec">Retards détectés par l'appli</div>
            {retardsVus.map((r) => (
              <div key={r.code} className="evo-auto-ligne">
                <span><b>{r.code}</b> {r.titre} : {r.message}</span>
                {estAdmin && !evolutions.some((e) => normCode(e.element) === normCode(r.code)) && (
                  <button type="button" className="btn-lien" onClick={() => setEdition({
                    ...vide(projet.id), element: r.code, titre: `${r.code} en retard`, avant: `${r.periode} (fin ${date(r.fin)})`,
                  })}>Noter dans le journal</button>
                )}
              </div>
            ))}
            <div className="muted" style={{ fontSize: 12 }}>Comparaison entre la période du formulaire et le livrable suivi dans l'appli ; rien n'est enregistré tant qu'on ne le note pas.</div>
          </div>
        )}
        {estAdmin && !edition && (
          <button type="button" className="btn" style={{ margin: "4px 0 10px" }} onClick={() => setEdition({ ...vide(projet.id), element: filtre ?? "" })}>+ Nouvelle évolution</button>
        )}
        {edition && <FormEvolution initial={edition} codes={codes} onFin={() => setEdition(null)} />}
        {liste.length === 0 && !retardsVus.length && (
          <div className="muted">Rien de noté pour l'instant : le projet suit le formulaire, ou les écarts n'ont pas encore été relevés.</div>
        )}
        <div className="evo-liste">
          {liste.map((e) => (
            <div key={e.id} className={`evo-ligne${e.statut === "abandonne" ? " abandonne" : ""}`}>
              <div className="evo-date">{date(e.date_evolution)}</div>
              <div className="evo-corps">
                <div className="evo-tete">
                  <span className="badge">{LIB_TYPE_EVO[e.type]}</span>
                  {e.element && <button type="button" className="evo-code" onClick={() => setFiltre(e.element)}>{e.element}</button>}
                  <b>{e.titre}</b>
                </div>
                {(e.avant || e.apres) && <div className="evo-avant-apres"><span>{e.avant || "—"}</span> → <b>{e.apres || "—"}</b></div>}
                {e.motif && <div className="evo-motif">{e.motif}</div>}
                <div className="evo-pied">
                  <span className={`badge ${COULEUR_STATUT[e.statut]}`}>
                    {LIB_STATUT_EVO[e.statut]}{e.statut === "integre" && e.version_integree ? ` (V${Number(e.version_integree).toFixed(1)})` : ""}
                  </span>
                  <span className="muted">{e.modifie_par_admin ? "Joseph" : "le secrétaire"}</span>
                  <BoutonSources cible={{ champ: "evolution_id", id: e.id, titre: e.titre, projetId: e.projet_id }} ajout />
                  {estAdmin && <>
                    <button type="button" className="btn-lien" onClick={() => setEdition(e)}>Modifier</button>
                    <button type="button" className="btn-lien evo-suppr" onClick={() => void supprimer(e)}>Supprimer</button>
                  </>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
