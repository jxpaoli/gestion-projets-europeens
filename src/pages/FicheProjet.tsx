import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { db } from "../supabase";
import { useDonnees } from "../donnees";
import { date, montant } from "../format";
import { lienFichier } from "../onedrive";
import { LienDoc, PastilleProjet } from "../composants";
import { BadgeEvolutions, JournalEvolutions, useEvolutions, useRetardsAuto } from "../Evolutions";
import type { FicheProjet as Fiche, Projet, SectionFiche } from "../types";

const LANGUES: Record<string, string> = { it: "italien", fr: "français", en: "anglais" };
const version = (v: number) => `V${Number(v).toFixed(1)}`;

// Texte rédigé par le secrétaire : paragraphes séparés par une ligne vide, lignes « - » en liste.
function Texte({ texte }: { texte?: string | null }) {
  if (!texte) return null;
  return (
    <>
      {texte.trim().split(/\n\s*\n/).map((bloc, i) => {
        const lignes = bloc.split("\n");
        return lignes.every((l) => /^\s*[-•]\s/.test(l))
          ? <ul key={i}>{lignes.map((l, j) => <li key={j}>{l.replace(/^\s*[-•]\s/, "")}</li>)}</ul>
          : <p key={i}>{bloc}</p>;
      })}
    </>
  );
}

const Page = ({ page }: { page?: number | null }) => (page ? <span className="fp-page" title="Page du formulaire PDF">p. {page}</span> : null);

function Sections({ sections }: { sections?: SectionFiche[] }) {
  if (!sections?.length) return <div className="muted">Rien pour cette partie.</div>;
  return (
    <>
      {sections.map((s, i) => (
        <section key={i} className="fp-section">
          <h4>{s.titre} <Page page={s.page} /></h4>
          <Texte texte={s.texte} />
        </section>
      ))}
    </>
  );
}

function Partie({ titre, ouvert, children }: { titre: ReactNode; ouvert?: boolean; children: ReactNode }) {
  return (
    <details className="card fp-partie" open={ouvert}>
      <summary>{titre}</summary>
      <div className="fp-corps">{children}</div>
    </details>
  );
}

export default function FicheProjet() {
  const { id } = useParams();
  const { donnees } = useDonnees();
  const [fiches, setFiches] = useState<Fiche[] | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    if (!id) return;
    void db.from("fiches_projet").select("*").eq("projet_id", id).order("version", { ascending: false })
      .then(({ data, error }) => { if (error) setErreur(error.message); else setFiches((data ?? []) as Fiche[]); });
  }, [id]);

  const projet = donnees?.projets.find((p) => p.id === id);
  if (!donnees || !projet) return null;
  if (erreur) return <div className="vide">Chargement impossible : {erreur}</div>;
  if (!fiches) return <div className="vide">Chargement…</div>;

  const retour = <Link to="/projets" className="btn-lien">← Projets</Link>;
  if (!fiches.length) {
    return (
      <>
        {retour}
        <div className="titre"><PastilleProjet projet={projet} /> Fiche projet</div>
        <div className="vide">Pas encore de fiche : le secrétaire la rédige à partir du dernier formulaire de candidature
          (dossier 01-administratif du projet).</div>
      </>
    );
  }

  return <VueFiche projet={projet} fiches={fiches} retour={retour} />;
}

function VueFiche({ projet, fiches, retour }: { projet: Projet; fiches: Fiche[]; retour: ReactNode }) {
  const { donnees } = useDonnees();
  const [choix, setChoix] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<string | null>(null);
  const f = fiches.find((x) => x.id === choix) ?? fiches[0];
  const c = f.contenu;
  const r = c.recap;
  const evolutions = useEvolutions(projet.id);
  const retards = useRetardsAuto(projet, c);
  if (!donnees) return null;
  const doc = donnees.documents.find((d) => d.id === f.document_id);
  const lienPdf = doc?.present ? lienFichier(donnees.parametres.onedrive_base, doc.chemin, doc.extension) : null;
  const codes = (c.lots ?? []).flatMap((l) => [l.code, ...(l.activites ?? []).map((a) => a.code), ...(l.livrables ?? []).map((d) => d.code)]);
  const voir = (code: string) => {
    setFiltre(code);
    document.getElementById("evolutions")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const badge = (code: string) => <BadgeEvolutions code={code} evolutions={evolutions} retards={retards} onVoir={voir} />;

  return (
    <div className="fiche-projet">
      {retour}
      <div className="fp-tete">
        <div>
          <div className="titre"><PastilleProjet projet={projet} /> {r.titre || projet.titre || projet.acronyme}</div>
          <div className="muted">
            Formulaire {version(f.version)}{f.date_export ? ` · exporté le ${date(f.date_export)}` : ""}
            {f.langue_origine ? ` · original en ${LANGUES[f.langue_origine] ?? f.langue_origine}` : ""}
            {f.partenaire ? ` · nous : ${f.partenaire}` : ""}
          </div>
        </div>
        <div className="fp-actions">
          {fiches.length > 1 && (
            <select value={f.id} onChange={(e) => setChoix(e.target.value)} aria-label="Version du formulaire">
              {fiches.map((x, i) => <option key={x.id} value={x.id}>{version(x.version)}{i === 0 ? " (dernière)" : ""}</option>)}
            </select>
          )}
          {lienPdf
            ? <LienDoc href={lienPdf}>📄 PDF complet</LienDoc>
            : f.document_nom && <span className="muted" title="PDF dans le dossier administratif du projet">📄 {f.document_nom}</span>}
          <span className={`badge ${f.modifie_par_admin ? "vert" : "bleu"}`}>
            {f.modifie_par_admin ? "✓ relue par Joseph" : "✉ rédigée par le secrétaire"} · {date(f.updated_at)}
          </span>
        </div>
      </div>

      {/* 1. Récap */}
      <div className="card fp-recap">
        {r.titre_origine && <div className="fp-origine">« {r.titre_origine} »</div>}
        <div className="kpis">
          <div className="kpi"><div className="muted">Budget projet</div><b className="num">{montant(r.budget_total)}</b></div>
          <div className="kpi"><div className="muted">FEDER{r.taux_feder ? ` (${r.taux_feder} %)` : ""}</div><b className="num">{montant(r.feder_total)}</b></div>
          <div className="kpi nous"><div className="muted">Notre budget</div><b className="num">{montant(r.notre_budget)}</b>
            {r.notre_feder != null && <div className="muted num">FEDER {montant(r.notre_feder)}</div>}</div>
        </div>
        <dl className="fp-dl">
          {r.chef_de_file && <><dt>Chef de file</dt><dd>{r.chef_de_file}</dd></>}
          {r.priorite && <><dt>Priorité</dt><dd>{r.priorite}</dd></>}
          {r.objectif_specifique && <><dt>Objectif spécifique</dt><dd>{r.objectif_specifique}</dd></>}
          {r.duree && <><dt>Durée</dt><dd>{r.duree}</dd></>}
          {r.dates && <><dt>Dates</dt><dd>{r.dates}</dd></>}
        </dl>
        {r.resume && <><div className="sec">Le projet</div><Texte texte={r.resume} /></>}
        {r.notre_role && <><div className="sec">Notre rôle</div><div className="fp-nous-bloc"><Texte texte={r.notre_role} /></div></>}
        {!!r.a_retenir?.length && <><div className="sec">À retenir</div><ul>{r.a_retenir.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      </div>

      {!!c.ecarts?.length && (
        <div className="card fp-ecarts">
          <div className="sec">⚠️ Écarts avec d'autres pièces</div>
          {c.ecarts.map((e, i) => (
            <section key={i} className="fp-section">
              <h4>{e.titre}{e.source && <span className="muted"> · {e.source}</span>}</h4>
              <Texte texte={e.texte} />
            </section>
          ))}
        </div>
      )}

      <JournalEvolutions projet={projet} evolutions={evolutions} retards={retards} codes={codes} filtre={filtre} setFiltre={setFiltre} />

      {!!c.partenaires?.length && (
        <Partie titre={`Partenariat (${c.partenaires.length})`}>
          <div className="tableau-scroll">
            <table className="fp-table">
              <thead><tr><th></th><th>Partenaire</th><th>Pays</th><th className="num">Budget</th><th className="num">FEDER</th></tr></thead>
              <tbody>
                {c.partenaires.map((p, i) => (
                  <tr key={i} className={p.nous ? "nous" : ""}>
                    <td>{p.code}</td><td>{p.nom}</td><td>{p.pays}</td>
                    <td className="num">{montant(p.budget)}</td><td className="num">{montant(p.feder)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Partie>
      )}

      {/* 2. Partie commune */}
      <Partie titre="Partie commune">
        <Sections sections={c.commune} />
      </Partie>

      {!!c.lots?.length && (
        <Partie titre={<>Lots de travail <span className="fp-legende">nos activités surlignées</span></>}>
          {c.lots.map((l) => (
            <section key={l.code} className="fp-lot">
              <h4>{l.code}{l.titre ? ` – ${l.titre}` : ""} <Page page={l.page} /> {badge(l.code)}</h4>
              <Texte texte={l.resume} />
              {l.activites?.map((a) => (
                <div key={a.code} className={`fp-activite${a.nous ? " nous" : ""}`}>
                  <div className="fp-activite-tete"><b>{a.code}</b> {a.titre} <Page page={a.page} />
                    {a.nous ? <span className="badge vert">nous</span> : null} {badge(a.code)}</div>
                  <Texte texte={a.texte} />
                  {a.notre_tache && <div className="fp-tache"><b>Notre tâche :</b> {a.notre_tache}</div>}
                </div>
              ))}
              {!!l.livrables?.length && (
                <table className="fp-table fp-livrables">
                  <tbody>
                    {l.livrables.map((d) => (
                      <tr key={d.code} className={d.nous ? "nous" : ""}>
                        <td>{d.code}</td><td>{d.titre} {badge(d.code)}</td><td>{d.periode}</td><td>{d.nous ? (d.role || "nous") : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </Partie>
      )}

      {/* 3. Notre partie */}
      <Partie titre={`Notre partie${f.partenaire ? ` · ${f.partenaire}` : ""}`} ouvert>
        <Sections sections={c.notre_partie} />
        {c.budget && (
          <section className="fp-section">
            <h4>Notre budget <Page page={c.budget.page} /></h4>
            <div className="fp-budget">
              {!!c.budget.categories?.length && (
                <table className="fp-table">
                  <thead><tr><th>Catégorie</th><th className="num">Montant</th></tr></thead>
                  <tbody>{c.budget.categories.map((x, i) => <tr key={i}><td>{x.libelle}</td><td className="num">{montant(x.montant)}</td></tr>)}</tbody>
                </table>
              )}
              {!!c.budget.periodes?.length && (
                <table className="fp-table">
                  <thead><tr><th>Période</th><th className="num">Montant</th></tr></thead>
                  <tbody>{c.budget.periodes.map((x, i) => <tr key={i}><td>{x.periode}</td><td className="num">{montant(x.montant)}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          </section>
        )}
      </Partie>
    </div>
  );
}
