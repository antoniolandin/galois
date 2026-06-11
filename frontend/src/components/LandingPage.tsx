// Página de aterrizaje: dos tarjetas que llevan al visor de monodromía
// o al de Stauduhar. Sirve como índice del TFG y como punto neutro al
// abrir la URL raíz.

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
          <p className="landing-sub">
            Dos rutas para calcular y visualizar el grupo de Galois de un
            polinomio: la aproximación numérico-topológica vía monodromía
            sobre <span className="ital">C</span>(α) y el descenso
            algebraico clásico de Stauduhar sobre <span className="ital">Q</span>.
          </p>
        </header>

        <div className="landing-cards">
          <button
            type="button"
            className="landing-card landing-card-monodromia"
            onClick={onGoToMonodromia}
          >
            <div className="landing-card-eyebrow">Familia paramétrica</div>
            <h2>Monodromía</h2>
            <p>
              Para una familia <code>P(x, α)</code> con coeficientes en{' '}
              <span className="ital">C</span>(α), se sigue cómo se permutan las
              raíces cuando α recorre lazos en el plano complejo evitando los
              puntos de ramificación. Cada lazo aporta un generador del grupo
              de Galois.
            </p>
            <div className="landing-card-cta">
              Abrir visor →
            </div>
          </button>

          <button
            type="button"
            className="landing-card landing-card-stauduhar"
            onClick={onGoToStauduhar}
          >
            <div className="landing-card-eyebrow">Polinomio sobre Q</div>
            <h2>Stauduhar</h2>
            <p>
              Para un polinomio irreducible <code>f(x) ∈ Q[x]</code> de grado
              3, 4 o 5, se desciende por la cadena de subgrupos transitivos
              maximales probando resolventes asociadas a cada candidato
              hasta identificar el grupo de Galois.
            </p>
            <div className="landing-card-cta">
              Abrir visor →
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
