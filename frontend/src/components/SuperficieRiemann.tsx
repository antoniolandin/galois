// Vista 3D de la superficie de Riemann de P(x, α) = 0.
//
// La superficie es el conjunto de pares (α, x) ∈ C × C que anulan
// P; al proyectar (α, x) → α se obtiene una cobertura n-hojas del
// plano α, ramificada sobre el discriminante.  Aquí se grafica
// como una malla N×N sobre el plano α, con altura
//
//     Z = h(x_k(α)) = Re(x_k) + ½ Im(x_k)
//
// para cada una de las n hojas k.  La misma proyección lineal C → R
// que en la vista de trayectorias evita que hojas distintas colapsen
// en altura sólo por simetría en una parte de C.
//
// La malla se precalcula vía BFS desde un vértice cercano a α = 0
// (donde el etiquetado de raíces es conocido) y se mantiene mientras
// no cambie el polinomio.  Para pintar, cada hoja se renderiza como
// wireframe; las aristas en las que dos raíces "vecinas" están muy
// alejadas en C se descartan, lo que produce los cortes esperados
// alrededor de los puntos de ramificación sin pintar saltos artificiales.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Complex } from '../galois/complex';
import { cAbs } from '../galois/complex';
import { DEGREE, INITIAL_ROOTS, ROOT_COLORS } from '../galois/polinomio';
import {
  DEFAULT_CAM,
  PHI_MAX,
  PHI_MIN,
  project,
  projectFromLookAt,
  type CamState,
  type Vec3,
} from '../galois/proyeccion3d';
import type { CameraMode } from './CameraToggle';
import type { Dispatch, SetStateAction } from 'react';
import {
  altMaxPolinomio,
  computarMallaRiemann,
  type MallaRiemann,
} from '../galois/superficie_riemann';

interface Props {
  ramificacion: Complex[];
  currentAlpha: Complex;
  roots: Complex[];
  lazo: Complex[];
  trayectorias: Complex[][];
  startRoots: Complex[];
  cameraMode: CameraMode;
  povIdx: number;
  cam: CamState;
  onCamChange: Dispatch<SetStateAction<CamState>>;
}

// Resolución de la malla (puntos por lado). 50 × 50 = 2 500 vértices
// por hoja, ~12 500 puntos pintados en total. Compromiso entre
// densidad visual (más bajo → puntos individuales más legibles, con
// el plano del fondo respirando) y suavidad de la superficie. El
// spike usa 80 pero al ser una nube WebGL los puntos quedan muy
// pegados; aquí, con canvas 2D y puntos cuadrados, se ve mejor con
// menos densidad.
const N_MALLA = 50;

// Proyección C → R que actúa como coordenada vertical. Idéntica a
// la usada en la vista de trayectorias, para que el ojo asocie la
// misma altura al mismo valor de x.
const altura = (x: Complex): number => x[0] + 0.5 * x[1];

// Frame local (right, forwardDef) ortogonal a `up`. `forwardDef` se
// elige proyectando el vector mundo (0, 1, 0) sobre el plano
// perpendicular a `up`; si esa proyección es nula (caso degenerado
// con up paralelo a +Y) cae a (1, 0, 0). `right = up × forwardDef`.
function frameLocal(up: Vec3): { right: Vec3; forwardDef: Vec3 } {
  const candidatos: Vec3[] = [
    [0, 1, 0],
    [1, 0, 0],
  ];
  let fx = 0;
  let fy = 0;
  let fz = 0;
  for (const c of candidatos) {
    const dot = c[0] * up[0] + c[1] * up[1] + c[2] * up[2];
    const px = c[0] - dot * up[0];
    const py = c[1] - dot * up[1];
    const pz = c[2] - dot * up[2];
    const pn = Math.hypot(px, py, pz);
    if (pn > 1e-6) {
      fx = px / pn;
      fy = py / pn;
      fz = pz / pn;
      break;
    }
  }
  // right = forwardDef × up (regla de la mano derecha).
  const rx = fy * up[2] - fz * up[1];
  const ry = fz * up[0] - fx * up[2];
  const rz = fx * up[1] - fy * up[0];
  return { right: [rx, ry, rz], forwardDef: [fx, fy, fz] };
}

// Dirección de mirada parametrizada por (yaw, pitch) en el frame
// local: yaw = 0 mira en `forwardDef`, yaw positivo rota hacia el
// `right` (CCW desde arriba); pitch positivo levanta la mirada
// hacia `up`.
function forwardDesdeYawPitch(
  yaw: number,
  pitch: number,
  up: Vec3,
): Vec3 {
  const { right, forwardDef } = frameLocal(up);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const hx = cy * forwardDef[0] + sy * right[0];
  const hy = cy * forwardDef[1] + sy * right[1];
  const hz = cy * forwardDef[2] + sy * right[2];
  return [
    cp * hx + sp * up[0],
    cp * hy + sp * up[1],
    cp * hz + sp * up[2],
  ];
}

// Inverso: (yaw, pitch) que orientan la cámara desde `camPos`
// para mirar a `target`, expresados en el frame local de `up`.
function yawPitchHaciaPunto(
  target: Vec3,
  camPos: Vec3,
  up: Vec3,
): { yaw: number; pitch: number } {
  const { right, forwardDef } = frameLocal(up);
  let wx = target[0] - camPos[0];
  let wy = target[1] - camPos[1];
  let wz = target[2] - camPos[2];
  const wn = Math.hypot(wx, wy, wz);
  if (wn < 1e-9) return { yaw: 0, pitch: 0 };
  wx /= wn;
  wy /= wn;
  wz /= wn;
  const wDotUp = wx * up[0] + wy * up[1] + wz * up[2];
  const wDotFwd = wx * forwardDef[0] + wy * forwardDef[1] + wz * forwardDef[2];
  const wDotRight = wx * right[0] + wy * right[1] + wz * right[2];
  return {
    pitch: Math.asin(Math.max(-1, Math.min(1, wDotUp))),
    yaw: Math.atan2(wDotRight, wDotFwd),
  };
}

// Hoja del mallado sobre la que se encuentra una raíz concreta en
// el α actual. La identidad de la raíz seguida (color/canónica) es
// estable, pero su posición sobre la superficie de Riemann cambia al
// aplicar permutaciones: cruzar un punto de ramificación intercambia
// los roles entre hojas. Esta función localiza la hoja del mallado
// más próxima a la posición de la raíz para que el ancla de la
// cámara POV siga al color y no al índice fijo de la hoja.
function meshSheetParaRaiz(
  malla: MallaRiemann,
  currentAlpha: Complex,
  rootPos: Complex,
): number {
  const N = malla.N;
  const baseR = malla.baseR;
  let i = Math.round(((currentAlpha[0] + baseR) / (2 * baseR)) * (N - 1));
  let j = Math.round(((currentAlpha[1] + baseR) / (2 * baseR)) * (N - 1));
  if (i < 0) i = 0;
  else if (i >= N) i = N - 1;
  if (j < 0) j = 0;
  else if (j >= N) j = N - 1;
  const sheets = malla.roots[i * N + j];
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < sheets.length; k++) {
    const s = sheets[k];
    if (!s) continue;
    const dx = s[0] - rootPos[0];
    const dy = s[1] - rootPos[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

// Normal local a la hoja `povIdx` en el punto del α actual.
// La superficie es z = h(α), así que la normal (no unitaria) es
// (-∂h/∂αx, -∂h/∂αy, 1).  Se aproxima con diferencias finitas
// sobre la malla precomputada: dos vecinos en cada eje. Sirve
// para que en POV el "up" de la cámara siga la inclinación de la
// hoja sobre la que la raíz observada "camina".
function normalEnAlpha(
  malla: MallaRiemann,
  currentAlpha: Complex,
  povIdx: number,
): Vec3 {
  const N = malla.N;
  const baseR = malla.baseR;
  let i = Math.round(((currentAlpha[0] + baseR) / (2 * baseR)) * (N - 1));
  let j = Math.round(((currentAlpha[1] + baseR) / (2 * baseR)) * (N - 1));
  if (i < 1) i = 1;
  else if (i >= N - 1) i = N - 2;
  if (j < 1) j = 1;
  else if (j >= N - 1) j = N - 2;
  const dAlpha = (2 * baseR) / (N - 1);
  const hAt = (ii: number, jj: number): number => {
    const r = malla.roots[ii * N + jj][povIdx];
    return r ? r[0] + 0.5 * r[1] : 0;
  };
  const dhdx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * dAlpha);
  const dhdy = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * dAlpha);
  let nx = -dhdx;
  let ny = -dhdy;
  let nz = 1;
  const nn = Math.hypot(nx, ny, nz);
  if (nn < 1e-9) return [0, 0, 1];
  nx /= nn;
  ny /= nn;
  nz /= nn;
  return [nx, ny, nz];
}

const BOX_COLOR = '#d8d8db';

// Tamaño en píxeles de cada punto de la nube. Se mantiene constante
// en pantalla (no en mundo) para que la superficie se vea con la
// misma densidad independientemente del zoom.
const TAM_PUNTO_PX = 2.4;

// Submuestreo en POV. STEP = 2 cuadruplica el rendimiento respecto
// a STEP = 1 a costa de facets el doble de grandes; con la nueva
// modulación de color por Im(x) (cada triángulo coge un tono ligero
// distinto de la tabla pre-cuantizada) el relieve sigue
// percibiéndose y se evita el sobrecoste de pintar 4× triángulos.
const POV_STEP = 2;

// Margen vertical sobre el "techo" local de la hoja del observador
// en POV. La cámara se ancla a la raíz `povIdx` (no se eleva por
// otras hojas vecinas) para que la sensación de "primera persona
// desde la raíz" se conserve. El máximo se toma en una ventana 5×5
// para que el lazo no entre en zonas atravesables durante
// movimientos rápidos.
const POV_LIFT = 0.08;
const POV_VENTANA = 2;

// Calcula la coordenada Z para la cámara POV: máximo de altura de
// la hoja `povIdx` en la ventana ±POV_VENTANA alrededor del α
// actual, sumando `POV_LIFT`. Sólo mira la hoja observadora.
function camZPOV(
  malla: MallaRiemann,
  currentAlpha: Complex,
  povIdx: number,
): number {
  const N = malla.N;
  const baseR = malla.baseR;
  let i = Math.round(((currentAlpha[0] + baseR) / (2 * baseR)) * (N - 1));
  let j = Math.round(((currentAlpha[1] + baseR) / (2 * baseR)) * (N - 1));
  if (i < 0) i = 0;
  else if (i >= N) i = N - 1;
  if (j < 0) j = 0;
  else if (j >= N) j = N - 1;
  let maxH = -Infinity;
  for (let di = -POV_VENTANA; di <= POV_VENTANA; di++) {
    for (let dj = -POV_VENTANA; dj <= POV_VENTANA; dj++) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || ni >= N || nj < 0 || nj >= N) continue;
      const r = malla.roots[ni * N + nj][povIdx];
      if (!r) continue;
      const h = r[0] + 0.5 * r[1];
      if (h > maxH) maxH = h;
    }
  }
  if (!Number.isFinite(maxH)) maxH = 0;
  return maxH + POV_LIFT;
}

// Modulación de color por Im(x_k) en POV: en lugar de sombreado
// direccional (caro y plano sobre la hoja negra), la luminosidad
// del triángulo se determina por la parte imaginaria de la raíz en
// ese punto. Im más alto = más claro, Im más bajo = más oscuro. Esto
// da relieve visual ligado a una magnitud "real" de la superficie y
// elimina el cálculo de normales por triángulo.
//
// Los colores se precomputan en una tabla cuantizada: por cada hoja
// y nivel discreto de Im, un string `rgb(...)` listo para asignar a
// `ctx.fillStyle`. Los `fillStyle` repetidos se cachean en el
// navegador, así que la presión sobre el GC del hot loop baja
// notablemente respecto a construir el string cada triángulo.
const IM_NIVELES = 16;
const IM_RANGO = 1.2;
const SHEET_COLOR_TABLE: string[][] = ROOT_COLORS.map((hex) => {
  let r: number, g: number, b: number;
  if (hex === '#000000') {
    // El negro puro no responde a la modulación (0 × cualquier
    // factor = 0). Se sustituye por un gris frío oscuro para que
    // la hoja 0 muestre relieve sin perder su identidad visual.
    r = 60; g = 62; b = 72;
  } else {
    const c = parseInt(hex.slice(1), 16);
    r = (c >> 16) & 0xff;
    g = (c >> 8) & 0xff;
    b = c & 0xff;
  }
  const tabla: string[] = new Array(IM_NIVELES);
  for (let i = 0; i < IM_NIVELES; i++) {
    const t = i / (IM_NIVELES - 1);
    const f = 0.45 + 0.55 * t;
    tabla[i] = `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
  }
  return tabla;
});

function imToLevel(im: number): number {
  let t = (im + IM_RANGO) / (2 * IM_RANGO);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const lvl = Math.floor(t * IM_NIVELES);
  return lvl >= IM_NIVELES ? IM_NIVELES - 1 : lvl;
}

// `baseR` "fijo" del polinomio para la malla precomputada. Se
// dimensiona con un factor 2.5 × max |ramif| (más generoso que el
// del cubo orbital, factor 1.5) precisamente para que cualquier
// lazo razonable del usuario entre dentro del rango cubierto por
// la superficie precomputada — y la trayectoria del lazo no quede
// "flotando" sobre área sin superficie pintada.
function baseRPolinomio(ramificacion: Complex[]): number {
  const r =
    ramificacion.length === 0
      ? 1.2
      : Math.max(...ramificacion.map(cAbs)) * 2.5;
  return Math.max(r, 1.2);
}

// `mundo`: dimensiones del cubo dependientes sólo del polinomio
// (no del lazo). Si el usuario dibuja un lazo que se sale, las
// curvas se ven fuera del cubo — pero el cubo no se reescala, así
// que la cámara y la sensación espacial permanecen estables.
function computarMundo(
  baseRFijo: number,
  altRFijo: number,
): { baseR: number; altR: number } {
  // Mismo cap relativo que en la vista de trayectorias: el cubo
  // no puede ser más de un 60 % más alto que ancho.
  const baseR = Math.max(baseRFijo * 1.15, 0.6);
  const altCap = baseR * 1.6;
  return {
    baseR,
    altR: Math.max(Math.min(altRFijo * 1.15, altCap), 1.2),
  };
}

export function SuperficieRiemann({
  ramificacion,
  currentAlpha,
  roots,
  lazo,
  trayectorias,
  startRoots,
  cameraMode,
  povIdx,
  cam,
  onCamChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Orientación de la cámara en modo POV: yaw (azimut) y pitch
  // (elevación), expresados en radianes. `yaw = 0` mira hacia +Y;
  // `pitch = 0` mira horizontal. El roll queda implícito a 0 porque
  // `projectFromLookAt` reconstruye la base con `worldUp = (0, 0, 1)`.
  const [povYaw, setPovYaw] = useState(0);
  const [povPitch, setPovPitch] = useState(0);
  type DragState =
    | { kind: 'orbital'; mx: number; my: number; cam: CamState }
    | { kind: 'pov'; mx: number; my: number; yaw: number; pitch: number };
  const draggingRef = useRef<DragState | null>(null);
  // Igual que en la vista de trayectorias: índice de la raíz bajo el
  // cursor y posiciones en pantalla de las raíces para el hit-test.
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const projectedRef = useRef<Array<{ k: number; sx: number; sy: number; depth: number }>>([]);

  const baseRFijo = useMemo(() => baseRPolinomio(ramificacion), [ramificacion]);
  // Sonda de raíces sobre una rejilla del plano α (al cargar la
  // página). Da una cota razonable del rango vertical de la
  // superficie de Riemann sin esperar a que el usuario dibuje un
  // lazo amplio. ~30 evaluaciones de Durand-Kerner, despreciable.
  const altRFijo = useMemo(() => altMaxPolinomio(baseRFijo), [baseRFijo]);
  const mundo = useMemo(
    () => computarMundo(baseRFijo, altRFijo),
    [baseRFijo, altRFijo],
  );

  // Malla precomputada: usa el `baseR` del polinomio (no el del
  // cubo adaptativo) para no recomputar Durand-Kerner cada vez que
  // el lazo del usuario altera las dimensiones del cubo.
  const malla = useMemo<MallaRiemann>(
    () => computarMallaRiemann(N_MALLA, baseRFijo),
    [baseRFijo],
  );

  // Hoja del mallado en la que actualmente reside la raíz seguida.
  // `povIdx` es el índice canónico (color) de la raíz; tras una
  // permutación, esa raíz ocupa una hoja distinta de la malla. El
  // ancla de la cámara POV debe consultar este índice dinámico.
  const povMeshIdx = useMemo(() => {
    const r = roots[povIdx];
    if (!r) return povIdx;
    return meshSheetParaRaiz(malla, currentAlpha, r);
  }, [malla, currentAlpha, roots, povIdx]);

  // Cámara dinámica en POV. Cada vez que la raíz se mueve
  // (cambia `currentAlpha`), la orientación se recalcula para que
  // apunte hacia el origen del mundo desde la nueva posición. El
  // drag del usuario rompe temporalmente este auto-encuadre — la
  // mirada queda donde la haya dejado mientras la raíz no se mueva
  // —, pero en cuanto vuelve a moverse la raíz el efecto se
  // dispara y restablece el ángulo dinámico. El check de
  // `draggingRef` evita que el reorientado machaque la mirada que
  // el usuario está produciendo en ese mismo instante con el ratón.
  useEffect(() => {
    if (cameraMode !== 'pov') return;
    if (draggingRef.current?.kind === 'pov') return;
    const cz = camZPOV(malla, currentAlpha, povMeshIdx);
    const camPos: Vec3 = [currentAlpha[0], currentAlpha[1], cz];
    // yaw/pitch ahora viven en el frame local de la normal de la
    // hoja; los resolvemos a partir del vector camPos → origen.
    const up = normalEnAlpha(malla, currentAlpha, povMeshIdx);
    const { yaw, pitch } = yawPitchHaciaPunto([0, 0, 0], camPos, up);
    setPovYaw(yaw);
    setPovPitch(pitch);
  }, [currentAlpha, cameraMode, malla, povMeshIdx]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.resetTransform();
        ctx.scale(dpr, dpr);
      }
      setSize({ w: rect.width, h: rect.height });
    });
    obs.observe(canvas);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (size.w === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h } = size;
    ctx.clearRect(0, 0, w, h);

    const { baseR, altR } = mundo;
    // Cámara: orbital (esféricas alrededor del origen) o POV (anclada
    // a la raíz `povIdx` mirando hacia el origen del mundo). En POV
    // la propia `projectFromLookAt` actúa como frustum culling: lo
    // que queda detrás de la raíz se descarta y no se pinta, así no
    // hace falta hacer back-face culling manual.
    let proj: (p: Vec3) => { sx: number; sy: number; depth: number } | null;
    if (cameraMode === 'pov' && roots[povIdx]) {
      const camPos: Vec3 = [
        currentAlpha[0],
        currentAlpha[1],
        camZPOV(malla, currentAlpha, povMeshIdx),
      ];
      // `worldUp` = normal local de la hoja observada. La cámara
      // se "inclina" con la superficie: cuando la hoja sube en una
      // dirección, el techo de la cámara apunta hacia esa dirección.
      const upLocal = normalEnAlpha(malla, currentAlpha, povMeshIdx);
      // El forward se construye en el frame local de `upLocal` para
      // que el drag (yaw/pitch) se sienta como rotar la cabeza
      // sobre la hoja: yaw siempre rota alrededor de la normal y
      // pitch siempre levanta/baja la mirada relativa a la hoja.
      const f = forwardDesdeYawPitch(povYaw, povPitch, upLocal);
      const target: Vec3 = [
        camPos[0] + f[0],
        camPos[1] + f[1],
        camPos[2] + f[2],
      ];
      proj = (p: Vec3) =>
        projectFromLookAt(p, camPos, target, w, h, upLocal);
    } else {
      proj = (p: Vec3) => project(p, cam, w, h);
    }
    const enPOV = cameraMode === 'pov';

    // === Caja delimitadora wireframe ===
    const corners: Vec3[] = [
      [-baseR, -baseR, -altR],
      [+baseR, -baseR, -altR],
      [+baseR, +baseR, -altR],
      [-baseR, +baseR, -altR],
      [-baseR, -baseR, +altR],
      [+baseR, -baseR, +altR],
      [+baseR, +baseR, +altR],
      [-baseR, +baseR, +altR],
    ];
    const edges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    ctx.strokeStyle = BOX_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    for (const [a, b] of edges) {
      const pa = proj(corners[a]);
      const pb = proj(corners[b]);
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.sx, pa.sy);
      ctx.lineTo(pb.sx, pb.sy);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // === Nube de puntos de la superficie ===
    // El spike `spike/riemann.html` pinta la superficie como nube de
    // partículas con Three.js (GPU); aquí replicamos esa estética
    // sobre canvas 2D con `fillRect`, que la CPU encadena muy rápido
    // sin pagar el coste de antialiasing de los `lineTo` del
    // wireframe. Resultado: ~32 000 cuadrados de 2 px por frame,
    // fluido durante el orbit.
    //
    // Cuando hay un lazo activo se baja la opacidad de la nube para
    // que las trayectorias destaquen como "sujeto" sobre la
    // superficie como "atmósfera".
    const hayLazo = lazo.length > 1;
    const nubeAlpha = hayLazo ? 0.22 : 0.7;
    const N = malla.N;
    const total = N * N;
    const half = TAM_PUNTO_PX / 2;
    if (enPOV) {
      // === POV: hojas opacas como malla triangulada ===
      // Cada celda (i, j)-(i+1, j+1) de la malla se divide en dos
      // triángulos, que se pintan opacos con `fill()`. Para que las
      // hojas se ocluyan entre sí se ordena el lote completo de
      // triángulos por profundidad media descendente (painter's
      // algorithm); como cada hoja es un cuadrilátero continuo y
      // las hojas no se intersecan a sí mismas en su interior, este
      // orden basta para que la geometría delante tape la de detrás.
      //
      // Se descartan los triángulos cuya celda cruzaría un punto de
      // ramificación (alguna arista de la celda supera el umbral en
      // C), igual que se hacía con el wireframe: evita esos
      // triángulos enormes que aparecerían al saltar entre hojas
      // por la asignación greedy de raíces.
      const step = POV_STEP;
      const dAlpha = (2 * malla.baseR) / (N - 1);
      // El paso real entre vecinos de la submalla es `step·Δα`; el
      // umbral se escala en consecuencia. Más tolerante (factor 8)
      // que el de la nube orbital porque cerca de branch points la
      // raíz se mueve mucho más rápido que `Δα`, y un umbral
      // pequeño dejaba agujeros visibles cuando la cámara POV los
      // miraba de cerca.
      const umbralC = 8 * step * dAlpha;
      // Items que entran en el painter's: triángulos de la superficie
      // y segmentos de las trayectorias. Mezclarlos en una sola
      // colección ordenada por profundidad permite que las
      // trayectorias se oculten correctamente cuando pasan detrás de
      // una hoja.
      type Tri = {
        kind: 'tri';
        v0: { sx: number; sy: number };
        v1: { sx: number; sy: number };
        v2: { sx: number; sy: number };
        depth: number;
        color: string;
      };
      // Un "Seg" es un tramo del lazo: una polilínea con varios
      // puntos consecutivos. Pintar la curva tramo a tramo (en vez
      // de segmento por segmento) reduce los "trompicones" que
      // produce la intercalación con triángulos de la hoja: dentro
      // de un tramo la línea es continua; entre tramos puede haber
      // un triángulo del fondo intercalado.
      type Seg = {
        kind: 'seg';
        pts: Array<{ sx: number; sy: number }>;
        depth: number;
        color: string;
      };
      const items: Array<Tri | Seg> = [];
      // Comparación al cuadrado para evitar sqrt en el descarte.
      const umbralC2 = umbralC * umbralC;
      for (let k = 0; k < DEGREE; k++) {
        // La hoja `povIdx` se incluye: `projectFromLookAt` descarta
        // los triángulos cuyos vértices queden detrás del plano de
        // cámara (zCam ≤ 0.02), así que la parte de la hoja
        // alrededor de la cámara se omite naturalmente y la
        // prolongación hacia delante sí se renderiza.
        const tabla = SHEET_COLOR_TABLE[k];
        for (let i = 0; i + step < N; i += step) {
          for (let j = 0; j + step < N; j += step) {
            const id00 = i * N + j;
            const id10 = (i + step) * N + j;
            const id01 = i * N + (j + step);
            const id11 = (i + step) * N + (j + step);
            const r00 = malla.roots[id00][k];
            const r10 = malla.roots[id10][k];
            const r01 = malla.roots[id01][k];
            const r11 = malla.roots[id11][k];
            // Distancias al cuadrado de las 5 aristas (4 exteriores
            // + diagonal 00–11). Cada triángulo comprueba sus 3
            // lados; así, si solo uno de los dos triángulos cruza
            // un branch point, el otro sí se pinta y la malla no
            // queda con agujero entero por celda.
            const dx1 = r00[0] - r10[0], dy1 = r00[1] - r10[1];
            const d12 = dx1 * dx1 + dy1 * dy1;
            const dx2 = r00[0] - r01[0], dy2 = r00[1] - r01[1];
            const d22 = dx2 * dx2 + dy2 * dy2;
            const dx3 = r10[0] - r11[0], dy3 = r10[1] - r11[1];
            const d32 = dx3 * dx3 + dy3 * dy3;
            const dx4 = r01[0] - r11[0], dy4 = r01[1] - r11[1];
            const d42 = dx4 * dx4 + dy4 * dy4;
            const dxD = r00[0] - r11[0], dyD = r00[1] - r11[1];
            const dD2 = dxD * dxD + dyD * dyD;
            // Triángulo 1: (00, 10, 11). Aristas: 00–10, 10–11, 00–11.
            const tri1OK =
              d12 <= umbralC2 && d32 <= umbralC2 && dD2 <= umbralC2;
            // Triángulo 2: (00, 11, 01). Aristas: 00–11, 11–01, 00–01.
            const tri2OK =
              dD2 <= umbralC2 && d42 <= umbralC2 && d22 <= umbralC2;
            if (!tri1OK && !tri2OK) continue;
            const a00 = malla.alphas[id00];
            const a11 = malla.alphas[id11];
            const z00 = altura(r00);
            const z11 = altura(r11);
            const p00 = proj([a00[0], a00[1], z00]);
            const p11 = proj([a11[0], a11[1], z11]);
            if (!p00 || !p11) continue;
            if (tri1OK) {
              const a10 = malla.alphas[id10];
              const z10 = altura(r10);
              const p10 = proj([a10[0], a10[1], z10]);
              if (p10) {
                const c1 =
                  tabla[imToLevel((r00[1] + r10[1] + r11[1]) / 3)];
                items.push({
                  kind: 'tri',
                  v0: p00,
                  v1: p10,
                  v2: p11,
                  depth: (p00.depth + p10.depth + p11.depth) / 3,
                  color: c1,
                });
              }
            }
            if (tri2OK) {
              const a01 = malla.alphas[id01];
              const z01 = altura(r01);
              const p01 = proj([a01[0], a01[1], z01]);
              if (p01) {
                const c2 =
                  tabla[imToLevel((r00[1] + r11[1] + r01[1]) / 3)];
                items.push({
                  kind: 'tri',
                  v0: p00,
                  v1: p11,
                  v2: p01,
                  depth: (p00.depth + p11.depth + p01.depth) / 3,
                  color: c2,
                });
              }
            }
          }
        }
      }
      // Trayectorias del lazo agrupadas en tramos de varios puntos
      // consecutivos. Cada tramo entra al painter's con su
      // profundidad media; los triángulos pueden tapar el tramo
      // entero pero ya no recortan la curva entre vértices
      // adyacentes, así que la línea se ve continua dentro del
      // tramo. La trayectoria de la raíz POV se omite (arranca
      // pegada a la cámara).
      const numPasos = Math.min(
        ...trayectorias.map((t) => t.length),
        Math.max(0, lazo.length - 1),
      );
      // Longitud del tramo en número de puntos. Con 8 las curvas
      // se ven continuas y, dado que los puntos de la malla suelen
      // ser bastante densos, los tramos siguen siendo cortos en
      // profundidad y mantienen oclusión razonable.
      const TRAMO = 8;
      if (numPasos >= 1 && trayectorias.length === DEGREE) {
        for (let k = 0; k < DEGREE; k++) {
          if (k === povIdx) continue;
          const color = ROOT_COLORS[k];
          // Proyectar todos los puntos de la curva una vez.
          const pts: Array<{ sx: number; sy: number; depth: number } | null> = [];
          const a0 = lazo[0];
          const r0 = startRoots[k] ?? INITIAL_ROOTS[k];
          pts.push(proj([a0[0], a0[1], altura(r0)]));
          for (let i = 0; i < numPasos; i++) {
            const a = lazo[i + 1];
            const r = trayectorias[k][i];
            if (!a || !r) {
              pts.push(null);
              continue;
            }
            pts.push(proj([a[0], a[1], altura(r)]));
          }
          // Acumular en tramos respetando los huecos (puntos null).
          let buffer: Array<{ sx: number; sy: number; depth: number }> = [];
          const flush = () => {
            if (buffer.length < 2) {
              buffer = [];
              return;
            }
            let dSum = 0;
            for (const p of buffer) dSum += p.depth;
            items.push({
              kind: 'seg',
              pts: buffer.map((p) => ({ sx: p.sx, sy: p.sy })),
              depth: dSum / buffer.length,
              color,
            });
            buffer = [];
          };
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (!p) {
              flush();
              continue;
            }
            buffer.push(p);
            if (buffer.length >= TRAMO + 1) {
              // Solapamos un punto con el siguiente tramo para que
              // la curva no muestre "cortes" entre tramos.
              const last = buffer[buffer.length - 1];
              flush();
              buffer.push(last);
            }
          }
          flush();
        }
      }

      items.sort((a, b) => b.depth - a.depth);
      ctx.globalAlpha = 1;
      // Triángulos sin `stroke()` extra: el coste por triángulo se
      // reduce a casi la mitad y los micro-gaps por antialias quedan
      // disimulados porque los triángulos vecinos ya no son de
      // colores totalmente distintos sino del mismo tono modulado.
      for (let t = 0; t < items.length; t++) {
        const it = items[t];
        if (it.kind === 'tri') {
          ctx.fillStyle = it.color;
          ctx.beginPath();
          ctx.moveTo(it.v0.sx, it.v0.sy);
          ctx.lineTo(it.v1.sx, it.v1.sy);
          ctx.lineTo(it.v2.sx, it.v2.sy);
          ctx.closePath();
          ctx.fill();
        } else {
          // Tramo: polilínea con halo blanco + trazo de color.
          // Una sola Path2D por tramo para que la curva quede
          // visualmente continua dentro de él, aunque los tramos
          // sigan respetando la oclusión con los triángulos.
          if (it.pts.length < 2) continue;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(it.pts[0].sx, it.pts[0].sy);
          for (let q = 1; q < it.pts.length; q++) {
            ctx.lineTo(it.pts[q].sx, it.pts[q].sy);
          }
          ctx.strokeStyle = '#ffffff';
          ctx.globalAlpha = 0.8;
          ctx.lineWidth = 5.2;
          ctx.stroke();
          ctx.strokeStyle = it.color;
          ctx.globalAlpha = 1;
          ctx.lineWidth = 2.4;
          ctx.stroke();
        }
      }
      // Segunda pasada de tramos como "fantasma" sobre toda la
      // geometría: aunque la hoja del observador o una vecina
      // tapen el lazo en el painter's principal, el fantasma se
      // sigue viendo translúcido. Doble pasada por tramo:
      // primero un outline oscuro y encima el color, así la
      // curva se distingue incluso sobre una hoja del mismo
      // color que la trayectoria.
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let t = 0; t < items.length; t++) {
        const it = items[t];
        if (it.kind !== 'seg' || it.pts.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(it.pts[0].sx, it.pts[0].sy);
        for (let q = 1; q < it.pts.length; q++) {
          ctx.lineTo(it.pts[q].sx, it.pts[q].sy);
        }
        // Outline negro semitransparente (más ancho).
        ctx.strokeStyle = '#1a1a1a';
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 3;
        ctx.stroke();
        // Trazo de color encima del outline.
        ctx.strokeStyle = it.color;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      // === Orbital: opacidad reducida y sin sort (más rápido) ===
      for (let k = 0; k < DEGREE; k++) {
        ctx.fillStyle = ROOT_COLORS[k];
        ctx.globalAlpha = nubeAlpha;
        for (let idx = 0; idx < total; idx++) {
          const r = malla.roots[idx][k];
          const a = malla.alphas[idx];
          const p = proj([a[0], a[1], altura(r)]);
          if (!p) continue;
          ctx.fillRect(p.sx - half, p.sy - half, TAM_PUNTO_PX, TAM_PUNTO_PX);
        }
      }
      ctx.globalAlpha = 1;
    }

    // === Trayectorias 3D del lazo actual ===
    // Mismo patrón que en Trayectorias3D: para cada raíz k se traza
    // una curva (Re α_t, Im α_t, h(x_k(α_t))) que sigue el lazo
    // dibujado en el plano α. `trayectorias[k][i]` corresponde a
    // `lazo[i + 1]` (la posición de la raíz tras avanzar α a ese
    // punto); el arranque va en `lazo[0]` con `startRoots[k]`.
    //
    // En POV las trayectorias se pintan dentro del painter's de la
    // superficie (mezcladas con los triángulos) para que respeten
    // la oclusión. Aquí sólo cubrimos el modo orbital.
    const numPasos = enPOV
      ? 0
      : Math.min(
          ...trayectorias.map((t) => t.length),
          Math.max(0, lazo.length - 1),
        );
    if (numPasos >= 1 && trayectorias.length === DEGREE) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (let k = 0; k < DEGREE; k++) {
        // En POV no se pinta la trayectoria de la raíz observadora:
        // arranca pegada a la cámara y deformaría el campo de visión.
        if (enPOV && k === povIdx) continue;
        // Construir el path UNA vez sobre Path2D para reutilizarlo en
        // las dos pasadas (halo blanco + trazo de color).
        const path = new Path2D();
        let started = false;
        let hayPunto = false;
        const a0 = lazo[0];
        const r0 = startRoots[k] ?? INITIAL_ROOTS[k];
        const p0 = proj([a0[0], a0[1], altura(r0)]);
        if (p0) {
          path.moveTo(p0.sx, p0.sy);
          started = true;
          hayPunto = true;
        }
        for (let i = 0; i < numPasos; i++) {
          const a = lazo[i + 1];
          const r = trayectorias[k][i];
          if (!a || !r) continue;
          const p = proj([a[0], a[1], altura(r)]);
          if (!p) {
            started = false;
            continue;
          }
          if (!started) {
            path.moveTo(p.sx, p.sy);
            started = true;
          } else {
            path.lineTo(p.sx, p.sy);
          }
          hayPunto = true;
        }
        if (!hayPunto) continue;
        // Halo blanco para que la curva destaque sobre la nube,
        // independientemente del color de la hoja del fondo.
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 5.2;
        ctx.stroke(path);
        // Trazo de color por encima del halo.
        ctx.strokeStyle = ROOT_COLORS[k];
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2.4;
        ctx.stroke(path);
      }
      ctx.globalAlpha = 1;
    }

    // Huellas: posiciones iniciales (círculos huecos grises) sobre
    // la superficie, sólo si hay lazo en curso.
    if (lazo.length >= 1) {
      const aStart = lazo[0];
      ctx.strokeStyle = '#aaaaaa';
      ctx.lineWidth = 1.4;
      for (let k = 0; k < startRoots.length; k++) {
        if (enPOV && k === povIdx) continue;
        const r = startRoots[k];
        const p = proj([aStart[0], aStart[1], altura(r)]);
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 5, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }

    // === Raíces actuales sobre la superficie ===
    // Cada raíz en su posición 3D (Re α, Im α, h(x_k)). Se ordenan
    // por profundidad antes de pintar para que los marcadores más
    // cercanos a la cámara queden por encima del wireframe.
    const items: Array<{ k: number; sx: number; sy: number; depth: number }> = [];
    for (let k = 0; k < roots.length; k++) {
      if (enPOV && k === povIdx) continue;
      const r = roots[k];
      const p = proj([currentAlpha[0], currentAlpha[1], altura(r)]);
      if (!p) continue;
      items.push({ k, sx: p.sx, sy: p.sy, depth: p.depth });
    }
    items.sort((a, b) => b.depth - a.depth);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.4;
    for (const it of items) {
      ctx.fillStyle = ROOT_COLORS[it.k];
      ctx.beginPath();
      ctx.arc(it.sx, it.sy, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
    projectedRef.current = items;

    // Etiqueta con el índice de la raíz hovereada (mismo patrón que
    // PlanoX y Trayectorias3D: caja blanca con el número en negrita).
    if (hoveredIdx != null) {
      const it = items.find((x) => x.k === hoveredIdx);
      if (it) {
        const text = String(hoveredIdx);
        ctx.font = 'bold 13px "Manrope", -apple-system, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        const tw = ctx.measureText(text).width;
        const pad = 4;
        const boxW = Math.max(tw + pad * 2, 18);
        const boxH = 18;
        const dx = 14;
        const dy = 10;
        let lx = it.sx + dx;
        let ly = it.sy - dy;
        if (lx + boxW / 2 > w) lx = it.sx - dx;
        if (ly - boxH / 2 < 0) ly = it.sy + dy;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(lx - boxW / 2, ly - boxH / 2, boxW, boxH, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1a1a1a';
        ctx.fillText(text, lx, ly);
      }
    }
  }, [
    size,
    cam,
    mundo,
    malla,
    ramificacion,
    currentAlpha,
    roots,
    lazo,
    trayectorias,
    startRoots,
    hoveredIdx,
    cameraMode,
    povIdx,
    povMeshIdx,
    povYaw,
    povPitch,
  ]);

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    if (cameraMode === 'pov') {
      // Mouse-look: el drag rota la mirada anclada a la raíz.
      draggingRef.current = {
        kind: 'pov',
        mx: e.clientX,
        my: e.clientY,
        yaw: povYaw,
        pitch: povPitch,
      };
      setHoveredIdx(null);
      return;
    }
    draggingRef.current = {
      kind: 'orbital',
      mx: e.clientX,
      my: e.clientY,
      cam,
    };
    setHoveredIdx(null);
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const d = draggingRef.current;
    if (d) {
      const dx = e.clientX - d.mx;
      const dy = e.clientY - d.my;
      const sens = (2 * Math.PI) / 600;
      if (d.kind === 'pov') {
        let pitch = d.pitch - dy * sens;
        if (pitch < PHI_MIN) pitch = PHI_MIN;
        if (pitch > PHI_MAX) pitch = PHI_MAX;
        setPovYaw(d.yaw + dx * sens);
        setPovPitch(pitch);
        return;
      }
      let phi = d.cam.phi - dy * sens;
      if (phi < PHI_MIN) phi = PHI_MIN;
      if (phi > PHI_MAX) phi = PHI_MAX;
      onCamChange({ theta: d.cam.theta + dx * sens, phi, d: d.cam.d });
      return;
    }
    // Hit-test contra las raíces actuales, igual que en Trayectorias3D.
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best = -1;
    let bestDist = 12;
    const orden = [...projectedRef.current].sort((a, b) => a.depth - b.depth);
    for (const it of orden) {
      const ddx = mx - it.sx;
      const ddy = my - it.sy;
      const dd = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dd < bestDist) {
        bestDist = dd;
        best = it.k;
      }
    }
    setHoveredIdx(best === -1 ? null : best);
  }
  function endDrag() {
    draggingRef.current = null;
  }
  function onMouseLeave() {
    draggingRef.current = null;
    setHoveredIdx(null);
  }
  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (cameraMode === 'pov') return;
    const factor = e.deltaY < 0 ? 1 / 1.12 : 1.12;
    onCamChange((c) => ({ ...c, d: Math.min(15, Math.max(1.5, c.d * factor)) }));
  }
  function onDoubleClick() {
    if (cameraMode === 'pov') {
      // Reset de la mirada: vuelve a orientar la cámara hacia el
      // origen del mundo. yaw/pitch en el frame local de la normal
      // de la hoja para no descuadrar el drag posterior.
      const camPos: Vec3 = [
        currentAlpha[0],
        currentAlpha[1],
        camZPOV(malla, currentAlpha, povMeshIdx),
      ];
      const up = normalEnAlpha(malla, currentAlpha, povMeshIdx);
      const { yaw, pitch } = yawPitchHaciaPunto([0, 0, 0], camPos, up);
      setPovYaw(yaw);
      setPovPitch(pitch);
      return;
    }
    onCamChange(DEFAULT_CAM);
  }

  return (
    <canvas
      ref={canvasRef}
      className="canvas-x"
      style={{
        width: 'min(70vh, 100%)',
        aspectRatio: '1',
        cursor: draggingRef.current ? 'grabbing' : 'grab',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={onMouseLeave}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
    />
  );
}
