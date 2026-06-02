import { useCallback, useEffect, useRef, useState } from 'react';
import type { Complex } from './galois/complex';
import { INITIAL_ROOTS } from './galois/polinomio';
import { emparejarPorProximidad } from './galois/monodromia';
import {
  getPolinomio,
  getSubgrupo,
  type PolinomioInfo,
  type SubgrupoResponse,
} from './api/client';
import { Header } from './components/Header';
import { ModeSelector, type Mode } from './components/ModeSelector';
import { PlanoAlpha } from './components/PlanoAlpha';
import { PlanoX } from './components/PlanoX';
import { PanelGrupo } from './components/PanelGrupo';
import { SuperficieRiemann } from './components/SuperficieRiemann';
import { Trayectorias3D } from './components/Trayectorias3D';
import { ViewToggle, type View } from './components/ViewToggle';

// Un generador guardado lleva consigo todo el contexto visual que se
// usó para descubrirlo: el trazo del plano α, las trayectorias de
// las raíces, y las posiciones de inicio y final.  Así al pinchar
// sobre σᵢ en el panel podemos restaurar la escena que lo produjo.
export interface GeneradorGuardado {
  permutacion: number[];
  lazo: Complex[];
  trayectorias: Complex[][];
  startAlpha: Complex;
  startRoots: Complex[];
  endRoots: Complex[];
}

export default function App() {
  const [polinomio, setPolinomio] = useState<PolinomioInfo | null>(null);
  const [mode, setMode] = useState<Mode>('manual');
  const [view, setView] = useState<View>('plano-x');

  const [currentAlpha, setCurrentAlpha] = useState<Complex>([0, 0]);
  const [currentRoots, setCurrentRoots] = useState<Complex[]>([...INITIAL_ROOTS]);
  const [startRoots, setStartRoots] = useState<Complex[]>([...INITIAL_ROOTS]);
  const [trayectorias, setTrayectorias] = useState<Complex[][]>(() =>
    INITIAL_ROOTS.map(() => [] as Complex[]),
  );
  // Espejo del lazo vivo de PlanoAlpha. Lo necesitamos en App para
  // que Trayectorias3D pueda dibujarlo a la par que el drag, sin
  // levantar el state completo del PlanoAlpha.
  const [liveLazo, setLiveLazo] = useState<Complex[]>([]);

  const [generadores, setGeneradores] = useState<GeneradorGuardado[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [subgrupo, setSubgrupo] = useState<SubgrupoResponse | null>(null);
  // resetKey fuerza remount de PlanoAlpha (Reset/Deshacer hard).
  const [resetKey, setResetKey] = useState(0);
  // clearLazoSignal sólo limpia el lazo interno del PlanoAlpha sin
  // tocar alphaRef/rootsRef — evita el teleport visual de las raíces.
  const [clearLazoSignal, setClearLazoSignal] = useState(0);

  // Refs para acceder a estado más reciente sin tener que recrear
  // callbacks en cada cambio.
  const trayectoriasRef = useRef(trayectorias);
  useEffect(() => {
    trayectoriasRef.current = trayectorias;
  }, [trayectorias]);

  // Cargar info del polinomio al montar
  useEffect(() => {
    getPolinomio()
      .then(setPolinomio)
      .catch((err) => {
        console.error('Backend no accesible:', err);
      });
  }, []);

  // Refetch del subgrupo cada vez que cambia generadores
  useEffect(() => {
    if (!polinomio) return;
    const permutaciones = generadores.map((g) => g.permutacion);
    getSubgrupo(permutaciones, polinomio.grado)
      .then(setSubgrupo)
      .catch(console.error);
  }, [generadores, polinomio]);

  const pushTrayectoria = useCallback((roots: Complex[]) => {
    setTrayectorias((prev) => prev.map((row, i) => [...row, roots[i]]));
  }, []);
  const resetTrayectorias = useCallback(() => {
    setTrayectorias(INITIAL_ROOTS.map(() => [] as Complex[]));
  }, []);

  const handleLoopEnd = useCallback(
    (
      finalRoots: Complex[],
      sRoots: Complex[],
      startAlpha: Complex,
      lazo: Complex[],
    ) => {
      const asignacion = emparejarPorProximidad(finalRoots, sRoots);
      const isIdentity = asignacion.every((j, i) => j === i);
      if (isIdentity) return;

      const nuevoGen: GeneradorGuardado = {
        permutacion: asignacion,
        lazo: [...lazo],
        trayectorias: trayectoriasRef.current.map((t) => [...t]),
        startAlpha: [...startAlpha] as Complex,
        startRoots: [...sRoots],
        endRoots: [...finalRoots],
      };

      setGeneradores((prev) => {
        const isDup = prev.some(
          (g) =>
            g.permutacion.length === asignacion.length &&
            g.permutacion.every((x, i) => x === asignacion[i]),
        );
        if (isDup) return prev;
        // El nuevo generador queda automáticamente seleccionado para
        // que su lazo siga visible tras cerrar.
        setSelectedIdx(prev.length);
        return [...prev, nuevoGen];
      });
    },
    [],
  );

  const handleDeshacer = useCallback(() => {
    setGeneradores((prev) => prev.slice(0, -1));
    setSelectedIdx(null);
    setCurrentAlpha([0, 0]);
    setCurrentRoots([...INITIAL_ROOTS]);
    setStartRoots([...INITIAL_ROOTS]);
    resetTrayectorias();
    setResetKey((k) => k + 1);
  }, [resetTrayectorias]);

  const handleReset = useCallback(() => {
    setGeneradores([]);
    setSelectedIdx(null);
    setCurrentAlpha([0, 0]);
    setCurrentRoots([...INITIAL_ROOTS]);
    setStartRoots([...INITIAL_ROOTS]);
    resetTrayectorias();
    setResetKey((k) => k + 1);
  }, [resetTrayectorias]);

  const handleEscape = useCallback(() => {
    // No hay nada que limpiar si no hay un generador seleccionado ni
    // trayectorias en pantalla. Evita el "blink" cuando se pulsa
    // Escape estando ya en estado limpio.
    const hayVisualState =
      selectedIdx != null ||
      (trayectoriasRef.current[0]?.length ?? 0) > 0;
    if (!hayVisualState) return;

    setSelectedIdx(null);
    setStartRoots([...INITIAL_ROOTS]);
    resetTrayectorias();
    // Sólo borramos el lazo del PlanoAlpha; no tocamos currentAlpha
    // ni currentRoots para que el hover continúe desde donde está
    // el ratón sin teleport.
    setClearLazoSignal((s) => s + 1);
  }, [resetTrayectorias, selectedIdx]);

  // Toggle de selección al clickar un generador del panel.
  const handleSelectGenerator = useCallback((idx: number) => {
    setSelectedIdx((prev) => (prev === idx ? null : idx));
  }, []);

  // Borrado de un generador específico vía el botón × del panel.
  const handleDeleteGenerator = useCallback(
    (idx: number) => {
      const eraElSeleccionado = selectedIdx === idx;
      setGeneradores((prev) => prev.filter((_, i) => i !== idx));
      setSelectedIdx((prev) => {
        if (prev == null) return null;
        if (prev === idx) return null;
        if (prev > idx) return prev - 1;
        return prev;
      });
      // Si lo que se eliminó era lo que estaba en pantalla, limpiar
      // también el lazo interno del PlanoAlpha + trayectorias para
      // que no quede el trazo "huérfano".
      if (eraElSeleccionado) {
        setClearLazoSignal((s) => s + 1);
        resetTrayectorias();
        setStartRoots([...INITIAL_ROOTS]);
      }
    },
    [selectedIdx, resetTrayectorias],
  );

  // El usuario interactuó con el canvas: deseleccionar el generador
  // mostrado, si lo había, para volver al estado live.
  const handleCanvasInteraction = useCallback(() => {
    setSelectedIdx((prev) => (prev == null ? prev : null));
  }, []);

  // Atajos de teclado.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (generadores.length === 0) return;
        e.preventDefault();
        handleDeshacer();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        handleEscape();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDeshacer, handleEscape, generadores.length]);

  if (!polinomio) {
    return (
      <div className="app">
        <Header />
        <div style={{ padding: 20, color: '#666' }}>
          Esperando al backend en <code>http://localhost:8000</code>…
        </div>
      </div>
    );
  }

  const ramificacion: Complex[] = polinomio.puntos_de_ramificacion.map(
    (p) => [p.re, p.im] as Complex,
  );
  const alphaEstrella: Complex = [
    polinomio.alpha_estrella.re,
    polinomio.alpha_estrella.im,
  ];

  // Estado a renderizar: live, o el snapshot del generador seleccionado.
  const selectedGen =
    selectedIdx != null ? generadores[selectedIdx] ?? null : null;

  const displayLazo: Complex[] | null = selectedGen ? selectedGen.lazo : null;
  const displayRoots: Complex[] = selectedGen
    ? selectedGen.endRoots
    : currentRoots;
  const displayStartRoots: Complex[] = selectedGen
    ? selectedGen.startRoots
    : startRoots;
  const displayTrayectorias: Complex[][] = selectedGen
    ? selectedGen.trayectorias
    : trayectorias;

  return (
    <div className="app">
      <Header expresion={polinomio.expresion} />
      <div className="main">
        {/* --- Columna 1: plano α --- */}
        <div className="panel col-alpha">
          <div className="panel-label">Modo</div>
          <ModeSelector mode={mode} onChange={setMode} />

          <div className="panel-label">
            Plano de <span className="var">α</span>
          </div>
          <PlanoAlpha
            key={resetKey}
            ramificacion={ramificacion}
            alphaEstrella={alphaEstrella}
            currentAlpha={currentAlpha}
            displayLazo={displayLazo}
            clearLazoSignal={clearLazoSignal}
            setAlpha={setCurrentAlpha}
            setRoots={setCurrentRoots}
            setStartRoots={setStartRoots}
            pushTrayectoria={pushTrayectoria}
            resetTrayectorias={resetTrayectorias}
            onLoopEnd={handleLoopEnd}
            onInteraction={handleCanvasInteraction}
            onLazoChange={setLiveLazo}
          />

          <div className="controls">
            <button
              className="btn"
              onClick={handleDeshacer}
              disabled={generadores.length === 0}
            >
              Deshacer
            </button>
            <button
              className="btn"
              onClick={handleReset}
              disabled={generadores.length === 0}
            >
              Reset
            </button>
          </div>
        </div>

        {/* --- Columna 2: viewport --- */}
        <div className="panel col-viewport">
          <ViewToggle view={view} onChange={setView} />
          {view === 'plano-x' ? (
            <PlanoX
              roots={displayRoots}
              startRoots={displayStartRoots}
              trayectorias={displayTrayectorias}
            />
          ) : view === 'trayectorias' ? (
            <Trayectorias3D
              ramificacion={ramificacion}
              alphaEstrella={alphaEstrella}
              currentAlpha={currentAlpha}
              lazo={displayLazo ?? liveLazo}
              trayectorias={displayTrayectorias}
              startRoots={displayStartRoots}
              roots={displayRoots}
            />
          ) : (
            <SuperficieRiemann
              ramificacion={ramificacion}
              currentAlpha={currentAlpha}
              roots={displayRoots}
              lazo={displayLazo ?? liveLazo}
              trayectorias={displayTrayectorias}
              startRoots={displayStartRoots}
            />
          )}
        </div>

        {/* --- Columna 3: subgrupo descubierto --- */}
        <div className="panel col-group">
          <PanelGrupo
            subgrupo={subgrupo}
            generadores={generadores}
            selectedIdx={selectedIdx}
            onSelect={handleSelectGenerator}
            onDelete={handleDeleteGenerator}
          />
        </div>
      </div>
    </div>
  );
}
