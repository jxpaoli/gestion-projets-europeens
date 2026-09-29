import { Link, useParams, useSearchParams } from "react-router-dom";
import { useDonnees } from "../donnees";
import { aujourdhui, date, LIB_TYPE_ECHEANCE, montant } from "../format";
import { Anneaux, calculer, useEcranLarge } from "../indicateurs";
import { BlocDate, LienDoc, PastilleProjet } from "../composants";
import { estReunion, heure } from "../reunions";
import Actions from "./Actions";
import Reunions from "./Reunions";
import Livrables from "./Livrables";
import Finances from "./Finances";
import Documents from "./Documents";
import FicheProjet from "./FicheProjet";
import RepriseFormulaire from "../RepriseFormulaire";

const ONGLETS = [
  { code: "", libelle: "Aperçu" },
  { code: "actions", libelle: "Actions" },
  { code: "reunions", libelle: "Réunions" },
  { code: "livrables", libelle: "Livrables" },
  { code: "finances", libelle: "Finances" },
  { code: "documents", libelle: "Documents" },
  { code: "fiche", libelle: "Fiche" },
] as const;

const LIB_ETAPE = { declaration: "Déclaration Jems", controle: "Contrôle 1er niveau", rapport_cf: "Rapport au chef de file", paiement: "Paiement FEDER" } as const;

// Espace d'un projet : tout ce qui le concerne, onglet par onglet (?vue=… pour garder l'onglet au retour).
export default function EspaceProjet() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { donnees } = useDonnees();
  const p = donnees?.projets.find((x) => x.id === id);
  if (!donnees) return null;
  if (!p) return <div className="vide">Projet introuvable. <Link to="/projets">Voir les projets</Link></div>;
  const vue = params.get("vue") ?? "";
  const choisir = (code: string) => setParams(code ? { vue: code } : {}, { replace: true });

  return (
    <div className="espace-projet">
      <Link to="/projets" className="btn-lien">← Projets</Link>
      <div className="ep-tete" style={{ borderLeftColor: p.couleur || undefined }}>
        <div className="titre"><PastilleProjet projet={p} /> {p.titre || p.acronyme}</div>
        <div className="muted">{[p.programme, p.appel, p.id_jems && `Jems ${p.id_jems}`].filter(Boolean).join(" · ") || "—"}</div>
      </div>
      <div className="chips ep-onglets" role="tablist">
        {ONGLETS.map((o) => (
          <button key={o.code} role="tab" aria-selected={vue === o.code} className={`chip${vue === o.code ? " on" : ""}`} onClick={() => choisir(o.code)}>{o.libelle}</button>
        ))}
      </div>
      {vue === "actions" ? <Actions projetId={p.id} />
        : vue === "reunions" ? <Reunions projetId={p.id} />
        : vue === "livrables" ? <Livrables projetId={p.id} />
        : vue === "finances" ? <Finances projetId={p.id} />
        : vue === "documents" ? <Documents projetId={p.id} />
        : vue === "fiche" ? <FicheProjet integre />
        : <Apercu projetId={p.id} voir={choisir} />}
    </div>
  );
}

function Apercu({ projetId, voir }: { projetId: string; voir: (code: string) => void }) {
  const { donnees, estAdmin, setEditer } = useDonnees();
  const large = useEcranLarge();
  if (!donnees) return null;
  const p = donnees.projets.find((x) => x.id === projetId)!;
  const auj = aujourdhui();
  const avecFiche = new Set([...donnees.infos.map((i) => i.echeance_id), ...donnees.points.map((x) => x.echeance_id)]);
  const reunions = donnees.echeances
    .filter((e) => e.projet_id === projetId && e.date >= auj && e.statut !== "annule" && estReunion(e, avecFiche))
    .slice(0, 3);
  const retards = donnees.actions
    .filter((a) => a.projet_id === projetId && (a.statut === "a_faire" || a.statut === "en_cours") && a.echeance && a.echeance < auj)
    .sort((a, b) => a.echeance!.localeCompare(b.echeance!));
  const livrablesRetard = donnees.livrables
    .filter((v) => v.projet_id === projetId && (v.statut === "a_faire" || v.statut === "en_cours") && v.echeance && v.echeance < auj);
  const periodes = new Set(donnees.periodes.filter((x) => x.projet_id === projetId).map((x) => x.id));
  const etapes = donnees.etapes
    .filter((e) => periodes.has(e.periode_id) && !e.fait_le && e.date_limite)
    .sort((a, b) => a.date_limite!.localeCompare(b.date_limite!))
    .slice(0, 4);

  return (
    <div className="ep-apercu">
      <Anneaux ind={calculer(donnees, projetId)} compact={!large} />

      <div className="ep-colonnes">
        <div>
          <div className="sec">Prochaines réunions</div>
          {reunions.length ? (
            <div className="liste">
              {reunions.map((e) => (
                <Link to={`/reunions/${e.id}`} className="item lien-carte" key={e.id}>
                  <BlocDate iso={e.date} />
                  <div className="corps">
                    <div className="libelle">{e.libelle}</div>
                    <div className="meta">
                      <span className="badge">{LIB_TYPE_ECHEANCE[e.type]}</span>
                      {e.heure_debut && <span>{heure(e.heure_debut)}</span>}
                      {(e.lieu_nom || e.lieu) && <span>📍 {e.lieu_nom || e.lieu}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : <div className="vide">Aucune réunion prévue.</div>}

          <div className="sec">Actions en retard ({retards.length})</div>
          {retards.length ? (
            <div className="liste">
              {retards.slice(0, 5).map((a) => (
                <div className="item" key={a.id}>
                  <BlocDate iso={a.echeance} retard />
                  <div className="corps">
                    <div className={`libelle${estAdmin ? " cliquable" : ""}`} onClick={() => estAdmin && setEditer(a)}>{a.libelle}</div>
                    {a.responsable && <div className="meta">{a.responsable}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="vide">Aucune action en retard.</div>}
          {retards.length > 5 && <button className="btn-lien" onClick={() => voir("actions")}>Voir les {retards.length} actions en retard</button>}

          {livrablesRetard.length > 0 && (
            <>
              <div className="sec">Livrables en retard ({livrablesRetard.length})</div>
              <div className="liste">
                {livrablesRetard.map((v) => (
                  <div className="item" key={v.id}>
                    <BlocDate iso={v.echeance} retard />
                    <div className="corps"><div className="libelle">{v.code && <b>{v.code} – </b>}{v.titre}</div></div>
                  </div>
                ))}
              </div>
            </>
          )}

          {etapes.length > 0 && (
            <>
              <div className="sec">Déclarations CDINNOV</div>
              <div className="liste">
                {etapes.map((e) => {
                  const per = donnees.periodes.find((x) => x.id === e.periode_id);
                  return (
                    <div className="item" key={e.id}>
                      <div className="corps">
                        <div className="libelle">{LIB_ETAPE[e.etape]} – P{per?.numero}</div>
                        <div className="meta">
                          <span className={`badge${e.date_limite! < auj ? " rouge" : ""}`}>avant le {date(e.date_limite)}</span>
                          {e.responsable && <span>{e.responsable}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div>
          <div className="sec">Carte d’identité</div>
          <div className="card projet-carte" style={{ borderLeftColor: p.couleur || undefined }}>
            <dl>
              <dt>Chef de file</dt><dd>{p.chef_de_file ?? "—"}</dd>
              <dt>Partenaire n°</dt><dd>{p.n_partenaire ?? "—"}</dd>
              <dt>Dates</dt><dd>{date(p.date_debut)} → {date(p.date_fin)}</dd>
              <dt>Budget projet</dt><dd className="num">{montant(p.budget_projet)}</dd>
              <dt>FEDER projet</dt><dd className="num">{montant(p.feder_projet)}</dd>
              <dt>Budget EPCI</dt><dd className="num">{montant(p.budget_epci)}</dd>
            </dl>
            <div className="projet-liens">
              <button className="btn" onClick={() => voir("fiche")}>📋 Fiche projet</button>
              {p.dossier_onedrive && <LienDoc href={p.dossier_onedrive}>Dossier OneDrive du projet</LienDoc>}
            </div>
            {estAdmin && <RepriseFormulaire projet={p} />}
          </div>
        </div>
      </div>
    </div>
  );
}
