// Retículo de subgrupos: vista SVG interactiva con zoom y pan.
//
// Cada nodo es una clase de conjugación de subgrupos del grupo actual.
// El retículo se dibuja en horizontal: el subgrupo trivial queda a la
// izquierda y el grupo completo a la derecha, con los niveles de orden
// avanzando de izquierda a derecha. Esta orientación encaja mejor con
// los paneles anchos y poco altos. Una arista entre dos nodos indica
// que el de menor orden es subgrupo maximal del de mayor orden.
//
// El layout usa coordenadas "naturales" con espaciado mínimo fijo
// para que los nodos nunca se apilen. Al montar (y cuando cambia la
// estructura del retículo) se calcula automáticamente un zoom y pan
// que encuadran toda la vista en el container, con un poco de margen.
// La rueda hace zoom centrado en la posición del cursor; arrastrar
// hace pan; doble-click vuelve al auto-fit.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lattice, LatticeNodo } from '../api/client';

interface Props {
  lattice: Lattice;
}

const SUB_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

function formatEstructura(s: string): string {
  if (s === '1' || s === 'trivial') return '1';
  let out = s.replace(/C_(\d+)/g, (_, d) => 'ℤ_' + d);
  out = out.replace(/_(\d+)/g, (_, d: string) =>
    d.split('').map((c) => SUB_DIGITS[parseInt(c, 10)]).join(''),
  );
  return out.replace(/ x /g, ' × ').replace(/ : /g, ' ⋊ ');
}

interface Pos {
  x: number;
  y: number;
}
interface Layout {
  positions: Map<number, Pos>;
  bboxW: number;
  bboxH: number;
}

// Espaciado mínimo entre nodos en coordenadas "naturales".
const MIN_LEVEL_GAP = 56;
const MIN_NODE_GAP = 60;

function computarLayout(nodos: LatticeNodo[]): Layout {
  const positions = new Map<number, Pos>();
  if (nodos.length === 0) return { positions, bboxW: 0, bboxH: 0 };

  const porOrden = new Map<number, LatticeNodo[]>();
  for (const n of nodos) {
    const arr = porOrden.get(n.orden) ?? [];
    arr.push(n);
    porOrden.set(n.orden, arr);
  }
  const ordenes = [...porOrden.keys()].sort((a, b) => a - b);
  const niveles = ordenes.length;

  // Altura del nivel más poblado: marca la altura total de la bbox.
  let maxFila = 1;
  for (const o of ordenes) {
    const f = porOrden.get(o)!.length;
    if (f > maxFila) maxFila = f;
  }
  const bboxW = (niveles - 1) * MIN_LEVEL_GAP;
  const bboxH = (maxFila - 1) * MIN_NODE_GAP;

  for (let i = 0; i < niveles; i++) {
    const orden = ordenes[i];
    const fila = porOrden.get(orden)!;
    const num = fila.length;
    const x = i * MIN_LEVEL_GAP; // orden creciente hacia la derecha
    const filaH = (num - 1) * MIN_NODE_GAP;
    const startY = (bboxH - filaH) / 2;
    for (let j = 0; j < num; j++) {
      positions.set(fila[j].id, {
        x,
        y: num > 1 ? startY + j * MIN_NODE_GAP : bboxH / 2,
      });
    }
  }
  return { positions, bboxW, bboxH };
}

function computarAutoFit(
  bboxW: number,
  bboxH: number,
  containerW: number,
  containerH: number,
): { scale: number; pan: Pos } {
  if (bboxW === 0 && bboxH === 0) {
    return { scale: 1, pan: { x: containerW / 2, y: containerH / 2 } };
  }
  // Margen uniforme alrededor del retículo. Con el layout horizontal
  // el eje del orden suele ser el factor limitante, así que no hace
  // falta forzar márgenes laterales mayores.
  const margin = 32;
  const safeW = Math.max(40, containerW - 2 * margin);
  const safeH = Math.max(40, containerH - 2 * margin);
  // Tratamiento del caso de bbox de dimensión nula (un solo nivel o
  // un solo nodo por nivel): evitamos dividir por cero.
  const sx = bboxW > 0 ? safeW / bboxW : 1;
  const sy = bboxH > 0 ? safeH / bboxH : 1;
  const scale = Math.min(sx, sy, 1.5);
  const pan = {
    x: (containerW - bboxW * scale) / 2,
    y: (containerH - bboxH * scale) / 2,
  };
  return { scale, pan };
}

export function LatticeView({ lattice }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<Pos>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef<{ mx: number; my: number; px: number; py: number }>({
    mx: 0,
    my: 0,
    px: 0,
    py: 0,
  });
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  // Recordamos si el usuario ya ha tocado el zoom/pan: si lo ha hecho,
  // no le robamos la vista cuando llega un retículo del mismo tamaño.
  const lastFitRef = useRef<{ n: number; w: number; h: number }>({
    n: 0,
    w: 0,
    h: 0,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const layout = useMemo(() => computarLayout(lattice.nodos), [lattice.nodos]);

  // Auto-fit cuando cambia la estructura del retículo (número de
  // nodos distinto) o cuando cambia el tamaño del container.  Si la
  // estructura es la misma de antes, mantenemos la vista del usuario.
  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    const lastFit = lastFitRef.current;
    const cambioEstructura = lastFit.n !== lattice.nodos.length;
    const cambioContenedor = lastFit.w !== size.w || lastFit.h !== size.h;
    if (!cambioEstructura && !cambioContenedor) return;
    const fit = computarAutoFit(layout.bboxW, layout.bboxH, size.w, size.h);
    setScale(fit.scale);
    setPan(fit.pan);
    lastFitRef.current = { n: lattice.nodos.length, w: size.w, h: size.h };
  }, [layout.bboxW, layout.bboxH, size.w, size.h, lattice.nodos.length]);

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.min(8, Math.max(0.15, scale * factor));
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const newPanX = mx - ((mx - pan.x) * newScale) / scale;
    const newPanY = my - ((my - pan.y) * newScale) / scale;
    setScale(newScale);
    setPan({ x: newPanX, y: newPanY });
  }

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    setPanning(true);
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    panStartRef.current = {
      mx: e.clientX - rect.left,
      my: e.clientY - rect.top,
      px: pan.x,
      py: pan.y,
    };
  }
  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!panning) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const dx = e.clientX - rect.left - panStartRef.current.mx;
    const dy = e.clientY - rect.top - panStartRef.current.my;
    setPan({ x: panStartRef.current.px + dx, y: panStartRef.current.py + dy });
  }
  function endPan() {
    setPanning(false);
  }

  function fitView() {
    if (size.w === 0 || size.h === 0) return;
    const fit = computarAutoFit(layout.bboxW, layout.bboxH, size.w, size.h);
    setScale(fit.scale);
    setPan(fit.pan);
  }

  const hoveredNode = useMemo(
    () =>
      hoveredId != null
        ? lattice.nodos.find((n) => n.id === hoveredId) ?? null
        : null,
    [hoveredId, lattice.nodos],
  );

  return (
    <div ref={containerRef} className="lattice-view">
      {size.w > 0 && (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.w} ${size.h}`}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endPan}
          onMouseLeave={endPan}
          onDoubleClick={fitView}
          style={{ cursor: panning ? 'grabbing' : 'grab' }}
        >
          <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
            {lattice.aristas.map(([from, to], idx) => {
              const a = layout.positions.get(from);
              const b = layout.positions.get(to);
              if (!a || !b) return null;
              return (
                <line
                  key={`e${idx}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#bbb"
                  strokeWidth={1 / scale}
                />
              );
            })}
            {lattice.nodos.map((n) => {
              const p = layout.positions.get(n.id);
              if (!p) return null;
              const r = 6;
              return (
                <g
                  key={n.id}
                  onMouseEnter={() => setHoveredId(n.id)}
                  onMouseLeave={() =>
                    setHoveredId((prev) => (prev === n.id ? null : prev))
                  }
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    fill={hoveredId === n.id ? '#D55E00' : '#1a1a1a'}
                    stroke="#fff"
                    strokeWidth={2 / scale}
                  />
                </g>
              );
            })}
          </g>
          {hoveredNode &&
            (() => {
              const p = layout.positions.get(hoveredNode.id);
              if (!p) return null;
              const x = p.x * scale + pan.x + 12;
              const y = p.y * scale + pan.y - 8;
              const text = `${formatEstructura(hoveredNode.estructura)} (orden ${hoveredNode.orden})${
                hoveredNode.tam_clase > 1 ? ` · ${hoveredNode.tam_clase} conjugados` : ''
              }`;
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <rect
                    x={x - 4}
                    y={y - 14}
                    width={text.length * 6.6 + 8}
                    height={20}
                    rx={3}
                    fill="rgba(255,255,255,0.95)"
                    stroke="#1a1a1a"
                    strokeWidth={1}
                  />
                  <text
                    x={x}
                    y={y}
                    fontSize={11}
                    fontFamily="Manrope, -apple-system, sans-serif"
                    fill="#1a1a1a"
                  >
                    {text}
                  </text>
                </g>
              );
            })()}
        </svg>
      )}
    </div>
  );
}
