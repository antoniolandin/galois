// Cliente del backend FastAPI (esquema en backend/modelos.py).
// Vite proxia /api → :8000 en desarrollo (ver vite.config.ts).

export interface ComplejoJSON {
  re: number;
  im: number;
}

export interface PolinomioInfo {
  expresion: string;
  grado: number;
  alpha_estrella: ComplejoJSON;
  puntos_de_ramificacion: ComplejoJSON[];
  raices_base: ComplejoJSON[];
}

export interface LatticeNodo {
  id: number;
  orden: number;
  estructura: string;
  tam_clase: number;
  es_normal: boolean;
}

export interface Lattice {
  nodos: LatticeNodo[];
  aristas: [number, number][]; // (j, i) → clase j es subgrupo maximal de i
}

export interface SubgrupoResponse {
  orden: number;
  estructura: string;
  grado: number;
  orbitas: number[][];
  // Campos extra de GAP (null si GAP no respondió).
  is_abelian?: boolean | null;
  is_solvable?: boolean | null;
  is_nilpotent?: boolean | null;
  is_perfect?: boolean | null;
  is_simple?: boolean | null;
  is_transitive?: boolean | null;
  is_primitive?: boolean | null;
  tid?: number | null;
  center_order?: number | null;
  composition_factors?: string[];
  lattice?: Lattice | null;
}

export async function getPolinomio(): Promise<PolinomioInfo> {
  const r = await fetch('/api/polinomio');
  if (!r.ok) throw new Error(`GET /api/polinomio: ${r.status}`);
  return r.json();
}

export async function getSubgrupo(
  generadores: number[][],
  grado: number,
): Promise<SubgrupoResponse> {
  const r = await fetch('/api/grupo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ generadores, grado }),
  });
  if (!r.ok) throw new Error(`POST /api/grupo: ${r.status}`);
  return r.json();
}
