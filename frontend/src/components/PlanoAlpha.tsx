// Canvas 2D del plano α donde el usuario dibuja arrastrando el ratón.
// Cada mousemove dispara una iteración del predictor-corrector que
// actualiza las raíces, y notifica al padre vía callbacks.
//
// Estado caliente (alpha, roots, lazo) en refs para evitar re-render
// por cada frame del ratón. El tamaño del canvas se lleva en state
// para que un resize dispare redibujo (evita el bug del viewer en
// blanco antes del primer evento).
//
// MODO MANUAL LIBRE: el lazo NO se fuerza a empezar en α* = 0. El
// usuario puede arrastrar desde cualquier punto y dejar α donde
// quiera. La permutación se extrae únicamente cuando, al soltar el
// ratón, α ha vuelto suficientemente cerca de α* (tolerancia
// CLOSE_TOL) — solo entonces tenemos un lazo cerrado y la noción de
// "permutación inducida" tiene sentido matemático.

import { useEffect, useRef, useState } from 'react';
import type { Complex } from '../galois/complex';
import { cAbs, cSub } from '../galois/complex';
import { stepRootsAdaptive } from '../galois/continuacion';
import { emparejarPorProximidad } from '../galois/monodromia';
import { INITIAL_ROOTS } from '../galois/polinomio';

interface Props {
  ramificacion: Complex[];
  alphaEstrella: Complex;
  currentAlpha: Complex;
  setAlpha: (a: Complex) => void;
  setRoots: (r: Complex[]) => void;
  setStartRoots: (r: Complex[]) => void;
  pushTrayectoria: (r: Complex[]) => void;
  resetTrayectorias: () => void;
  onLoopEnd: (finalRoots: Complex[], startRoots: Complex[]) => void;
}

const RANGE = 0.85;
// Tolerancia para considerar que α ha vuelto al origen (lazo cerrado).
const CLOSE_TOL = 0.05;

const canvasToAlpha = (px: number, py: number, w: number, h: number): Complex => [
  (px / w) * (2 * RANGE) - RANGE,
  -((py / h) * (2 * RANGE) - RANGE),
];

const alphaToCanvas = (z: Complex, w: number, h: number): [number, number] => [
  ((z[0] + RANGE) / (2 * RANGE)) * w,
  ((-z[1] + RANGE) / (2 * RANGE)) * h,
];

export function PlanoAlpha({
  ramificacion,
  alphaEstrella,
  currentAlpha,
  setAlpha,
  setRoots,
  setStartRoots,
  pushTrayectoria,
  resetTrayectorias,
  onLoopEnd,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef(false);
  const alphaRef = useRef<Complex>([0, 0]);
  const rootsRef = useRef<Complex[]>([...INITIAL_ROOTS]);
  // Inicio del lazo (mousedown): posición α y raíces en ese punto
  const startAlphaRef = useRef<Complex>([0, 0]);
  const startRootsRef = useRef<Complex[]>([...INITIAL_ROOTS]);
  const [lazo, setLazo] = useState<Complex[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // ResizeObserver: sincroniza el buffer del canvas con el tamaño CSS
  // y mantiene `size` en state para disparar redibujo cuando cambia.
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

  // Dibujo
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
    const c = alphaToCanvas([0, 0], w, h);
    ctx.moveTo(0, c[1]);
    ctx.lineTo(w, c[1]);
    ctx.moveTo(c[0], 0);
    ctx.lineTo(c[0], h);
    ctx.stroke();

    // Trazo del lazo en curso
    if (lazo.length > 1) {
      ctx.strokeStyle = '#0072B2';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const p0 = alphaToCanvas(lazo[0], w, h);
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < lazo.length; i++) {
        const p = alphaToCanvas(lazo[i], w, h);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }

    // Puntos de ramificación
    ctx.fillStyle = '#D55E00';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.4;
    for (const b of ramificacion) {
      const [bx, by] = alphaToCanvas(b, w, h);
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }

    // Punto base α* (triángulo negro)
    const [tx, ty] = alphaToCanvas(alphaEstrella, w, h);
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.moveTo(tx, ty - 9);
    ctx.lineTo(tx - 7, ty + 5);
    ctx.lineTo(tx + 7, ty + 5);
    ctx.closePath();
    ctx.fill();

    // Posición actual de α (azul) si no está sobre el origen
    if (cAbs(currentAlpha) > 0.001) {
      const [ax, ay] = alphaToCanvas(currentAlpha, w, h);
      ctx.fillStyle = '#0072B2';
      ctx.strokeStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(ax, ay, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  }, [ramificacion, alphaEstrella, currentAlpha, lazo, size]);

  function getMouseAlpha(e: React.MouseEvent<HTMLCanvasElement>): Complex | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return canvasToAlpha(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
  }

  function step(target: Complex) {
    rootsRef.current = stepRootsAdaptive(rootsRef.current, alphaRef.current, target);
    alphaRef.current = target;
    setAlpha(target);
    setRoots(rootsRef.current);
    pushTrayectoria(rootsRef.current);
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const target = getMouseAlpha(e);
    if (!target) return;
    // El click marca el inicio del lazo. Continuamos desde el estado
    // actual con predictor-corrector (el hover ya estaba siguiendo
    // las raíces; el click sólo "fija" ese estado como punto de
    // partida del lazo). Si no había habido hover previo, alphaRef
    // está en (0, 0) y se hace el paso desde ahí.
    rootsRef.current = stepRootsAdaptive(rootsRef.current, alphaRef.current, target);
    alphaRef.current = target;
    startAlphaRef.current = target;
    startRootsRef.current = [...rootsRef.current];
    isDraggingRef.current = true;
    setAlpha(target);
    setRoots(rootsRef.current);
    setStartRoots([...rootsRef.current]);
    setLazo([target]);
    resetTrayectorias();
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const target = getMouseAlpha(e);
    if (!target) return;
    if (isDraggingRef.current) {
      // Drag activo: predictor-corrector preserva el etiquetado para
      // poder extraer la permutación al cerrar.
      step(target);
      setLazo((prev) => [...prev, target]);
    } else {
      // Hover sin click: usamos predictor-corrector (mismo que el
      // drag) para que el etiquetado se preserve a lo largo del
      // camino del ratón. Si usásemos Durand-Kerner + relabel por
      // proximidad, las raíces "saltarían" al pasar cerca de un
      // punto de ramificación porque dos raíces vecinas se asignarían
      // ambas al mismo label canónico. Con tracking continuo, el
      // intercambio es suave: una raíz cede su color a otra al cruzar
      // una rama, igual que ocurre durante el dibujo de un lazo.
      rootsRef.current = stepRootsAdaptive(rootsRef.current, alphaRef.current, target);
      alphaRef.current = target;
      setAlpha(target);
      setRoots(rootsRef.current);
    }
  }

  function onMouseUp() {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    // Un lazo "útil" tiene que cumplir dos cosas: (1) cerrar, esto es,
    // soltar el ratón cerca de donde se empezó, y (2) inducir una
    // permutación no trivial. Un lazo cerrado pero con permutación
    // identidad (no encerró ningún punto de ramificación) o un lazo
    // abierto se descartan y limpiamos toda la visualización.
    const dist = cAbs(cSub(alphaRef.current, startAlphaRef.current));
    const cerrado = dist < CLOSE_TOL;
    let utile = false;
    if (cerrado) {
      const sigma = emparejarPorProximidad(rootsRef.current, startRootsRef.current);
      utile = !sigma.every((j, i) => j === i);
    }

    if (utile) {
      // Lazo cerrado y con permutación no trivial: cerramos visualmente
      // el trazo, extraemos la permutación y dejamos todo en pantalla.
      setLazo((prev) => [...prev, startAlphaRef.current]);
      onLoopEnd(rootsRef.current, startRootsRef.current);
    } else {
      // Cualquier otro caso: limpiamos sólo el trazo, las trayectorias
      // y la marca de huellas, pero dejamos α y las raíces donde
      // estaban al soltar.  Así no hay "teleport" visual al canónico
      // — el hover continúa suavemente desde la posición del ratón.
      setLazo([]);
      resetTrayectorias();
      setStartRoots([...INITIAL_ROOTS]);
    }
  }

  function onMouseLeave() {
    // El ratón sale del canvas. Cancelamos cualquier drag en curso
    // (sin chequear cierre — sería sospechoso aceptarlo aquí) y
    // devolvemos las raíces al estado canónico.
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setLazo([]);
      resetTrayectorias();
      setStartRoots([...INITIAL_ROOTS]);
    }
    rootsRef.current = [...INITIAL_ROOTS];
    alphaRef.current = [0, 0];
    setAlpha([0, 0]);
    setRoots([...INITIAL_ROOTS]);
  }

  return (
    <canvas
      ref={canvasRef}
      className="canvas-alpha"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    />
  );
}
