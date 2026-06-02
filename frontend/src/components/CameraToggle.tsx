// Toggle entre cámara orbital y cámara en primera persona desde una
// raíz. De momento la primera persona se ancla a la raíz índice 0;
// más adelante se podrá elegir la raíz observadora con un selector.

import { ROOT_COLORS } from '../galois/polinomio';

export type CameraMode = 'orbital' | 'pov';

interface Props {
  mode: CameraMode;
  povIdx: number;
  onChange: (m: CameraMode) => void;
}

export function CameraToggle({ mode, povIdx, onChange }: Props) {
  // Para el icono activo se conserva el color de la hoja en modo POV
  // como pista visual de qué raíz se está observando.
  const povActiveStyle =
    mode === 'pov'
      ? { background: ROOT_COLORS[povIdx], color: '#fff' }
      : undefined;
  return (
    <div className="toggle-group camera-toggle">
      <div
        className={`opt icon ${mode === 'orbital' ? 'active' : ''}`}
        title="Cámara orbital"
        onClick={() => onChange('orbital')}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
      </div>
      <div
        className={`opt icon ${mode === 'pov' ? 'active' : ''}`}
        title={`Primera persona desde la raíz ${povIdx}`}
        onClick={() => onChange('pov')}
        style={povActiveStyle}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </div>
    </div>
  );
}
