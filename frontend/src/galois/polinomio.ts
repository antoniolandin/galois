// Polinomio canónico del TFG: P(x, α) = x⁵ − x + α
//
// Para el MVP está hardcodeado. Cuando se generalice, este módulo
// expondrá una factoría que produce las funciones P, Px, Pa a partir
// de la respuesta del backend (probablemente compilando una expresión
// simbólica que vendrá serializada en JSON).

import type { Complex } from './complex';
import { cAdd, cSub, cMul, cPow } from './complex';

const ONE: Complex = [1, 0];
const FIVE: Complex = [5, 0];

// P(x, α) = x⁵ − x + α
export const P = (x: Complex, alpha: Complex): Complex =>
  cAdd(cSub(cPow(x, 5), x), alpha);

// ∂P/∂x = 5x⁴ − 1
export const Px = (x: Complex): Complex =>
  cSub(cMul(FIVE, cPow(x, 4)), ONE);

// ∂P/∂α = 1
export const Pa = (): Complex => ONE;

// Raíces de x⁵ − x = x(x − 1)(x + 1)(x − i)(x + i) en α* = 0.
// Orden canónico que el backend espera para emparejar generadores.
export const INITIAL_ROOTS: Complex[] = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
];

export const DEGREE = 5;

// Lugar de ramificación en el plano x: raíces dobles de
// P(x, α_b) = 0 en cada punto de ramificación α_b.  Para x⁵ − x + α
// se obtienen como los 4 ceros de P_x = 5x⁴ − 1, esto es,
// x_b = (1/5)^(1/4) · {1, i, -1, -i} ≈ {±0.6687, ±0.6687i}.
export const BRANCH_X: Complex[] = (() => {
  const r = Math.pow(1 / 5, 1 / 4);
  return [
    [r, 0],
    [0, r],
    [-r, 0],
    [0, -r],
  ];
})();

// Paleta Okabe-Ito por raíz, en el mismo orden que INITIAL_ROOTS.
export const ROOT_COLORS = [
  '#000000', // 0
  '#56B4E9', // 1
  '#E69F00', // -1
  '#009E73', // i
  '#CC79A7', // -i
];
