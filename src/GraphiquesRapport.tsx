import type { Periode, Projet } from "./types";
import { aujourdhui, date, montant } from "./format";

const jour = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const COULEURS = ["#0e3052", "#2a7f62", "#b8631f", "#7a3fb0", "#b23a48", "#1f6fa8", "#6b7a1f"];

// Calendrier de tous les projets (Gantt) : une barre par projet, découpée en périodes, avec la ligne « aujourd'hui ».
// Un projet sans dates (candidature, dates non connues) n'est pas dessiné : il est cité sous le graphique.
export function GanttProjets({ projets, periodes }: { projets: Projet[]; periodes: Periode[] }) {
  const dessines = projets.filter((p) => p.date_debut && p.date_fin);
  const sans = projets.filter((p) => !(p.date_debut && p.date_fin));
  if (dessines.length === 0) return null;
  const debut = Math.min(...dessines.map((p) => jour(p.date_debut!)));
  const fin = Math.max(...dessines.map((p) => jour(p.date_fin!)));
  const auj = jour(aujourdhui());
  const anneeDebut = new Date(debut).getUTCFullYear();
  const anneeFin = new Date(fin).getUTCFullYear() + 1;
  const t0 = Date.UTC(anneeDebut, 0, 1), t1 = Date.UTC(anneeFin, 0, 1);
  const G = 120, D = 700, H = 26, haut = 22 + dessines.length * H + 6;
  const x = (t: number) => G + ((t - t0) / (t1 - t0)) * D;
  const annees: number[] = [];
  for (let a = anneeDebut; a < anneeFin; a++) annees.push(a);
  return (
    <>
      <svg viewBox={`0 0 ${G + D + 10} ${haut}`} width="100%" role="img" aria-label="Calendrier des projets" style={{ maxWidth: 860 }}>
        {annees.map((a) => {
          const xa = x(Date.UTC(a, 0, 1));
          return (
            <g key={a}>
              <line x1={xa} x2={xa} y1={16} y2={haut} stroke="#d5dbe6" />
              <text x={xa + 3} y={12} fontSize="10" fill="#5d6a80">{a}</text>
            </g>
          );
        })}
        {dessines.map((p, i) => {
          const y = 22 + i * H;
          const c = p.couleur || COULEURS[i % COULEURS.length];
          const ps = periodes.filter((q) => q.projet_id === p.id && q.date_debut && q.date_fin).sort((a, b) => a.numero - b.numero);
          return (
            <g key={p.id}>
              <text x={G - 6} y={y + 13} fontSize="11" textAnchor="end" fontWeight="600" fill="#172033">{p.acronyme}</text>
              <rect x={x(jour(p.date_debut!))} y={y + 3} width={Math.max(2, x(jour(p.date_fin!)) - x(jour(p.date_debut!)))} height={H - 10} rx="3" fill={c} opacity="0.18" />
              {ps.map((q, k) => (
                <rect key={q.id} x={x(jour(q.date_debut!))} y={y + 3} width={Math.max(1, x(jour(q.date_fin!)) - x(jour(q.date_debut!)) - 1)} height={H - 10} rx="2" fill={c} opacity={k % 2 ? 0.55 : 0.85}>
                  <title>{`${p.acronyme} P${q.numero} : ${date(q.date_debut)} → ${date(q.date_fin)}`}</title>
                </rect>
              ))}
              {ps.map((q) => {
                const largeur = x(jour(q.date_fin!)) - x(jour(q.date_debut!));
                return largeur > 18 ? <text key={`t${q.id}`} x={x(jour(q.date_debut!)) + largeur / 2} y={y + 15} fontSize="9" textAnchor="middle" fill="#fff">P{q.numero}</text> : null;
              })}
            </g>
          );
        })}
        {auj >= t0 && auj <= t1 && (
          <g>
            <line x1={x(auj)} x2={x(auj)} y1={16} y2={haut} stroke="#c0392b" strokeWidth="1.5" strokeDasharray="3 2" />
            <text x={x(auj) + 3} y={haut - 2} fontSize="9" fill="#c0392b">aujourd’hui</text>
          </g>
        )}
      </svg>
      {sans.length > 0 && (
        <p className="muted" style={{ fontSize: 11.5 }}>
          Non représentés (dates non connues) : {sans.map((p) => p.acronyme).join(", ")}.
        </p>
      )}
    </>
  );
}

// Budget par période (part EPCI de Corse) : prévu en barre claire, déclaré en barre foncée.
export function BudgetPeriodes({ periodes, couleur }: { periodes: Periode[]; couleur?: string | null }) {
  const ps = [...periodes].sort((a, b) => a.numero - b.numero);
  if (!ps.some((p) => p.prevu != null || p.declare != null)) return null;
  const max = Math.max(...ps.map((p) => Math.max(p.prevu ?? 0, p.declare ?? 0)), 1);
  const c = couleur || "#0e3052";
  const L = 56, B = 130, hauteur = 96, pas = Math.min(80, 640 / ps.length);
  const largeur = L + ps.length * pas + 10;
  const h = (v: number) => (v / max) * hauteur;
  const cumulPrevu = ps.reduce((s, p) => s + (p.prevu ?? 0), 0);
  return (
    <>
      <svg viewBox={`0 0 ${largeur} ${B + 30}`} width="100%" role="img" aria-label="Budget par période" style={{ maxWidth: Math.max(320, largeur) }}>
        <line x1={L} x2={largeur - 6} y1={B} y2={B} stroke="#9aa5b8" />
        <text x={L - 4} y={B - hauteur + 3} fontSize="9" textAnchor="end" fill="#5d6a80">{Math.round(max / 1000)} k€</text>
        <text x={L - 4} y={B + 3} fontSize="9" textAnchor="end" fill="#5d6a80">0</text>
        {ps.map((p, i) => {
          const x0 = L + i * pas + pas * 0.12;
          const w = pas * 0.36;
          return (
            <g key={p.id}>
              {p.prevu != null && <rect x={x0} y={B - h(p.prevu)} width={w} height={h(p.prevu)} fill={c} opacity="0.35"><title>{`P${p.numero} prévu : ${montant(p.prevu)}`}</title></rect>}
              {p.declare != null && <rect x={x0 + w + 2} y={B - h(p.declare)} width={w} height={h(p.declare)} fill={c}><title>{`P${p.numero} déclaré : ${montant(p.declare)}`}</title></rect>}
              <text x={x0 + w} y={B + 12} fontSize="10" textAnchor="middle" fill="#172033">P{p.numero}</text>
              {p.prevu != null && p.prevu > 0 && <text x={x0 + w / 2} y={B - h(p.prevu) - 3} fontSize="8" textAnchor="middle" fill="#5d6a80">{Math.round(p.prevu / 100) / 10} k</text>}
            </g>
          );
        })}
        <rect x={L} y={B + 20} width="9" height="9" fill={c} opacity="0.35" />
        <text x={L + 13} y={B + 28} fontSize="9" fill="#5d6a80">prévu (total {montant(cumulPrevu)})</text>
        <rect x={L + 150} y={B + 20} width="9" height="9" fill={c} />
        <text x={L + 163} y={B + 28} fontSize="9" fill="#5d6a80">déclaré</text>
      </svg>
    </>
  );
}
