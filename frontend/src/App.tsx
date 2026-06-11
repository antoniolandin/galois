import { useCallback, useEffect, useRef, useState } from 'react';
import type { Complex } from './galois/complex';
import { INITIAL_ROOTS, setPolinomioRuntime } from './galois/polinomio';
import { emparejarPorProximidad } from './galois/monodromia';
import {
  getGaloisObjetivo,
  getPolinomio,
  getSubgrupo,
  postPermutacion,
  postPolinomio,
  type GrupoObjetivo,
  type PolinomioInfo,
  type SubgrupoResponse,
} from './api/client';
import {
  alphaEstrellaInsegura,
  generarLazoAleatorio,
} from './galois/lazos_aleatorios';
import { generarLazoAlrededorDe } from './galois/lazos_hauenstein';
import { Header } from './components/Header';
import { ModeSelector, type Mode } from './components/ModeSelector';
import { PlanoAlpha } from './components/PlanoAlpha';
import { PlanoX } from './components/PlanoX';
import { PanelGrupo } from './components/PanelGrupo';
import { SuperficieRiemann } from './components/SuperficieRiemann';
import { Trayectorias3D } from './components/Trayectorias3D';
import { ViewToggle, type View } from './components/ViewToggle';
import { CameraToggle, type CameraMode } from './components/CameraToggle';
import { StatsPills } from './components/StatsPills';
import { StauduharPage } from './components/StauduharPage';
import { LandingPage } from './components/LandingPage';
import { DEFAULT_CAM, type CamState } from './galois/proyeccion3d';

type PageView = 'landing' | 'monodromia' | 'stauduhar';

function pageDeUrl(): PageView {
  const p = window.location.pathname;
  if (p.startsWith('/stauduhar')) return 'stauduhar';
  if (p.startsWith('/monodromia')) return 'monodromia';
  return 'landing';
}

function pathDePage(v: PageView): string {
  if (v === 'stauduhar') return '/stauduhar';
  if (v === 'monodromia') return '/monodromia';
  return '/';
}

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
  // Toggle de vista a nivel raiz: monodromia (la app original sobre
  // C(alpha)) o stauduhar (cuerpos de numeros, descenso clasico).
  // Stauduhar no necesita el estado paramétrico, por eso se monta
  // antes de pedir el polinomio al backend.
  const [pageView, setPageView] = useState<PageView>(pageDeUrl());

  // Sincroniza pageView <-> URL para que /, /monodromia y /stauduhar
  // sean bookmarkeables y la recarga no devuelva siempre al primero.
  useEffect(() => {
    const path = pathDePage(pageView);
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
  }, [pageView]);
  useEffect(() => {
    function onPop() { setPageView(pageDeUrl()); }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const [polinomio, setPolinomio] = useState<PolinomioInfo | null>(null);
  // Overlay de loading durante el cambio de polinomio: tapamos la
  // app mientras el backend recalcula (grupo de Galois, ramif…) y
  // mientras el frontend reconstruye la malla de Riemann.
  const [loadingPolinomio, setLoadingPolinomio] = useState(false);
  // Grupo de Galois objetivo del polinomio actual. Lo calcula el
  // backend al arrancar (Hauenstein sin animar + GAP). Cuando el
  // subgrupo descubierto coincide con éste, marcamos la pill de
  // Estructura en verde y los bucles automáticos se saltan la
  // primera iteración (ya no hay nada que añadir).
  const [galoisObjetivo, setGaloisObjetivo] = useState<GrupoObjetivo | null>(
    null,
  );
  const [mode, setMode] = useState<Mode>('manual');
  const [view, setView] = useState<View>('plano-x');
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbital');
  // Cámara orbital compartida entre las dos vistas 3D (Superficie
  // de Riemann y Trayectorias). Levantarla a App hace que al
  // cambiar de vista se conserve el ángulo y la distancia que el
  // usuario haya estado ajustando.
  const [orbitCam, setOrbitCam] = useState<CamState>(DEFAULT_CAM);
  // Índice de la raíz desde la que se mira en POV. De momento fija
  // a 0; cuando haya selector de raíz, este state se actualizará.
  const povIdx = 0;

  // Estado del modo "Aleatorio" (Leykin–Sottile). Cuando está en
  // marcha, un bucle async genera lazos pseudoaleatorios alrededor
  // de los puntos de ramificación, los manda al backend, acumula
  // generadores y comprueba después de cada paso si el subgrupo
  // descubierto ya es el simétrico completo (criterio de parada
  // del paper). `runningAleatorio` controla la UI; `stoppedRef`
  // permite cancelar el bucle desde el botón "Detener".
  const [runningAleatorio, setRunningAleatorio] = useState(false);
  const stoppedAleatorioRef = useRef(false);
  // Iteración actual: solo informativo para la UI.
  const [iterAleatorio, setIterAleatorio] = useState(0);

  // Estado del modo Hauenstein–Rodríguez–Sottile. Recorre los
  // puntos de ramificación uno a uno y solo anima el lazo cuando
  // su permutación añade información al grupo descubierto.
  const [runningHauenstein, setRunningHauenstein] = useState(false);
  const stoppedHauensteinRef = useRef(false);
  const [iterHauenstein, setIterHauenstein] = useState(0);

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
  // Mismo patrón para los generadores: los bucles del modo
  // Aleatorio y Hauenstein leen las permutaciones acumuladas desde
  // aquí en cada iteración, así reaccionan en vivo si el usuario
  // borra un generador (el ✕ del panel) mientras corren.
  const generadoresRef = useRef(generadores);
  useEffect(() => {
    generadoresRef.current = generadores;
  }, [generadores]);

  // Clave para forzar remount del árbol cuando cambia el polinomio:
  // las constantes mutables del módulo `polinomio.ts` (P, Px, DEGREE,
  // INITIAL_ROOTS, ...) se han actualizado, pero los hijos que las
  // capturaron en `useMemo`/`useEffect` no se invalidan solos. Un
  // remount completo limpia esa caché.
  const [polinomioKey, setPolinomioKey] = useState(0);

  // Cargar info del polinomio al montar
  useEffect(() => {
    getPolinomio()
      .then((info) => {
        setPolinomioRuntime(info);
        setPolinomio(info);
      })
      .catch((err) => {
        console.error('Backend no accesible:', err);
      });
    getGaloisObjetivo()
      .then(setGaloisObjetivo)
      .catch((err) => {
        console.warn('No se pudo obtener el grupo de Galois objetivo:', err);
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

  // Inserta un generador en la lista, descartando identidad y duplicados.
  // Se usa tanto desde el flujo manual (vía `handleLoopEnd`) como desde
  // el bucle del modo Aleatorio (`runAleatorio`).
  //
  // `autoSelect` controla si el nuevo generador queda seleccionado al
  // insertarse. En el modo manual sí (el usuario suelta el lazo y la
  // vista muestra el snapshot que acaba de generar); en el modo
  // aleatorio no, para que el bucle siga animando los siguientes
  // lazos en vivo sin que la UI se congele en el último snapshot.
  const addGenerador = useCallback(
    (gen: GeneradorGuardado, autoSelect = true) => {
      const isIdentity = gen.permutacion.every((j, i) => j === i);
      if (isIdentity) return;
      setGeneradores((prev) => {
        const isDup = prev.some(
          (g) =>
            g.permutacion.length === gen.permutacion.length &&
            g.permutacion.every((x, i) => x === gen.permutacion[i]),
        );
        if (isDup) return prev;
        if (autoSelect) setSelectedIdx(prev.length);
        return [...prev, gen];
      });
    },
    [],
  );

  const handleLoopEnd = useCallback(
    (
      finalRoots: Complex[],
      sRoots: Complex[],
      startAlpha: Complex,
      lazo: Complex[],
    ) => {
      const asignacion = emparejarPorProximidad(finalRoots, sRoots);
      addGenerador({
        permutacion: asignacion,
        lazo: [...lazo],
        trayectorias: trayectoriasRef.current.map((t) => [...t]),
        startAlpha: [...startAlpha] as Complex,
        startRoots: [...sRoots],
        endRoots: [...finalRoots],
      });
    },
    [addGenerador],
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

  // Reset "visual" sin tocar los generadores acumulados: limpia el
  // estado vivo (raíces actuales, lazo en curso, trayectorias) y
  // devuelve la cámara a α*. Lo usa la transición de modo para que
  // las raíces vuelvan a sus posiciones iniciales sin perder los
  // generadores que ya se habían descubierto.
  const handleResetVisual = useCallback(() => {
    setSelectedIdx(null);
    setCurrentAlpha([0, 0]);
    setCurrentRoots([...INITIAL_ROOTS]);
    setStartRoots([...INITIAL_ROOTS]);
    setLiveLazo([]);
    resetTrayectorias();
    // Aviso al canvas para que limpie su lazo interno sin pasar
    // por un remount completo (evita el "blink" al cambiar de
    // modo). El Reset duro de generadores sí remontea con
    // `resetKey` en handleReset.
    setClearLazoSignal((s) => s + 1);
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

  // Cambio del polinomio activo desde el header. Lo gestiona el
  // backend (parseo + validación + recálculo de ramif./raíces) y
  // aquí reseteamos absolutamente todo: generadores, lazo en curso,
  // raíces actuales, modo (volvemos a Manual para que el usuario
  // no se quede con un bucle automático corriendo sobre datos del
  // polinomio anterior).
  const handleChangeExpresion = useCallback(
    async (expresion: string) => {
      stoppedAleatorioRef.current = true;
      stoppedHauensteinRef.current = true;
      setLoadingPolinomio(true);
      let info: PolinomioInfo;
      try {
        info = await postPolinomio(expresion);
      } catch (e) {
        // Apagamos el overlay y propagamos el error al Header
        // para que muestre el mensaje del backend al usuario.
        setLoadingPolinomio(false);
        throw e;
      }
      // Reconfigurar las bindings runtime del módulo `polinomio.ts`
      // ANTES de pintar nada con el nuevo polinomio: P, Px, DEGREE,
      // INITIAL_ROOTS, etc., apuntarán al polinomio nuevo.
      setPolinomioRuntime(info);
      setPolinomio(info);
      // El grupo de Galois objetivo del nuevo polinomio.
      try {
        const obj = await getGaloisObjetivo();
        setGaloisObjetivo(obj);
      } catch (e) {
        console.warn(
          'No se pudo obtener el grupo de Galois objetivo del nuevo polinomio:',
          e,
        );
        setGaloisObjetivo(null);
      }
      // Punto base actualizado para que el reset visual no use el
      // viejo (0, 0) que para algunos polinomios cae sobre un branch.
      const alpha0: Complex = [info.alpha_estrella.re, info.alpha_estrella.im];
      const raicesIni: Complex[] = info.raices_base.map(
        (p) => [p.re, p.im] as Complex,
      );
      setGeneradores([]);
      setSelectedIdx(null);
      setSubgrupo(null);
      setCurrentAlpha(alpha0);
      setCurrentRoots(raicesIni);
      setStartRoots(raicesIni);
      setLiveLazo([]);
      resetTrayectorias();
      setResetKey((k) => k + 1);
      setMode('manual');
      setRunningAleatorio(false);
      setRunningHauenstein(false);
      // Remount del árbol: invalida `useMemo`/`useEffect` que
      // hayan capturado las constantes del polinomio anterior.
      // El overlay de loading se cierra desde un useEffect que
      // detecta el cambio de `polinomioKey` (más abajo). Así no
      // dependemos de rAFs encadenados con los renders pesados.
      setPolinomioKey((k) => k + 1);
    },
    [resetTrayectorias],
  );

  // Cierre del overlay: el effect solo depende de `polinomioKey`,
  // que sólo cambia con el último `setPolinomioKey((k) => k + 1)`
  // del handler. Como los useEffect se ejecutan post-commit, en
  // este punto el remount con la malla nueva ya está pintado.
  // El `polinomioKey === 0` inicial (montaje sin cambio de
  // polinomio) se ignora para que el overlay no se cierre al
  // primer render.
  useEffect(() => {
    if (polinomioKey === 0) return;
    const t = setTimeout(() => setLoadingPolinomio(false), 0);
    return () => clearTimeout(t);
  }, [polinomioKey]);

  // Bucle del modo Aleatorio (Leykin–Sottile): genera lazos
  // pseudoaleatorios alrededor de los puntos de ramificación, los
  // manda al backend, acumula los generadores no identidad y comprueba
  // tras cada paso si el subgrupo descubierto coincide con el
  // simétrico completo S_n. Para cuando se cumple ese criterio o
  // cuando el usuario pulsa "Detener".
  const handleStopAleatorio = useCallback(() => {
    stoppedAleatorioRef.current = true;
  }, []);
  const handleRunAleatorio = useCallback(async () => {
    if (!polinomio || runningAleatorio) return;
    // Pre-chequeo: si ya estamos en el grupo de Galois objetivo,
    // no hay nada que hacer. Lo verificamos contra el backend con
    // la lista de generadores actual (leída del ref para que
    // refleje borrados recientes). Hacerlo aquí, ANTES de tocar
    // ningún state, evita el flash de "iteración 0" cuando ya
    // está todo descubierto.
    if (galoisObjetivo) {
      const permsActuales = generadoresRef.current.map((g) => g.permutacion);
      let ordenActual = 1;
      if (permsActuales.length > 0) {
        try {
          const grupo = await getSubgrupo(permsActuales, polinomio.grado);
          ordenActual = grupo.orden;
        } catch (e) {
          console.error('[aleatorio] error al consultar el grupo', e);
          return;
        }
      }
      if (ordenActual === galoisObjetivo.orden) return;
    }
    stoppedAleatorioRef.current = false;
    setRunningAleatorio(true);
    setIterAleatorio(0);
    setSelectedIdx(null);

    const alphaEstrellaLocal: Complex = [
      polinomio.alpha_estrella.re,
      polinomio.alpha_estrella.im,
    ];
    const ramif: Complex[] = polinomio.puntos_de_ramificacion.map(
      (p) => [p.re, p.im] as Complex,
    );
    // `polinomio.raices_base` viene del backend en el orden de
    // `np.roots` (autovalores de la matriz compañera), que NO
    // coincide con el orden canónico de `INITIAL_ROOTS` ni con los
    // colores. Calculamos la permutación que mapea cada raíz inicial
    // a su contraparte del backend para reordenar las trayectorias
    // y mantener "la raíz negra siempre en el origen".
    const raicesBaseRaw: Complex[] = polinomio.raices_base.map(
      (p) => [p.re, p.im] as Complex,
    );
    const permBackendACanonico = emparejarPorProximidad(
      INITIAL_ROOTS,
      raicesBaseRaw,
    );
    const raicesBase: Complex[] = [...INITIAL_ROOTS];
    const n = polinomio.grado;
    if (alphaEstrellaInsegura(alphaEstrellaLocal, ramif)) {
      console.warn(
        '[aleatorio] α* está peligrosamente cerca de un punto de ramificación; ' +
          'considera usar otro punto base.',
      );
    }
    // Las permutaciones acumuladas se releen del ref en cada
    // iteración (ver bucle), así reflejan al instante los
    // borrados que el usuario haga en el panel.

    // Velocidad de animación: ms entre pasos del lazo. Más bajo =
    // más rápido. 18 ms da ~55 fps, fluido a la vista.
    const PASO_MS = 18;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const MAX_ITER = 120;
    for (let iter = 0; iter < MAX_ITER; iter++) {
      if (stoppedAleatorioRef.current) break;
      // Las permutaciones se releen del ref, así reflejan los
      // borrados que el usuario haga en el panel mientras corre.
      const perms = generadoresRef.current.map((g) => g.permutacion);
      // Criterio de parada: subgrupo descubierto == grupo de Galois
      // objetivo. Si no hay generadores aún, el subgrupo es trivial
      // (orden 1); seguimos parando si ese ya es el objetivo (caso
      // de polinomios como x + α, donde el grupo de Galois es {e}).
      let ordenActual = 1;
      if (perms.length > 0) {
        try {
          const grupo = await getSubgrupo(perms, n);
          if (stoppedAleatorioRef.current) break;
          ordenActual = grupo.orden;
        } catch (e) {
          console.error('[aleatorio] error al consultar el grupo', e);
          break;
        }
      }
      const alcanzado = galoisObjetivo
        ? ordenActual === galoisObjetivo.orden
        : false;
      if (alcanzado) break;
      setIterAleatorio(iter + 1);
      const lazo = generarLazoAleatorio(alphaEstrellaLocal, ramif);
      try {
        const lazoJson = lazo.map(([re, im]) => ({ re, im }));
        // El lazo ya empieza y termina en α*; le decimos al backend
        // que NO añada α* por su cuenta para que las trayectorias
        // devueltas tengan exactamente la longitud del lazo.
        const resp = await postPermutacion(lazoJson, false);
        if (stoppedAleatorioRef.current) break;
        const trayectoriasRaw = resp.trayectorias.map((t) =>
          t.map((c) => [c.re, c.im] as Complex),
        );
        // Reordenar al orden canónico para que la raíz índice 0
        // sea la del origen, índice 1 la de x=1, etc.
        const trayectoriasCompl: Complex[][] = permBackendACanonico.map(
          (j) => trayectoriasRaw[j],
        );
        const finalRoots: Complex[] = trayectoriasCompl.map(
          (t) => t[t.length - 1],
        );
        // La asignación del backend también va en orden np.roots;
        // recálculo en el orden canónico por emparejamiento final.
        const asignacionCanonica = emparejarPorProximidad(
          finalRoots,
          INITIAL_ROOTS,
        );

        // --- Animación paso a paso del lazo y de las raíces ---
        setStartRoots(raicesBase);
        setCurrentAlpha(lazo[0]);
        setCurrentRoots(raicesBase);
        resetTrayectorias();
        setLiveLazo([lazo[0]]);
        for (let i = 1; i < lazo.length; i++) {
          if (stoppedAleatorioRef.current) break;
          const rootsEnPaso: Complex[] = trayectoriasCompl.map(
            (t) => t[i],
          );
          setCurrentAlpha(lazo[i]);
          setCurrentRoots(rootsEnPaso);
          pushTrayectoria(rootsEnPaso);
          setLiveLazo(lazo.slice(0, i + 1));
          await sleep(PASO_MS);
        }
        if (stoppedAleatorioRef.current) break;

        addGenerador(
          {
            permutacion: asignacionCanonica,
            lazo: [...lazo],
            trayectorias: trayectoriasCompl,
            startAlpha: [...alphaEstrellaLocal] as Complex,
            startRoots: raicesBase,
            endRoots: finalRoots,
          },
          false,
        );
        // `perms` se reconstruye desde el ref al inicio de la
        // siguiente iteración; no hace falta apenderlo aquí.
      } catch (e) {
        console.error('[aleatorio] error al calcular permutación', e);
        break;
      }
      // Pausa entre lazos para que el espectador "vea" el paso.
      await sleep(200);
      // Limpiar la visualización antes del siguiente lazo: vuelve
      // todo al estado base (sin lazo, raíces en α*).
      setLiveLazo([]);
      resetTrayectorias();
      setCurrentAlpha(alphaEstrellaLocal);
      setCurrentRoots(raicesBase);
      setStartRoots(raicesBase);
    }
    setRunningAleatorio(false);
  }, [
    polinomio,
    runningAleatorio,
    generadores,
    addGenerador,
    pushTrayectoria,
    resetTrayectorias,
    galoisObjetivo,
    subgrupo,
  ]);

  // Bucle del modo Hauenstein–Rodríguez–Sottile: recorre cada
  // punto de ramificación, calcula el lazo que lo rodea y la
  // permutación que induce, y SOLO anima el dibujo (y guarda el
  // generador) si esa permutación añade información al subgrupo
  // ya descubierto. El criterio de parada es doble: o se llega a
  // S_n (siempre que el grupo sea simétrico) o se han recorrido
  // todos los puntos de ramificación.
  const handleStopHauenstein = useCallback(() => {
    stoppedHauensteinRef.current = true;
  }, []);
  const handleRunHauenstein = useCallback(async () => {
    if (!polinomio || runningHauenstein) return;
    // Pre-chequeo idéntico al de aleatorio: si ya estamos en el
    // grupo de Galois objetivo, salimos sin tocar state ni
    // incrementar el contador de iteraciones.
    if (galoisObjetivo) {
      const permsActuales = generadoresRef.current.map((g) => g.permutacion);
      let ordenActual = 1;
      if (permsActuales.length > 0) {
        try {
          const grupo = await getSubgrupo(permsActuales, polinomio.grado);
          ordenActual = grupo.orden;
        } catch (e) {
          console.error('[hauenstein] error al consultar el grupo', e);
          return;
        }
      }
      if (ordenActual === galoisObjetivo.orden) return;
    }
    stoppedHauensteinRef.current = false;
    setRunningHauenstein(true);
    setIterHauenstein(0);
    setSelectedIdx(null);

    const alphaEstrellaLocal: Complex = [
      polinomio.alpha_estrella.re,
      polinomio.alpha_estrella.im,
    ];
    const ramif: Complex[] = polinomio.puntos_de_ramificacion.map(
      (p) => [p.re, p.im] as Complex,
    );
    const raicesBaseRaw: Complex[] = polinomio.raices_base.map(
      (p) => [p.re, p.im] as Complex,
    );
    const permBackendACanonico = emparejarPorProximidad(
      INITIAL_ROOTS,
      raicesBaseRaw,
    );
    const raicesBase: Complex[] = [...INITIAL_ROOTS];
    const n = polinomio.grado;

    // Trayectorias más lentas que en Aleatorio para dar tiempo a
    // ver cada rodeo con detalle.
    const PASO_MS = 40;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Bucle de rondas. Cada ronda recorre los puntos de ramificación;
    // si en una ronda no se añadió nada nuevo, se sale. Si el
    // usuario borra un generador descubierto, su permutación volverá
    // a faltar y se reanima en la siguiente ronda.
    const MAX_RONDAS = 4;
    let totalIter = 0;
    rondas: for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
      if (stoppedHauensteinRef.current) break;
      let anadidoEnRonda = false;
      for (let idx = 0; idx < ramif.length; idx++) {
        if (stoppedHauensteinRef.current) break rondas;
        totalIter += 1;
        setIterHauenstein(totalIter);
        // Releer las permutaciones acumuladas desde el ref: refleja
        // los borrados que el usuario haya hecho en el panel.
        const perms = generadoresRef.current.map((g) => g.permutacion);
        let ordenPrevio = 1;
        if (perms.length > 0) {
          try {
            const g0 = await getSubgrupo(perms, n);
            if (stoppedHauensteinRef.current) break rondas;
            ordenPrevio = g0.orden;
          } catch (e) {
            console.error('[hauenstein] error al consultar el grupo', e);
            break rondas;
          }
        }
        // Si el grupo descubierto ya coincide con el objetivo
        // (incluido el caso trivial perms.length == 0 con grupo
        // de Galois {e}), salimos sin animar.
        if (galoisObjetivo && ordenPrevio === galoisObjetivo.orden) {
          break rondas;
        }
        const bi = ramif[idx];
        const otrosB = ramif.filter((_, j) => j !== idx);
        const lazo = generarLazoAlrededorDe(alphaEstrellaLocal, bi, otrosB);
        try {
          const lazoJson = lazo.map(([re, im]) => ({ re, im }));
          const resp = await postPermutacion(lazoJson, false);
          if (stoppedHauensteinRef.current) break rondas;
          const trayectoriasRaw = resp.trayectorias.map((t) =>
            t.map((c) => [c.re, c.im] as Complex),
          );
          const trayectoriasCompl: Complex[][] = permBackendACanonico.map(
            (j) => trayectoriasRaw[j],
          );
          const finalRoots: Complex[] = trayectoriasCompl.map(
            (t) => t[t.length - 1],
          );
          const sigma = emparejarPorProximidad(finalRoots, INITIAL_ROOTS);
          const isIdentity = sigma.every((j, i) => j === i);
          if (isIdentity) continue;

          // ¿Esta permutación aporta información al grupo actual?
          const candidata = [...perms, sigma];
          const grupoCandidato = await getSubgrupo(candidata, n);
          if (stoppedHauensteinRef.current) break rondas;
          if (grupoCandidato.orden === ordenPrevio) {
            // Ya cubierta: saltamos el rodeo sin animar.
            continue;
          }

          // Aporta: animar la trayectoria paso a paso.
          setStartRoots(raicesBase);
          setCurrentAlpha(lazo[0]);
          setCurrentRoots(raicesBase);
          resetTrayectorias();
          setLiveLazo([lazo[0]]);
          for (let i = 1; i < lazo.length; i++) {
            if (stoppedHauensteinRef.current) break rondas;
            const rootsEnPaso: Complex[] = trayectoriasCompl.map((t) => t[i]);
            setCurrentAlpha(lazo[i]);
            setCurrentRoots(rootsEnPaso);
            pushTrayectoria(rootsEnPaso);
            setLiveLazo(lazo.slice(0, i + 1));
            await sleep(PASO_MS);
          }
          if (stoppedHauensteinRef.current) break rondas;

          addGenerador(
            {
              permutacion: sigma,
              lazo: [...lazo],
              trayectorias: trayectoriasCompl,
              startAlpha: [...alphaEstrellaLocal] as Complex,
              startRoots: raicesBase,
              endRoots: finalRoots,
            },
            false,
          );
          anadidoEnRonda = true;
          const alcanzadoTras = galoisObjetivo
            ? grupoCandidato.orden === galoisObjetivo.orden
            : grupoCandidato.estructura === `S_${n}`;
          if (alcanzadoTras) break rondas;
        } catch (e) {
          console.error('[hauenstein] error al calcular permutación', e);
          break rondas;
        }
        await sleep(250);
        setLiveLazo([]);
        resetTrayectorias();
        setCurrentAlpha(alphaEstrellaLocal);
        setCurrentRoots(raicesBase);
        setStartRoots(raicesBase);
      }
      if (!anadidoEnRonda) break;
    }
    // Limpieza final del estado vivo.
    setLiveLazo([]);
    resetTrayectorias();
    setCurrentAlpha(alphaEstrellaLocal);
    setCurrentRoots(raicesBase);
    setStartRoots(raicesBase);
    setRunningHauenstein(false);
  }, [
    polinomio,
    runningHauenstein,
    generadores,
    addGenerador,
    pushTrayectoria,
    resetTrayectorias,
    galoisObjetivo,
    subgrupo,
  ]);

  // Re-arranque automático cuando el usuario borra un generador
  // mientras está en modo aleatorio o Hauenstein. Si el bucle ya
  // había terminado (p.ej. porque alcanzó S_n) y el borrado deja
  // un agujero, retomamos el algoritmo para rellenarlo.
  const prevGenLenRef = useRef(generadores.length);
  useEffect(() => {
    const prev = prevGenLenRef.current;
    prevGenLenRef.current = generadores.length;
    if (generadores.length >= prev) return;
    if (mode === 'hauenstein' && !runningHauenstein) {
      handleRunHauenstein();
    } else if (mode === 'aleatorio' && !runningAleatorio) {
      handleRunAleatorio();
    }
  }, [
    generadores.length,
    mode,
    runningHauenstein,
    runningAleatorio,
    handleRunHauenstein,
    handleRunAleatorio,
  ]);

  // Transición entre modos. El cambio de modo limpia sólo el
  // estado vivo (raíces actuales, lazo en curso, trayectorias) para
  // que las raíces vuelvan a su posición inicial, PERO los
  // generadores acumulados se mantienen — son parte del progreso
  // que el usuario ya consiguió. Si el nuevo modo es "aleatorio",
  // el bucle arranca con esas permutaciones ya en la lista, así
  // sigue desde donde estaban.
  const prevModeRef = useRef<Mode>(mode);
  useEffect(() => {
    if (prevModeRef.current === mode) return;
    const prevMode = prevModeRef.current;
    prevModeRef.current = mode;
    if (prevMode === 'aleatorio') handleStopAleatorio();
    if (prevMode === 'hauenstein') handleStopHauenstein();
    handleResetVisual();
    if (mode === 'aleatorio') {
      setTimeout(() => handleRunAleatorio(), 0);
    } else if (mode === 'hauenstein') {
      setTimeout(() => handleRunHauenstein(), 0);
    }
  }, [
    mode,
    handleRunAleatorio,
    handleStopAleatorio,
    handleRunHauenstein,
    handleStopHauenstein,
    handleResetVisual,
  ]);

  // Atajos de teclado. Sólo activos en modo Manual: en Aleatorio y
  // Hauenstein el plano α lo pilota un bucle automático y un
  // Ctrl+Z o un Escape lo dejarían incoherente con el state del
  // bucle.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (mode !== 'manual') return;
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
  }, [mode, handleDeshacer, handleEscape, generadores.length]);

  if (pageView === 'landing') {
    return (
      <LandingPage
        onGoToMonodromia={() => setPageView('monodromia')}
        onGoToStauduhar={() => setPageView('stauduhar')}
      />
    );
  }

  if (pageView === 'stauduhar') {
    return <StauduharPage onBack={() => setPageView('landing')} />;
  }

  if (!polinomio) {
    return (
      <div className="app">
        <Header onGoHome={() => setPageView('landing')} />
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
  // Posición de α que se renderiza en las vistas 3D. Al seleccionar
  // un generador, las raíces mostradas son las del FINAL del lazo,
  // así que la α también debe ser la del último punto del lazo —de
  // lo contrario, la cámara POV (que se ancla a la raíz) sigue
  // pegada al α live y no acompaña al snapshot del generador.
  const displayAlpha: Complex = selectedGen
    ? selectedGen.lazo[selectedGen.lazo.length - 1] ?? selectedGen.startAlpha
    : currentAlpha;
  // El subgrupo descubierto coincide con el grupo de Galois objetivo.
  const grupoCompleto =
    galoisObjetivo != null &&
    subgrupo != null &&
    subgrupo.orden === galoisObjetivo.orden;

  return (
    <div className="app">
      {loadingPolinomio && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-card">
            <div className="loading-spinner" aria-hidden />
            <div className="loading-text">Recalculando polinomio…</div>
          </div>
        </div>
      )}
      <Header
        expresion={polinomio.expresion}
        onChangeExpresion={handleChangeExpresion}
        onGoHome={() => setPageView('landing')}
      />
      <div className="main" key={polinomioKey}>
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
            displayLazo={
              displayLazo ??
              (mode !== 'manual' && (liveLazo?.length ?? 0) > 1
                ? liveLazo
                : null)
            }
            clearLazoSignal={clearLazoSignal}
            setAlpha={setCurrentAlpha}
            setRoots={setCurrentRoots}
            setStartRoots={setStartRoots}
            pushTrayectoria={pushTrayectoria}
            resetTrayectorias={resetTrayectorias}
            onLoopEnd={handleLoopEnd}
            onInteraction={handleCanvasInteraction}
            onLazoChange={setLiveLazo}
            disabled={mode !== 'manual'}
          />

          <div className="controls">
            {mode === 'aleatorio' ? (
              <>
                <button
                  className="btn"
                  onClick={
                    runningAleatorio ? handleStopAleatorio : handleRunAleatorio
                  }
                  disabled={!runningAleatorio && grupoCompleto}
                >
                  {runningAleatorio
                    ? `Detener (iter ${iterAleatorio})`
                    : 'Continuar'}
                </button>
                <button
                  className="btn"
                  onClick={handleReset}
                  disabled={runningAleatorio || generadores.length === 0}
                >
                  Reset
                </button>
              </>
            ) : mode === 'hauenstein' ? (
              <>
                <button
                  className="btn"
                  onClick={
                    runningHauenstein
                      ? handleStopHauenstein
                      : handleRunHauenstein
                  }
                  disabled={!runningHauenstein && grupoCompleto}
                >
                  {runningHauenstein
                    ? `Detener (B ${iterHauenstein}/${
                        polinomio.puntos_de_ramificacion.length
                      })`
                    : 'Continuar'}
                </button>
                <button
                  className="btn"
                  onClick={handleReset}
                  disabled={runningHauenstein || generadores.length === 0}
                >
                  Reset
                </button>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>

        {/* --- Columna 2: viewport --- */}
        <div className="panel col-viewport">
          <div className="viewport-overlay">
            <ViewToggle view={view} onChange={setView} />
            <StatsPills subgrupo={subgrupo} completo={grupoCompleto} />
          </div>
          {view === 'superficie' && (
            <CameraToggle
              mode={cameraMode}
              povIdx={povIdx}
              onChange={setCameraMode}
            />
          )}
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
              currentAlpha={displayAlpha}
              lazo={displayLazo ?? liveLazo}
              trayectorias={displayTrayectorias}
              startRoots={displayStartRoots}
              roots={displayRoots}
              cam={orbitCam}
              onCamChange={setOrbitCam}
            />
          ) : (
            <SuperficieRiemann
              ramificacion={ramificacion}
              currentAlpha={displayAlpha}
              roots={displayRoots}
              lazo={displayLazo ?? liveLazo}
              trayectorias={displayTrayectorias}
              startRoots={displayStartRoots}
              cameraMode={cameraMode}
              povIdx={povIdx}
              cam={orbitCam}
              onCamChange={setOrbitCam}
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
