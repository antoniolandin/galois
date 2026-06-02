"""Cálculo "a toda hostia" del grupo de Galois objetivo de un polinomio
parametrico P(x, alpha) sobre C(alpha).

La idea: aplicar el algoritmo de Hauenstein-Rodríguez-Sottile (un lazo
circular por punto de ramificación b_i) sin animación ni overhead de
red, calcular las permutaciones inducidas y delegar la identificación
del grupo a GAP. Sirve para conocer el "objetivo" del juego antes de
que el usuario empiece a dibujar lazos."""

from __future__ import annotations

import math

import numpy as np
import sympy.combinatorics as comb

from .identificacion import identificar_grupo_via_gap
from .monodromia import permutacion_de_lazo
from .polinomio import Polinomio
from .raices import raices_en


# Tamaño máximo del radio del arco circular alrededor de un branch.
# Se reduce dinámicamente cuando hay otro b_j más cerca para no
# englobarlo por accidente.
_RADIO_MAX = 0.16
# Número de puntos del arco. Suficiente para que la continuación
# numérica del backend no tenga que subdividir mucho.
_N_ARC = 40
# Paso de los ramales rectos α* → enter y enter → α*.
_STEP_RECTO = 0.04


def _lazo_circular(
    alpha_estrella: complex,
    bi: complex,
    ramificacion: np.ndarray,
) -> np.ndarray:
    """Lazo basado en alpha_estrella que rodea unicamente a bi.

    Forma: ramal recto α* → enter, arco CCW de 360° alrededor de bi,
    ramal recto enter → α*. El radio se ajusta si hay otro b_j más
    cerca de la mitad de la distancia."""
    direccion = alpha_estrella - bi
    dist = abs(direccion)
    if dist < 1e-9:
        # α* coincide con bi: ningún lazo razonable.
        return np.array([alpha_estrella, alpha_estrella], dtype=complex)
    radio = _RADIO_MAX
    for bj in ramificacion:
        if bj == bi:
            continue
        d = abs(bj - bi)
        limite = d / 2 - 0.015
        if limite < radio:
            radio = limite
    if radio < 0.03:
        radio = 0.03
    u = direccion / dist  # vector unitario α* ← bi
    enter = bi + u * radio
    # Ramal recto α* → enter
    distIn = abs(alpha_estrella - enter)
    nIn = max(1, math.ceil(distIn / _STEP_RECTO))
    ramal_in = [alpha_estrella + (enter - alpha_estrella) * (k / nIn) for k in range(nIn + 1)]
    # Arco CCW 360° alrededor de bi, empezando en enter.
    start_ang = math.atan2(enter.imag - bi.imag, enter.real - bi.real)
    arco = [
        bi + radio * (math.cos(start_ang + (k / _N_ARC) * 2 * math.pi)
                      + 1j * math.sin(start_ang + (k / _N_ARC) * 2 * math.pi))
        for k in range(1, _N_ARC + 1)
    ]
    # Ramal recto enter → α*
    ramal_out = [enter + (alpha_estrella - enter) * (k / nIn) for k in range(1, nIn + 1)]
    return np.array(ramal_in + arco + ramal_out, dtype=complex)


def calcular_grupo_galois(
    polinomio: Polinomio,
    alpha_estrella: complex,
    ramificacion: np.ndarray,
) -> dict:
    """Devuelve la identificación del grupo de Galois de la familia
    `polinomio` sobre C(alpha): estructura y orden. Internamente
    aplica Hauenstein (un lazo por b_i ∈ B) y delega en GAP.

    El resultado lleva las mismas claves que `identificar_grupo_via_gap`
    (estructura, orden, is_abelian, ...). Si GAP no responde, se cae a
    una identificación parcial via sympy (estructura más pobre)."""
    if len(ramificacion) == 0:
        return {"estructura": "trivial", "orden": 1}
    raices_base = raices_en(polinomio, alpha_estrella)
    perms: list[comb.Permutation] = []
    for bi in ramificacion:
        lazo = _lazo_circular(complex(alpha_estrella), complex(bi), ramificacion)
        sigma = permutacion_de_lazo(polinomio, alpha_estrella, lazo, raices_base)
        if not sigma.is_Identity:
            perms.append(sigma)
    info = identificar_grupo_via_gap(perms, polinomio.grado)
    if info is None:
        # Fallback minimalista sin GAP: orden + flag is_symmetric.
        from .monodromia import describir_grupo, subgrupo_generado
        grupo = subgrupo_generado(perms)
        return {
            "estructura": describir_grupo(grupo, polinomio.grado, perms),
            "orden": grupo.order(),
        }
    return info
