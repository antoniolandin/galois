// Toggle entre cámara orbital y cámara en primera persona desde una
// raíz. Un solo botón circular con dos iconos SVG apilados; al
// pulsar se intercambian con un cross-fade animado por CSS. El
// botón se posiciona en valor absoluto, así puede vivir dentro del
// área del visor 3D sin tomar espacio del layout.

import { ROOT_COLORS } from '../galois/polinomio';

export type CameraMode = 'orbital' | 'pov';

interface Props {
  mode: CameraMode;
  povIdx: number;
  onChange: (m: CameraMode) => void;
}

export function CameraToggle({ mode, povIdx, onChange }: Props) {
  const isPov = mode === 'pov';
  // Color de fondo cuando POV está activo: el de la raíz observada,
  // como pista visual de qué hoja se está mirando.
  const povBg = ROOT_COLORS[povIdx] ?? '#1a1a1a';
  const style = isPov ? { background: povBg, borderColor: povBg } : undefined;
  return (
    <button
      type="button"
      className={`camera-toggle-btn ${isPov ? 'is-pov' : 'is-orbital'}`}
      title={
        isPov
          ? `Cámara orbital (saliendo de la raíz ${povIdx})`
          : `Primera persona desde la raíz ${povIdx}`
      }
      style={style}
      onClick={() => onChange(isPov ? 'orbital' : 'pov')}
    >
      <svg
        className="ico-cam"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
        <circle cx="12" cy="13" r="3" />
      </svg>
      <svg
        className="ico-eye"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  );
}
