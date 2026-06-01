// Búsqueda de las 5 raíces de P(x, alpha) en un alpha arbitrario,
// vía Durand-Kerner.  Necesario para inicializar el sistema cuando
// el usuario clica fuera del origen — ahí no podemos arrancar el
// predictor-corrector desde INITIAL_ROOTS porque esas son las raíces
// en alpha=0, no en alpha=target.

import type { Complex } from './complex';
import { cAbs, cDiv, cMul, cSub } from './complex';
import { INITIAL_ROOTS, P } from './polinomio';

/**
 * Itera Durand-Kerner partiendo de las raíces canónicas en α=0.
 * Devuelve las 5 raíces en orden arbitrario.
 */
export function durandKerner(
  alpha: Complex,
  maxIter = 50,
  tol = 1e-11,
): Complex[] {
  let z: Complex[] = INITIAL_ROOTS.map((g) => [g[0], g[1]] as Complex);
  for (let iter = 0; iter < maxIter; iter++) {
    let maxChange = 0;
    const next: Complex[] = [];
    for (let i = 0; i < z.length; i++) {
      const pv = P(z[i], alpha);
      let denom: Complex = [1, 0];
      for (let j = 0; j < z.length; j++) {
        if (j === i) continue;
        denom = cMul(denom, cSub(z[i], z[j]));
      }
      const corr = cDiv(pv, denom);
      next.push(cSub(z[i], corr));
      maxChange = Math.max(maxChange, cAbs(corr));
    }
    z = next;
    if (maxChange < tol) break;
  }
  return z;
}

/**
 * Raíces en α, reetiquetadas por proximidad a INITIAL_ROOTS.  Así
 * el array devuelto sigue el mismo orden canónico (0, 1, -1, i, -i)
 * y los colores de la UI se mantienen estables.
 */
export function rootsAt(alpha: Complex): Complex[] {
  const dk = durandKerner(alpha);
  const out: Complex[] = new Array(INITIAL_ROOTS.length);
  const used = new Set<number>();
  for (let i = 0; i < INITIAL_ROOTS.length; i++) {
    let bestJ = -1;
    let bestD = Infinity;
    for (let j = 0; j < dk.length; j++) {
      if (used.has(j)) continue;
      const d = cAbs(cSub(dk[j], INITIAL_ROOTS[i]));
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    out[i] = dk[bestJ];
    used.add(bestJ);
  }
  return out;
}
