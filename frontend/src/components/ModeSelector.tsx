export type Mode = 'manual' | 'aleatorio' | 'hauenstein';

interface Props {
  mode: Mode;
  onChange: (m: Mode) => void;
}

export function ModeSelector({ mode, onChange }: Props) {
  return (
    <div className="mode-selector">
      <button
        className={`mode ${mode === 'manual' ? 'active' : ''}`}
        onClick={() => onChange('manual')}
      >
        Manual
      </button>
      <button
        className={`mode ${mode === 'aleatorio' ? 'active' : ''}`}
        onClick={() => onChange('aleatorio')}
        disabled
      >
        Aleatorio
      </button>
      <button
        className={`mode ${mode === 'hauenstein' ? 'active' : ''}`}
        onClick={() => onChange('hauenstein')}
        disabled
      >
        Hauenstein
      </button>
    </div>
  );
}
