// Aritmética compleja: un complejo es un par [re, im].
//
// Diseñado para mínima sobrecarga: sin clase, sin allocations cuando se
// puede evitar. Apto para llamadas a 60 fps en el bucle de drag.

export type Complex = readonly [number, number];

export const C_ZERO: Complex = [0, 0];
export const C_ONE: Complex = [1, 0];

export const cAdd = (a: Complex, b: Complex): Complex =>
  [a[0] + b[0], a[1] + b[1]];

export const cSub = (a: Complex, b: Complex): Complex =>
  [a[0] - b[0], a[1] - b[1]];

export const cMul = (a: Complex, b: Complex): Complex =>
  [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];

export const cDiv = (a: Complex, b: Complex): Complex => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};

export const cNeg = (a: Complex): Complex => [-a[0], -a[1]];

export const cAbs = (a: Complex): number =>
  Math.sqrt(a[0] * a[0] + a[1] * a[1]);

export const cPow = (a: Complex, n: number): Complex => {
  let r: Complex = [1, 0];
  for (let i = 0; i < n; i++) r = cMul(r, a);
  return r;
};
