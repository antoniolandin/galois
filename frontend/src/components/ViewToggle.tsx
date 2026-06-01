export type View = 'superficie' | 'trayectorias' | 'plano-x';

interface Props {
  view: View;
  onChange: (v: View) => void;
}

export function ViewToggle({ view, onChange }: Props) {
  return (
    <div className="viewport-overlay">
      <div className="toggle-group">
        <div
          className={`opt ${view === 'superficie' ? 'active' : ''}`}
          onClick={() => onChange('superficie')}
        >
          Superficie
        </div>
        <div
          className={`opt ${view === 'trayectorias' ? 'active' : ''}`}
          onClick={() => onChange('trayectorias')}
        >
          Trayectorias
        </div>
        <div
          className={`opt ${view === 'plano-x' ? 'active' : ''}`}
          onClick={() => onChange('plano-x')}
        >
          Plano x
        </div>
      </div>
    </div>
  );
}
