import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { db } from "./supabase";
import type { Action, CibleSource, DocumentProjet, Evolution, ReunionInfo, ReunionPoint, Echeance, EtapePeriode, Evenement, Livrable, NouvelleSource, Passage, Periode, Projet, Role, Source, StatutAction } from "./types";

export interface Donnees {
  projets: Projet[];
  actions: Action[];
  echeances: Echeance[];
  livrables: Livrable[];
  periodes: Periode[];
  etapes: EtapePeriode[];
  evenements: Evenement[];
  dernierPassage: Passage | null;
  documents: DocumentProjet[];
  parametres: Record<string, string>;
  infos: ReunionInfo[];
  points: ReunionPoint[];
  sources: Source[];
  evolutions: Evolution[];
}

interface DonneesCtx {
  donnees: Donnees | null;
  erreur: string;
  estAdmin: boolean;
  recharger: () => Promise<void>;
  projet: (id: string) => Projet | undefined;
  cocherAction: (a: Action) => Promise<void>;
  // Les sources passées sont rattachées à l'action après sa création.
  enregistrerAction: (a: Partial<Action> & Pick<Action, "projet_id" | "libelle">, sources?: NouvelleSource[]) => Promise<string>;
  supprimerAction: (id: string) => Promise<string>;
  commenter: (actionId: string, message: string) => Promise<string>;
  majPoint: (id: string, champs: Partial<ReunionPoint>) => Promise<string>;
  ajouterSource: (cible: Pick<CibleSource, "champ" | "id">, s: NouvelleSource) => Promise<string>;
  supprimerSource: (id: string) => Promise<string>;
  // Journal des évolutions : création (sans id) ou modification ; renvoie un message d'erreur ou "".
  enregistrerEvolution: (e: Partial<Evolution> & Pick<Evolution, "projet_id" | "titre">) => Promise<string>;
  supprimerEvolution: (id: string) => Promise<string>;
  // Élément dont le panneau des sources est ouvert, ou null.
  voirSources: CibleSource | null;
  setVoirSources: (c: CibleSource | null) => void;
  // Action ouverte dans la fiche d'édition : une action existante, "nouvelle", ou null (fermée).
  editer: Action | "nouvelle" | null;
  setEditer: (a: Action | "nouvelle" | null) => void;
}

const Ctx = createContext<DonneesCtx>(null as unknown as DonneesCtx);
export const useDonnees = () => useContext(Ctx);

async function lire<T>(table: string, ordre: string): Promise<T[]> {
  const { data, error } = await db.from(table).select("*").order(ordre, { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as T[];
}

export function DonneesProvider({ estAdmin, children }: { estAdmin: boolean; children: ReactNode }) {
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState("");
  const [editer, setEditer] = useState<Action | "nouvelle" | null>(null);
  const [voirSources, setVoirSources] = useState<CibleSource | null>(null);

  const recharger = useCallback(async () => {
    try {
      const [projets, actions, echeances, livrables, periodes, etapes, evenements, passages, documents, parametres, infos, points, sources, evolutions] = await Promise.all([
        lire<Projet>("projets", "acronyme"),
        lire<Action>("actions", "echeance"),
        lire<Echeance>("echeances", "date"),
        lire<Livrable>("livrables", "echeance"),
        lire<Periode>("periodes", "numero"),
        lire<EtapePeriode>("etapes_periode", "date_limite"),
        lire<Evenement>("actions_evenements", "id"),
        db.from("passages_secretaire").select("*").order("debut", { ascending: false }).limit(1)
          .then(({ data, error }) => { if (error) throw error; return (data ?? []) as Passage[]; }),
        lire<DocumentProjet>("documents", "nom"),
        lire<{ cle: string; valeur: string }>("parametres", "cle"),
        lire<ReunionInfo>("reunion_infos", "ordre"),
        lire<ReunionPoint>("reunion_points", "ordre"),
        lire<Source>("sources", "date_source"),
        lire<Evolution>("evolutions", "date_evolution"),
      ]);
      setDonnees({ projets, actions, echeances, livrables, periodes, etapes, evenements, dernierPassage: passages[0] ?? null,
        documents, parametres: Object.fromEntries(parametres.map((p) => [p.cle, p.valeur])), infos, points, sources, evolutions });
      setErreur("");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible");
    }
  }, []);

  useEffect(() => { void recharger(); }, [recharger]);

  const projet = (id: string) => donnees?.projets.find((p) => p.id === id);

  // Coche / décoche une action : affichage immédiat, puis enregistrement ; retour arrière si la base refuse.
  const cocherAction = async (a: Action) => {
    const statut: StatutAction = a.statut === "fait" ? "a_faire" : "fait";
    const remplacer = (s: StatutAction) => setDonnees((d) => d && ({
      ...d, actions: d.actions.map((x) => (x.id === a.id ? { ...x, statut: s } : x)),
    }));
    remplacer(statut);
    const { error } = await db.from("actions").update({ statut }).eq("id", a.id);
    if (error) {
      remplacer(a.statut);
      alert(`Modification impossible : ${error.message}`);
      return;
    }
    await recharger();
  };

  // Création (sans id) ou modification d'une action ; renvoie un message d'erreur, ou "" si c'est enregistré.
  const enregistrerAction = async (a: Partial<Action> & Pick<Action, "projet_id" | "libelle">, sources: NouvelleSource[] = []) => {
    const { id, updated_at, ...champs } = a;
    if (id) {
      // Refusé si quelqu'un (le secrétaire) a modifié l'action depuis son ouverture : pas d'écrasement silencieux.
      const { data, error } = await db.from("actions").update(champs).eq("id", id).eq("updated_at", updated_at!).select("id");
      if (error) return error.message;
      if (!data?.length) { await recharger(); return "Cette action vient d'être modifiée par ailleurs. Elle a été rechargée : vérifie et réessaie."; }
    } else {
      const { data, error } = await db.from("actions").insert(champs).select("id").single();
      if (error) return error.message;
      if (sources.length) {
        const { error: e } = await db.from("sources").insert(sources.map((s) => ({ ...s, action_id: data.id })));
        if (e) { await recharger(); return `Action créée, mais sources non enregistrées : ${e.message}`; }
      }
    }
    await recharger();
    return "";
  };

  const majPoint = async (id: string, champs: Partial<ReunionPoint>) => {
    setDonnees((d) => d && ({ ...d, points: d.points.map((p) => (p.id === id ? { ...p, ...champs } : p)) }));
    const { error } = await db.from("reunion_points").update(champs).eq("id", id);
    return error ? error.message : "";
  };

  const ajouterSource = async (cible: Pick<CibleSource, "champ" | "id">, s: NouvelleSource) => {
    const { data, error } = await db.from("sources").insert({ ...s, [cible.champ]: cible.id }).select().single();
    if (error) return error.code === "23505" ? "Ce mail est déjà cité." : error.message;
    setDonnees((d) => d && ({ ...d, sources: [...d.sources, data as Source] }));
    return "";
  };

  const supprimerSource = async (id: string) => {
    const { error } = await db.from("sources").delete().eq("id", id);
    if (error) return error.message;
    setDonnees((d) => d && ({ ...d, sources: d.sources.filter((x) => x.id !== id) }));
    return "";
  };

  const enregistrerEvolution = async (e: Partial<Evolution> & Pick<Evolution, "projet_id" | "titre">) => {
    const { id, updated_at, modifie_par_admin, ajoute_par, ...champs } = e;
    const { error } = id ? await db.from("evolutions").update(champs).eq("id", id) : await db.from("evolutions").insert(champs);
    if (error) return error.message;
    await recharger();
    return "";
  };

  const supprimerEvolution = async (id: string) => {
    const { error } = await db.from("evolutions").delete().eq("id", id);
    if (error) return error.message;
    await recharger();
    return "";
  };

  const commenter = async (actionId: string, message: string) => {
    const { error } = await db.from("actions_evenements").insert({ action_id: actionId, type: "commentaire", message });
    if (error) return error.message;
    await recharger();
    return "";
  };

  const supprimerAction = async (id: string) => {
    const { error } = await db.from("actions").delete().eq("id", id);
    if (error) return error.message;
    await recharger();
    return "";
  };

  return (
    <Ctx.Provider value={{ donnees, erreur, estAdmin, recharger, projet, cocherAction, enregistrerAction, supprimerAction, commenter, majPoint,
      ajouterSource, supprimerSource, enregistrerEvolution, supprimerEvolution, voirSources, setVoirSources, editer, setEditer }}>
      {children}
    </Ctx.Provider>
  );
}

// Rôle du compte connecté dans l'appli ; "aucun" si le compte n'est pas inscrit.
export function useRole(userId: string | undefined): Role | "aucun" | null {
  const [role, setRole] = useState<Role | "aucun" | null>(null);
  useEffect(() => {
    if (!userId) return;
    let actif = true;
    void db.from("roles_appli").select("role").eq("user_id", userId).maybeSingle().then(({ data, error }) => {
      if (!actif) return;
      setRole(error || !data ? "aucun" : (data.role as Role));
    });
    return () => { actif = false; };
  }, [userId]);
  return role;
}
