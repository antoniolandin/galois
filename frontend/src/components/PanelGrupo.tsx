// Panel derecho: información del subgrupo descubierto.

import type { SubgrupoResponse } from '../api/client';
import { formatPerm } from '../galois/monodromia';

interface Props {
  subgrupo: SubgrupoResponse | null;
  generadores: number[][];
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
  let out = s.replace(/C_(\d+)/g, (_, digits: string) =>
    'ℤ_' + digits,
  );
  out = out.replace(/_(\d+)/g, (_, digits: string) =>
    digits.split('').map((d) => SUB_DIGITS[parseInt(d, 10)]).join(''),
  );
  out = out.replace(/ x /g, ' × ').replace(/ : /g, ' ⋊ ');
  return out;
}

export function PanelGrupo({ subgrupo, generadores }: Props) {
  const empty = generadores.length === 0;

  return (
    <>
      <div className="panel-label">Subgrupo descubierto</div>

      <div className="field">
        <div className="field-label">Estructura</div>
        <div className={'field-value mono' + (empty ? ' empty' : '')}>
          {subgrupo ? formatEstructura(subgrupo.estructura) : '—'}
        </div>
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
              <div className="gen" key={i}>
                <span className="index">σ{subindex(i + 1)}</span>
                <span className="perm">{formatPerm(g)}</span>
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

// "1" → "₁", etc. (Unicode subíndices)
const SUB_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
function subindex(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUB_DIGITS[parseInt(d, 10)])
    .join('');
}
