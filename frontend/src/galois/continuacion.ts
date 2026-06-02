// Continuación numérica: predictor (Euler) + corrector (Newton)
// con subdivisión adaptativa para evitar saltos grandes.
//
// Es el puerto JS del algoritmo en `~/Repos/galois/galois/continuacion.py`.
// Validado contra el backend con tests de paridad a 1e-8 (futuros).

import type { Complex } from './complex';
import { cAdd, cSub, cMul, cDiv, cNeg, cAbs } from './complex';
import { P, Px, Pa } from './polinomio';

function eulerStep(x_k: Complex, alpha_k: Complex, alpha_kp1: Complex): Complex {
  // dx/dα = -P_α / P_x  (ambas derivadas dependen de (x, α) en
  // general; antes el polinomio era x⁵-x+α y P_x y P_α eran
  // independientes de α, por eso se evaluaban sin pasarlo).
  const dx_da = cNeg(cDiv(Pa(x_k, alpha_k), Px(x_k, alpha_k)));
  const da = cSub(alpha_kp1, alpha_k);
  return cAdd(x_k, cMul(dx_da, da));
}

function newtonCorrect(
  x_pred: Complex,
  alpha: Complex,
  tol = 1e-12,
  maxIter = 30,
): Complex {
  let x = x_pred;
  for (let i = 0; i < maxIter; i++) {
    const pv = P(x, alpha);
    if (cAbs(pv) < tol) return x;
    const der = Px(x, alpha);
    if (cAbs(der) < 1e-15) break; // raíz doble: imposible continuar
    x = cSub(x, cDiv(pv, der));
  }
  return x;
}

function stepRoot(x_k: Complex, a_k: Complex, a_kp1: Complex): Complex {
  return newtonCorrect(eulerStep(x_k, a_k, a_kp1), a_kp1);
}

// Tamaño máximo del salto en α antes de subdividir. Empírico:
// más allá de ~0.05 unidades, Newton tiende a divergir o ir a la
// raíz vecina equivocada.
const MAX_DELTA = 0.05;

/**
 * Mueve cada una de las n raíces desde la posición correspondiente
 * a `alpha` hasta la correspondiente a `newAlpha`. Si el delta es
 * grande, subdivide el camino en tramos pequeños para que Newton
 * converja siempre.
 */
export function stepRootsAdaptive(
  roots: Complex[],
  alpha: Complex,
  newAlpha: Complex,
): Complex[] {
  const dA = cSub(newAlpha, alpha);
  const dist = cAbs(dA);
  if (dist < MAX_DELTA) {
    return roots.map((r) => stepRoot(r, alpha, newAlpha));
  }
  const n = Math.ceil(dist / MAX_DELTA);
  let cur = roots;
  let curA = alpha;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const interp: Complex = [alpha[0] + dA[0] * t, alpha[1] + dA[1] * t];
    cur = cur.map((r) => stepRoot(r, curA, interp));
    curA = interp;
  }
  return cur;
}
