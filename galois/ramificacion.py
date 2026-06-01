"""Calculo del lugar de ramificacion de P(x, alpha): los valores de
alpha donde el polinomio especializado P(x, alpha_0) tiene una raiz
multiple en x.

Se obtienen como las raices del discriminante Disc_x(P), que es un
polinomio en alpha. La aproximacion mixta del POC: sympy calcula el
discriminante simbolicamente y lo entrega como polinomio en alpha;
numpy.roots resuelve esa ecuacion numericamente."""

import numpy as np
import sympy as sp

from .polinomio import Polinomio


def puntos_de_ramificacion(polinomio: Polinomio) -> np.ndarray:
    """Devuelve los valores de alpha donde P(x, alpha) tiene una raiz
    multiple."""
    x, alpha = sp.symbols("x alpha")
    disc = sp.discriminant(polinomio.expresion, x)
    poly_alpha = sp.Poly(disc, alpha)
    coefs = [complex(c) for c in poly_alpha.all_coeffs()]
    return np.roots(coefs)
