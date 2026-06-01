// Panel derecho: información del subgrupo descubierto.
//
// Al hacer hover sobre la fila "Estructura" se despliega un tooltip
// con propiedades abstractas adicionales que devuelve GAP: si es
// abeliano, resoluble, nilpotente, transitivo, primitivo, su T-number,
// el orden de su centro y los factores de composición.

import { useState } from 'react';
import type { SubgrupoResponse } from '../api/client';
import type { GeneradorGuardado } from '../App';
import { formatPerm } from '../galois/monodromia';

interface Props {
  subgrupo: SubgrupoResponse | null;
  generadores: GeneradorGuardado[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  onDelete: (idx: number) => void;
}

function formatOrbitas(orbs: number[][]): string {
  return orbs.map((o) => '{' + o.join(', ') + '}').join('  ');
}

// El backend, tras pasar por GAP, devuelve cadenas como
// "S_5", "A_5", "D_4", "C_3", o compuestas: "C_2 x C_3", "C_5 : C_4".
// Aquí:
//   · C_n → ℤ_n (ℤ con doble barra, U+2124).
//   · _N → subíndice Unicode (S₅, A₅, D₄, ℤ_n).
//   · " x " → " × " (producto directo Unicode).
//   · " : " → " ⋊ " (producto semidirecto Unicode).
function formatEstructura(s: string): string {
  let out = s.replace(/C_(\d+)/g, (_, digits: string) => 'ℤ_' + digits);
  out = out.replace(/_(\d+)/g, (_, digits: string) =>
    digits.split('').map((d) => SUB_DIGITS[parseInt(d, 10)]).join(''),
  );
  out = out.replace(/ x /g, ' × ').replace(/ : /g, ' ⋊ ');
  return out;
}

const SUB_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
function subindex(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUB_DIGITS[parseInt(d, 10)])
    .join('');
}

const formatBool = (b: boolean | null | undefined): string =>
  b === true ? 'sí' : b === false ? 'no' : '—';

function formatCenter(orden: number | null | undefined): string {
  if (orden == null) return '—';
  if (orden === 1) return 'trivial';
  return String(orden);
}

function formatFactoresComposicion(factores: string[] | undefined): string {
  if (!factores || factores.length === 0) return '—';
  // Se muestran de "abajo arriba": el primer factor de GAP es el
  // cociente más alto de la serie; al darle la vuelta queda primero
  // el factor minimal. Para S_5 sale "A_5 · ℤ_2".
  return [...factores].reverse().map(formatEstructura).join(' · ');
}

export function PanelGrupo({
  subgrupo,
  generadores,
  selectedIdx,
  onSelect,
  onDelete,
}: Props) {
  const [showInfo, setShowInfo] = useState(false);
  const empty = generadores.length === 0;
  const gapAvailable =
    subgrupo != null && subgrupo.is_solvable !== null && subgrupo.is_solvable !== undefined;

  return (
    <>
      <div className="panel-label">Subgrupo descubierto</div>

      <div
        className="field has-tooltip"
        onMouseEnter={() => setShowInfo(true)}
        onMouseLeave={() => setShowInfo(false)}
      >
        <div className="field-label">Estructura</div>
        <div className={'field-value mono' + (empty ? ' empty' : '')}>
          {subgrupo ? formatEstructura(subgrupo.estructura) : '—'}
        </div>

        {showInfo && gapAvailable && subgrupo && (
          <div className="tooltip">
            <dl>
              {subgrupo.tid != null && (
                <>
                  <dt>T-number</dt>
                  <dd>
                    {subgrupo.grado}T{subgrupo.tid}
                  </dd>
                </>
              )}
              <dt>Abeliano</dt>
              <dd>{formatBool(subgrupo.is_abelian)}</dd>
              <dt>Resoluble</dt>
              <dd>{formatBool(subgrupo.is_solvable)}</dd>
              <dt>Nilpotente</dt>
              <dd>{formatBool(subgrupo.is_nilpotent)}</dd>
              <dt>Simple</dt>
              <dd>{formatBool(subgrupo.is_simple)}</dd>
              <dt>Perfecto</dt>
              <dd>{formatBool(subgrupo.is_perfect)}</dd>
              <dt>Transitivo</dt>
              <dd>{formatBool(subgrupo.is_transitive)}</dd>
              {subgrupo.is_primitive != null && (
                <>
                  <dt>Primitivo</dt>
                  <dd>{formatBool(subgrupo.is_primitive)}</dd>
                </>
              )}
              <dt>Centro</dt>
              <dd>{formatCenter(subgrupo.center_order)}</dd>
              {subgrupo.composition_factors &&
                subgrupo.composition_factors.length > 0 && (
                  <>
                    <dt>Factores</dt>
                    <dd>{formatFactoresComposicion(subgrupo.composition_factors)}</dd>
                  </>
                )}
            </dl>
          </div>
        )}
      </div>

      <div className="field">
        <div className="field-label">Orden</div>
        <div className="field-value">{subgrupo?.orden ?? 1}</div>
      </div>

      <div className="field">
        <div className="field-label">Generadores</div>
        {empty ? (
          <div className="gens-empty">ninguno aún</div>
        ) : (
          <div className="gens">
            {generadores.map((g, i) => (
              <div
                className={'gen' + (selectedIdx === i ? ' selected' : '')}
                key={i}
                onClick={() => onSelect(i)}
                title="Click para ver el lazo que generó esta permutación"
              >
                <span className="index">σ{subindex(i + 1)}</span>
                <span className="perm">{formatPerm(g.permutacion)}</span>
                <button
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(i);
                  }}
                  title="Eliminar este generador"
                  aria-label="Eliminar"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <div className="field-label">Órbitas</div>
        <div className="orbs">
          {subgrupo ? formatOrbitas(subgrupo.orbitas) : '—'}
        </div>
      </div>
    </>
  );
}
