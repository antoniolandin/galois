"""Continuacion numerica de raices a lo largo de un lazo en el plano del
parametro mediante el esquema predictor-corrector Euler-Newton.

Predictor (Euler): aproxima la raiz en alpha_{k+1} a partir de la de
alpha_k usando la derivada implicita dx/dalpha = -P_alpha / P_x.

Corrector (Newton): refina la prediccion iterando Newton sobre el
polinomio especializado P(x, alpha_{k+1}) = 0. La convergencia es
cuadratica (el numero de digitos correctos se duplica en cada iteracion)
siempre que el predictor caiga suficientemente cerca de la raiz."""

import numpy as np

from .polinomio import Polinomio


def paso_euler(
    polinomio: Polinomio,
    x_k: complex,
    alpha_k: complex,
    alpha_kp1: complex,
) -> complex:
    """Un paso del predictor de Euler: aproxima x_{k+1} mediante
    x_k + dx/dalpha * (alpha_{k+1} - alpha_k)."""
    P_x = polinomio.derivada_x(x_k, alpha_k)
    P_alpha = polinomio.derivada_alpha(x_k, alpha_k)
    return x_k - (P_alpha / P_x) * (alpha_kp1 - alpha_k)


def corregir_newton(
    polinomio: Polinomio,
    x_pred: complex,
    alpha: complex,
    tol: float = 1e-12,
    max_iter: int = 30,
) -> complex:
    """Corrector de Newton: parte de x_pred e itera Newton sobre
    P(x, alpha) = 0 hasta que |P(x, alpha)| < tol."""
    x = x_pred
    for _ in range(max_iter):
        P_val = polinomio.evaluar(x, alpha)
        if abs(P_val) < tol:
            return x
        P_x_val = polinomio.derivada_x(x, alpha)
        if P_x_val == 0:
            break
        x = x - P_val / P_x_val
    return x


def seguir_raiz(
    polinomio: Polinomio,
    raiz_inicial: complex,
    lazo: np.ndarray,
) -> np.ndarray:
    """Sigue una raiz a lo largo de un lazo discretizado.

    Argumentos:
        polinomio: P(x, alpha).
        raiz_inicial: raiz de P(x, lazo[0]) que se quiere seguir.
        lazo: array de valores complejos del parametro a lo largo
            del lazo, incluyendo punto inicial y final.

    Devuelve la trayectoria de la raiz como array de igual longitud
    que lazo."""
    n = len(lazo)
    trayectoria = np.zeros(n, dtype=complex)
    trayectoria[0] = raiz_inicial
    for k in range(1, n):
        x_pred = paso_euler(polinomio, trayectoria[k - 1], lazo[k - 1], lazo[k])
        trayectoria[k] = corregir_newton(polinomio, x_pred, lazo[k])
    return trayectoria
