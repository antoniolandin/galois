import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import katex from 'katex';
import {
  postStauduhar,
  type StauduharResponse,
  type CandidatoProbado,
  type CosetApp,
  type GrupoInfo,
} from '../api/client';
import { Math as Tex } from './Math';

interface Props {
  onBack: () => void;
}

// Polinomios canonicos por grupo (atajos en el placeholder).
const SUGERENCIAS: { label: string; expr: string }[] = [
  { label: 'x³ − 2 (S₃)',         expr: 'x^3 - 2'         },
  { label: 'x³ − 3x + 1 (A₃)',    expr: 'x^3 - 3*x + 1'   },
  { label: 'x⁴ − 2 (D₄)',         expr: 'x^4 - 2'         },
  { label: 'x⁴ + 1 (V₄)',         expr: 'x^4 + 1'         },
  { label: 'x⁴ + x + 1 (S₄)',     expr: 'x^4 + x + 1'     },
  { label: 'x⁴ + 8x + 12 (A₄)',   expr: 'x^4 + 8*x + 12'  },
  { label: 'x⁴ + 5x² + 5 (C₄)',   expr: 'x^4 + 5*x^2 + 5' },
  { label: 'x⁵ − x − 1 (S₅)',     expr: 'x^5 - x - 1'     },
];

// Imitamos pretty() del Header del visor de monodromia: superindices
// Unicode para los exponentes y signo menos tipografico. Solo para
// presentacion en el header (el envio al backend mantiene "x^n").
function prettyPoly(expr: string): string {
  return expr
    .replace(/\s+/g, '')
    .replace(/\*/g, '')
    .replace(/(\^|\*\*)(\d+)/g, (_, _op, d) =>
      d.split('').map((c: string) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[parseInt(c, 10)]).join(''),
    )
    .replace(/([a-z⁰¹²³⁴⁵⁶⁷⁸⁹])(?=[a-z])/g, '$1·')
    .replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹\d])(?=[a-z])/g, '$1·')
    .replace(/-/g, ' − ')
    .replace(/\+/g, ' + ');
}

// Deducir grado del polinomio del exponente maximo de x.
function deducirGrado(expr: string): 3 | 4 | 5 {
  const matches = [...expr.matchAll(/x\s*(?:\^|\*\*)\s*(\d+)/g)];
  if (matches.length === 0) return 4;
  const max = Math.max(...matches.map((m) => parseInt(m[1], 10)));
  if (max <= 3) return 3;
  if (max === 4) return 4;
  return 5;
}

function renderInlineMath(s: string): string {
  return s.replace(/\\\((.+?)\\\)/g, (_, tex) =>
    katex.renderToString(tex, { throwOnError: false, displayMode: false }),
  );
}

// Render mini: parsea LaTeX simple (\alpha_{N}, y_{N}, exponentes,
// productos, paréntesis \left \right, raíces, i imaginario) y devuelve
// HTML con clases para colorear por raíz. Más fiel al boceto que KaTeX
// porque usa la fuente Fira Code y aplica la paleta Okabe-Ito a los
// subíndices.
// Inyecta \textcolor{#hex}{N} en los subindices de \alpha_{N} antes
// de pasar el LaTeX a KaTeX. Solo aplica a alphas — los y_i del
// invariante simbólico se quedan en negro para no contaminar con
// la paleta de raíces a un objeto que aún no se ha especializado.
const COLORES_HEX: Record<number, string> = {
  1: '56B4E9',
  2: 'E69F00',
  3: '009E73',
  4: 'CC79A7',
  5: '0072B2',
};
function preColoreLatex(latex: string, animSet?: Set<number>): string {
  // `animSet` opcional: si se pasa, solo los subindices cuya posicion
  // (orden de aparicion 0-indexado) esta en el Set llevan la clase
  // `anim-sub` que dispara la animacion de pop. El coloreado por
  // raiz (paleta Okabe-Ito) se aplica siempre.
  let occ = -1;
  return latex.replace(
    /\\alpha_\{?(\d+)\}?/g,
    (match, num) => {
      occ++;
      const c = COLORES_HEX[parseInt(num, 10)];
      if (!c) return match;
      const inner = `\\textcolor{#${c}}{${num}}`;
      const shouldAnim = animSet !== undefined && animSet.has(occ);
      if (shouldAnim) {
        return `\\alpha_{\\htmlClass{anim-sub anim-sub-${num}}{${inner}}}`;
      }
      return `\\alpha_{${inner}}`;
    },
  );
}

// Compara dos LaTeX de conjugados (estructura idéntica, solo cambian
// los índices de α). Devuelve el Set de posiciones (0-indexadas por
// orden de aparición de \alpha_{N}) donde el índice difiere.
function diffPosicionesAlpha(oldLatex: string, newLatex: string): Set<number> {
  const re = /\\alpha_\{?(\d+)\}?/g;
  const extraer = (s: string): number[] => {
    const out: number[] = [];
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, 'g');
    while ((m = r.exec(s)) !== null) out.push(parseInt(m[1], 10));
    return out;
  };
  const a = extraer(oldLatex);
  const b = extraer(newLatex);
  const diff = new Set<number>();
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) diff.add(i);
  return diff;
}

// Render Fira Code para nombres de grupo: "S_4", "D_4", "F_{20}",
// "A_5", "PGL_2(F_5)", etc. No colorea (no son raices).
// Convierte un nombre de grupo "F_20" en LaTeX que KaTeX renderiza
// con el subíndice completo: "F_{20}". Sin esto, KaTeX solo coge el
// primer carácter del subíndice ("F_2") y deja el resto suelto.
function texGrupo(nombre: string): string {
  return nombre.replace(/_(\d+)/, '_{$1}');
}

function renderGroupName(latex: string): JSX.Element {
  const s = latex
    .replace(/\\mathrm\{([^}]+)\}/g, '$1')
    .replace(/\\mathbb\{([^}]+)\}/g, '$1');
  const m = s.match(/^([A-Za-z]+)_\{?(\w+)\}?$/);
  if (m) {
    return <span className="mexpr-sym">{m[1]}<sub>{m[2]}</sub></span>;
  }
  return <span>{s}</span>;
}

// Render Fira Code para representantes de coset: "e", "(1 2)", "(1 2 3)".
function renderCoset(latex: string): JSX.Element {
  // \  en LaTeX es un espacio
  return <span>{latex.replace(/\\\s/g, ' ').replace(/\\ /g, ' ')}</span>;
}

function renderExpr(latex: string): JSX.Element {
  // Normalizamos partes visuales antes del parser.
  const s = latex
    .replace(/\\left\(/g, '(')
    .replace(/\\right\)/g, ')')
    .replace(/\\left\[/g, '[')
    .replace(/\\right\]/g, ']')
    .replace(/\\cdot\s*/g, '·')
    .replace(/\\delta/g, 'δ')
    .replace(/\\pi(?![a-zA-Z])/g, 'π')
    .replace(/\\sqrt\{(\d+)\}/g, '√$1');

  const out: JSX.Element[] = [];
  let i = 0;
  let key = 0;
  while (i < s.length) {
    // \alpha con subíndice opcional y exponente opcional
    if (s.startsWith('\\alpha', i)) {
      i += 6;
      let sub: number | null = null;
      let sup: number | null = null;
      const sm = s.slice(i).match(/^_\{?(\d+)\}?/);
      if (sm) { sub = parseInt(sm[1], 10); i += sm[0].length; }
      const xm = s.slice(i).match(/^\^\{?(\d+)\}?/);
      if (xm) { sup = parseInt(xm[1], 10); i += xm[0].length; }
      out.push(
        <span key={key++} className="mexpr-sym">
          α
          {sub !== null && <sub className={`y${sub}`}>{sub}</sub>}
          {sup !== null && <sup>{sup}</sup>}
        </span>,
      );
      continue;
    }
    // y con subíndice/exponente: requiere _ o dígito a continuación
    if (s[i] === 'y' && (s[i + 1] === '_' || /[1-9]/.test(s[i + 1] ?? ''))) {
      i += 1;
      let sub: number | null = null;
      let sup: number | null = null;
      const sm = s.slice(i).match(/^_\{?(\d+)\}?/);
      if (sm) { sub = parseInt(sm[1], 10); i += sm[0].length; }
      const xm = s.slice(i).match(/^\^\{?(\d+)\}?/);
      if (xm) { sup = parseInt(xm[1], 10); i += xm[0].length; }
      out.push(
        <span key={key++} className="mexpr-sym">
          y
          {sub !== null && <sub>{sub}</sub>}
          {sup !== null && <sup>{sup}</sup>}
        </span>,
      );
      continue;
    }
    if (s[i] === '+' || s[i] === '-') {
      out.push(<span key={key++} className="mexpr-op"> {s[i]} </span>);
      i++;
      continue;
    }
    if (s[i] === ' ') { i++; continue; }
    out.push(<span key={key++}>{s[i]}</span>);
    i++;
  }
  return <>{out}</>;
}

// ---- Reticulo hardcodeado por grado ----
interface ReticuloNodo {
  nombre: string;
  display: string;
  x: number;
  y: number;
  orden: number;
}
interface ReticuloDef {
  nodos: ReticuloNodo[];
  aristas: [string, string][];
}
const RETICULOS: Record<number, ReticuloDef> = {
  3: {
    nodos: [
      { nombre: 'S_3', display: 'S₃', x: 120, y: 50,  orden: 6 },
      { nombre: 'A_3', display: 'A₃', x: 120, y: 150, orden: 3 },
    ],
    aristas: [['A_3', 'S_3']],
  },
  4: {
    nodos: [
      { nombre: 'S_4', display: 'S₄', x: 120, y: 36,  orden: 24 },
      { nombre: 'A_4', display: 'A₄', x: 60,  y: 100, orden: 12 },
      { nombre: 'D_4', display: 'D₄', x: 180, y: 100, orden: 8  },
      { nombre: 'V_4', display: 'V₄', x: 120, y: 170, orden: 4  },
      { nombre: 'C_4', display: 'C₄', x: 200, y: 210, orden: 4  },
    ],
    aristas: [
      ['A_4', 'S_4'], ['D_4', 'S_4'],
      ['V_4', 'A_4'], ['V_4', 'D_4'], ['C_4', 'D_4'],
    ],
  },
  5: {
    nodos: [
      { nombre: 'S_5',  display: 'S₅',  x: 120, y: 36,  orden: 120 },
      { nombre: 'A_5',  display: 'A₅',  x: 60,  y: 110, orden: 60  },
      { nombre: 'F_20', display: 'F₂₀', x: 180, y: 110, orden: 20  },
      { nombre: 'D_5',  display: 'D₅',  x: 180, y: 175, orden: 10  },
      { nombre: 'C_5',  display: 'C₅',  x: 180, y: 220, orden: 5   },
    ],
    aristas: [
      ['A_5', 'S_5'], ['F_20', 'S_5'],
      ['D_5', 'F_20'], ['C_5', 'D_5'],
    ],
  },
};

const MAXIMALES_DE: Record<string, string[]> = {
  S_3: ['A_3'], A_3: [],
  S_4: ['A_4', 'D_4'], A_4: ['V_4'], D_4: ['V_4', 'C_4'], V_4: [], C_4: [],
  S_5: ['A_5', 'F_20'], A_5: [], F_20: ['D_5'], D_5: ['C_5'], C_5: [],
};

const ORDENES: Record<string, number> = {
  S_3: 6, A_3: 3,
  S_4: 24, A_4: 12, D_4: 8, V_4: 4, C_4: 4,
  S_5: 120, A_5: 60, F_20: 20, D_5: 10, C_5: 5,
};

interface StepPos {
  nivelIdx: number;
  candIdx: number;
  cosetIdx: number;
}

function flattenSteps(data: StauduharResponse): StepPos[] {
  const out: StepPos[] = [];
  data.niveles.forEach((nv, ni) => {
    nv.candidatos.forEach((cd, ci) => {
      cd.cosets.forEach((_, coi) => {
        out.push({ nivelIdx: ni, candIdx: ci, cosetIdx: coi });
      });
    });
  });
  return out;
}

function buildQAcumuladaSinClase(cand: CandidatoProbado, hasta: number): string {
  // Version "limpia" sin la clase \htmlClass del ultimo factor: se
  // usa para el fantasma que reserva el ancho del Q(t) final.
  const trozos: string[] = [];
  for (let i = 0; i <= hasta; i++) {
    const v = cand.cosets[i].valor_numerico_latex;
    if (v === '0') trozos.push('t');
    else if (v.startsWith('-')) trozos.push(`(t + ${v.slice(1)})`);
    else trozos.push(`(t - ${v})`);
  }
  return `Q(t) = ${trozos.join('')}`;
}

function buildQDeAplicados(
  cand: CandidatoProbado,
  start: number,
  applied: Set<number>,
): string {
  // Solo incluye factores de cosets que el usuario ha aplicado de
  // verdad: arrastrar π_2 antes que π_1 NO debe pintar el factor
  // asociado a π_1.
  const trozos: string[] = [];
  for (let i = 0; i < cand.cosets.length; i++) {
    if (!applied.has(start + i)) continue;
    const v = cand.cosets[i].valor_numerico_latex;
    if (v === '0') trozos.push('t');
    else if (v.startsWith('-')) trozos.push(`(t + ${v.slice(1)})`);
    else trozos.push(`(t - ${v})`);
  }
  return `Q(t) = ${trozos.join('')}`;
}

function Reticulo({
  grado,
  caminoVisible,
  nodoActual,
  nodoCandidato,
  nodoFinal,
  descartados,
}: {
  grado: number;
  caminoVisible: Set<string>;
  nodoActual: string | null;
  nodoCandidato: string | null;
  nodoFinal: string | null;
  descartados: Set<string>;
}) {
  const ret = RETICULOS[grado];
  if (!ret) return null;
  return (
    <svg viewBox="0 0 240 240" width="100%" height="100%">
      {ret.aristas.map(([sub, sup]) => {
        const a = ret.nodos.find((n) => n.nombre === sub)!;
        const b = ret.nodos.find((n) => n.nombre === sup)!;
        // Resaltar arista del nivel actual al candidato en bermellón.
        const esAristaCandidato =
          (sub === nodoCandidato && sup === nodoActual) ||
          (sub === nodoActual && sup === nodoCandidato);
        const enCamino = caminoVisible.has(sub) && caminoVisible.has(sup);
        return (
          <line
            key={`${sub}-${sup}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={
              esAristaCandidato ? '#D55E00'
                : enCamino ? '#1a1a1a'
                : '#bbb'
            }
            strokeWidth={esAristaCandidato || enCamino ? 2 : 1}
            strokeDasharray={esAristaCandidato ? '4 3' : undefined}
          />
        );
      })}
      {ret.nodos.map((nodo) => {
        const enRuta = caminoVisible.has(nodo.nombre);
        const esActual = nodo.nombre === nodoActual;
        const esCandidato = nodo.nombre === nodoCandidato && !esActual;
        const esFinal = nodo.nombre === nodoFinal;
        const esDescartado = descartados.has(nodo.nombre);
        let fill = '#fff';
        let stroke = '#bbb';
        let strokeWidth = 1.5;
        let textFill = '#aaa';
        if (esFinal) {
          // Verde para el grupo final: convención del visor de monodromía.
          fill = '#009E73'; stroke = '#009E73'; strokeWidth = 2.5; textFill = '#fff';
        } else if (esDescartado) {
          // Descartado: rojo claro con X superpuesta.
          fill = '#fbeaea'; stroke = '#c0392b'; strokeWidth = 2; textFill = '#c0392b';
        } else if (esActual) {
          fill = '#e4e4e8'; stroke = '#1a1a1a'; strokeWidth = 2.5; textFill = '#1a1a1a';
        } else if (esCandidato) {
          fill = '#fff'; stroke = '#D55E00'; strokeWidth = 2.5; textFill = '#D55E00';
        } else if (enRuta) {
          fill = '#e4e4e8'; stroke = '#1a1a1a'; strokeWidth = 1.5; textFill = '#1a1a1a';
        }
        return (
          <g key={nodo.nombre}>
            <circle
              cx={nodo.x} cy={nodo.y}
              r={esActual || esCandidato ? 19 : 16}
              fill={fill} stroke={stroke} strokeWidth={strokeWidth}
            />
            <text
              x={nodo.x} y={nodo.y + 5}
              textAnchor="middle"
              fontSize="13" fontFamily="Fira Code, monospace"
              fill={textFill}
              style={esDescartado ? { textDecoration: 'line-through' } : undefined}
            >
              {nodo.display}
            </text>
            {esDescartado && (
              // X superpuesta en bermellón oscuro (rojo)
              <g>
                <line
                  x1={nodo.x - 22} y1={nodo.y - 22}
                  x2={nodo.x + 22} y2={nodo.y + 22}
                  stroke="#c0392b" strokeWidth={2.5} strokeLinecap="round"
                />
                <line
                  x1={nodo.x + 22} y1={nodo.y - 22}
                  x2={nodo.x - 22} y2={nodo.y + 22}
                  stroke="#c0392b" strokeWidth={2.5} strokeLinecap="round"
                />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// Pill con hover que muestra el resumen abstracto del grupo
// (abeliano, resoluble, etc.). Misma información y estilo que la
// pill "Estructura" del visor de monodromía (StatsPills).
function PillGrupo(props: {
  label: string;
  nombre: string;
  orden: number;
  grado: number;
  info: GrupoInfo | null;
  completo?: boolean;
}) {
  const { label, nombre, orden, grado, info, completo } = props;
  const [showInfo, setShowInfo] = useState(false);
  const bool = (b: boolean | null | undefined): string =>
    b === true ? 'sí' : b === false ? 'no' : '—';
  const centro = (n: number | null | undefined): string =>
    n == null ? '—' : n === 1 ? 'trivial' : String(n);
  const factores = (fs: string[] | undefined): string =>
    !fs || fs.length === 0 ? '—' : [...fs].reverse().join(' · ');
  return (
    <span
      className={
        'pill pill-grupo' +
        (label === 'Nivel' ? ' pill-nivel' : '') +
        (completo ? ' completo' : '')
      }
      onMouseEnter={() => setShowInfo(true)}
      onMouseLeave={() => setShowInfo(false)}
    >
      <span className="lbl">{label}</span>
      <span className="val">{renderGroupName(nombre)}</span>
      {showInfo && info && (
        <div className="pill-tooltip">
          <dl>
            {info.tid != null && (
              <>
                <dt>T-number</dt>
                <dd>{grado}T{info.tid}</dd>
              </>
            )}
            <dt>Orden</dt>
            <dd>{orden}</dd>
            <dt>Abeliano</dt>
            <dd>{bool(info.is_abelian)}</dd>
            <dt>Resoluble</dt>
            <dd>{bool(info.is_solvable)}</dd>
            <dt>Nilpotente</dt>
            <dd>{bool(info.is_nilpotent)}</dd>
            <dt>Simple</dt>
            <dd>{bool(info.is_simple)}</dd>
            <dt>Perfecto</dt>
            <dd>{bool(info.is_perfect)}</dd>
            <dt>Transitivo</dt>
            <dd>{bool(info.is_transitive)}</dd>
            {info.is_primitive != null && (
              <>
                <dt>Primitivo</dt>
                <dd>{bool(info.is_primitive)}</dd>
              </>
            )}
            <dt>Centro</dt>
            <dd>{centro(info.center_order)}</dd>
            {info.composition_factors && info.composition_factors.length > 0 && (
              <>
                <dt>Factores</dt>
                <dd>{factores(info.composition_factors)}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </span>
  );
}

export function StauduharPage({ onBack }: Props) {
  const [polinomio, setPolinomio] = useState('x^4 - 2');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [polyError, setPolyError] = useState<string | null>(null);
  const [data, setData] = useState<StauduharResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // true desde el primer render: el `useEffect` de montaje lanza
  // `calcular` inmediatamente, así que no queremos pestañear el
  // panel "vacío" antes de que se vea el spinner.
  const [loading, setLoading] = useState(true);
  const [stepIdx, setStepIdx] = useState(0);
  const [hasUserAction, setHasUserAction] = useState(false);
  // Set de stepIdx que el usuario ha aplicado. Un candidato se
  // considera "completado" solo cuando TODOS sus cosets están aquí
  // (es decir, su resolvente entera se ha construido).
  const [appliedSteps, setAppliedSteps] = useState<Set<number>>(new Set());
  // Historial de snapshots para Ctrl+Z. Cada acción del usuario
  // (drag, click en candidato) hace push del estado anterior.
  const [historial, setHistorial] = useState<
    { stepIdx: number; appliedSteps: Set<number>; hasUserAction: boolean }[]
  >([]);
  const [showFTooltip, setShowFTooltip] = useState(false);
  const [showInvActTooltip, setShowInvActTooltip] = useState(false);
  const [invTooltipPos, setInvTooltipPos] = useState({ top: 0, left: 0, width: 0 });
  const invWrapperRef = useRef<HTMLDivElement>(null);
  // Posiciones (0-indexadas por orden de aparición de \alpha_{N} en
  // el conjugado) que cambiaron de la última aplicación a la nueva.
  // null = no animar (no había diff o no hay aplicación pendiente).
  const [animDiff, setAnimDiff] = useState<Set<number> | null>(null);
  // Mostrar el banner de conclusión solo tras la animación de
  // permutación (no antes), para que no aparezca el hueco vacío
  // empujando Q(t) hacia arriba.
  const [mostrarBanner, setMostrarBanner] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const grado = useMemo(() => deducirGrado(polinomio), [polinomio]);

  const calcular = useCallback(
    async (expr: string) => {
      const g = deducirGrado(expr);
      setLoading(true);
      setError(null);
      try {
        const r = await postStauduhar(expr, g);
        setData(r);
        setStepIdx(0);
        setHasUserAction(false);
        setAppliedSteps(new Set());
        setHistorial([]);
        setAnimDiff(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido');
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Carga automatica al montar.
  useEffect(() => {
    calcular(polinomio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function aplicar(expr: string) {
    setPolinomio(expr);
    setEditing(false);
    setPolyError(null);
    calcular(expr);
  }

  function commitEdit() {
    setEditing(false);
    setPolyError(null);
    if (draft && draft !== polinomio) {
      setPolinomio(draft);
      calcular(draft);
    }
  }

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const steps = useMemo(() => (data ? flattenSteps(data) : []), [data]);
  const totalSteps = steps.length;
  const pos = steps[stepIdx] ?? null;
  const nivelActual = pos ? data!.niveles[pos.nivelIdx] : null;
  const candActual = nivelActual ? nivelActual.candidatos[pos!.candIdx] : null;
  const cosetActual = candActual ? candActual.cosets[pos!.cosetIdx] : null;

  // Camino visible en el reticulo: solo los niveles ya cerrados,
  // sin el `descender_a` del nivel actual (que aparece como
  // "candidato" con otro color, no como ruta consolidada).
  const caminoVisible = useMemo(() => {
    const s = new Set<string>();
    if (!data || !pos) return s;
    for (let i = 0; i < pos.nivelIdx; i++) {
      s.add(data.niveles[i].grupo_actual_latex);
      if (data.niveles[i].descender_a) {
        s.add(data.niveles[i].descender_a!);
      }
    }
    s.add(data.niveles[pos.nivelIdx].grupo_actual_latex);
    return s;
  }, [data, pos]);

  const nodoActual = nivelActual?.grupo_actual_latex ?? null;
  const nodoCandidato = candActual?.subgrupo_latex ?? null;

  // Grupo final alcanzado: en el último nivel del descenso, sin
  // descenso pendiente, con todos los candidatos completados (todas
  // las resolventes construidas y descartadas).
  const grupoFinalAlcanzado = useMemo(() => {
    if (!data || !pos) return null;
    const nivel = data.niveles[pos.nivelIdx];
    if (nivel.descender_a !== null) return null;
    const todosCompletados = nivel.candidatos.length === 0
      || nivel.candidatos.every((_, ci) => candidatoCompletado(pos.nivelIdx, ci));
    return todosCompletados ? nivel.grupo_actual_latex : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pos, appliedSteps]);


  // El candidato actual concluye el descenso aun cuando su nivel
  // siguiente exista, si éste no tiene candidatos (la tabla de
  // descensos hardcodeados no cubre más allá). En ese caso el
  // grupo de Galois es `candActual.descender_a` y no hay "siguiente
  // nivel" al que avanzar sin romper el index de steps.
  const descensoTerminado = useMemo(() => {
    if (!data || !pos || !candActual) return false;
    if (!candidatoCompletado(pos.nivelIdx, pos.candIdx)) return false;
    if (candActual.descender_a === null) return false;
    const prox = data.niveles[pos.nivelIdx + 1];
    return prox != null && prox.candidatos.length === 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pos, candActual, appliedSteps]);

  // Nombre, orden e info del grupo que se muestra en la pill "Nivel".
  // Siempre el del nivel actual: cuando el catálogo se queda corto
  // sin haber confirmado el grupo de Galois, no debemos pintar en
  // verde como si lo hubiéramos identificado.
  const nivelPillNombre = nivelActual?.grupo_actual_latex ?? '';
  const nivelPillOrden = nivelActual?.grupo_actual_orden ?? 0;
  const nivelPillInfo = nivelActual?.grupo_actual_info ?? null;

  // El nodo verde del retículo solo aparece cuando el descenso ha
  // concluido legítimamente (todos los maximales del nivel actual
  // probados). Si el catálogo se ha quedado corto, lo dejamos sin
  // marcar para no sugerir una conclusión que no se ha alcanzado.
  const nodoFinal = grupoFinalAlcanzado;

  // Candidatos descartados: completados (resolvente entera construida)
  // cuyo descender_a es null. Solo se cuentan en el nivel actual.
  const descartados = useMemo(() => {
    const s = new Set<string>();
    if (!data || !pos) return s;
    const nivel = data.niveles[pos.nivelIdx];
    nivel.candidatos.forEach((cand, ci) => {
      if (cand.descender_a === null && candidatoCompletado(pos.nivelIdx, ci)) {
        s.add(cand.subgrupo_latex);
      }
    });
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pos, appliedSteps]);

  function marcarAplicado(idx: number) {
    setAppliedSteps((prev) => {
      if (prev.has(idx)) return prev;
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  }

  function pushHistorial() {
    setHistorial((h) => [
      ...h,
      { stepIdx, appliedSteps: new Set(appliedSteps), hasUserAction },
    ]);
  }

  const deshacer = useCallback(() => {
    if (historial.length === 0) return;
    const last = historial[historial.length - 1];
    setStepIdx(last.stepIdx);
    setAppliedSteps(new Set(last.appliedSteps));
    setHasUserAction(last.hasUserAction);
    setHistorial(historial.slice(0, -1));
    setAnimDiff(null);
  }, [historial]);

  // Decide cuándo mostrar el banner de conclusión: solo cuando el
  // candidato actual está completado, esperando ~900 ms si venimos
  // de una animación de permutación.
  useEffect(() => {
    if (!data || !pos) { setMostrarBanner(false); return; }
    const completado = candidatoCompletado(pos.nivelIdx, pos.candIdx);
    if (!completado) { setMostrarBanner(false); return; }
    if (animDiff && animDiff.size > 0) {
      setMostrarBanner(false);
      const id = window.setTimeout(() => setMostrarBanner(true), 900);
      return () => window.clearTimeout(id);
    }
    setMostrarBanner(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, appliedSteps, animDiff]);

  // Atajo Ctrl+Z / Cmd+Z para deshacer la ultima accion.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        const tgt = e.target as HTMLElement;
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        deshacer();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [deshacer]);

  const maximalesNivel = useMemo(() => {
    if (!nivelActual || !pos) return [];
    const probados = new Map(
      nivelActual.candidatos.map((c) => [c.subgrupo_latex, c]),
    );
    return (MAXIMALES_DE[nivelActual.grupo_actual_latex] ?? []).map((nombre) => {
      const cand = probados.get(nombre);
      let estado: 'pendiente' | 'actual' | 'completado' = 'pendiente';
      let idxEnNivel = -1;
      if (cand) {
        idxEnNivel = nivelActual.candidatos.findIndex(
          (c) => c.subgrupo_latex === nombre,
        );
        if (candidatoCompletado(pos.nivelIdx, idxEnNivel)) {
          estado = 'completado';
        } else if (idxEnNivel === pos.candIdx) {
          estado = 'actual';
        } else {
          estado = 'pendiente';
        }
      }
      return { nombre, orden: ORDENES[nombre], estado, idxEnNivel };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nivelActual, pos, appliedSteps]);

  // Calcula el stepIdx global del primer coset del candidato (ni, ci).
  function stepIdxDePrimerCosetDe(ni: number, ci: number): number {
    if (!data) return 0;
    let acc = 0;
    for (let i = 0; i < ni; i++) {
      for (const c of data.niveles[i].candidatos) {
        acc += c.cosets.length;
      }
    }
    for (let j = 0; j < ci; j++) {
      acc += data.niveles[ni].candidatos[j].cosets.length;
    }
    return acc;
  }

  // Un candidato esta completado si TODOS sus cosets estan aplicados.
  function candidatoCompletado(ni: number, ci: number): boolean {
    if (!data) return false;
    const start = stepIdxDePrimerCosetDe(ni, ci);
    const len = data.niveles[ni].candidatos[ci].cosets.length;
    for (let k = 0; k < len; k++) {
      if (!appliedSteps.has(start + k)) return false;
    }
    return true;
  }

  // Salta al primer coset del candidato `candIdxObjetivo` del nivel
  // actual. Es solo navegacion: no marca nada como aplicado. El usuario
  // tendra que arrastrar la permutacion para "aplicarla".
  function irACandidato(candIdxObjetivo: number) {
    if (!data || !pos || candIdxObjetivo < 0) return;
    const target = stepIdxDePrimerCosetDe(pos.nivelIdx, candIdxObjetivo);
    pushHistorial();
    setAnimDiff(null);
    setHasUserAction(true);
    setStepIdx(target);
  }

  // Salta al primer coset del primer candidato del nivel `niObjetivo`.
  function irANivel(niObjetivo: number) {
    if (!data || niObjetivo < 0 || niObjetivo >= data.niveles.length) return;
    // Si el nivel destino no tiene cosets, no podemos posicionar
    // stepIdx en él (steps[stepIdx] sería null y el render explota).
    // Lo manejamos con `descensoTerminado` derivado en el banner.
    const dst = data.niveles[niObjetivo];
    if (dst.candidatos.every((c) => c.cosets.length === 0)) return;
    let acc = 0;
    for (let i = 0; i < niObjetivo; i++) {
      for (const c of data.niveles[i].candidatos) {
        acc += c.cosets.length;
      }
    }
    pushHistorial();
    setAnimDiff(null);
    setHasUserAction(true);
    setStepIdx(acc);
  }

  const startCandActual = pos
    ? stepIdxDePrimerCosetDe(pos.nivelIdx, pos.candIdx)
    : 0;
  const QAcumulada = candActual && pos
    ? buildQDeAplicados(candActual, startCandActual, appliedSteps)
    : null;

  return (
    <div className="stauduhar-app">
      {/* ===== Header (clon del Header de monodromia) ===== */}
      <header className="header">
        <button className="btn-back" onClick={onBack}>← Inicio</button>
        <h1>Visualizador del descenso de Stauduhar</h1>
        {editing ? (
          <div className="poly-edit">
            <span>f(x) =</span>
            <input
              ref={inputRef}
              className={'poly-input' + (polyError ? ' poly-input-error' : '')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={commitEdit}
              spellCheck={false}
            />
          </div>
        ) : (
          <span
            className="poly poly-editable"
            title="Click para cambiar el polinomio"
            onClick={() => {
              setDraft(polinomio);
              setEditing(true);
            }}
          >
            f(x) = {prettyPoly(polinomio)}
          </span>
        )}
      </header>

      {/* ===== Main 3 columnas ===== */}
      <div className="stauduhar-main">

        {/* --- Col 1: maximales del nivel actual --- */}
        <aside className="panel">
          {nivelActual && (
            <>
              <div className="field-label">
                Maximales transitivos en{' '}
                {renderGroupName(nivelActual.grupo_actual_latex)}
              </div>
              <div className="maximales">
                {maximalesNivel.length === 0 && (
                  <div className="max-empty">— sin maximales transitivos —</div>
                )}
                {maximalesNivel.map((m) => {
                  // Completados (resolvente entera construida) no se
                  // pueden volver a seleccionar; el resto sí.
                  const clicable =
                    m.idxEnNivel >= 0 &&
                    m.estado !== 'actual' &&
                    m.estado !== 'completado';
                  return (
                    <div
                      key={m.nombre}
                      className={
                        'max-item' +
                        (m.estado === 'actual' ? ' actual' : '') +
                        (m.estado === 'completado' ? ' done' : '') +
                        (clicable ? ' clickable' : '')
                      }
                      onClick={() => {
                        if (clicable) irACandidato(m.idxEnNivel);
                      }}
                      title={clicable ? 'Click para volver a este candidato' : undefined}
                    >
                      <div className="head">
                        <span className="name">
                          {renderGroupName(m.nombre)}
                        </span>
                        <span className="order">|G| = {m.orden}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </aside>

        {/* --- Col 2: viewport central --- */}
        <section className="col-viewport panel">
          {error && <div className="stauduhar-error">{error}</div>}
          {loading && (
            <div className="stauduhar-loading">
              <div className="loading-spinner" />
              <p>Calculando descenso de Stauduhar…</p>
            </div>
          )}
          {!data && !error && !loading && (
            <div className="stauduhar-vacio">
              <p>Selecciona un polinomio canónico o introduce uno propio.</p>
              <div className="stauduhar-vacio-sugerencias">
                {SUGERENCIAS.map((s) => (
                  <button
                    key={s.label}
                    className="btn-sugerencia"
                    onClick={() => aplicar(s.expr)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {data && pos && candActual && cosetActual && nivelActual && (
            <>
              {/* Pills overlay — F truncado si la formula es muy larga */}
              <div className="viewport-overlay">
                {(() => {
                  const tex = candActual.invariante_y_latex;
                  const tooLong = tex.length > 60;
                  // Truncado "elegante": cortamos por el último +, − o
                  // ) anterior al límite para no partir un átomo a la mitad.
                  const truncado = (() => {
                    if (!tooLong) return tex;
                    const lim = 58;
                    for (let i = Math.min(lim, tex.length - 1); i > 20; i--) {
                      if ('+-)'.includes(tex[i])) return tex.slice(0, i + 1);
                    }
                    return tex.slice(0, lim);
                  })();
                  return (
                    <span
                      className={'pill pill-F' + (tooLong ? ' truncated' : '')}
                      onMouseEnter={() => tooLong && setShowFTooltip(true)}
                      onMouseLeave={() => setShowFTooltip(false)}
                    >
                      <span className="lbl">F</span>
                      <span className="val">
                        {renderExpr(truncado)}
                        {tooLong && <span className="ellipsis">…</span>}
                      </span>
                      {tooLong && showFTooltip && (
                        <div className="F-tooltip">
                          F = {renderExpr(tex)}
                        </div>
                      )}
                    </span>
                  );
                })()}
                <div className="stat-pills">
                  <PillGrupo
                    label="Nivel"
                    nombre={nivelPillNombre}
                    orden={nivelPillOrden}
                    grado={data!.grado}
                    info={nivelPillInfo}
                    completo={!!grupoFinalAlcanzado}
                  />
                  <PillGrupo
                    label="Candidato"
                    nombre={candActual.subgrupo_latex}
                    orden={candActual.subgrupo_orden}
                    grado={data!.grado}
                    info={candActual.subgrupo_info ?? null}
                  />
                </div>
              </div>

              {/* Escenario central — droppable. */}
              <div
                className="escenario"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add('drop-hover');
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove('drop-hover');
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('drop-hover');
                  const targetIdx = parseInt(
                    e.dataTransfer.getData('text/plain'), 10,
                  );
                  if (!isNaN(targetIdx) && pos && candActual && cosetActual) {
                    pushHistorial();
                    // Diff entre el conjugado que se está mostrando
                    // (cosetActual) y el del nuevo representante (target).
                    // En pre-state cosetActual es cosets[0] = identidad, así
                    // que arrastrar e sobre 0 aplicadas da diff vacío.
                    const oldLatex = cosetActual.conjugado_alpha_latex;
                    const newLatex =
                      candActual.cosets[targetIdx].conjugado_alpha_latex;
                    const diff = diffPosicionesAlpha(oldLatex, newLatex);
                    setAnimDiff(diff.size > 0 ? diff : null);
                    setHasUserAction(true);
                    const newStepIdx = Math.max(
                      0,
                      Math.min(totalSteps - 1, stepIdx - pos.cosetIdx + targetIdx),
                    );
                    setStepIdx(newStepIdx);
                    marcarAplicado(newStepIdx);
                  }
                }}
              >
                {!appliedSteps.has(stepIdx) ? (() => {
                  // Pre-aplicación: el conjugado en α del primer
                  // representante (la identidad, π₁ = e) y Q(t) con
                  // el placeholder gris.
                  const cosetIni = candActual.cosets[0];
                  const conjugadoMasLargo = candActual.cosets.reduce(
                    (best, c) => c.conjugado_alpha_latex.length > best.length
                      ? c.conjugado_alpha_latex : best,
                    '',
                  );
                  const valorMasLargo = candActual.cosets.reduce(
                    (best, c) => c.valor_numerico_latex.length > best.length
                      ? c.valor_numerico_latex : best,
                    '',
                  );
                  const QCompleto = buildQAcumuladaSinClase(
                    candActual, candActual.cosets.length - 1,
                  );
                  const len = cosetIni.conjugado_alpha_latex.length;
                  let fs = 30;
                  if (len > 30) fs = 26;
                  if (len > 60) fs = 22;
                  if (len > 100) fs = 18;
                  if (len > 160) fs = 15;
                  if (len > 220) fs = 13;
                  if (len > 300) fs = 12;
                  // A partir de cierto largo no cabe el conjugado y
                  // el "= valor" en una sola línea: apilamos en dos.
                  const vertical = len > 240;
                  const fsStyle = { fontSize: fs + 'px' };
                  const evalCls = 'alpha-eval' + (vertical ? ' vertical' : '');
                  return (
                    <>
                      <div className="alpha-wrapper">
                        <div className={evalCls + ' ghost'} style={fsStyle}>
                          <Tex tex={preColoreLatex(conjugadoMasLargo)} />
                          <span className="alpha-eval-rhs">
                            <span>&nbsp;=&nbsp;</span>
                            <span className="swap-token centered">
                              <Tex tex={preColoreLatex(valorMasLargo)} />
                            </span>
                          </span>
                        </div>
                        <div className={evalCls + ' real'} style={fsStyle}>
                          <Tex tex={preColoreLatex(cosetIni.conjugado_alpha_latex)} />
                          <span className="alpha-eval-rhs">
                            <span>&nbsp;=&nbsp;</span>
                          </span>
                        </div>
                      </div>
                      <div className="q-wrapper">
                        <div className="Q-line ghost">
                          <Tex tex={QCompleto} />
                        </div>
                        <div className="Q-line real" style={{ color: '#aaa' }}>
                          <Tex tex="Q(t) = " />
                        </div>
                      </div>
                      <div className="ayuda-inicial">
                        Arrastra los representantes π<sub>i</sub> del panel derecho
                        sobre el invariante F para construir la resolvente Q(t).
                      </div>
                    </>
                  );
                })() : (() => {
                  // Calcular el conjugado y el valor "más largos" del
                  // candidato para dimensionar los fantasmas que centran
                  // los wrappers en su ancho final.
                  const conjugadoMasLargo = candActual.cosets.reduce(
                    (best, c) => c.conjugado_alpha_latex.length > best.length
                      ? c.conjugado_alpha_latex : best,
                    '',
                  );
                  const valorMasLargo = candActual.cosets.reduce(
                    (best, c) => c.valor_numerico_latex.length > best.length
                      ? c.valor_numerico_latex : best,
                    '',
                  );
                  const QCompleto = buildQAcumuladaSinClase(
                    candActual, candActual.cosets.length - 1,
                  );
                  const len = cosetActual.conjugado_alpha_latex.length;
                  let fs = 30;
                  if (len > 30) fs = 26;
                  if (len > 60) fs = 22;
                  if (len > 100) fs = 18;
                  if (len > 160) fs = 15;
                  if (len > 220) fs = 13;
                  if (len > 300) fs = 12;
                  const vertical = len > 240;
                  const fsStyle = { fontSize: fs + 'px' };
                  const evalCls = 'alpha-eval' + (vertical ? ' vertical' : '');
                  return (
                  <>
                    <div className="alpha-wrapper">
                      <div className={evalCls + ' ghost'} style={fsStyle}>
                        <Tex tex={preColoreLatex(conjugadoMasLargo)} />
                        <span className="alpha-eval-rhs">
                          <span>&nbsp;=&nbsp;</span>
                          <span className="swap-token centered">
                            <Tex tex={preColoreLatex(valorMasLargo)} />
                          </span>
                        </span>
                      </div>
                      <div
                        key={animDiff ? `a-${stepIdx}` : 'a-stable'}
                        className={evalCls + ' real' + (animDiff ? ' aplicada' : '')}
                        style={fsStyle}
                      >
                        <Tex
                          tex={preColoreLatex(
                            cosetActual.conjugado_alpha_latex,
                            animDiff ?? undefined,
                          )}
                        />
                        <span className="alpha-eval-rhs">
                          <span>&nbsp;=&nbsp;</span>
                          <span className="swap-token centered">
                            <Tex tex={preColoreLatex(cosetActual.valor_numerico_latex)} />
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="q-wrapper">
                      <div className="Q-line ghost">
                        <Tex tex={QCompleto} />
                      </div>
                      <div className="Q-line real">
                        <Tex tex={QAcumulada ?? 'Q(t) = '} />
                      </div>
                    </div>
                    {mostrarBanner && (() => {
                      const completado = candidatoCompletado(pos.nivelIdx, pos.candIdx);
                      if (!completado) return null;
                      // ÉXITO: descender_a no null → hay raíz entera simple.
                      if (candActual.descender_a !== null) {
                        const cidx = candActual.coset_descenso_idx;
                        const valor = cidx !== null
                          ? candActual.cosets[cidx].valor_numerico_latex
                          : '?';
                        const esUltimoNivel = pos.nivelIdx >= data!.niveles.length - 1;
                        const cosetRepr = cidx !== null
                          ? candActual.cosets[cidx].representante_latex
                          : 'e';
                        return (
                          <div className="exito-banner">
                            <p>
                              <strong>✓ Resolvente construida.</strong>{' '}
                              <Tex tex={`Q(t)`} /> tiene la raíz racional simple{' '}
                              <Tex tex={preColoreLatex(valor)} />, aportada por{' '}
                              <Tex tex={`\\pi_{${(cidx ?? 0) + 1}} = ${cosetRepr}`} />.
                              Luego{' '}
                              <Tex tex={`\\mathrm{Gal}(f) \\subseteq ${texGrupo(candActual.descender_a)}`} />.
                            </p>
                            {descensoTerminado ? (
                              <p style={{ marginTop: 8 }}>
                                El catálogo no incluye resolventes para
                                descender desde{' '}
                                <Tex tex={texGrupo(candActual.descender_a!)} />, así
                                que el descenso no puede continuar.
                                El grupo de Galois podría ser{' '}
                                <Tex tex={texGrupo(candActual.descender_a!)} /> o
                                cualquier subgrupo transitivo contenido en él.
                              </p>
                            ) : !esUltimoNivel ? (
                              <button
                                className="btn"
                                onClick={() => irANivel(pos.nivelIdx + 1)}
                              >
                                Pasar al siguiente nivel →
                              </button>
                            ) : (
                              <p style={{ marginTop: 8 }}>
                                Es el último nivel del descenso.
                              </p>
                            )}
                          </div>
                        );
                      }
                      // FRACASO: descender_a null → no hay raíz simple.
                      const tieneEnterasMult = candActual.raices_enteras_simples.length > 0;
                      const hayMasCandidatos =
                        pos.candIdx + 1 < nivelActual.candidatos.length;
                      return (
                        <div className="fracaso-banner">
                          {!tieneEnterasMult ? (
                            <p>
                              <strong>✗ Resolvente sin raíces enteras.</strong>{' '}
                              <Tex tex="Q(t)" /> no tiene ninguna raíz en{' '}
                              <Tex tex="\mathbb{Z}" />, luego{' '}
                              <Tex tex={`\\mathrm{Gal}(f) \\not\\subseteq ${texGrupo(candActual.subgrupo_latex)}`} />.
                              Descartamos el candidato.
                            </p>
                          ) : (
                            <p>
                              <strong>⚠ Raíces enteras con multiplicidad &gt; 1.</strong>{' '}
                              <Tex tex="Q(t)" /> tiene las raíces enteras{' '}
                              <Tex tex={candActual.raices_enteras_simples.join(', ')} />,
                              pero todas son repetidas. El Teorema&nbsp;5 no aplica
                              directamente; en el algoritmo original se aplicaría una
                              transformación de Tschirnhausen sobre{' '}
                              <Tex tex="f(x)" />. Descartamos el candidato.
                            </p>
                          )}
                          {hayMasCandidatos ? (
                            <button
                              className="btn"
                              onClick={() => irACandidato(pos.candIdx + 1)}
                            >
                              Probar siguiente candidato →
                            </button>
                          ) : (
                            <p style={{ marginTop: 8 }}>
                              No quedan más candidatos en este nivel.{' '}
                              <Tex tex={`\\mathrm{Gal}(f) = ${texGrupo(nivelActual.grupo_actual_latex)}`} />.
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </>
                  );
                })()}
              </div>

              {/* Controles inferiores: solo deshacer y reset. */}
              <div className="controles">
                <div className="step-counter">
                  Aplicados <strong>{appliedSteps.size}</strong> / {totalSteps}
                </div>
                <button
                  className="btn"
                  onClick={deshacer}
                  disabled={historial.length === 0}
                  title="Deshacer (Ctrl+Z)"
                >
                  ↶ Deshacer
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    if (historial.length === 0) return;
                    pushHistorial();
                    setStepIdx(0);
                    setAppliedSteps(new Set());
                    setHasUserAction(false);
                  }}
                  disabled={appliedSteps.size === 0}
                  title="Reiniciar todo"
                >
                  ↻ Reiniciar
                </button>
              </div>
            </>
          )}
        </section>

        {/* --- Col 3 --- */}
        <aside className="panel col-group">
          {candActual && (
            <div className="field">
              <div className="field-label">Invariante actual</div>
              {(() => {
                const tex = candActual.invariante_y_latex;
                const tooLong = tex.length > 60;
                const truncado = (() => {
                  if (!tooLong) return tex;
                  const lim = 56;
                  for (let i = Math.min(lim, tex.length - 1); i > 14; i--) {
                    if ('+-)'.includes(tex[i])) return tex.slice(0, i + 1);
                  }
                  return tex.slice(0, lim);
                })();
                return (
                  <div className="invariante-wrapper" ref={invWrapperRef}>
                    <div
                      className={'invariante-actual' + (tooLong ? ' truncated' : '')}
                      onMouseEnter={() => {
                        if (!tooLong || !invWrapperRef.current) return;
                        const r = invWrapperRef.current.getBoundingClientRect();
                        setInvTooltipPos({
                          top: r.bottom + 6,
                          left: r.left,
                          width: r.width,
                        });
                        setShowInvActTooltip(true);
                      }}
                      onMouseLeave={() => setShowInvActTooltip(false)}
                    >
                      <span className="inv-formula">
                        F = {renderExpr(truncado)}
                        {tooLong && <span className="ellipsis">…</span>}
                      </span>
                    </div>
                    {tooLong && showInvActTooltip && createPortal(
                      <div
                        className="invariante-tooltip"
                        style={{
                          position: 'fixed',
                          top: invTooltipPos.top,
                          left: invTooltipPos.left,
                          width: invTooltipPos.width,
                        }}
                      >
                        F = {renderExpr(tex)}
                      </div>,
                      document.body,
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {candActual && pos && (() => {
            // Cuántos cosets del candidato actual han sido aplicados.
            const start = stepIdxDePrimerCosetDe(pos.nivelIdx, pos.candIdx);
            let aplicadasCnt = 0;
            for (let i = 0; i < candActual.cosets.length; i++) {
              if (appliedSteps.has(start + i)) aplicadasCnt++;
            }
            return (
            <div className="field">
              <div className="field-label">Clases laterales derechas</div>
              <div className="field-value mono">
                {aplicadasCnt} de {candActual.cosets.length} aplicadas
              </div>
              <div className="cosets" style={{ marginTop: 8 }}>
                {candActual.cosets.map((c, idx) => {
                  // Aplicada si su stepIdx global esta en appliedSteps.
                  const stepIdxCoset =
                    stepIdxDePrimerCosetDe(pos.nivelIdx, pos.candIdx) + idx;
                  const aplicada = appliedSteps.has(stepIdxCoset);
                  const arrastrable = !aplicada;
                  return (
                    <div
                      key={idx}
                      className={'coset-row' + (aplicada ? ' done' : '')}
                      draggable={arrastrable}
                      onDragStart={(e) => {
                        if (!arrastrable) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.setData('text/plain', String(idx));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      title={arrastrable ? 'Arrástrame al centro' : ''}
                    >
                      <span className="idx">π<sub>{idx + 1}</sub></span>
                      <span className="repr">
                        {renderCoset(c.representante_latex)}
                      </span>
                      <span className="tag">{aplicada ? 'aplicada' : '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })()}

          <div className="field" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="field-label">Retículo</div>
            <div className="lattice-view">
              <Reticulo
                grado={grado}
                caminoVisible={caminoVisible}
                nodoActual={nodoActual}
                nodoCandidato={nodoCandidato}
                nodoFinal={nodoFinal}
                descartados={descartados}
              />
            </div>
          </div>
        </aside>

      </div>
    </div>
  );
}
