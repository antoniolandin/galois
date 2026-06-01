// Monodromía: extracción de la permutación inducida por un lazo
// y utilidades de formato.

import type { Complex } from './complex';
import { cAbs, cSub } from './complex';

/**
 * Empareja cada raíz final con su raíz inicial más cercana
 * (asignación 1-a-1 greedy). Devuelve la permutación en formato
 * one-line: `asignacion[i] = j` significa "la raíz que partió en
 * la posición i acabó en la posición que ocupaba inicialmente la
 * raíz j".
 */
export function emparejarPorProximidad(
  finales: Complex[],
  iniciales: Complex[],
): number[] {
  const n = iniciales.length;
  const asignacion: number[] = [];
  const libres = Array(n).fill(true);
  for (let i = 0; i < n; i++) {
    let bestJ = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (!libres[j]) continue;
      const d = cAbs(cSub(finales[i], iniciales[j]));
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    asignacion.push(bestJ);
    libres[bestJ] = false;
  }
  return asignacion;
}

/**
 * Descomposición en ciclos disjuntos. Los puntos fijos
 * (σ(i) = i) se omiten.
 */
export function ciclos(asignacion: number[]): number[][] {
  const n = asignacion.length;
  const visited = Array(n).fill(false);
  const result: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    if (asignacion[i] === i) {
      visited[i] = true;
      continue;
    }
    const cycle: number[] = [];
    let j = i;
    while (!visited[j]) {
      visited[j] = true;
      cycle.push(j);
      j = asignacion[j];
    }
    if (cycle.length > 1) result.push(cycle);
  }
  return result;
}

export const formatCycle = (c: number[]): string => '(' + c.join(' ') + ')';

export function formatPerm(asignacion: number[]): string {
  const cyc = ciclos(asignacion);
  if (cyc.length === 0) return 'id';
  return cyc.map(formatCycle).join(' ');
}
