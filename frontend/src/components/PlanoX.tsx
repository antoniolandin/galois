// Vista 2D del plano x donde viven las raíces. Cada raíz se dibuja
// como un círculo coloreado en su posición actual, y la trayectoria
// que ha recorrido durante el lazo actual se traza como una línea
// del mismo color con baja opacidad.

import { useEffect, useRef, useState } from 'react';
import type { Complex } from '../galois/complex';
import { BRANCH_X, INITIAL_ROOTS, ROOT_COLORS, DEGREE } from '../galois/polinomio';

interface Props {
  roots: Complex[];
  trayectorias: Complex[][];
}

const RANGE = 1.5;

const xToCanvas = (z: Complex, w: number, h: number): [number, number] => [
  ((z[0] + RANGE) / (2 * RANGE)) * w,
  ((-z[1] + RANGE) / (2 * RANGE)) * h,
];

export function PlanoX({ roots, trayectorias }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Dimensiones CSS del canvas. Las llevamos en state para que un
  // cambio de tamaño dispare el useEffect de dibujo, y no quede el
  // canvas en blanco hasta que algo más cambie.
  const [size, setSize] = useState({ w: 0, h: 0 });

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

    // Huellas: círculos huecos en posiciones iniciales
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    for (const r0 of INITIAL_ROOTS) {
      const [px, py] = xToCanvas(r0, w, h);
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Lugar de ramificación: raíces dobles donde dos raíces colapsan.
    // Mismo estilo que los puntos de ramificación del plano α
    // (círculos bermellón con borde negro).
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

    // Trayectorias: polilínea por raíz en su color, opacidad media
    if (trayectorias.length === DEGREE && trayectorias[0].length > 1) {
      ctx.lineWidth = 2;
      for (let k = 0; k < DEGREE; k++) {
        const traj = trayectorias[k];
        if (traj.length < 2) continue;
        ctx.strokeStyle = ROOT_COLORS[k];
        ctx.globalAlpha = 0.55;
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
    ctx.lineWidth = 1.5;
    for (let k = 0; k < roots.length; k++) {
      const [px, py] = xToCanvas(roots[k], w, h);
      ctx.fillStyle = ROOT_COLORS[k];
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  }, [roots, trayectorias, size]);

  return (
    <canvas
      ref={canvasRef}
      className="canvas-x"
      style={{ width: 'min(70vh, 100%)', aspectRatio: '1' }}
    />
  );
}
