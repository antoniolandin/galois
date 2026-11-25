// Página de aterrizaje: dos tarjetas que llevan al visor de monodromía
// o al de Stauduhar. Sirve como índice del TFG y como punto neutro al
// abrir la URL raíz.

import { monodromiaDataUrl } from '../assets/monodromia';

interface Props {
  onGoToMonodromia: () => void;
  onGoToStauduhar: () => void;
}

export function LandingPage({ onGoToMonodromia, onGoToStauduhar }: Props) {
  return (
    <div className="landing">
      <div className="landing-inner">
        <header className="landing-head">
          <h1>Galois Group Visualiser</h1>
        </header>

        <div className="landing-cards">
          <button
            type="button"
            className="landing-card landing-card-monodromia"
            onClick={onGoToMonodromia}
          >
            <div
              className="landing-card-visual"
              style={{ backgroundImage: `url(${monodromiaDataUrl})` }}
            />
            <div className="landing-card-body">
              <h2>Monodromy</h2>
              <p>
                Family <code>P(x, α)</code> over{' '}
                <span className="ital">C</span>(α): loops in the parameter
                plane.
              </p>
            </div>
          </button>

          <button
            type="button"
            className="landing-card landing-card-stauduhar"
            onClick={onGoToStauduhar}
          >
            <div
              className="landing-card-visual"
              style={{ backgroundImage: 'url(/landing/stauduhar.svg)' }}
            />
            <div className="landing-card-body">
              <h2>Stauduhar</h2>
              <p>
                Polynomial <code>f(x) ∈ Q[x]</code>: descent through maximal
                transitive subgroups.
              </p>
            </div>
          </button>
        </div>

        <footer className="landing-foot">
          Bachelor's thesis · Computation and visualisation of the Galois
          group via monodromy
        </footer>
      </div>
    </div>
  );
}
