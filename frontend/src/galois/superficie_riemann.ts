// Precómputo de una malla N×N en el plano α y sus raíces asociadas,
// para visualizar la superficie de Riemann de P(x, α) = 0 como
// gráfica (Re α, Im α, h(x_k(α))) donde h es la proyección lineal
// usada también en la vista de trayectorias.
//
// Estrategia (heredada del spike `spike/riemann.html`):
//
//   1. En cada α de la malla se calculan las 5 raíces de P(x, α) con
//      el método de Durand-Kerner, partiendo siempre de las raíces
//      iniciales conocidas en α = 0.
//
//   2. Las raíces obtenidas se reordenan asignando cada una a la
//      `INITIAL_ROOTS[k]` más próxima.  El resultado: `roots[idx][k]`
//      es la raíz que en este α concreto está "más cerca" de la
//      k-ésima raíz inicial.  Es un etiquetado LOCAL por valor, no
//      por continuación.
//
// Diferencia con un BFS de continuación: el etiquetado por valor no
// depende del camino recorrido, así que la superficie no muestra
// "manchas" del color equivocado al rodear puntos de ramificación.
// La monodromía sigue presente en el problema y se aprecia en la
// vista de trayectorias y en el grupo de Galois calculado; aquí se
// busca sólo una superficie visualmente legible.

import type { Complex } from './complex';
import { cAbs, cDiv, cMul, cSub } from './complex';
import { P } from './polinomio';
import { DEGREE, INITIAL_ROOTS } from './polinomio';

export interface MallaRiemann {
  N: number;
  baseR: number;
  // Almacenados en orden row-major:  idx = i * N + j.
  alphas: Complex[];
  // roots[idx][k] = raíz en α = alphas[idx] que ha quedado asignada
  // a la hoja k (la más cercana a INITIAL_ROOTS[k] en C).
  roots: Complex[][];
}

// Durand-Kerner: encuentra simultáneamente las n raíces de P(x, α)
// para α fijo.  Las raíces iniciales (`guess`) deben estar bien
// separadas; al usar INITIAL_ROOTS = {0, 1, -1, i, -i} de partida
// la convergencia es rápida (3–10 iteraciones).
export function durandKerner(
  alpha: Complex,
  guess: Complex[],
  maxIter = 60,
  tol = 1e-11,
): Complex[] {
  const n = guess.length;
  let z = guess.map((g) => [...g] as Complex);
  for (let iter = 0; iter < maxIter; iter++) {
    let maxChange = 0;
    const next: Complex[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const pv = P(z[i], alpha);
      let denom: Complex = [1, 0];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        denom = cMul(denom, cSub(z[i], z[j]));
      }
      const corr = cDiv(pv, denom);
      next[i] = cSub(z[i], corr);
      const c = cAbs(corr);
      if (c > maxChange) maxChange = c;
    }
    z = next;
    if (maxChange < tol) break;
  }
  return z;
}

// Asignación greedy: a cada raíz se le da la INITIAL_ROOTS más cercana
// que aún no esté tomada.  El orden de selección sigue las raíces
// (resultado de Durand-Kerner) según la cercanía mínima a alguna
// inicial, para evitar que una raíz "robe" la etiqueta a otra mejor
// candidata.
function reordenarPorProximidad(rs: Complex[]): Complex[] {
  const n = rs.length;
  const ordenadas: Complex[] = new Array(n);
  const tomada = new Array<boolean>(n).fill(false);
  // Cada par (i, j) con su distancia: i = índice en rs, j = hoja
  const pares: Array<{ i: number; j: number; d: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pares.push({ i, j, d: cAbs(cSub(rs[i], INITIAL_ROOTS[j])) });
    }
  }
  pares.sort((a, b) => a.d - b.d);
  const usadaI = new Array<boolean>(n).fill(false);
  for (const { i, j, d: _d } of pares) {
    if (usadaI[i] || tomada[j]) continue;
    ordenadas[j] = rs[i];
    usadaI[i] = true;
    tomada[j] = true;
  }
  return ordenadas;
}

/**
 * Sonda barata para estimar el rango de altura `h(x) = Re(x) + ½ Im(x)`
 * que toman las raíces de P(x, α) en el entorno de los puntos de
 * ramificación.
 *
 * Muestrea una rejilla 5×5 dentro del disco |α| ≤ baseR/1.5 — es
 * decir, alrededor del cinturón natural de ramificación, sin incluir
 * las esquinas del cuadrado del cubo. Las esquinas estarían
 * demasiado lejos del polinomio y producirían raíces de módulo
 * grande que inflarían el cubo de visualización innecesariamente.
 */
export function altMaxPolinomio(baseR: number): number {
  const radio = baseR / 1.5;
  const muestras: Complex[] = [];
  const N = 5;
  for (let i = 0; i < N; i++) {
    const ax = -radio + (2 * radio * i) / (N - 1);
    for (let j = 0; j < N; j++) {
      const ay = -radio + (2 * radio * j) / (N - 1);
      muestras.push([ax, ay]);
    }
  }
  // Cota superior absoluta para descartar las divergencias de
  // Durand-Kerner sobre raices multiples (por ejemplo en alpha = 0
  // para x^n - alpha): cuando dos raices coinciden, el denominador
  // de la formula DK se anula y las raices se disparan.
  const TECHO = 12;
  let maxH = 0;
  for (const a of muestras) {
    const rs = durandKerner(a, INITIAL_ROOTS as unknown as Complex[]);
    for (const r of rs) {
      const h = Math.abs(r[0] + 0.5 * r[1]);
      if (!Number.isFinite(h)) continue;
      if (h > TECHO) continue;
      if (h > maxH) maxH = h;
    }
  }
  return maxH;
}

export function computarMallaRiemann(N: number, baseR: number): MallaRiemann {
  const total = N * N;
  const alphas: Complex[] = new Array(total);
  for (let i = 0; i < N; i++) {
    const re = -baseR + (2 * baseR * i) / (N - 1);
    for (let j = 0; j < N; j++) {
      const im = -baseR + (2 * baseR * j) / (N - 1);
      alphas[i * N + j] = [re, im];
    }
  }

  const roots: Complex[][] = new Array(total);
  for (let idx = 0; idx < total; idx++) {
    const rs = durandKerner(alphas[idx], INITIAL_ROOTS as unknown as Complex[]);
    roots[idx] = reordenarPorProximidad(rs);
  }

  // Garantía: si por alguna razón la asignación quedó incompleta
  // (no debería con n=DEGREE), rellenar con el origen para que el
  // wireframe no pinte basura.
  for (let idx = 0; idx < total; idx++) {
    for (let k = 0; k < DEGREE; k++) {
      if (!roots[idx][k]) roots[idx][k] = [0, 0];
    }
  }

  return { N, baseR, alphas, roots };
}
