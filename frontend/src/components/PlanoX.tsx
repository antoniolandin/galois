// Vista 2D del plano x donde viven las raíces. Cada raíz se dibuja
// como un círculo coloreado en su posición actual, y la trayectoria
// que ha recorrido durante el lazo actual se traza como una línea
// del mismo color con baja opacidad.

import { useEffect, useRef, useState } from 'react';
import type { Complex } from '../galois/complex';
import { BRANCH_X, ROOT_COLORS, DEGREE } from '../galois/polinomio';

interface Props {
  roots: Complex[];
  // Posiciones de las raíces en el inicio del lazo actual (las que
  // marcaba el ratón al hacer click). Se pintan como huellas huecas
  // grises. Si no hay lazo en curso, coinciden con INITIAL_ROOTS.
  startRoots: Complex[];
  trayectorias: Complex[][];
}

// Rango del plano x: span [-RANGE, +RANGE].  Más pequeño hace que
// los lazos pequeños alrededor de cada raíz se aprecien mejor.
const RANGE = 1.15;

const xToCanvas = (z: Complex, w: number, h: number): [number, number] => [
  ((z[0] + RANGE) / (2 * RANGE)) * w,
  ((-z[1] + RANGE) / (2 * RANGE)) * h,
];

export function PlanoX({ roots, startRoots, trayectorias }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Dimensiones CSS del canvas. Las llevamos en state para que un
  // cambio de tamaño dispare el useEffect de dibujo, y no quede el
  // canvas en blanco hasta que algo más cambie.
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Índice de la raíz sobre la que está el ratón (o null si fuera).
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

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

    // Ejes
    ctx.strokeStyle = '#e8e8eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const c = xToCanvas([0, 0], w, h);
    ctx.moveTo(0, c[1]);
    ctx.lineTo(w, c[1]);
    ctx.moveTo(c[0], 0);
    ctx.lineTo(c[0], h);
    ctx.stroke();

    // Lugar de ramificación: raíces dobles donde dos raíces colapsan.
    // Dibujados con opacidad reducida para indicar que son contexto
    // visual, no las raíces actuales (que aparecen sólidas).
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#D55E00';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.4;
    for (const bx of BRANCH_X) {
      const [px, py] = xToCanvas(bx, w, h);
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Huellas + trayectorias: solo cuando hay un lazo activo
    // (durante el drag) o un lazo cerrado-útil cuyo estado se
    // mantiene en pantalla. En modo hover, sin lazo en curso, no
    // pintamos las huellas — solo los puntos de ramificación y
    // las raíces actuales.
    const hayLazo =
      trayectorias.length === DEGREE && trayectorias[0].length > 1;
    if (hayLazo) {
      // Huellas: posiciones de las raíces al inicio del lazo
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      for (const r0 of startRoots) {
        const [px, py] = xToCanvas(r0, w, h);
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // Trayectorias: polilínea por raíz en su color
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let k = 0; k < DEGREE; k++) {
        const traj = trayectorias[k];
        if (traj.length < 2) continue;
        ctx.strokeStyle = ROOT_COLORS[k];
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        const p0 = xToCanvas(traj[0], w, h);
        ctx.moveTo(p0[0], p0[1]);
        for (let i = 1; i < traj.length; i++) {
          const p = xToCanvas(traj[i], w, h);
          ctx.lineTo(p[0], p[1]);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Raíces actuales: círculos llenos
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.4;
    for (let k = 0; k < roots.length; k++) {
      const [px, py] = xToCanvas(roots[k], w, h);
      ctx.fillStyle = ROOT_COLORS[k];
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }

    // Etiqueta con el índice de la raíz sobre la que está el ratón.
    // Se intenta poner en la esquina superior derecha de la raíz;
    // si se saldría del canvas, se voltea por el eje correspondiente.
    if (hoveredIdx != null && hoveredIdx < roots.length) {
      const [rx, ry] = xToCanvas(roots[hoveredIdx], w, h);
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
      // Posición por defecto: arriba-derecha. Se voltea cada eje si
      // la caja se saldría del canvas.
      let lx = rx + dx;
      let ly = ry - dy;
      if (lx + boxW / 2 > w) lx = rx - dx;
      if (ly - boxH / 2 < 0) ly = ry + dy;
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
  }, [roots, trayectorias, size, hoveredIdx]);

  // Pixel-hit detection: el cursor está sobre una raíz si la
  // distancia al centro de su círculo es menor que su radio + un
  // pequeño margen (12 px total, suficiente para que sea fácil de
  // pegar sin que se solapen las raíces cercanas).
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best = -1;
    let bestDist = 12;
    for (let k = 0; k < roots.length; k++) {
      const [rx, ry] = xToCanvas(roots[k], rect.width, rect.height);
      const dx = mx - rx;
      const dy = my - ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    setHoveredIdx(best === -1 ? null : best);
  }

  function onMouseLeave() {
    setHoveredIdx(null);
  }

  return (
    <canvas
      ref={canvasRef}
      className="canvas-x"
      style={{ width: 'min(70vh, 100%)', aspectRatio: '1' }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    />
  );
}
