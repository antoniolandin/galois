"""Encapsulacion del polinomio parametrico P(x, alpha) y sus derivadas
parciales.

El POC del visualizador trabaja por defecto sobre P(x, alpha) = x^5 - x + alpha,
pero la API admite construir el objeto desde cualquier expresion sympy
en las variables (x, alpha). Las derivadas parciales se calculan
simbolicamente y se compilan a numpy mediante lambdify para evitar pagar
el coste simbolico en cada paso del predictor-corrector."""

from dataclasses import dataclass
from typing import Callable

import numpy as np
import sympy as sp


@dataclass
class Polinomio:
    """Polinomio parametrico monico P(x, alpha)."""

    expresion: sp.Expr
    grado: int
    _P: Callable[[complex, complex], complex]
    _P_x: Callable[[complex, complex], complex]
    _P_alpha: Callable[[complex, complex], complex]
    _coefs_funcs: list[Callable[[complex], complex]]

    def evaluar(self, x: complex, alpha: complex) -> complex:
        """Evalua P(x, alpha)."""
        return self._P(x, alpha)

    def derivada_x(self, x: complex, alpha: complex) -> complex:
        """Evalua la derivada parcial dP/dx en (x, alpha)."""
        return self._P_x(x, alpha)

    def derivada_alpha(self, x: complex, alpha: complex) -> complex:
        """Evalua la derivada parcial dP/dalpha en (x, alpha)."""
        return self._P_alpha(x, alpha)

    def coeficientes_en(self, alpha: complex) -> np.ndarray:
        """Coeficientes del polinomio especializado P(x, alpha_0) en x,
        en orden de grado decreciente. Apto para entregar a np.roots."""
        return np.asarray(
            [complex(f(alpha)) for f in self._coefs_funcs],
            dtype=complex,
        )


def desde_expresion(expresion: sp.Expr) -> Polinomio:
    """Construye un Polinomio desde una expresion sympy en (x, alpha).

    El polinomio debe ser monico en x (coeficiente lider 1)."""
    x, alpha = sp.symbols("x alpha")
    grado = int(sp.degree(expresion, x))

    poly_x = sp.Poly(expresion, x)
    coefs_exprs = poly_x.all_coeffs()
    coefs_funcs = [sp.lambdify((alpha,), c, "numpy") for c in coefs_exprs]

    return Polinomio(
        expresion=expresion,
        grado=grado,
        _P=sp.lambdify((x, alpha), expresion, "numpy"),
        _P_x=sp.lambdify((x, alpha), sp.diff(expresion, x), "numpy"),
        _P_alpha=sp.lambdify((x, alpha), sp.diff(expresion, alpha), "numpy"),
        _coefs_funcs=coefs_funcs,
    )


def x5_menos_x_mas_alpha() -> Polinomio:
    """Polinomio canonico del TFG: P(x, alpha) = x^5 - x + alpha.

    Su grupo de Galois sobre C(alpha) es S_5 (caso clasico). Tiene cuatro
    puntos de ramificacion formando un cuadrado centrado en el origen."""
    x, alpha = sp.symbols("x alpha")
    return desde_expresion(x**5 - x + alpha)
