import { useCallback, useEffect, useState } from 'react';
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
import { ViewToggle, type View } from './components/ViewToggle';

export default function App() {
  const [polinomio, setPolinomio] = useState<PolinomioInfo | null>(null);
  const [mode, setMode] = useState<Mode>('manual');
  const [view, setView] = useState<View>('plano-x');

  const [currentAlpha, setCurrentAlpha] = useState<Complex>([0, 0]);
  const [currentRoots, setCurrentRoots] = useState<Complex[]>([...INITIAL_ROOTS]);
  const [trayectorias, setTrayectorias] = useState<Complex[][]>(() =>
    INITIAL_ROOTS.map(() => [] as Complex[]),
  );

  const [generadores, setGeneradores] = useState<number[][]>([]);
  const [subgrupo, setSubgrupo] = useState<SubgrupoResponse | null>(null);

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
    getSubgrupo(generadores, polinomio.grado)
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
    (finalRoots: Complex[], startRoots: Complex[]) => {
      // Permutación local: emparejamos las raíces al final con las
      // del punto de inicio.  Es la monodromía del lazo basado en
      // ese punto.  El subgrupo generado es el mismo que la
      // monodromía basada en α* (los generadores son conjugados).
      const asignacion = emparejarPorProximidad(finalRoots, startRoots);

      const isIdentity = asignacion.every((j, i) => j === i);
      if (!isIdentity) {
        setGeneradores((prev) => {
          const isDup = prev.some(
            (g) =>
              g.length === asignacion.length &&
              g.every((x, i) => x === asignacion[i]),
          );
          return isDup ? prev : [...prev, asignacion];
        });
      }
      setTimeout(() => resetTrayectorias(), 600);
    },
    [resetTrayectorias],
  );

  const handleDeshacer = useCallback(() => {
    setGeneradores((prev) => prev.slice(0, -1));
  }, []);
  const handleReset = useCallback(() => {
    setGeneradores([]);
  }, []);

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
            ramificacion={ramificacion}
            alphaEstrella={alphaEstrella}
            currentAlpha={currentAlpha}
            setAlpha={setCurrentAlpha}
            setRoots={setCurrentRoots}
            pushTrayectoria={pushTrayectoria}
            resetTrayectorias={resetTrayectorias}
            onLoopEnd={handleLoopEnd}
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
            <PlanoX roots={currentRoots} trayectorias={trayectorias} />
          ) : (
            <div className="viewport-placeholder">
              <div className="icon">◐</div>
              <div className="caption">
                Vista 3D{view === 'superficie' ? ' (con superficie de Riemann)' : ' (solo trayectorias)'}
              </div>
              <div className="sub">próximamente</div>
            </div>
          )}
        </div>

        {/* --- Columna 3: subgrupo descubierto --- */}
        <div className="panel col-group">
          <PanelGrupo subgrupo={subgrupo} generadores={generadores} />
        </div>
      </div>
    </div>
  );
}
