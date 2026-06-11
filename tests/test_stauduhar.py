"""Tests de paridad de `galois.stauduhar` contra `sympy.galois_group`.

`sympy.polys.numberfields.galoisgroups.galois_group` resuelve el mismo
problema (cuerpo de descomposicion de un polinomio en Q[x]) por una via
distinta (resolventes simbolicas). Es la referencia natural de paridad
para grado <= 4, donde ambos algoritmos son completos.
"""

import pytest
import sympy as sp
from sympy.polys.numberfields.galoisgroups import galois_group

from galois.stauduhar import desde_expresion

_X = sp.Symbol("x")


_SYMPY_NORM = {
    "S3": "S_3", "A3": "A_3",
    "S4": "S_4", "A4": "A_4", "D4": "D_4", "C4": "C_4",
    # sympy emite 'V' para el Klein four-group (sin sufijo de grado).
    "V": "V_4",
}


def _normalizar_sympy(g) -> str:
    """Pasa el enum de sympy al formato `S_4`, `D_4`, etc."""
    name = g.value if hasattr(g, "value") else str(g)
    return _SYMPY_NORM[name]


# Catalogo: polinomios irreducibles sobre Q con grupo conocido. Las
# referencias clasicas son Conrad ("Galois Groups of Cubics and Quartics
# (Not in Characteristic 2)") y Soicher-McKay 1985.
CATALOGO = [
    # Cubicas
    ("x**3 - 2",             3),  # S_3
    ("x**3 - 3*x + 1",       3),  # A_3
    ("x**3 + 2",             3),  # S_3
    ("x**3 - x - 1",         3),  # S_3 (disc = -23)
    ("x**3 + x + 1",         3),  # S_3
    ("x**3 - 7*x + 7",       3),  # A_3 (disc = 49)
    # Cuarticas
    ("x**4 - 2",             4),  # D_4
    ("x**4 + 1",             4),  # V_4
    ("x**4 + x + 1",         4),  # S_4
    ("x**4 + 8*x + 12",      4),  # A_4
    ("x**4 + 5*x**2 + 5",    4),  # C_4
    ("x**4 - 3",             4),  # D_4
    ("x**4 - x - 1",         4),  # S_4
    ("x**4 - 10*x**2 + 1",   4),  # V_4 (Q(sqrt 2, sqrt 3))
    ("x**4 - 4*x**2 + 2",    4),  # C_4 (Q(zeta_16) + Q(zeta_16)^-1 type)
]


@pytest.mark.parametrize("expresion,grado", CATALOGO)
def test_paridad_sympy(expresion, grado):
    """El grupo final devuelto por stauduhar debe coincidir con el
    devuelto por sympy.galois_group."""
    resultado = desde_expresion(expresion, grado)
    grupo_propio = resultado["grupo_final"]

    f = sp.Poly(sp.sympify(expresion), _X)
    grupo_sympy_enum, _ = galois_group(f, by_name=True)
    grupo_sympy = _normalizar_sympy(grupo_sympy_enum)

    assert grupo_propio == grupo_sympy, (
        f"Discrepancia en {expresion}: stauduhar={grupo_propio}, "
        f"sympy={grupo_sympy}"
    )


def test_polinomio_no_monico_se_normaliza():
    """`2*x^3 - 4` tiene el mismo grupo que `x^3 - 2`."""
    res_no_monico = desde_expresion("2*x**3 - 4", 3)
    res_monico = desde_expresion("x**3 - 2", 3)
    assert res_no_monico["grupo_final"] == res_monico["grupo_final"]


def test_grado_incompatible_eleva():
    """Pedir grado 4 sobre una cubica debe disparar ValueError."""
    with pytest.raises(ValueError):
        desde_expresion("x**3 - 2", 4)


def test_polinomio_reducible_eleva():
    """Stauduhar requiere irreducibilidad sobre Q."""
    with pytest.raises(ValueError):
        # (x-1)(x-2)(x-3) reducible
        desde_expresion("(x-1)*(x-2)*(x-3)", 3)


def test_grado_no_soportado_eleva():
    """Grado 6 no esta soportado (limite: 3, 4, 5)."""
    with pytest.raises(ValueError):
        desde_expresion("x**6 - 2", 6)


def test_estructura_respuesta():
    """La respuesta tiene la forma esperada por el frontend: jerarquia
    nivel -> candidato -> coset."""
    res = desde_expresion("x**4 - 2", 4)
    assert set(res.keys()) >= {"polinomio_latex", "grado", "niveles", "grupo_final"}
    assert res["grado"] == 4
    assert len(res["niveles"]) >= 1
    nivel = res["niveles"][0]
    assert set(nivel.keys()) >= {
        "grupo_actual_latex", "grupo_actual_orden", "candidatos", "descender_a",
    }
    assert len(nivel["candidatos"]) >= 1
    cand = nivel["candidatos"][0]
    assert set(cand.keys()) >= {
        "subgrupo_latex", "subgrupo_orden", "indice",
        "invariante_y_latex", "invariante_descripcion",
        "cosets", "Q_latex", "Q_factorizacion_latex",
        "raices_enteras_simples", "descender_a", "coset_descenso_idx", "razon",
    }
    assert len(cand["cosets"]) >= 1
    coset = cand["cosets"][0]
    assert set(coset.keys()) >= {
        "idx", "representante_latex", "representante_cycle",
        "conjugado_y_latex", "conjugado_alpha_latex",
        "valor_numerico_latex", "valor_es_entero",
    }
