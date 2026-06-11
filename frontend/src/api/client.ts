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

export async function postPolinomio(expresion: string): Promise<PolinomioInfo> {
  const r = await fetch('/api/polinomio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expresion }),
  });
  if (!r.ok) {
    let detail = `POST /api/polinomio: ${r.status}`;
    try {
      const j = (await r.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return r.json();
}

export interface GrupoObjetivo {
  estructura: string;
  orden: number;
}

export async function getGaloisObjetivo(): Promise<GrupoObjetivo> {
  const r = await fetch('/api/galois-objetivo');
  if (!r.ok) throw new Error(`GET /api/galois-objetivo: ${r.status}`);
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

export interface PermutacionResponse {
  asignacion: number[];
  cycles: number[][];
  trayectorias: ComplejoJSON[][];
}

export async function postPermutacion(
  lazo: ComplejoJSON[],
  cerrarEnAlphaEstrella: boolean,
): Promise<PermutacionResponse> {
  const r = await fetch('/api/permutacion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lazo,
      cerrar_en_alpha_estrella: cerrarEnAlphaEstrella,
    }),
  });
  if (!r.ok) throw new Error(`POST /api/permutacion: ${r.status}`);
  return r.json();
}

// -- Stauduhar (grado 3 a 5 sobre Q) -------------------------------

export interface CosetApp {
  idx: number;
  representante_latex: string;
  representante_cycle: number[][];
  conjugado_y_latex: string;
  conjugado_alpha_latex: string;
  valor_numerico_latex: string;
  valor_es_entero: boolean;
}

export interface GrupoInfo {
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
}

export interface CandidatoProbado {
  subgrupo_latex: string;
  subgrupo_orden: number;
  indice: number;
  invariante_y_latex: string;
  invariante_descripcion: string;
  cosets: CosetApp[];
  Q_latex: string;
  Q_factorizacion_latex: string;
  raices_enteras_simples: string[];
  descender_a: string | null;
  coset_descenso_idx: number | null;
  razon: string;
  subgrupo_info?: GrupoInfo | null;
}

export interface NivelDescenso {
  grupo_actual_latex: string;
  grupo_actual_orden: number;
  candidatos: CandidatoProbado[];
  descender_a: string | null;
  grupo_actual_info?: GrupoInfo | null;
}

export interface StauduharResponse {
  polinomio_latex: string;
  grado: number;
  niveles: NivelDescenso[];
  grupo_final: string;
}

export async function postStauduhar(
  expresion: string,
  grado: number,
): Promise<StauduharResponse> {
  const r = await fetch('/api/stauduhar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expresion, grado }),
  });
  if (!r.ok) {
    let detail = `POST /api/stauduhar: ${r.status}`;
    try {
      const j = (await r.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return r.json();
}
