// Generación de lazos para el algoritmo Hauenstein–Rodríguez–Sottile.
//
// Cada lazo rodea EXACTAMENTE un punto de ramificación bᵢ. La forma
// es una "elipse en huevo": pasa por α* en un extremo del eje mayor
// y bᵢ queda dentro del recinto, cerca del otro extremo. El
// semi-eje menor varía con la posición a lo largo del eje mayor:
// estrecho cerca de α* (pico del huevo) y ancho cerca de bᵢ
// (parte redondeada del huevo). Esa asimetría hace que la
// trayectoria se "abra" para envolver bᵢ y se "cierre" volviendo
// al punto base sin tropezarse con otros B.

import type { Complex } from './complex';

// Margen al otro lado de bᵢ. El otro extremo del eje mayor cae a
// `MARGEN_EXTREMO` unidades más allá de bᵢ en la dirección saliente.
const MARGEN_EXTREMO = 0.08;
// Ancho máximo del huevo (cerca de bᵢ). Se limita en tiempo de
// ejecución si la elipse fuese a englobar otro punto de ramificación.
const ANCHO_MAX = 0.22;
// Relación entre el ancho del extremo de α* y el ancho de bᵢ. Más
// bajo = más puntiagudo en α*.
const RELACION_HUEVO = 0.35;
// Muestras del contorno. 64 puntos dan una curva visualmente lisa
// para circunferencias del orden de 1 unidad de mundo.
const MUESTRAS = 64;

/**
 * Construye un lazo basado en α* que envuelve únicamente al punto
 * de ramificación `bi`. La forma es una "elipse-huevo": estrecha en
 * el extremo de α* y ancha en el extremo de bᵢ.
 */
export function generarLazoAlrededorDe(
  alphaEstrella: Complex,
  bi: Complex,
  otrosB: Complex[],
): Complex[] {
  const dx = bi[0] - alphaEstrella[0];
  const dy = bi[1] - alphaEstrella[1];
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) {
    // α* y bᵢ coinciden: caso degenerado, devolvemos lazo trivial.
    return [alphaEstrella, alphaEstrella];
  }
  // u_out: dirección α* → bᵢ; v: perpendicular CCW.
  const ux = dx / d;
  const uy = dy / d;
  const vx = -uy;
  const vy = ux;

  // Semi-eje mayor y centro:
  //   α* y bᵢ + margen·u_out son los dos extremos del eje mayor.
  //   2a = d + margen,  c = α* + a·u_out.
  const a = (d + MARGEN_EXTREMO) / 2;
  const cx = alphaEstrella[0] + a * ux;
  const cy = alphaEstrella[1] + a * uy;

  // Ancho máximo: clamp si otro B cae a menos de `bMax + margen`
  // perpendicular al eje, dentro de la franja longitudinal.
  let bMax = ANCHO_MAX;
  for (const bj of otrosB) {
    const px = bj[0] - alphaEstrella[0];
    const py = bj[1] - alphaEstrella[1];
    const proyU = px * ux + py * uy;
    const proyV = px * vx + py * vy;
    if (proyU >= 0 && proyU <= d + MARGEN_EXTREMO) {
      const lim = Math.abs(proyV) - 0.03;
      if (lim < bMax) bMax = lim;
    }
  }
  if (bMax < 0.04) bMax = 0.04;
  const bMin = bMax * RELACION_HUEVO;

  // Construir el contorno del huevo. La parametrización usa el eje
  // mayor en dirección bᵢ → α* (= −u_out) para que en θ = 0 el
  // punto coincida con α* (extremo "agudo" del huevo).
  const lazo: Complex[] = [];
  for (let k = 0; k <= MUESTRAS; k++) {
    const theta = (k / MUESTRAS) * 2 * Math.PI;
    // Atenuador del semi-eje menor para perfil de huevo:
    // t = (1 − cos θ) / 2  ∈ [0, 1], 0 en α* y 1 en el extremo
    // opuesto. Mezcla bMin → bMax con esa rampa.
    const t = (1 - Math.cos(theta)) / 2;
    const b = bMin + (bMax - bMin) * t;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const px = cx - a * cosT * ux + b * sinT * vx;
    const py = cy - a * cosT * uy + b * sinT * vy;
    lazo.push([px, py]);
  }
  return lazo;
}
