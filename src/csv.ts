// Export CSV lisible par Excel en français : séparateur « ; », BOM UTF-8 (accents), fins de ligne Windows.
// Les nombres gardent la virgule décimale.
export type Cellule = string | number | null | undefined;

const cellule = (v: Cellule): string => {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v).replace(".", ",") : v;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function telechargerCsv(nomFichier: string, lignes: Cellule[][]) {
  const contenu = "﻿" + lignes.map((l) => l.map(cellule).join(";")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([contenu], { type: "text/csv;charset=utf-8" }));
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
