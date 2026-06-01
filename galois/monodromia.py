"""Permutaciones de monodromia, subgrupo generado y orbitas.

Una permutacion sigma se obtiene siguiendo cada una de las n raices de
la fibra base a lo largo del lazo: las posiciones finales deben coincidir
(como conjunto) con las iniciales, y la asignacion concreta
'raiz i -> raiz sigma(i)' es la permutacion buscada."""

import math
from typing import Sequence

import numpy as np
import sympy.combinatorics as comb

from .continuacion import seguir_raiz
from .identificacion import identificar_grupo_via_gap
from .polinomio import Polinomio
from .raices import raices_en


def permutacion_y_trayectorias_de_lazo(
    polinomio: Polinomio,
    alpha_estrella: complex,
    lazo: np.ndarray,
    raices_base: np.ndarray | None = None,
) -> tuple[comb.Permutation, np.ndarray]:
    """Calcula la permutacion inducida por un lazo y devuelve tambien
    las trayectorias completas de las n raices.

    El lazo debe estar basado en alpha_estrella: lazo[0] == lazo[-1] == alpha_estrella.

    Si raices_base se pasa, se reutiliza como fibra inicial (ahorra una
    llamada a numpy.roots y, mas importante, garantiza una ordenacion
    canonica de las raices entre lazos consecutivos).

    Devuelve (sigma, trayectorias) con trayectorias de shape (n, N)."""
    if raices_base is None:
        raices_base = raices_en(polinomio, alpha_estrella)
    n = len(raices_base)

    trayectorias = np.zeros((n, len(lazo)), dtype=complex)
    for i in range(n):
        trayectorias[i] = seguir_raiz(polinomio, raices_base[i], lazo)

    raices_finales = trayectorias[:, -1]
    asignacion = _emparejar_por_proximidad(raices_finales, raices_base)
    return comb.Permutation(asignacion, size=n), trayectorias


def permutacion_de_lazo(
    polinomio: Polinomio,
    alpha_estrella: complex,
    lazo: np.ndarray,
    raices_base: np.ndarray | None = None,
) -> comb.Permutation:
    """Calcula la permutacion inducida por un lazo. Si necesitas tambien
    las trayectorias, utiliza `permutacion_y_trayectorias_de_lazo`."""
    sigma, _ = permutacion_y_trayectorias_de_lazo(
        polinomio, alpha_estrella, lazo, raices_base
    )
    return sigma


def _emparejar_por_proximidad(
    finales: np.ndarray, iniciales: np.ndarray
) -> list[int]:
    """Para cada raiz i de finales, devuelve el indice j de la raiz mas
    proxima en iniciales (asignacion 1-a-1 voraz)."""
    n = len(iniciales)
    asignacion: list[int] = []
    libres = [True] * n
    for i in range(n):
        candidatos = [
            (abs(finales[i] - iniciales[j]) if libres[j] else np.inf, j)
            for j in range(n)
        ]
        _, j_best = min(candidatos)
        asignacion.append(j_best)
        libres[j_best] = False
    return asignacion


def subgrupo_generado(
    generadores: Sequence[comb.Permutation], n: int
) -> comb.PermutationGroup:
    """Construye el subgrupo de S_n generado por las permutaciones dadas.

    Si la lista esta vacia, devuelve el grupo trivial sobre n puntos."""
    if not generadores:
        return comb.PermutationGroup([comb.Permutation(list(range(n)))])
    return comb.PermutationGroup(list(generadores))


def orbitas(grupo: comb.PermutationGroup) -> list[set[int]]:
    """Particiones del conjunto {0, ..., n-1} en orbitas del grupo."""
    return [set(o) for o in grupo.orbits()]


def describir_grupo(
    grupo: comb.PermutationGroup,
    n: int,
    generadores: Sequence[comb.Permutation] | None = None,
) -> str:
    """Identificacion sympy-only del subgrupo. Cubre los casos basicos:
    trivial, S_n, A_n, ciclico, diedrico. Se usa como fallback cuando
    GAP no esta disponible; la API normalmente llama directamente a
    `identificar_grupo_via_gap` (en `galois.identificacion`).

    Sympy 1.14 no expone `is_alt` como propiedad publica; se detecta
    A_n combinando orden = n!/2 con que todos los generadores sean
    permutaciones pares (G ⊆ A_n)."""
    if generadores is None:
        generadores = list(grupo.generators)

    orden = grupo.order()
    factorial_n = math.factorial(n)

    if orden == 1:
        return "trivial"
    if orden == factorial_n and grupo.is_symmetric:
        return f"S_{n}"
    if orden == factorial_n // 2 and all(
        g.is_even for g in grupo.generators
    ):
        return f"A_{n}"
    if grupo.is_cyclic:
        return f"C_{orden}"
    if hasattr(grupo, "is_dihedral"):
        try:
            if grupo.is_dihedral:
                return f"D_{orden // 2}"
        except (AttributeError, NotImplementedError):
            pass
    return f"orden {orden}"
