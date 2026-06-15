// Polinomio paramétrico P(x, α) cargado en tiempo de ejecución.
//
// El módulo mantiene unas "bindings mutables" (`let`) con las
// funciones del polinomio actual; al ser ES modules, los importadores
// ven el valor vigente en el momento de leer la referencia. La
// función `setPolinomioRuntime` actualiza esas bindings a partir de
// la respuesta del backend.
//
// Para forzar el re-render de los componentes que dependan del
// polinomio (cualquiera que use INITIAL_ROOTS, DEGREE, etc. en
// `useMemo`/`useEffect`), App.tsx remontea el árbol con `key` cuando
// cambia el polinomio. Los closures que hayan capturado las
// constantes anteriores ya estarán fuera de uso al remontar.

import type { Complex } from './complex';
import { cAdd, cMul } from './complex';

interface ComplejoJSON {
  re: number;
  im: number;
}

interface PolinomioRuntimeInfo {
  grado: number;
  raices_base: ComplejoJSON[];
  // coefs_alpha[k] = coeficientes de a_k(alpha) en orden de grado
  // decreciente; coefs_alpha[0] es el coeficiente líder a_n (≈ [1])
  // por monicidad.
  coefs_alpha: ComplejoJSON[][];
  branch_x: ComplejoJSON[];
}

// === Estado mutable ===

let _coefsAlpha: Complex[][] = [
  [[1, 0]],
  [[0, 0]],
  [[0, 0]],
  [[0, 0]],
  [[-1, 0]],
  [[1, 0], [0, 0]],
];

// Helpers de evaluación (Horner) sobre coefs en orden grado descendente.
function evalEnAlpha(coefs: Complex[], alpha: Complex): Complex {
  let r: Complex = [0, 0];
  for (const c of coefs) r = cAdd(cMul(r, alpha), c);
  return r;
}

// Coeficientes de la derivada respecto a α (orden descendente).
function derivCoefsAlpha(coefs: Complex[]): Complex[] {
  const m = coefs.length - 1;
  const out: Complex[] = [];
  for (let i = 0; i < m; i++) {
    const j = m - i;
    out.push(cMul([j, 0], coefs[i]));
  }
  return out;
}

// === Bindings exportados ===
// P = sum_k a_k(alpha) * x^k (Horner en x).
export const P = (x: Complex, alpha: Complex): Complex => {
  let r: Complex = [0, 0];
  for (const cs of _coefsAlpha) {
    const ak = evalEnAlpha(cs, alpha);
    r = cAdd(cMul(r, x), ak);
  }
  return r;
};
// ∂P/∂x = sum_{k≥1} k · a_k(alpha) · x^{k−1} (Horner en x).
export const Px = (x: Complex, alpha?: Complex): Complex => {
  const a = alpha ?? ([0, 0] as Complex);
  let r: Complex = [0, 0];
  const n = _coefsAlpha.length - 1;
  for (let i = 0; i < n; i++) {
    const k = n - i;
    const ak = evalEnAlpha(_coefsAlpha[i], a);
    const coef = cMul([k, 0], ak);
    r = cAdd(cMul(r, x), coef);
  }
  return r;
};
// ∂P/∂α = sum_k (da_k/dalpha)(alpha) · x^k.
export const Pa = (x?: Complex, alpha?: Complex): Complex => {
  const xx = x ?? ([0, 0] as Complex);
  const a = alpha ?? ([0, 0] as Complex);
  let r: Complex = [0, 0];
  for (const cs of _coefsAlpha) {
    const dak = evalEnAlpha(derivCoefsAlpha(cs), a);
    r = cAdd(cMul(r, xx), dak);
  }
  return r;
};

export let DEGREE = 5;
export let INITIAL_ROOTS: Complex[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// Paleta Okabe-Ito; las primeras `DEGREE` entradas se usan según el
// orden de raíces que devuelva el backend.
export const ROOT_COLORS = [
  '#000000', // 0
  '#56B4E9', // 1
  '#E69F00', // 2
  '#009E73', // 3
  '#CC79A7', // 4
  '#0072B2', // 5
  '#D55E00', // 6
  '#F0E442', // 7
];

// Raíces dobles de P en x para cada α_b del lugar de ramificación.
// El backend las calcula resolviendo P_x(x, α_b) = 0 y filtrando las
// que también anulan P. Se usan en `PlanoX` como marcadores
// "fantasma" de hacia dónde colapsa cada par de raíces cerca de un
// branch point.
export let BRANCH_X: Complex[] = (() => {
  const r = Math.pow(1 / 5, 1 / 4);
  return [
    [r, 0],
    [0, r],
    [-r, 0],
    [0, -r],
  ];
})();

// === Setter ===

// Orden canónico del polinomio "estándar" del TFG (x^5 − x + α): la
// raíz x = 0 va primera (color negro), después x = 1 (azul Okabe),
// luego −1, i, −i. Cuando el backend devuelve las raíces en el
// orden arbitrario de `np.roots`, las identificamos por proximidad
// y, si TODAS coinciden con este conjunto, las reordenamos a este
// orden. Otros polinomios se quedan en el orden del backend.
const CANON_5: Complex[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function setPolinomioRuntime(info: PolinomioRuntimeInfo): void {
  _coefsAlpha = info.coefs_alpha.map((cs) =>
    cs.map(({ re, im }) => [re, im] as Complex),
  );
  DEGREE = info.grado;
  BRANCH_X = info.branch_x.map(({ re, im }) => [re, im] as Complex);
  const raw: Complex[] = info.raices_base.map(
    ({ re, im }) => [re, im] as Complex,
  );
  // Heurística: si las raíces base coinciden aproximadamente con
  // {0, 1, −1, i, −i}, usamos el orden canónico para que los
  // colores sigan la convención del polinomio inicial (negro = 0).
  if (raw.length === CANON_5.length) {
    const cuadran = CANON_5.every((c) =>
      raw.some((r) => Math.hypot(r[0] - c[0], r[1] - c[1]) < 0.1),
    );
    if (cuadran) {
      INITIAL_ROOTS = CANON_5.map((c) => [c[0], c[1]] as Complex);
      return;
    }
  }
  INITIAL_ROOTS = raw;
}
