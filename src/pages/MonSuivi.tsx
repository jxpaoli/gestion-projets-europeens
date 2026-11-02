import { useMemo, useState, type FormEvent } from "react";
import { useDonnees } from "../donnees";
import { aujourdhui, date, horaire, LIB_DOMAINE_SUIVI, LIB_TYPE_SUIVI } from "../format";
import { BlocDate, CaseFait } from "../composants";
import { usePreference } from "../preferences";
import type { DomaineSuivi, SuiviPerso, TypeSuivi } from "../types";

// Date qui place l'élément dans le temps : celle de la réunion, sinon l'échéance de l'action.
export const quandSuivi = (s: SuiviPerso) => s.date ?? s.echeance;

// « Mon suivi » : tout ce qui engage Joseph hors projets européens (CSE, CSSCT, NAO, port, rencontres…). Admin seulement.
export default function MonSuivi() {
  const { donnees, estAdmin, enregistrerSuivi } = useDonnees();
  const [domaine, setDomaine] = usePreference<DomaineSuivi | "">("suivi.domaine", "");
  const [editer, setEditer] = useState<SuiviPerso | "nouveau" | null>(null);
  const auj = aujourdhui();

  const { retards, aVenir, sansDate, faits } = useMemo(() => {
    const liste = (donnees?.suivi ?? []).filter((s) => !domaine || s.domaine === domaine);
    const ouverts = liste.filter((s) => s.statut === "a_faire");
    const tri = (a: SuiviPerso, b: SuiviPerso) => (quandSuivi(a) ?? "").localeCompare(quandSuivi(b) ?? "") || (a.heure_debut ?? "").localeCompare(b.heure_debut ?? "");
    return {
      // Une réunion passée n'est pas un retard ; une action ou une échéance dépassée, si.
      retards: ouverts.filter((s) => quandSuivi(s) && quandSuivi(s)! < auj && ["action", "echeance"].includes(s.type)).sort(tri),
      aVenir: ouverts.filter((s) => quandSuivi(s) && quandSuivi(s)! >= auj).sort(tri),
      sansDate: ouverts.filter((s) => !quandSuivi(s)),
      faits: liste.filter((s) => s.statut !== "a_faire").sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 10),
    };
  }, [donnees, domaine, auj]);

  if (!donnees) return null;
  if (!estAdmin) return <div className="vide">Rubrique réservée.</div>;

  const cocher = async (s: SuiviPerso) => {
    const message = await enregistrerSuivi({ id: s.id, type: s.type, libelle: s.libelle, statut: s.statut === "fait" ? "a_faire" : "fait" });
    if (message) alert(`Modification impossible : ${message}`);
  };

  const ligne = (s: SuiviPerso, retard = false) => (
    <div className={`item${s.statut !== "a_faire" ? " fait" : ""}`} key={s.id}>
      <CaseFait fait={s.statut === "fait"} onClick={() => void cocher(s)} />
      <BlocDate iso={quandSuivi(s)} retard={retard} />
      <div className="corps">
        <div className="libelle cliquable" onClick={() => setEditer(s)}>{s.libelle}</div>
        <div className="meta">
          <span className="badge">{LIB_DOMAINE_SUIVI[s.domaine]}</span>
          <span className="badge">{LIB_TYPE_SUIVI[s.type]}</span>
          {s.statut === "annule" && <span className="badge rouge">Annulé</span>}
          {horaire(s.heure_debut, s.heure_fin) && <span>{horaire(s.heure_debut, s.heure_fin)}</span>}
          {s.lieu && <span>{s.lieu}</span>}
          {s.lien && <a className="doc" href={s.lien} target="_blank" rel="noreferrer">Lien</a>}
          {s.origine === "secretaire" && !s.modifie_par_admin && <span className="badge">secrétaire</span>}
        </div>
        {s.action_attendue && <div className="meta">À faire : {s.action_attendue}{s.echeance && s.date ? ` (avant le ${date(s.echeance)})` : ""}</div>}
      </div>
    </div>
  );

  return (
    <>
      <div className="titre">Mon suivi</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Hors projets européens. Visible par toi seul (et le secrétaire qui le remplit).</div>
      <div className="chips">
        <button className={`chip${!domaine ? " on" : ""}`} onClick={() => setDomaine("")}>Tout</button>
        {(Object.keys(LIB_DOMAINE_SUIVI) as DomaineSuivi[]).map((d) => (
          <button key={d} className={`chip${domaine === d ? " on" : ""}`} onClick={() => setDomaine(d)}>{LIB_DOMAINE_SUIVI[d]}</button>
        ))}
      </div>
      <button className="btn plein" style={{ margin: "8px 0" }} onClick={() => setEditer("nouveau")}>+ Ajouter</button>

      {retards.length > 0 && <><div className="sec">En retard ({retards.length})</div><div className="liste">{retards.map((s) => ligne(s, true))}</div></>}
      <div className="sec">À venir</div>
      {aVenir.length === 0 ? <div className="vide">Rien de prévu.</div> : <div className="liste">{aVenir.map((s) => ligne(s))}</div>}
      {sansDate.length > 0 && <><div className="sec">Sans date</div><div className="liste">{sansDate.map((s) => ligne(s))}</div></>}
      {faits.length > 0 && <><div className="sec">Faits ou annulés récemment</div><div className="liste">{faits.map((s) => ligne(s))}</div></>}

      {editer && <FicheSuivi key={editer === "nouveau" ? "nouveau" : editer.id} suivi={editer === "nouveau" ? null : editer} fermer={() => setEditer(null)} />}
    </>
  );
}

function FicheSuivi({ suivi, fermer }: { suivi: SuiviPerso | null; fermer: () => void }) {
  const { enregistrerSuivi, supprimerSuivi } = useDonnees();
  const [type, setType] = useState<TypeSuivi>(suivi?.type ?? "reunion");
  const [domaine, setDomaine] = useState<DomaineSuivi>(suivi?.domaine ?? "autre");
  const [libelle, setLibelle] = useState(suivi?.libelle ?? "");
  const [jour, setJour] = useState(suivi?.date ?? "");
  const [debut, setDebut] = useState(suivi?.heure_debut?.slice(0, 5) ?? "");
  const [fin, setFin] = useState(suivi?.heure_fin?.slice(0, 5) ?? "");
  const [lieu, setLieu] = useState(suivi?.lieu ?? "");
  const [lien, setLien] = useState(suivi?.lien ?? "");
  const [actionAttendue, setActionAttendue] = useState(suivi?.action_attendue ?? "");
  const [echeance, setEcheance] = useState(suivi?.echeance ?? "");
  const [statut, setStatut] = useState(suivi?.statut ?? "a_faire");
  const [notes, setNotes] = useState(suivi?.notes ?? "");
  const [err, setErr] = useState("");
  const [occupe, setOccupe] = useState(false);

  const valider = async (e: FormEvent) => {
    e.preventDefault();
    if (!libelle.trim()) { setErr("Libellé obligatoire."); return; }
    setOccupe(true);
    const message = await enregistrerSuivi({
      ...(suivi ? { id: suivi.id } : {}),
      type, domaine, libelle: libelle.trim(), date: jour || null, heure_debut: debut || null, heure_fin: fin || null,
      lieu: lieu.trim() || null, lien: lien.trim() || null, action_attendue: actionAttendue.trim() || null,
      echeance: echeance || null, statut, notes: notes.trim() || null,
    });
    setOccupe(false);
    if (message) setErr(message); else fermer();
  };

  const effacer = async () => {
    if (!suivi || !confirm("Supprimer définitivement cet élément ?")) return;
    const message = await supprimerSuivi(suivi.id);
    if (message) setErr(message); else fermer();
  };

  return (
    <div className="voile" onClick={fermer}>
      <form className="panneau" onClick={(e) => e.stopPropagation()} onSubmit={valider}>
        <div className="panneau-tete">
          <b>{suivi ? "Modifier" : "Ajouter à mon suivi"}</b>
          <button type="button" className="btn-lien" onClick={fermer}>Fermer</button>
        </div>

        <label>Type</label>
        <div className="chips">
          {(Object.keys(LIB_TYPE_SUIVI) as TypeSuivi[]).map((t) => (
            <button type="button" key={t} className={`chip${type === t ? " on" : ""}`} onClick={() => setType(t)}>{LIB_TYPE_SUIVI[t]}</button>
          ))}
        </div>
        <label>Domaine</label>
        <div className="chips">
          {(Object.keys(LIB_DOMAINE_SUIVI) as DomaineSuivi[]).map((d) => (
            <button type="button" key={d} className={`chip${domaine === d ? " on" : ""}`} onClick={() => setDomaine(d)}>{LIB_DOMAINE_SUIVI[d]}</button>
          ))}
        </div>

        <label htmlFor="sp-libelle">Libellé</label>
        <textarea id="sp-libelle" rows={2} value={libelle} onChange={(e) => setLibelle(e.target.value)} autoFocus={!suivi} placeholder="Ex. CSE Central" />

        <div className="grille2">
          <div><label htmlFor="sp-date">Date</label><input id="sp-date" type="date" value={jour} onChange={(e) => setJour(e.target.value)} /></div>
          <div><label htmlFor="sp-lieu">Lieu</label><input id="sp-lieu" value={lieu} onChange={(e) => setLieu(e.target.value)} /></div>
        </div>
        <div className="grille2">
          <div><label htmlFor="sp-debut">Début</label><input id="sp-debut" type="time" value={debut} onChange={(e) => setDebut(e.target.value)} /></div>
          <div><label htmlFor="sp-fin">Fin</label><input id="sp-fin" type="time" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
        </div>
        <label htmlFor="sp-lien">Lien (visio…)</label>
        <input id="sp-lien" value={lien} onChange={(e) => setLien(e.target.value)} />

        <label htmlFor="sp-action">Ce que je dois faire</label>
        <textarea id="sp-action" rows={2} value={actionAttendue} onChange={(e) => setActionAttendue(e.target.value)} />
        <div className="grille2">
          <div><label htmlFor="sp-ech">Avant le</label><input id="sp-ech" type="date" value={echeance} onChange={(e) => setEcheance(e.target.value)} /></div>
          <div>
            <label htmlFor="sp-statut">Statut</label>
            <select id="sp-statut" value={statut} onChange={(e) => setStatut(e.target.value as SuiviPerso["statut"])}>
              <option value="a_faire">À faire</option><option value="fait">Fait</option><option value="annule">Annulé</option>
            </select>
          </div>
        </div>
        <label htmlFor="sp-notes">Notes</label>
        <textarea id="sp-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

        {suivi?.source_objet && (
          <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            Mail : {suivi.source_expediteur} · {date(suivi.source_date)} · « {suivi.source_objet} »
            {suivi.fait_source && <><br />Fait : {suivi.fait_source}</>}
          </div>
        )}

        {err && <div className="login-err">{err}</div>}
        <button type="submit" className="btn-primary" disabled={occupe}>{occupe ? "Enregistrement…" : "Enregistrer"}</button>
        {suivi && <button type="button" className="btn danger" style={{ width: "100%", marginTop: 16 }} onClick={() => void effacer()}>Supprimer</button>}
      </form>
    </div>
  );
}
