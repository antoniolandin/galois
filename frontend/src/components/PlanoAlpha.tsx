// Canvas 2D del plano α donde el usuario dibuja arrastrando el ratón.
// Cada mousemove dispara una iteración del predictor-corrector que
// actualiza las raíces, y notifica al padre vía callbacks.
//
// Estado caliente (alpha, roots, lazo) en refs para evitar re-render
// por cada frame del ratón. El tamaño del canvas se lleva en state
// para que un resize dispare redibujo.
//
// MODO MANUAL LIBRE: el lazo NO se fuerza a empezar en α* = 0. El
// usuario puede arrastrar desde cualquier punto y la permutación se
// extrae si el lazo se cierra cerca del punto de inicio.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Complex } from '../galois/complex';
import { cAbs, cSub } from '../galois/complex';
import { stepRootsAdaptive } from '../galois/continuacion';
import { emparejarPorProximidad } from '../galois/monodromia';
import { INITIAL_ROOTS } from '../galois/polinomio';

interface Props {
  ramificacion: Complex[];
  alphaEstrella: Complex;
  currentAlpha: Complex;
  // Si no es null, el canvas muestra este lazo guardado en lugar del
  // que el usuario esté dibujando. El hover queda desactivado mientras
  // tanto; el mousedown deselecciona y arranca un drag nuevo.
  displayLazo: Complex[] | null;
  // Cada vez que cambia este número, el componente borra su lazo
  // interno (Escape lo usa). NO toca alphaRef ni rootsRef, así que
  // el hover continúa sin teleport.
  clearLazoSignal: number;
  setAlpha: (a: Complex) => void;
  setRoots: (r: Complex[]) => void;
  setStartRoots: (r: Complex[]) => void;
  pushTrayectoria: (r: Complex[]) => void;
  resetTrayectorias: () => void;
  onLoopEnd: (
    finalRoots: Complex[],
    startRoots: Complex[],
    startAlpha: Complex,
    lazo: Complex[],
  ) => void;
  // Avisa al padre cuando el usuario interactúa con el canvas para
  // que pueda limpiar la selección del generador mostrado, si la había.
  onInteraction: () => void;
  // Espejo del lazo interno hacia el padre, para que la vista 3D
  // pueda leerlo en vivo. Se dispara en cada cambio del array.
  onLazoChange?: (lazo: Complex[]) => void;
}

// Tolerancia para considerar que α ha vuelto al punto de inicio del lazo.
const CLOSE_TOL = 0.05;

export function PlanoAlpha({
  ramificacion,
  alphaEstrella,
  currentAlpha,
  displayLazo,
  clearLazoSignal,
  setAlpha,
  setRoots,
  setStartRoots,
  pushTrayectoria,
  resetTrayectorias,
  onLoopEnd,
  onInteraction,
  onLazoChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef(false);
  const alphaRef = useRef<Complex>([0, 0]);
  const rootsRef = useRef<Complex[]>([...INITIAL_ROOTS]);
  const startAlphaRef = useRef<Complex>([0, 0]);
  const startRootsRef = useRef<Complex[]>([...INITIAL_ROOTS]);
  const [lazo, setLazo] = useState<Complex[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // RANGE = 2 · (radio máximo de los puntos de ramificación). Así los
  // puntos de ramificación se sitúan a la mitad del eje, cualquiera
  // que sea el polinomio.  Si no hay ramificación (caso degenerado),
  // se cae a 0.85 que era el valor previo fijo.
  const RANGE = useMemo(() => {
    if (ramificacion.length === 0) return 0.85;
    const maxR = Math.max(...ramificacion.map(cAbs));
    return maxR * 2;
  }, [ramificacion]);

  const canvasToAlpha = (px: number, py: number, w: number, h: number): Complex => [
    (px / w) * (2 * RANGE) - RANGE,
    -((py / h) * (2 * RANGE) - RANGE),
  ];
  const alphaToCanvas = (z: Complex, w: number, h: number): [number, number] => [
    ((z[0] + RANGE) / (2 * RANGE)) * w,
    ((-z[1] + RANGE) / (2 * RANGE)) * h,
  ];

  // Señal de "limpiar lazo" (Escape lo dispara). Sólo borra el array
  // interno; no toca refs ni notifica al padre. El primer render
  // (signal inicial 0) no debe hacer nada visible — sólo cuando
  // realmente cambia.
  const firstClearRef = useRef(true);
  useEffect(() => {
    if (firstClearRef.current) {
      firstClearRef.current = false;
      return;
    }
    setLazo([]);
  }, [clearLazoSignal]);

  // Espejo del lazo hacia el padre. Cada vez que `lazo` cambia
  // (mousedown, mousemove, mouseup, clear), notificamos al padre con
  // el array nuevo. Permite a `Trayectorias3D` consumir el lazo
  // vivo sin levantar el state completo.
  useEffect(() => {
    onLazoChange?.(lazo);
  }, [lazo, onLazoChange]);

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

    // Trazo del lazo: el guardado (si hay generador seleccionado)
    // tiene prioridad sobre el dibujado en vivo.
    const visibleLazo = displayLazo ?? lazo;
    if (visibleLazo.length > 1) {
      ctx.strokeStyle = '#0072B2';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const p0 = alphaToCanvas(visibleLazo[0], w, h);
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < visibleLazo.length; i++) {
        const p = alphaToCanvas(visibleLazo[i], w, h);
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

    // Posición actual de α (azul), sólo si no estamos mostrando un
    // lazo guardado y no estamos en el origen.
    if (displayLazo == null && cAbs(currentAlpha) > 0.001) {
      const [ax, ay] = alphaToCanvas(currentAlpha, w, h);
      ctx.fillStyle = '#0072B2';
      ctx.strokeStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(ax, ay, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  }, [ramificacion, alphaEstrella, currentAlpha, lazo, displayLazo, size, RANGE]);

  function getMouseAlpha(e: React.MouseEvent<HTMLCanvasElement>): Complex | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return canvasToAlpha(
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect.width,
      rect.height,
    );
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
    // Cualquier interacción del usuario deselecciona el generador
    // mostrado, si lo había.
    onInteraction();
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
    // Si estamos mostrando un lazo guardado, el hover está congelado.
    // Sólo un mousedown (que limpia la selección) reactiva el tracking.
    if (displayLazo != null && !isDraggingRef.current) return;
    const target = getMouseAlpha(e);
    if (!target) return;
    if (isDraggingRef.current) {
      step(target);
      setLazo((prev) => [...prev, target]);
    } else {
      // Hover sin click: predictor-corrector continuo para preservar
      // etiquetado a lo largo del camino del ratón.
      rootsRef.current = stepRootsAdaptive(rootsRef.current, alphaRef.current, target);
      alphaRef.current = target;
      setAlpha(target);
      setRoots(rootsRef.current);
    }
  }

  function onMouseUp() {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    // Un lazo "útil" cierra cerca de donde se empezó Y la permutación
    // inducida no es la identidad.  Sólo entonces se guarda como
    // generador y la visualización persiste.
    const dist = cAbs(cSub(alphaRef.current, startAlphaRef.current));
    const cerrado = dist < CLOSE_TOL;
    let utile = false;
    if (cerrado) {
      const sigma = emparejarPorProximidad(
        rootsRef.current,
        startRootsRef.current,
      );
      utile = !sigma.every((j, i) => j === i);
    }

    if (utile) {
      const closedLazo: Complex[] = [...lazo, startAlphaRef.current];
      setLazo(closedLazo);
      onLoopEnd(
        [...rootsRef.current],
        [...startRootsRef.current],
        [...startAlphaRef.current] as Complex,
        closedLazo,
      );
    } else {
      // Cualquier otro caso: limpiamos sólo los artefactos del lazo
      // pero dejamos α y las raíces donde están (evita teleport).
      setLazo([]);
      resetTrayectorias();
      setStartRoots([...INITIAL_ROOTS]);
    }
  }

  function onMouseLeave() {
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
