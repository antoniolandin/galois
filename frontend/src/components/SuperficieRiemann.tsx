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
  type CamState,
  type Vec3,
} from '../galois/proyeccion3d';
import {
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

const BOX_COLOR = '#d8d8db';

// Tamaño en píxeles de cada punto de la nube. Se mantiene constante
// en pantalla (no en mundo) para que la superficie se vea con la
// misma densidad independientemente del zoom.
const TAM_PUNTO_PX = 2.4;

function computarMundo(ramificacion: Complex[]): {
  baseR: number;
  altR: number;
} {
  const r =
    ramificacion.length === 0
      ? 0.85
      : Math.max(...ramificacion.map(cAbs)) * 1.5;
  return { baseR: Math.max(r, 0.6), altR: 1.2 };
}

export function SuperficieRiemann({
  ramificacion,
  currentAlpha,
  roots,
  lazo,
  trayectorias,
  startRoots,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState<CamState>(DEFAULT_CAM);
  const draggingRef = useRef<{ mx: number; my: number; cam: CamState } | null>(
    null,
  );
  // Igual que en la vista de trayectorias: índice de la raíz bajo el
  // cursor y posiciones en pantalla de las raíces para el hit-test.
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const projectedRef = useRef<Array<{ k: number; sx: number; sy: number; depth: number }>>([]);

  const mundo = useMemo(() => computarMundo(ramificacion), [ramificacion]);

  // Malla precomputada: se reutiliza mientras no cambie baseR (que
  // de momento depende sólo del polinomio). El cómputo es bloqueante
  // pero rápido (< 100 ms para N = 21).
  const malla = useMemo<MallaRiemann>(
    () => computarMallaRiemann(N_MALLA, mundo.baseR),
    [mundo.baseR],
  );

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
    const proj = (p: Vec3) => project(p, cam, w, h);

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

    // === Trayectorias 3D del lazo actual ===
    // Mismo patrón que en Trayectorias3D: para cada raíz k se traza
    // una curva (Re α_t, Im α_t, h(x_k(α_t))) que sigue el lazo
    // dibujado en el plano α. `trayectorias[k][i]` corresponde a
    // `lazo[i + 1]` (la posición de la raíz tras avanzar α a ese
    // punto); el arranque va en `lazo[0]` con `startRoots[k]`.
    const numPasos = Math.min(
      ...trayectorias.map((t) => t.length),
      Math.max(0, lazo.length - 1),
    );
    if (numPasos >= 1 && trayectorias.length === DEGREE) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (let k = 0; k < DEGREE; k++) {
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
  ]);

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    draggingRef.current = { mx: e.clientX, my: e.clientY, cam };
    setHoveredIdx(null);
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const d = draggingRef.current;
    if (d) {
      const dx = e.clientX - d.mx;
      const dy = e.clientY - d.my;
      const sens = (2 * Math.PI) / 600;
      let phi = d.cam.phi - dy * sens;
      if (phi < PHI_MIN) phi = PHI_MIN;
      if (phi > PHI_MAX) phi = PHI_MAX;
      setCam({ theta: d.cam.theta + dx * sens, phi, d: d.cam.d });
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
    const factor = e.deltaY < 0 ? 1 / 1.12 : 1.12;
    setCam((c) => ({ ...c, d: Math.min(15, Math.max(1.5, c.d * factor)) }));
  }
  function onDoubleClick() {
    setCam(DEFAULT_CAM);
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
