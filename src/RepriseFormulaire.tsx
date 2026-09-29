import { useEffect, useState } from "react";
import { db } from "./supabase";
import { useDonnees } from "./donnees";
import { montant } from "./format";
import type { FicheProjet, Projet } from "./types";

type Champ = "titre" | "chef_de_file" | "n_partenaire" | "budget_projet" | "feder_projet" | "budget_epci";

const LIB: Record<Champ, string> = {
  titre: "Titre", chef_de_file: "Chef de file", n_partenaire: "Partenaire n°",
  budget_projet: "Budget projet", feder_projet: "FEDER projet", budget_epci: "Budget EPCI",
};

// Champs où la carte peut volontairement s'écarter du formulaire (reprise de la CCI par l'EPCI de Corse, annexe 5).
const PRUDENCE: Partial<Record<Champ, string>> = {
  n_partenaire: "le numéro a pu changer avec la reprise par l’EPCI de Corse",
  budget_epci: "le formulaire donne le budget du partenaire ; la carte peut ne compter que la part reprise par l’EPCI de Corse",
};

const numero = (s: string | null | undefined) => s?.match(/\bPP\s*\d+/i)?.[0].replace(/\s/g, "").toUpperCase() ?? null;

// Propose de compléter la carte d'identité avec la dernière fiche du formulaire (admin).
// Rien n'est enregistré sans validation ; les champs vides sont cochés d'office, les écarts non.
export default function RepriseFormulaire({ projet }: { projet: Projet }) {
  const { recharger } = useDonnees();
  const [fiche, setFiche] = useState<FicheProjet | null>(null);
  const [coches, setCoches] = useState<Set<Champ> | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void db.from("fiches_projet").select("*").eq("projet_id", projet.id).order("version", { ascending: false }).limit(1)
      .then(({ data }) => setFiche(((data ?? [])[0] as FicheProjet) ?? null));
  }, [projet.id]);

  if (!fiche) return null;
  const r = fiche.contenu.recap ?? {};
  const formulaire: Record<Champ, string | number | null> = {
    titre: r.titre ?? null, chef_de_file: r.chef_de_file ?? null, n_partenaire: numero(fiche.partenaire),
    budget_projet: r.budget_total ?? null, feder_projet: r.feder_total ?? null, budget_epci: r.notre_budget ?? null,
  };
  const numerique = (c: Champ) => c === "budget_projet" || c === "feder_projet" || c === "budget_epci";
  const differe = (c: Champ) => {
    const f = formulaire[c], p = projet[c];
    if (f == null || f === "") return false;
    if (p == null || p === "") return true;
    return numerique(c) ? Math.abs(Number(f) - Number(p)) > 0.005 : String(f).trim() !== String(p).trim();
  };
  const champs = (Object.keys(LIB) as Champ[]).filter(differe);
  if (!champs.length) return null;
  const vide = (c: Champ) => projet[c] == null || projet[c] === "";
  const selection = coches ?? new Set(champs.filter(vide));
  const basculer = (c: Champ) => {
    const s = new Set(selection);
    if (s.has(c)) s.delete(c); else s.add(c);
    setCoches(s);
  };
  const aff = (c: Champ, v: string | number | null) => (v == null || v === "" ? <i className="muted">vide</i> : numerique(c) ? montant(Number(v)) : String(v));
  const version = `V${Number(fiche.version).toFixed(1)}`;

  const enregistrer = async () => {
    const maj = Object.fromEntries([...selection].map((c) => [c, formulaire[c]]));
    const { error } = await db.from("projets").update(maj).eq("id", projet.id);
    if (error) { setMessage(error.message); return; }
    setMessage("");
    setOuvert(false);
    setCoches(null);
    await recharger();
  };

  if (!ouvert) {
    return (
      <button className="btn reprise-bouton" onClick={() => setOuvert(true)}>
        📥 Compléter depuis le formulaire {version} ({champs.filter(vide).length} vide{champs.filter(vide).length > 1 ? "s" : ""}, {champs.filter((c) => !vide(c)).length} écart{champs.filter((c) => !vide(c)).length > 1 ? "s" : ""})
      </button>
    );
  }

  return (
    <div className="reprise">
      <div className="reprise-titre">Reprendre depuis le formulaire {version}</div>
      <div className="muted" style={{ fontSize: 12.5 }}>Coche ce que tu veux reprendre. Les champs vides sont cochés d’office, les écarts non.</div>
      {champs.map((c) => (
        <label key={c} className="reprise-ligne">
          <input type="checkbox" checked={selection.has(c)} onChange={() => basculer(c)} />
          <div>
            <b>{LIB[c]}</b>
            <div className="reprise-valeurs"><span>Carte : {aff(c, projet[c])}</span><span>→ Formulaire : {aff(c, formulaire[c])}</span></div>
            {!vide(c) && PRUDENCE[c] && <div className="reprise-alerte">⚠ {PRUDENCE[c]}</div>}
          </div>
        </label>
      ))}
      {message && <div className="login-err">{message}</div>}
      <div className="projet-liens">
        <button className="btn plein" disabled={!selection.size} onClick={() => void enregistrer()}>Reprendre ({selection.size})</button>
        <button className="btn" onClick={() => { setOuvert(false); setCoches(null); }}>Annuler</button>
      </div>
    </div>
  );
}
