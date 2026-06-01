"""Busqueda de las raices complejas de P(x, alpha) en un valor concreto
de alpha.

Para el POC se utiliza numpy.roots, que internamente calcula los
autovalores de la matriz compania. Es robusto y suficiente hasta grados
moderados (n del orden de unas decenas). Si la app crece a grados altos
conviene cambiar a Aberth-Ehrlich, que escala mejor."""

import numpy as np

from .polinomio import Polinomio


def raices_en(polinomio: Polinomio, alpha: complex) -> np.ndarray:
    """Devuelve las n raices complejas de P(x, alpha) en el orden en que
    las entrega numpy.roots (no canonico)."""
    coefs = polinomio.coeficientes_en(alpha)
    return np.roots(coefs)
