// Generación de lazos aleatorios para el modo Leykin–Sottile.
//
// Cada llamada produce un lazo cerrado en `ℂ ∖ B` basado en α*. La
// trayectoria es una caminata pseudoaleatoria de paso fijo: arranca
// en α*, da N pasos en direcciones uniformes (rechazando los que
// salen del disco de exploración o cruzan la vecindad de un punto
// de ramificación) y al final se cierra en línea recta hasta α*.
//
// No es un arco geométrico alrededor de un branch concreto (eso es
// la estrategia de Hauenstein–Rodríguez–Sottile, sec. 2.4 del TFG)
// sino el componente aleatorio que da nombre al método: el lazo
// puede rodear ninguno, uno o varios puntos de ramificación de
// forma impredecible, y la permutación inducida es la composición
// de las monodromías locales en el orden en que el lazo los rodea.

import type { Complex } from './complex';

// Tamaño del paso de la caminata. Suficientemente pequeño para que
// la continuación numérica del backend siga las raíces sin saltos.
const STEP_SIZE = 0.08;
// Número de pasos antes de cerrar el lazo. Más pasos = lazo más
// largo y más probabilidad de rodear varios branches.
const N_PASOS = 50;
// Distancia mínima permitida a un punto de ramificación. Si la
// caminata se acerca más, se rechaza el paso y se prueba otra
// dirección, así el lazo no atraviesa la vecindad inmediata de un
// branch (donde el predictor-corrector pierde precisión).
const MARGEN_BRANCH = 0.05;
// Radio del disco de exploración en función del extremo de los
// puntos de ramificación: la caminata no se aleja más de aquí.
const FACTOR_RADIO = 1.8;
// Intentos por paso antes de quedarse quieto: si todos fallan
// (porque cur está rodeado de B o muy pegado al borde), se mantiene
// la posición y se sigue.
const INTENTOS_POR_PASO = 12;
// Margen mínimo de cualquier α* respecto a los puntos de ramificación.
const UMBRAL_CERCA_BRANCH = 0.08;

function lejosDeBranches(
  p: Complex,
  ramif: Complex[],
  margen: number,
): boolean {
  for (const b of ramif) {
    if (Math.hypot(p[0] - b[0], p[1] - b[1]) < margen) return false;
  }
  return true;
}

/**
 * Devuelve `true` si `alphaEstrella` está peligrosamente cerca de
 * algún punto de ramificación. El método de Leykin–Sottile pierde
 * estabilidad numérica si el punto base coincide o casi coincide
 * con un branch.
 */
export function alphaEstrellaInsegura(
  alphaEstrella: Complex,
  ramificacion: Complex[],
): boolean {
  return !lejosDeBranches(alphaEstrella, ramificacion, UMBRAL_CERCA_BRANCH);
}

/**
 * Construye un lazo cerrado pseudoaleatorio basado en α*. La
 * caminata da `N_PASOS` pasos cortos en direcciones uniformes,
 * rechazando los que caen dentro de la vecindad inmediata de un
 * punto de ramificación o fuera del disco de exploración. Al final
 * cierra el trayecto con una línea recta de pequeños pasos hasta α*.
 */
export function generarLazoAleatorio(
  alphaEstrella: Complex,
  ramificacion: Complex[],
): Complex[] {
  const maxRamif =
    ramificacion.length === 0
      ? 0.5
      : Math.max(...ramificacion.map((b) => Math.hypot(b[0], b[1])));
  const R_DISCO = Math.max(0.6, maxRamif * FACTOR_RADIO);
  // Las constantes de paso/margen se calibraron para |ramif| ≈ 0.5.
  // Para polinomios con ramificación más lejana (p.ej. x^5 + 5x + α
  // tiene |ramif| ≈ 4) hay que escalarlas en proporción, si no la
  // caminata recorre un trozo despreciable del plano.
  const escala = Math.max(maxRamif / 0.5, 1);
  const stepSize = STEP_SIZE * escala;
  const margenBranch = MARGEN_BRANCH * escala;

  const lazo: Complex[] = [alphaEstrella];
  let cur = alphaEstrella;

  for (let paso = 0; paso < N_PASOS; paso++) {
    let avanzado: Complex | null = null;
    for (let intento = 0; intento < INTENTOS_POR_PASO; intento++) {
      const ang = Math.random() * 2 * Math.PI;
      const candidato: Complex = [
        cur[0] + stepSize * Math.cos(ang),
        cur[1] + stepSize * Math.sin(ang),
      ];
      if (Math.hypot(candidato[0], candidato[1]) > R_DISCO) continue;
      if (!lejosDeBranches(candidato, ramificacion, margenBranch)) continue;
      avanzado = candidato;
      break;
    }
    if (avanzado == null) {
      // Atascado: si rechazamos todos los intentos, terminamos el
      // tramo aleatorio aquí y cerramos el lazo.
      break;
    }
    lazo.push(avanzado);
    cur = avanzado;
  }

  // Cierre lineal hasta α* en pasos cortos, para que el
  // predictor-corrector del backend no tenga que subdividir mucho.
  const dx = alphaEstrella[0] - cur[0];
  const dy = alphaEstrella[1] - cur[1];
  const distFinal = Math.hypot(dx, dy);
  const nCierre = Math.max(1, Math.ceil(distFinal / stepSize));
  for (let k = 1; k <= nCierre; k++) {
    const t = k / nCierre;
    lazo.push([cur[0] + dx * t, cur[1] + dy * t]);
  }

  return lazo;
}
