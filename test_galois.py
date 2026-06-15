"""Smoke test del nucleo matematico, sin UI.

Construye explicitamente cuatro lazos basados en alpha* = 0, cada uno
rodeando un unico punto de ramificacion de P(x, alpha) = x^5 - x + alpha,
y verifica que:
    1. Cada lazo induce una transposicion en la fibra base.
    2. El subgrupo generado por las cuatro transposiciones es S_5.

Util como contraste antes de probar la UI: si esto pasa, el nucleo es
correcto; si falla, el bug esta en `galois/`, no en Trame/Plotly."""

import numpy as np

from galois.monodromia import (
    describir_grupo,
    orbitas,
    permutacion_de_lazo,
    subgrupo_generado,
)
from galois.polinomio import x5_menos_x_mas_alpha
from galois.raices import raices_en
from galois.ramificacion import puntos_de_ramificacion


def lazo_alrededor_de(base: complex, centro: complex,
                      radio: float, n_pasos: int = 400) -> np.ndarray:
    """Construye un lazo basado en `base` que rodea `centro` con
    `radio`. Lazo en tres tramos: (1) recta de `base` a un punto en el
    circulo, (2) circulo completo, (3) vuelta en recta a `base`."""
    n_in = max(2, n_pasos // 20)
    n_out = n_in
    n_circ = n_pasos - n_in - n_out

    direccion = (base - centro) / abs(base - centro)
    punto_entrada = centro + direccion * radio

    tramo_in = np.linspace(base, punto_entrada, n_in)
    theta0 = float(np.angle(punto_entrada - centro))
    theta = theta0 + np.linspace(0, 2 * np.pi, n_circ)
    tramo_circ = centro + radio * np.exp(1j * theta)
    tramo_out = np.linspace(punto_entrada, base, n_out)
    return np.concatenate([tramo_in, tramo_circ, tramo_out])


def main() -> None:
    P = x5_menos_x_mas_alpha()
    print(f"Polinomio:  P(x, α) = {P.expresion}")
    print(f"Grado:      n = {P.grado}")

    ramif = puntos_de_ramificacion(P)
    print(f"\nPuntos de ramificación ({len(ramif)}):")
    for b in ramif:
        print(f"  α = {b.real:+.4f}{b.imag:+.4f}j")

    alpha_estrella = 0 + 0j
    raices = raices_en(P, alpha_estrella)
    print("\nRaíces en α* = 0:")
    for k, x in enumerate(raices):
        print(f"  x_{k} = {x.real:+.4f}{x.imag:+.4f}j")

    print("\n--- Permutaciones por punto de ramificación ---")
    generadores = []
    radio = 0.15
    for b in ramif:
        lazo = lazo_alrededor_de(alpha_estrella, b, radio)
        sigma = permutacion_de_lazo(P, alpha_estrella, lazo, raices)
        cyc = sigma.cyclic_form
        print(f"  α ≈ {b.real:+.3f}{b.imag:+.3f}j  →  σ = {cyc}")
        generadores.append(sigma)

    G = subgrupo_generado(generadores, P.grado)
    print("\n--- Subgrupo generado ---")
    print(f"Orden:      {G.order()}")
    print(f"Estructura: {describir_grupo(G, P.grado)}")
    print(f"Órbitas:    {[sorted(o) for o in orbitas(G)]}")

    esperado = (G.order() == 120 and G.is_symmetric)
    print(f"\nResultado esperado (S_5, orden 120): {'OK' if esperado else 'NO'}")


if __name__ == "__main__":
    main()
