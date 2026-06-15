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
          <h1>Visualizador del grupo de Galois</h1>
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
              <h2>Monodromía</h2>
              <p>
                Familia <code>P(x, α)</code> sobre{' '}
                <span className="ital">C</span>(α): lazos en el plano del
                parámetro.
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
                Polinomio <code>f(x) ∈ Q[x]</code>: descenso por subgrupos
                transitivos maximales.
              </p>
            </div>
          </button>
        </div>

        <footer className="landing-foot">
          TFG · Cálculo y visualización del grupo de Galois mediante monodromía
        </footer>
      </div>
    </div>
  );
}
