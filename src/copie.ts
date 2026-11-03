// Copie locale pour la consultation hors connexion : dernières données lues et rôle du compte.
// Effacée à la déconnexion. Sans stockage disponible, l'appli fonctionne comme avant (sans copie).

export const CLE_COPIE = "europa.copie";
export const CLE_ROLE = "europa.role";

export function lireCopie<T>(): { quand: string; donnees: T } | null {
  try {
    const brut = localStorage.getItem(CLE_COPIE);
    return brut ? (JSON.parse(brut) as { quand: string; donnees: T }) : null;
  } catch {
    return null;
  }
}

export function ecrireCopie(donnees: unknown) {
  try {
    localStorage.setItem(CLE_COPIE, JSON.stringify({ quand: new Date().toISOString(), donnees }));
  } catch { /* stockage plein ou indisponible : pas de copie */ }
}

export function lireRoleMemorise(): { user_id: string; role: string } | null {
  try {
    const brut = localStorage.getItem(CLE_ROLE);
    return brut ? (JSON.parse(brut) as { user_id: string; role: string }) : null;
  } catch {
    return null;
  }
}

export function memoriserRole(user_id: string, role: string) {
  try {
    localStorage.setItem(CLE_ROLE, JSON.stringify({ user_id, role }));
  } catch { /* sans stockage, pas de rôle hors ligne */ }
}

export function viderCopie() {
  try {
    localStorage.removeItem(CLE_COPIE);
    localStorage.removeItem(CLE_ROLE);
  } catch { /* rien à effacer */ }
}
