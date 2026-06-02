// Panel derecho: lista de generadores acumulados y retículo de
// subgrupos. La estructura, orden y propiedades abstractas se han
// movido al overlay del viewport (componente `StatsPills`) para
// dejar a este panel más espacio vertical para los generadores y
// sobre todo para el retículo.

import type { SubgrupoResponse } from '../api/client';
import type { GeneradorGuardado } from '../App';
import { formatPerm } from '../galois/monodromia';
import { LatticeView } from './LatticeView';

interface Props {
  subgrupo: SubgrupoResponse | null;
  generadores: GeneradorGuardado[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  onDelete: (idx: number) => void;
}

const SUB_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
function subindex(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUB_DIGITS[parseInt(d, 10)])
    .join('');
}

export function PanelGrupo({
  subgrupo,
  generadores,
  selectedIdx,
  onSelect,
  onDelete,
}: Props) {
  const empty = generadores.length === 0;
  return (
    <>
      <div className="field">
        <div className="field-label">Generadores</div>
        <div className="gens">
          {empty ? (
            <div className="gens-empty">ninguno aún</div>
          ) : (
            generadores.map((g, i) => (
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
            ))
          )}
        </div>
      </div>

      {subgrupo?.lattice && (
        <div className="field lattice-field">
          <div className="field-label">Retículo de subgrupos</div>
          <LatticeView lattice={subgrupo.lattice} />
        </div>
      )}
    </>
  );
}
