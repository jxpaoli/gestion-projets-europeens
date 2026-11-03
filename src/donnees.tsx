import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { db } from "./supabase";
import { ecrireCopie, lireCopie, lireRoleMemorise, memoriserRole } from "./copie";
import type { Action, CibleSource, DocumentProjet, Evolution, ReunionInfo, ReunionPoint, Echeance, EtapePeriode, Evenement, Livrable, NouvelleSource, Passage, Periode, Projet, Role, Source, StatutAction, SuiviPerso } from "./types";

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
  // « Mon suivi » : vide pour un lecteur (la base ne lui renvoie rien, et on ne le demande même pas).
  suivi: SuiviPerso[];
}

// Un message éphémère du bandeau ; « annuler » défait l'opération qui vient d'être faite.
interface Avis {
  texte: string;
  annuler?: () => void;
}

interface DonneesCtx {
  donnees: Donnees | null;
  erreur: string;
  estAdmin: boolean;
  // Date de la copie affichée faute de réseau (ISO), ou null quand les données sont à jour.
  copieLocale: string | null;
  // Relit toutes les tables, ou seulement celles qui ont changé.
  recharger: (cles?: Cle[]) => Promise<void>;
  projet: (id: string) => Projet | undefined;
  cocherAction: (a: Action, annulable?: boolean) => Promise<void>;
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
  // « Mon suivi » : création (sans id) ou modification, et suppression ; renvoient un message d'erreur ou "".
  enregistrerSuivi: (s: Partial<SuiviPerso> & Pick<SuiviPerso, "type" | "libelle">) => Promise<string>;
  supprimerSuivi: (id: string) => Promise<string>;
  // Élément dont le panneau des sources est ouvert, ou null.
  voirSources: CibleSource | null;
  setVoirSources: (c: CibleSource | null) => void;
  // Action ouverte dans la fiche d'édition : une action existante, "nouvelle", ou null (fermée).
  editer: Action | "nouvelle" | null;
  setEditer: (a: Action | "nouvelle" | null) => void;
  // Bandeau : message du moment, et fermeture.
  avis: Avis | null;
  notifier: (texte: string, annuler?: () => void) => void;
  fermerAvis: () => void;
}

const Ctx = createContext<DonneesCtx>(null as unknown as DonneesCtx);
export const useDonnees = () => useContext(Ctx);

// Les tables lues par l'appli ; « passage » est le dernier passage du secrétaire.
type Cle = "projets" | "actions" | "echeances" | "livrables" | "periodes" | "etapes" | "evenements" | "passage" | "documents" | "parametres" | "infos" | "points" | "sources" | "evolutions" | "suivi";
const TOUTES: Cle[] = ["projets", "actions", "echeances", "livrables", "periodes", "etapes", "evenements", "passage", "documents", "parametres", "infos", "points", "sources", "evolutions", "suivi"];

async function lire<T>(table: string, ordre: string): Promise<T[]> {
  const { data, error } = await db.from(table).select("*").order(ordre, { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as T[];
}

async function lireCle(cle: Cle, estAdmin: boolean): Promise<Partial<Donnees>> {
  switch (cle) {
    case "projets": return { projets: await lire<Projet>("projets", "acronyme") };
    case "actions": return { actions: await lire<Action>("actions", "echeance") };
    case "echeances": return { echeances: await lire<Echeance>("echeances", "date") };
    case "livrables": return { livrables: await lire<Livrable>("livrables", "echeance") };
    case "periodes": return { periodes: await lire<Periode>("periodes", "numero") };
    case "etapes": return { etapes: await lire<EtapePeriode>("etapes_periode", "date_limite") };
    case "evenements": return { evenements: await lire<Evenement>("actions_evenements", "id") };
    case "passage": return {
      dernierPassage: await db.from("passages_secretaire").select("*").order("debut", { ascending: false }).limit(1)
        .then(({ data, error }) => { if (error) throw error; return ((data ?? []) as Passage[])[0] ?? null; }),
    };
    case "documents": return { documents: await lire<DocumentProjet>("documents", "nom") };
    case "parametres": return {
      parametres: Object.fromEntries((await lire<{ cle: string; valeur: string }>("parametres", "cle")).map((p) => [p.cle, p.valeur])),
    };
    case "infos": return { infos: await lire<ReunionInfo>("reunion_infos", "ordre") };
    case "points": return { points: await lire<ReunionPoint>("reunion_points", "ordre") };
    case "sources": return { sources: await lire<Source>("sources", "date_source") };
    case "evolutions": return { evolutions: await lire<Evolution>("evolutions", "date_evolution") };
    // « Mon suivi » : jamais demandé à un lecteur.
    case "suivi": return { suivi: estAdmin ? await lire<SuiviPerso>("suivi_perso", "date") : [] };
  }
}

// Titre court pour les messages : un libellé d'action peut être long.
const court = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

export function DonneesProvider({ estAdmin, children }: { estAdmin: boolean; children: ReactNode }) {
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState("");
  const [copieLocale, setCopieLocale] = useState<string | null>(null);
  const [editer, setEditer] = useState<Action | "nouvelle" | null>(null);
  const [voirSources, setVoirSources] = useState<CibleSource | null>(null);
  const [avis, setAvis] = useState<Avis | null>(null);
  const minuterieAvis = useRef<number | undefined>(undefined);

  const notifier = useCallback((texte: string, annuler?: () => void) => {
    window.clearTimeout(minuterieAvis.current);
    setAvis({ texte, annuler });
    // Un « Annuler » reste affiché un peu plus longtemps qu'une simple erreur à lire.
    minuterieAvis.current = window.setTimeout(() => setAvis(null), annuler ? 5000 : 7000);
  }, []);
  const fermerAvis = useCallback(() => {
    window.clearTimeout(minuterieAvis.current);
    setAvis(null);
  }, []);
  useEffect(() => () => window.clearTimeout(minuterieAvis.current), []);

  const recharger = useCallback(async (cles: Cle[] = TOUTES) => {
    const complet = cles === TOUTES;
    try {
      const morceaux = await Promise.all(cles.map((c) => lireCle(c, estAdmin)));
      const nouveau = Object.assign({}, ...morceaux) as Partial<Donnees>;
      // Une relecture partielle ne remplace que les tables concernées.
      setDonnees((d) => (complet || !d ? (nouveau as Donnees) : { ...d, ...nouveau }));
      setErreur("");
      setCopieLocale(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Chargement impossible";
      // Hors réseau au premier chargement : on affiche la dernière copie, en le signalant.
      const copie = complet ? lireCopie<Donnees>() : null;
      if (copie) {
        setDonnees(copie.donnees);
        setCopieLocale(copie.quand);
        setErreur("");
      } else if (complet) {
        setErreur(message);
      } else {
        notifier(`Mise à jour impossible : ${message}`);
      }
    }
  }, [estAdmin, notifier]);

  useEffect(() => { void recharger(); }, [recharger]);

  // Copie locale à jour après chaque lecture réussie, pour le mode hors connexion.
  useEffect(() => { if (donnees) ecrireCopie(donnees); }, [donnees]);

  const projet = (id: string) => donnees?.projets.find((p) => p.id === id);

  // Coche / décoche une action : affichage immédiat, puis enregistrement ; retour arrière si la base refuse.
  // Un bandeau propose alors d'annuler (sauf quand c'est déjà une annulation).
  const cocherAction = async (a: Action, annulable = true) => {
    const statut: StatutAction = a.statut === "fait" ? "a_faire" : "fait";
    const remplacer = (s: StatutAction) => setDonnees((d) => d && ({
      ...d, actions: d.actions.map((x) => (x.id === a.id ? { ...x, statut: s } : x)),
    }));
    remplacer(statut);
    const { error } = await db.from("actions").update({ statut }).eq("id", a.id);
    if (error) {
      remplacer(a.statut);
      notifier(`Modification impossible : ${error.message}`);
      return;
    }
    await recharger(["actions", "evenements"]);
    if (annulable) {
      notifier(`« ${court(a.libelle)} » ${statut === "fait" ? "terminée" : "rouverte"}`, () => void cocherAction({ ...a, statut }, false));
    }
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
    await recharger(["actions", "evenements", "sources"]);
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
    await recharger(["evolutions"]);
    return "";
  };

  const supprimerEvolution = async (id: string) => {
    const { error } = await db.from("evolutions").delete().eq("id", id);
    if (error) return error.message;
    await recharger(["evolutions", "sources"]);
    return "";
  };

  const enregistrerSuivi = async (s: Partial<SuiviPerso> & Pick<SuiviPerso, "type" | "libelle">) => {
    const { id, updated_at, origine, modifie_par_admin, ...champs } = s;
    const { error } = id ? await db.from("suivi_perso").update(champs).eq("id", id) : await db.from("suivi_perso").insert(champs);
    if (error) return error.message;
    await recharger(["suivi"]);
    return "";
  };

  const supprimerSuivi = async (id: string) => {
    const { error } = await db.from("suivi_perso").delete().eq("id", id);
    if (error) return error.message;
    await recharger(["suivi", "sources"]);
    return "";
  };

  const commenter = async (actionId: string, message: string) => {
    const { error } = await db.from("actions_evenements").insert({ action_id: actionId, type: "commentaire", message });
    if (error) return error.message;
    await recharger(["evenements"]);
    return "";
  };

  const supprimerAction = async (id: string) => {
    const { error } = await db.from("actions").delete().eq("id", id);
    if (error) return error.message;
    await recharger(["actions", "evenements", "sources"]);
    return "";
  };

  return (
    <Ctx.Provider value={{ donnees, erreur, estAdmin, copieLocale, recharger, projet, cocherAction, enregistrerAction, supprimerAction, commenter, majPoint,
      ajouterSource, supprimerSource, enregistrerEvolution, supprimerEvolution, enregistrerSuivi, supprimerSuivi, voirSources, setVoirSources, editer, setEditer,
      avis, notifier, fermerAvis }}>
      {children}
    </Ctx.Provider>
  );
}

// Rôle du compte connecté dans l'appli ; "aucun" si le compte n'est pas inscrit.
// Hors réseau, on garde le rôle mémorisé pour ce même compte.
export function useRole(userId: string | undefined): Role | "aucun" | null {
  const [role, setRole] = useState<Role | "aucun" | null>(null);
  useEffect(() => {
    if (!userId) return;
    let actif = true;
    void db.from("roles_appli").select("role").eq("user_id", userId).maybeSingle().then(({ data, error }) => {
      if (!actif) return;
      if (error) {
        const memo = lireRoleMemorise();
        setRole(memo?.user_id === userId ? (memo.role as Role) : "aucun");
        return;
      }
      if (!data) { setRole("aucun"); return; }
      memoriserRole(userId, data.role);
      setRole(data.role as Role);
    });
    return () => { actif = false; };
  }, [userId]);
  return role;
}
