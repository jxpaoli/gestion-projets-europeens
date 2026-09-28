import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useDonnees } from "./donnees";
import { aujourdhui, date } from "./format";
import { lienFichier } from "./onedrive";
import type { CibleSource, NouvelleSource, Source, TypeSource } from "./types";

// Sources d'un élément (action, écheance, livrable, période, point ou info de réunion).
// Mail : pas d'accès à la messagerie depuis l'appli ; date + expéditeur + objet (copiable) pour le retrouver.

export const ICONE_SOURCE: Record<TypeSource, string> = { mail: "✉️", document: "📄", reunion: "🗓", autre: "🔗" };
const LIB_TYPE: Record<TypeSource, string> = { mail: "Mail", document: "Document", reunion: "Réunion", autre: "Autre" };

export function useSources(cible: Pick<CibleSource, "champ" | "id">): Source[] {
  const { donnees } = useDonnees();
  return useMemo(
    () => (donnees?.sources ?? []).filter((s) => s[cible.champ] === cible.id)
      .sort((a, b) => (b.date_source ?? "").localeCompare(a.date_source ?? "")),
    [donnees, cible.champ, cible.id],
  );
}

// Petit bouton dans les listes : « ✉️ 3 📄 1 » ; ouvre le panneau des sources. Rien s'il n'y a aucune source
// (sauf pour l'admin avec ajout=true, qui voit « + source »).
export function BoutonSources({ cible, ajout = false }: { cible: CibleSource; ajout?: boolean }) {
  const { estAdmin, setVoirSources } = useDonnees();
  const sources = useSources(cible);
  const texte = cible.texte?.trim();
  if (!sources.length && !texte && !(estAdmin && ajout)) return null;
  const nb = (Object.keys(ICONE_SOURCE) as TypeSource[])
    .map((t) => [t, sources.filter((s) => s.type === t).length] as const).filter(([, n]) => n > 0);
  return (
    <button type="button" className="src-bouton" title="Voir les sources"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setVoirSources(cible); }}>
      {nb.length ? nb.map(([t, n]) => <span key={t}>{ICONE_SOURCE[t]}{n > 1 ? ` ${n}` : ""}</span>)
        : texte ? <span>📝 source</span> : <span>+ source</span>}
    </button>
  );
}

// Panneau ouvert depuis n'importe quelle liste (tous les rôles ; ajout et suppression pour l'admin).
export function PanneauSources() {
  const { voirSources: c, setVoirSources, estAdmin } = useDonnees();
  if (!c) return null;
  const fermer = () => setVoirSources(null);
  return (
    <div className="voile" onClick={fermer}>
      <div className="panneau" onClick={(e) => e.stopPropagation()}>
        <div className="panneau-tete">
          <b>Sources</b>
          <button type="button" className="btn-lien" onClick={fermer}>Fermer</button>
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{c.titre}</div>
        <ListeSources cible={c} modifiable={estAdmin} />
        {estAdmin && <AjoutSource projetId={c.projetId} cible={c} />}
      </div>
    </div>
  );
}

export function ListeSources({ cible, modifiable }: { cible: CibleSource; modifiable: boolean }) {
  const { supprimerSource } = useDonnees();
  const sources = useSources(cible);
  const [err, setErr] = useState("");
  const texte = cible.texte?.trim();
  const supprimer = async (s: Source) => {
    if (!confirm("Retirer cette source ?")) return;
    setErr(await supprimerSource(s.id));
  };
  return (
    <div className="src-liste">
      {sources.length === 0 && !texte && <div className="muted" style={{ fontSize: 13 }}>Aucune source.</div>}
      {sources.map((s) => (
        <LigneSource key={s.id} s={s}>
          {modifiable && <button type="button" className="src-retirer" title="Retirer" aria-label="Retirer la source" onClick={() => void supprimer(s)}>✕</button>}
        </LigneSource>
      ))}
      {texte && (
        <div className="src-ligne">
          <span className="src-ico">📝</span>
          <div className="src-corps"><div className="muted" style={{ fontSize: 12 }}>Note de source</div><div>{texte}</div></div>
        </div>
      )}
      {err && <div className="login-err">{err}</div>}
    </div>
  );
}

function LigneSource({ s, children }: { s: Source | (NouvelleSource & { id?: string }); children?: ReactNode }) {
  const { donnees } = useDonnees();
  let corps: ReactNode;
  if (s.type === "mail") {
    corps = (
      <>
        <div className="muted" style={{ fontSize: 12 }}>{[s.date_source ? date(s.date_source) : null, s.expediteur].filter(Boolean).join(" · ") || "Mail"}</div>
        {s.objet ? <div className="src-objet">« {s.objet} » <Copier texte={s.objet} /></div> : null}
      </>
    );
  } else if (s.type === "document") {
    const doc = s.document_id ? donnees?.documents.find((d) => d.id === s.document_id) : undefined;
    const href = doc ? lienFichier(donnees?.parametres.onedrive_base, doc.chemin, doc.extension) : s.lien ?? null;
    const nom = doc?.nom ?? s.objet ?? "Document";
    corps = href ? <a href={href} target="_blank" rel="noreferrer">{nom}</a> : <div>{nom}</div>;
  } else if (s.type === "reunion") {
    const e = s.reunion_id ? donnees?.echeances.find((x) => x.id === s.reunion_id) : undefined;
    corps = e ? <Link to={`/reunions/${e.id}`}>{e.libelle} · {date(e.date)}</Link> : <div>{s.objet ?? "Réunion"}</div>;
  } else {
    corps = (
      <>
        {s.objet && <div>{s.objet}</div>}
        {s.lien && <a href={s.lien} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>{s.objet ? "Ouvrir le lien" : s.lien}</a>}
      </>
    );
  }
  return (
    <div className="src-ligne">
      <span className="src-ico" title={LIB_TYPE[s.type]}>{ICONE_SOURCE[s.type]}</span>
      <div className="src-corps">{corps}</div>
      {children}
    </div>
  );
}

// Copie l'objet du mail, à coller dans la recherche de la messagerie.
function Copier({ texte }: { texte: string }) {
  const [fait, setFait] = useState(false);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(texte);
    } catch {
      const t = document.createElement("textarea");
      t.value = texte;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setFait(true);
    window.setTimeout(() => setFait(false), 1500);
  };
  return (
    <button type="button" className="src-copier" title="Copier l’objet pour le rechercher dans la messagerie" onClick={() => void copier()}>
      {fait ? "✓ copié" : "📋 copier"}
    </button>
  );
}

// Formulaire d'ajout. Avec cible : enregistre tout de suite ; sans cible (action pas encore créée) : onAjout.
export function AjoutSource({ cible, projetId, onAjout }: {
  cible?: Pick<CibleSource, "champ" | "id">;
  projetId: string | null;
  onAjout?: (s: NouvelleSource) => void;
}) {
  const { donnees, ajouterSource } = useDonnees();
  const [ouvert, setOuvert] = useState(false);
  const [type, setType] = useState<TypeSource>("mail");
  const [jour, setJour] = useState(aujourdhui());
  const [expediteur, setExpediteur] = useState("");
  const [objet, setObjet] = useState("");
  const [lien, setLien] = useState("");
  const [docNom, setDocNom] = useState("");
  const [reunionId, setReunionId] = useState("");
  const [err, setErr] = useState("");
  const [occupe, setOccupe] = useState(false);

  const docs = useMemo(
    () => (donnees?.documents ?? []).filter((d) => d.present && (!projetId || d.projet_id === projetId || d.projet_id == null)),
    [donnees, projetId],
  );
  const reunions = useMemo(
    () => (donnees?.echeances ?? []).filter((e) => !projetId || e.projet_id === projetId).slice().sort((a, b) => b.date.localeCompare(a.date)),
    [donnees, projetId],
  );

  const vider = () => { setExpediteur(""); setObjet(""); setLien(""); setDocNom(""); setReunionId(""); setErr(""); };

  const valider = async () => {
    let s: NouvelleSource;
    if (type === "mail") {
      if (!objet.trim()) { setErr("L’objet du mail est nécessaire pour le retrouver."); return; }
      s = { type, date_source: jour || null, expediteur: expediteur.trim() || null, objet: objet.trim() };
    } else if (type === "document") {
      const doc = docs.find((d) => d.nom === docNom.trim());
      if (!doc && !docNom.trim()) { setErr("Choisis un document."); return; }
      s = { type, document_id: doc?.id ?? null, objet: doc?.nom ?? docNom.trim() };
    } else if (type === "reunion") {
      if (!reunionId) { setErr("Choisis une réunion."); return; }
      const e = reunions.find((x) => x.id === reunionId);
      s = { type, reunion_id: reunionId, objet: e?.libelle ?? null, date_source: e?.date ?? null };
    } else {
      if (!objet.trim() && !lien.trim()) { setErr("Un texte ou un lien."); return; }
      s = { type, objet: objet.trim() || null, lien: lien.trim() || null };
    }
    if (!cible) { onAjout?.(s); vider(); return; }
    setOccupe(true);
    const m = await ajouterSource(cible, s);
    setOccupe(false);
    if (m) setErr(m); else vider();
  };

  if (!ouvert) return <button type="button" className="btn-lien" style={{ marginTop: 10 }} onClick={() => setOuvert(true)}>+ Ajouter une source</button>;
  return (
    // Entrée valide la source, pas le formulaire de l'action qui l'entoure.
    <div className="src-ajout" onKeyDown={(e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); void valider(); }
    }}>
      <div className="chips">
        {(Object.keys(LIB_TYPE) as TypeSource[]).map((t) => (
          <button type="button" key={t} className={`chip${type === t ? " on" : ""}`} onClick={() => { setType(t); setErr(""); }}>{ICONE_SOURCE[t]} {LIB_TYPE[t]}</button>
        ))}
      </div>
      {type === "mail" && (
        <>
          <div className="grille2">
            <div><label htmlFor="src-jour">Date du mail</label><input id="src-jour" type="date" value={jour} onChange={(e) => setJour(e.target.value)} /></div>
            <div><label htmlFor="src-exp">Expéditeur</label><input id="src-exp" value={expediteur} onChange={(e) => setExpediteur(e.target.value)} placeholder="Ex. M. Scarsi" /></div>
          </div>
          <label htmlFor="src-objet">Objet du mail (exact, pour le retrouver)</label>
          <input id="src-objet" value={objet} onChange={(e) => setObjet(e.target.value)} placeholder="Ex. RE: EASY2LOG – WP3" />
        </>
      )}
      {type === "document" && (
        <>
          <label htmlFor="src-doc">Document OneDrive</label>
          <input id="src-doc" list="src-doc-liste" value={docNom} onChange={(e) => setDocNom(e.target.value)} placeholder="Tape une partie du nom…" />
          <datalist id="src-doc-liste">{docs.map((d) => <option key={d.id} value={d.nom} />)}</datalist>
        </>
      )}
      {type === "reunion" && (
        <>
          <label htmlFor="src-reu">Réunion</label>
          <select id="src-reu" value={reunionId} onChange={(e) => setReunionId(e.target.value)}>
            <option value="">—</option>
            {reunions.map((e) => <option key={e.id} value={e.id}>{date(e.date)} · {e.libelle}</option>)}
          </select>
        </>
      )}
      {type === "autre" && (
        <>
          <label htmlFor="src-txt">Description</label>
          <input id="src-txt" value={objet} onChange={(e) => setObjet(e.target.value)} placeholder="Ex. appel de P. Quilici, site JEMS…" />
          <label htmlFor="src-lien">Lien (facultatif)</label>
          <input id="src-lien" type="url" value={lien} onChange={(e) => setLien(e.target.value)} placeholder="https://…" />
        </>
      )}
      {err && <div className="login-err">{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" className="btn plein" disabled={occupe} onClick={() => void valider()}>{occupe ? "…" : "Ajouter"}</button>
        <button type="button" className="btn" onClick={() => { vider(); setOuvert(false); }}>Annuler</button>
      </div>
    </div>
  );
}

// Sources en attente d'une action pas encore créée (fiche « Nouvelle action »).
export function SourcesEnAttente({ liste, retirer }: { liste: NouvelleSource[]; retirer: (i: number) => void }) {
  if (!liste.length) return null;
  return (
    <div className="src-liste">
      {liste.map((s, i) => (
        <LigneSource key={i} s={s}>
          <button type="button" className="src-retirer" aria-label="Retirer la source" onClick={() => retirer(i)}>✕</button>
        </LigneSource>
      ))}
    </div>
  );
}
