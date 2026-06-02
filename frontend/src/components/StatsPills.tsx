// Stats del subgrupo descubierto en formato de "pills" que flotan
// sobre el viewport central, en lugar de ocupar campos sueltos en
// la columna derecha. Tres pills: Estructura, Orden, e Iter (sólo
// visible cuando estamos en los modos Aleatorio o Hauenstein).
//
// La pill de Estructura conserva el tooltip detallado que antes vivía
// en el PanelGrupo (abeliano, resoluble, nilpotente, transitivo,
// T-number, centro, factores de composición, órbitas).

import { useState } from 'react';
import type { SubgrupoResponse } from '../api/client';

interface Props {
  subgrupo: SubgrupoResponse | null;
  // Si `true`, el subgrupo descubierto coincide con el grupo de
  // Galois objetivo del polinomio. La pill de Estructura se marca
  // en verde para indicar "ya hemos llegado al final".
  completo?: boolean;
}

const SUB_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

function formatEstructura(s: string): string {
  let out = s.replace(/C_(\d+)/g, (_, digits: string) => 'ℤ_' + digits);
  out = out.replace(/_(\d+)/g, (_, digits: string) =>
    digits.split('').map((d) => SUB_DIGITS[parseInt(d, 10)]).join(''),
  );
  out = out.replace(/ x /g, ' × ').replace(/ : /g, ' ⋊ ');
  return out;
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
  return [...factores].reverse().map(formatEstructura).join(' · ');
}

function formatOrbitas(orbs: number[][]): string {
  return orbs.map((o) => '{' + o.join(', ') + '}').join('  ');
}

export function StatsPills({ subgrupo, completo }: Props) {
  const [showInfo, setShowInfo] = useState(false);
  const gapAvailable =
    subgrupo != null &&
    subgrupo.is_solvable !== null &&
    subgrupo.is_solvable !== undefined;

  return (
    <div className="stat-pills">
      <div
        className={
          'pill pill-est' +
          (subgrupo ? '' : ' empty') +
          (completo ? ' completo' : '')
        }
        onMouseEnter={() => setShowInfo(true)}
        onMouseLeave={() => setShowInfo(false)}
        title={
          completo
            ? 'El subgrupo coincide con el grupo de Galois objetivo'
            : undefined
        }
      >
        <span className="lbl">Estructura</span>
        <span className="val">
          {subgrupo ? formatEstructura(subgrupo.estructura) : '—'}
        </span>
        {showInfo && gapAvailable && subgrupo && (
          <div className="pill-tooltip">
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
                    <dd>
                      {formatFactoresComposicion(subgrupo.composition_factors)}
                    </dd>
                  </>
                )}
              <dt>Órbitas</dt>
              <dd>{formatOrbitas(subgrupo.orbitas)}</dd>
            </dl>
          </div>
        )}
      </div>
      <div className="pill">
        <span className="lbl">Orden</span>
        <span className="val num">{subgrupo?.orden ?? 1}</span>
      </div>
    </div>
  );
}
