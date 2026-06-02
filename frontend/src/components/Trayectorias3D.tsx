// Vista 3D "Trayectorias" (sin superficie de Riemann).
//
// Sistema de coordenadas mundo:
//   X = Re(α),  Y = Im(α),  Z = Re(x_k) + ½ Im(x_k)
//
// La base XY recoge el plano del parámetro α (con los puntos de
// ramificación y el lazo activo proyectados en Z = 0); el eje Z
// recoge una proyección lineal de cada raíz al eje real, de forma
// que cuando dos raíces colapsan al acercarse a un punto de
// ramificación se ve cómo dos curvas se aproximan en altura. El
// factor ½ delante de Im(x_k) sirve para romper degeneraciones en
// raíces puramente imaginarias: con Z = Re(x_k) "a secas", las
// raíces iniciales {0, i, −i} de x⁵ − x + α tendrían los tres la
// misma altura y se apilarían visualmente. Con esta proyección
// reciben alturas {0, ½, −½} y se separan limpiamente.
//
// La cámara es orbital: arrastrar rota (azimut/elevación), la rueda
// hace zoom, doble click resetea a la vista por defecto. No hay
// matrices 4×4 ni dependencias externas: la proyección perspectiva
// está montada a mano sobre canvas 2D para mantener el bundle ligero
// y la estética consistente con el resto de la app.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Complex } from '../galois/complex';
import { cAbs } from '../galois/complex';
import {
  DEGREE,
  INITIAL_ROOTS,
  ROOT_COLORS,
} from '../galois/polinomio';
import {
  DEFAULT_CAM,
  PHI_MAX,
  PHI_MIN,
  project,
  type CamState,
  type Vec3,
} from '../galois/proyeccion3d';

interface Props {
  ramificacion: Complex[];
  alphaEstrella: Complex;
  currentAlpha: Complex;
  lazo: Complex[];
  trayectorias: Complex[][];
  startRoots: Complex[];
  roots: Complex[];
}

// Proyección de C → R que se usa para la coordenada vertical de las
// trayectorias. Lineal en (Re, Im), con coeficiente ½ delante de Im
// para evitar que raíces puramente imaginarias colapsen a la misma
// altura que las puramente reales o que el origen.
const altura = (x: Complex): number => x[0] + 0.5 * x[1];

const BRANCH_COLOR = '#D55E00';
const GRID_COLOR = '#e4e4e6';
const AXIS_COLOR = '#bfbfc2';
const BOX_COLOR = '#d8d8db';

// Tamaños canónicos del mundo. El radio base se ajusta al polinomio
// (igual que el plano α 2D), la altura se fija a 1.2 que cubre con
// margen el rango de Re(x_k) en las raíces iniciales y los puntos
// de ramificación del polinomio canónico.
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

export function Trayectorias3D({
  ramificacion,
  alphaEstrella,
  currentAlpha,
  lazo,
  trayectorias,
  startRoots,
  roots,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState<CamState>(DEFAULT_CAM);
  const draggingRef = useRef<{ mx: number; my: number; cam: CamState } | null>(
    null,
  );
  // Índice de la raíz sobre la que está el ratón. Igual que en
  // PlanoX, pinta una caja con el índice al lado del marcador.
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  // Posiciones en pantalla de las raíces actuales, calculadas en el
  // último dibujo. La detección de hover las lee desde aquí para no
  // duplicar la lógica de proyección.
  const projectedRef = useRef<Array<{ k: number; sx: number; sy: number; depth: number }>>([]);

  const mundo = useMemo(() => computarMundo(ramificacion), [ramificacion]);

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

    // === Grid del plano base (Z = 0) ===
    const N_GRID = 6;
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (let i = 0; i <= N_GRID; i++) {
      const t = -baseR + (2 * baseR * i) / N_GRID;
      const a1 = proj([t, -baseR, 0]);
      const a2 = proj([t, +baseR, 0]);
      if (a1 && a2) {
        ctx.beginPath();
        ctx.moveTo(a1.sx, a1.sy);
        ctx.lineTo(a2.sx, a2.sy);
        ctx.stroke();
      }
      const b1 = proj([-baseR, t, 0]);
      const b2 = proj([+baseR, t, 0]);
      if (b1 && b2) {
        ctx.beginPath();
        ctx.moveTo(b1.sx, b1.sy);
        ctx.lineTo(b2.sx, b2.sy);
        ctx.stroke();
      }
    }

    // Ejes Re(α) e Im(α) en la base, marcados con su nombre.
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1.2;
    const axOriginX = proj([-baseR, 0, 0]);
    const axEndX = proj([+baseR, 0, 0]);
    if (axOriginX && axEndX) {
      ctx.beginPath();
      ctx.moveTo(axOriginX.sx, axOriginX.sy);
      ctx.lineTo(axEndX.sx, axEndX.sy);
      ctx.stroke();
    }
    const axOriginY = proj([0, -baseR, 0]);
    const axEndY = proj([0, +baseR, 0]);
    if (axOriginY && axEndY) {
      ctx.beginPath();
      ctx.moveTo(axOriginY.sx, axOriginY.sy);
      ctx.lineTo(axEndY.sx, axEndY.sy);
      ctx.stroke();
    }

    // === Puntos de ramificación en la base (Z = 0) ===
    // Misma opacidad apagada que en el plano x: son contexto visual
    // permanente, no la información viva del lazo.
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = BRANCH_COLOR;
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.2;
    for (const b of ramificacion) {
      const p = proj([b[0], b[1], 0]);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // α* en la base como marcador discreto
    {
      const p = proj([alphaEstrella[0], alphaEstrella[1], 0]);
      if (p) {
        ctx.fillStyle = '#999';
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 2.5, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // === Trayectorias 3D de las raíces ===
    // trayectorias[k][i] corresponde a lazo[i + 1] (la posición de la
    // raíz k tras avanzar α al punto lazo[i+1]). Para alinearlas en
    // 3D recorremos ambos arrays en paralelo, con ese desfase de 1.
    const numPasos = Math.min(
      ...trayectorias.map((t) => t.length),
      Math.max(0, lazo.length - 1),
    );
    if (numPasos >= 1 && trayectorias.length === DEGREE) {
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (let k = 0; k < DEGREE; k++) {
        ctx.strokeStyle = ROOT_COLORS[k];
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        let started = false;
        // Punto inicial: arrancamos en (startAlpha, altura(startRoot))
        const a0 = lazo[0];
        const r0 = startRoots[k] ?? INITIAL_ROOTS[k];
        const p0 = proj([a0[0], a0[1], altura(r0)]);
        if (p0) {
          ctx.moveTo(p0.sx, p0.sy);
          started = true;
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
            ctx.moveTo(p.sx, p.sy);
            started = true;
          } else {
            ctx.lineTo(p.sx, p.sy);
          }
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // === Raíces actuales y huellas de inicio ===
    // Huellas: posiciones iniciales (círculos huecos grises) en la α
    // de inicio del lazo. Solo se pintan si hay lazo en curso.
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

    // Raíces actuales: en la α actual, Z = altura(root)
    const aNow = currentAlpha;
    const items: Array<{ k: number; sx: number; sy: number; depth: number }> = [];
    for (let k = 0; k < roots.length; k++) {
      const r = roots[k];
      const p = proj([aNow[0], aNow[1], altura(r)]);
      if (!p) continue;
      items.push({ k, sx: p.sx, sy: p.sy, depth: p.depth });
    }
    // Pinta de atrás hacia delante para que las raíces cercanas a
    // la cámara queden por encima.
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
    // Guardar las posiciones en pantalla para el hit-test del hover.
    projectedRef.current = items;

    // === Etiqueta con el índice de la raíz hovereada ===
    // Mismo estilo que en PlanoX: caja blanca con borde negro y el
    // número en negrita, posicionada arriba-derecha del marcador con
    // flip si se saldría del canvas.
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
    ramificacion,
    alphaEstrella,
    currentAlpha,
    lazo,
    trayectorias,
    startRoots,
    roots,
    hoveredIdx,
  ]);

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    draggingRef.current = { mx: e.clientX, my: e.clientY, cam };
    // Al empezar a orbitar ocultamos el hover para que la caja con
    // el índice no acompañe al drag.
    setHoveredIdx(null);
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const d = draggingRef.current;
    if (d) {
      const dx = e.clientX - d.mx;
      const dy = e.clientY - d.my;
      // 360° por cada ~600 px arrastrados.
      const sens = (2 * Math.PI) / 600;
      let phi = d.cam.phi - dy * sens;
      if (phi < PHI_MIN) phi = PHI_MIN;
      if (phi > PHI_MAX) phi = PHI_MAX;
      setCam({ theta: d.cam.theta + dx * sens, phi, d: d.cam.d });
      return;
    }
    // Hit-test contra las raíces actuales. Igual que en PlanoX, radio
    // de 12 px (suficiente para "pegarse" al marcador sin saltos
    // entre raíces cercanas).
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best = -1;
    let bestDist = 12;
    // Recorrer de delante hacia atrás (depth menor primero) para
    // que la raíz visible quede preferida cuando dos se solapan.
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
