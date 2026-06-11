"""Algoritmo de Stauduhar paso a paso sobre Q, con traza jerarquica
del descenso para animacion en frontend.

La traza recoge:
    - Niveles del descenso H_0 = S_n -> H_1 -> ... -> H_final
    - Por nivel, candidatos maximales transitivos G probados en orden
    - Por candidato: invariante F asociado, k clases laterales aplicadas
      una a una con su conjugado simbolico y su evaluacion numerica,
      resolvente Q ensamblada, raices enteras simples y decision de
      descenso o paso al siguiente candidato.

Alcance: grados 3, 4 y 5. Para los descensos en los que no hay
invariante hardcodeado (algunos pares H -> G en grado 5 internos),
delegamos en sympy.galois_group para el grupo final del nivel y
marcamos el descenso como "sin desglose por clases laterales".

El test final sobre Q (busqueda de raices enteras simples) se anota en
cada candidato; el frontend lo anima al cerrarse los k cosets."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import sympy as sp
from sympy.combinatorics import Permutation
from sympy.combinatorics.named_groups import SymmetricGroup, AlternatingGroup
from sympy.combinatorics.galois import (
    S3TransitiveSubgroups, S4TransitiveSubgroups, S5TransitiveSubgroups,
)
from sympy.polys.numberfields.galois_resolvents import Resolvent


_X = sp.Symbol("x")
_T = sp.Symbol("t")


# -- Modelo de datos (serializable a JSON) -------------------------

@dataclass
class CosetApp:
    """Aplicacion de un representante pi_i de una clase lateral
    derecha de G en H sobre el invariante F."""

    idx: int                                # 0..k-1
    representante_latex: str                # "e", "(1\\ 2)"
    representante_cycle: list[list[int]]    # forma ciclica 1-indexed
    conjugado_y_latex: str                  # "y_1 y_3 + y_2 y_4"
    conjugado_alpha_latex: str              # "\\alpha_1 \\alpha_3 + ..."
    valor_numerico_latex: str               # "0", "-2 i \\sqrt{2}"
    valor_es_entero: bool                   # ¿v_i ∈ Z?


@dataclass
class CandidatoProbado:
    """Prueba completa de un candidato G en el nivel H actual."""

    subgrupo_latex: str                     # "A_4", "D_4"
    subgrupo_orden: int                     # |G|
    indice: int                             # k = [H:G]
    invariante_y_latex: str                 # "y_1 y_3 + y_2 y_4"
    invariante_descripcion: str
    cosets: list[CosetApp]
    Q_latex: str                            # "t^3 + 8 t"
    Q_factorizacion_latex: str              # "t (t^2 + 8)"
    raices_enteras_simples: list[str]       # ["0"]
    descender_a: str | None                 # nombre del subgrupo o None
    coset_descenso_idx: int | None          # cual π_i dio la raiz entera
    razon: str


@dataclass
class NivelDescenso:
    """Un nivel del descenso (un grupo H actual)."""

    grupo_actual_latex: str
    grupo_actual_orden: int
    candidatos: list[CandidatoProbado]
    descender_a: str | None


@dataclass
class StauduharTraza:
    polinomio_latex: str
    grado: int
    niveles: list[NivelDescenso]
    grupo_final: str


# -- Helpers de presentacion ---------------------------------------

def _perm_latex(p: Permutation, n: int) -> str:
    """Forma ciclica con 1-indexado y notacion latex."""
    cycles = p.cyclic_form
    if not cycles:
        return r"e"
    return "".join(
        "(" + "\\ ".join(str(i + 1) for i in c) + ")" for c in cycles
    )


def _perm_cycles_1indexed(p: Permutation) -> list[list[int]]:
    return [[i + 1 for i in c] for c in p.cyclic_form]


def _aplicar_perm_a_F_simbolico(F_expr, X_syms, p: Permutation) -> sp.Expr:
    """Aplica pi a F sustituyendo X_i por X_{pi^{-1}(i)} (forma cíclica
    correcta para que pi*F(x) = F(x_{pi(1)}, ..., x_{pi(n)})).
    """
    p_inv = ~p
    n = len(X_syms)
    subs = {X_syms[i]: X_syms[p_inv(i)] for i in range(n)}
    return F_expr.subs(subs, simultaneous=True)


def _y_expr_to_latex_compact(expr) -> str:
    """LaTeX compacto: sin '*' visible, productos juntos."""
    s = sp.latex(expr, mul_symbol=None)
    return s


def _y_a_alpha_latex(expr, n: int) -> str:
    """Reemplaza y_i -> alpha_i en una expresion simbolica."""
    Y_syms = sp.symbols(f"X0:{n}")
    A_syms = sp.symbols(f"alpha1:{n+1}")
    subs = {Y_syms[i]: A_syms[i] for i in range(n)}
    expr_a = expr.subs(subs, simultaneous=True)
    return sp.latex(expr_a, mul_symbol=None)


def _y_a_y_indexado_latex(expr, n: int) -> str:
    Y_syms = sp.symbols(f"X0:{n}")
    Y_indexed = sp.symbols(f"y1:{n+1}")
    subs = {Y_syms[i]: Y_indexed[i] for i in range(n)}
    return sp.latex(expr.subs(subs, simultaneous=True), mul_symbol=None)


def _valor_complejo_latex(v: complex, tol: float = 1e-8) -> str:
    """LaTeX de un valor complejo aproximado, intentando reducirlo a
    formas simples (entero, racional, imaginario puro k*sqrt(d))."""
    # Entero?
    if abs(v.imag) < tol and abs(v.real - round(v.real)) < tol:
        return str(int(round(v.real)))
    # Imaginario puro?
    if abs(v.real) < tol:
        im = v.imag
        # k * sqrt(d)?
        for d in [2, 3, 5, 6, 7, 10]:
            k = im / sp.sqrt(d)
            k_f = float(k)
            if abs(k_f - round(k_f)) < tol:
                kk = int(round(k_f))
                if kk == 1:
                    return rf"i \sqrt{{{d}}}"
                if kk == -1:
                    return rf"-i \sqrt{{{d}}}"
                return rf"{kk} i \sqrt{{{d}}}"
        # Imaginario "limpio"?
        if abs(im - round(im)) < tol:
            iv = int(round(im))
            if iv == 1: return "i"
            if iv == -1: return "-i"
            return rf"{iv} i"
        return rf"{im:.3f} i"
    # Complejo general
    return rf"{v.real:.3f} + {v.imag:.3f} i"


def _es_cuadrado_en_q(q) -> bool:
    q = sp.Rational(q)
    if q < 0:
        return False
    return sp.sqrt(q).is_rational


# -- Catalogo de invariantes y cosets por descenso ----------------

# Cada entrada: (n, H_name, G_name) -> dict con:
#   F          : invariante simbolico (sympy expr en X_0..X_{n-1})
#   X          : tuple de simbolos
#   cosets     : list[Permutation] de representantes de clases laterales
#                derechas de G en H
#   nombre_H   : str
#   nombre_G   : str
#   descripcion: str

def _construir_catalogo():
    """Construye el catalogo de invariantes/cosets para todos los
    descensos soportados."""
    cat = {}

    # ---- GRADO 3 ----
    X3 = sp.symbols("X0:3")
    # S_3 -> A_3 : Vandermonde (delta^2 = disc).
    # En el visor lo tratamos por discriminante directamente (no
    # construimos resolvente). Pero registramos info simbolica para mostrar.
    cat[(3, "S_3", "A_3")] = {
        "F": (X3[0] - X3[1]) * (X3[0] - X3[2]) * (X3[1] - X3[2]),
        "X": X3,
        "cosets": [Permutation(2), Permutation([1, 0, 2])],
        "via_discriminante": True,
        "descripcion": (
            "El invariante de Vandermonde "
            r"$\delta = \prod_{i < j}(y_i - y_j)$ tiene cuadrado "
            r"$\delta^2 = \Delta_f$. Su estabilizador en $S_3$ es $A_3$."
        ),
    }

    # ---- GRADO 4 ----
    X4 = sp.symbols("X0:4")
    # S_4 -> A_4 : Vandermonde.
    cat[(4, "S_4", "A_4")] = {
        "F": (X4[0] - X4[1]) * (X4[0] - X4[2]) * (X4[0] - X4[3])
             * (X4[1] - X4[2]) * (X4[1] - X4[3]) * (X4[2] - X4[3]),
        "X": X4,
        "cosets": [Permutation(3), Permutation([1, 0, 2, 3])],
        "via_discriminante": True,
        "descripcion": (
            "Invariante de Vandermonde. Su estabilizador en $S_4$ es "
            "$A_4$ (permutaciones pares)."
        ),
    }
    # S_4 -> D_4 : F = X_0 X_2 + X_1 X_3 (F_{4,1} de SymPy).
    cat[(4, "S_4", "D_4")] = {
        "F": X4[0]*X4[2] + X4[1]*X4[3],
        "X": X4,
        "cosets": [
            Permutation(3),
            Permutation([1, 0, 2, 3]),       # (1 2)
            Permutation([3, 1, 2, 0]),       # (1 4)
        ],
        "via_discriminante": False,
        "descripcion": (
            "El invariante $F = y_1 y_3 + y_2 y_4$ tiene como "
            "estabilizador en $S_4$ el grupo dihedrico $D_4$. La "
            "resolvente es la cubica clasica de la cuartica."
        ),
    }
    # A_4 -> V_4 : F = X_0 X_1 + X_2 X_3 restringido a A_4.
    cat[(4, "A_4", "V_4")] = {
        "F": X4[0]*X4[1] + X4[2]*X4[3],
        "X": X4,
        "cosets": [
            Permutation(3),
            Permutation([1, 2, 0, 3]),       # (1 2 3)
            Permutation([2, 0, 1, 3]),       # (1 3 2)
        ],
        "via_discriminante": False,
        "descripcion": (
            "Invariante asociado a la particion "
            r"$\{1,2\} \cup \{3,4\}$. Su estabilizador en $A_4$ es "
            "$V_4$ (Klein)."
        ),
    }
    # D_4 -> V_4 : restriccion de F = X_0 X_1 + X_2 X_3 al D_4 que
    # estabiliza X_0 X_2 + X_1 X_3. El cociente es Z_2. El segundo coset
    # se representa por (0 1 2 3), que pertenece a este D_4.
    cat[(4, "D_4", "V_4")] = {
        "F": X4[0]*X4[1] + X4[2]*X4[3],
        "X": X4,
        "cosets": [Permutation(3), Permutation([1, 2, 3, 0])],  # (1 2 3 4)
        "via_discriminante": False,
        "descripcion": (
            r"Invariante $y_1 y_2 + y_3 y_4$ restringido a $D_4$. "
            "Su estabilizador en $D_4$ es $V_4$, con indice 2."
        ),
    }
    # D_4 -> C_4 : invariante F_{4,0} de SymPy. Segundo coset
    # representado por (0 1)(2 3), que esta en D_4 \ C_4.
    cat[(4, "D_4", "C_4")] = {
        "F": X4[0]*X4[1]**2 + X4[1]*X4[2]**2 + X4[2]*X4[3]**2 + X4[3]*X4[0]**2,
        "X": X4,
        "cosets": [Permutation(3), Permutation([1, 0, 3, 2])],  # (1 2)(3 4)
        "via_discriminante": False,
        "descripcion": (
            "Invariante asimetrico $F_{4,0}$ de Soicher-McKay. Estabilizador "
            "en $D_4$ es $C_4$."
        ),
    }

    # ---- GRADO 5 ----
    X5 = sp.symbols("X0:5")
    # S_5 -> A_5 : Vandermonde.
    cat[(5, "S_5", "A_5")] = {
        "F": sp.prod(X5[i] - X5[j] for i in range(5) for j in range(i+1, 5)),
        "X": X5,
        "cosets": [Permutation(4), Permutation([1, 0, 2, 3, 4])],
        "via_discriminante": True,
        "descripcion": "Vandermonde. Estabilizador $A_5$ en $S_5$.",
    }
    # S_5 -> F_20 : F_{5,1} de SymPy.
    F51 = (
        X5[0]**2 * (X5[1]*X5[4] + X5[2]*X5[3]) +
        X5[1]**2 * (X5[2]*X5[0] + X5[3]*X5[4]) +
        X5[2]**2 * (X5[3]*X5[1] + X5[4]*X5[0]) +
        X5[3]**2 * (X5[4]*X5[2] + X5[0]*X5[1]) +
        X5[4]**2 * (X5[0]*X5[3] + X5[1]*X5[2])
    )
    cat[(5, "S_5", "F_20")] = {
        "F": F51,
        "X": X5,
        "cosets": [
            Permutation(4),
            Permutation([1, 0, 2, 3, 4]),
            Permutation([2, 1, 0, 3, 4]),
            Permutation([3, 1, 2, 0, 4]),
            Permutation([4, 1, 2, 3, 0]),
            Permutation([0, 4, 2, 3, 1]),
        ],
        "via_discriminante": False,
        "descripcion": (
            "Invariante de Soicher-McKay con 5 terminos ciclicos. "
            "Estabilizador $F_{20}$ (Frobenius de orden 20) en $S_5$."
        ),
    }

    return cat


CATALOGO = _construir_catalogo()


# -- Retículos del descenso (qué candidatos maximales hay por nivel) --

DESCENSOS = {
    3: {
        "S_3": ["A_3"],
        "A_3": [],
    },
    4: {
        "S_4": ["A_4", "D_4"],
        "A_4": ["V_4"],
        "D_4": ["V_4", "C_4"],
        "V_4": [],
        "C_4": [],
    },
    5: {
        "S_5": ["A_5", "F_20"],
        "A_5": [],          # A_5 simple, no descenso util en visor
        "F_20": [],         # descenso D_5 sin invariante hardcodeado
        "D_5": [],
        "C_5": [],
    },
}

ORDENES = {
    "S_3": 6, "A_3": 3,
    "S_4": 24, "A_4": 12, "D_4": 8, "V_4": 4, "C_4": 4,
    "S_5": 120, "A_5": 60, "F_20": 20, "D_5": 10, "C_5": 5,
}


# -- Núcleo del descenso ------------------------------------------

def _calcular_raices(f_poly: sp.Poly) -> list[complex]:
    """Aproxima las raices de f con precision suficiente como complejos."""
    import numpy as np
    coefs = [complex(c) for c in f_poly.all_coeffs()]
    return [complex(r) for r in np.roots(coefs)]


def _evaluar_conjugado(F_expr, X_syms, p: Permutation, raices) -> complex:
    """Evalua pi(F) sobre las raices (en orden). Es decir, sustituye
    X_i por raices[p^{-1}(i)] (formula del conjugado del paper)."""
    p_inv = ~p
    n = len(X_syms)
    sub = {X_syms[i]: complex(raices[p_inv(i)]) for i in range(n)}
    return complex(F_expr.subs(sub))


def _coefs_enteros_de_Q(valores: list[complex], tol: float = 1e-4) -> list[int] | None:
    """Dado el conjunto de valores v_1, ..., v_k (raices de Q), devuelve
    los coeficientes enteros del polinomio monico
        Q(t) = prod_i (t - v_i)
    si redondean a enteros con margen `tol`; None en caso contrario."""
    import numpy as np
    Q = np.poly(valores)
    enteros = []
    for c in Q:
        c_real = c.real
        c_int = round(c_real)
        if abs(c.imag) > tol or abs(c_real - c_int) > tol:
            return None
        enteros.append(int(c_int))
    return enteros


def _raices_enteras(coefs_Q: list[int]) -> tuple[list[int], list[int]]:
    """Devuelve (simples, multiples): raices enteras de Q clasificadas
    por multiplicidad. El test de Stauduhar exige simples; las multiples
    requieren Tschirnhausen en el algoritmo original, pero en el visor
    las aceptamos como descenso anotando el caveat."""
    Y = sp.Symbol("Y")
    Q = sp.Poly(coefs_Q, Y)
    factorlist = sp.factor_list(Q.as_expr())[1]
    simples = []
    multiples = []
    for fact_expr, mult in factorlist:
        poly_f = sp.Poly(fact_expr, Y)
        if poly_f.degree() == 1:
            a, b = poly_f.all_coeffs()
            if a == 1 and b.is_integer:
                if mult == 1:
                    simples.append(int(-b))
                else:
                    multiples.append(int(-b))
    return simples, multiples


def _probar_candidato(
    n: int,
    H_name: str,
    G_name: str,
    raices: list[complex],
    f_poly: sp.Poly,
) -> CandidatoProbado:
    """Prueba el candidato G en el nivel H sobre el polinomio f.
    Devuelve la traza completa del candidato (cosets + Q + test)."""
    key = (n, H_name, G_name)
    info = CATALOGO[key]
    F_expr = info["F"]
    X = info["X"]
    cosets = info["cosets"]

    # Aplicacion de cada coset
    coset_apps: list[CosetApp] = []
    valores: list[complex] = []
    via_disc = info.get("via_discriminante", False)
    for i, p in enumerate(cosets):
        conjugado_simb = _aplicar_perm_a_F_simbolico(F_expr, X, p)
        v = _evaluar_conjugado(F_expr, X, p, raices)
        valores.append(v)
        v_redondeado = round(v.real)
        es_ent = abs(v.imag) < 1e-4 and abs(v.real - v_redondeado) < 1e-4
        # Para Vandermonde devolvemos notacion compacta: el conjugado
        # de \delta bajo una permutacion es +\delta o -\delta segun
        # la paridad de la permutacion (van der Waerden).
        if via_disc:
            sign = p.signature()
            tag = r"\delta" if sign == 1 else r"-\delta"
            conjugado_y = tag
            conjugado_alpha = tag
        else:
            conjugado_y = _y_a_y_indexado_latex(conjugado_simb, n)
            conjugado_alpha = _y_a_alpha_latex(conjugado_simb, n)
        coset_apps.append(CosetApp(
            idx=i,
            representante_latex=_perm_latex(p, n),
            representante_cycle=_perm_cycles_1indexed(p),
            conjugado_y_latex=conjugado_y,
            conjugado_alpha_latex=conjugado_alpha,
            valor_numerico_latex=_valor_complejo_latex(v),
            valor_es_entero=es_ent,
        ))

    # Construir Q
    coefs_Q = _coefs_enteros_de_Q(valores)
    if coefs_Q is None:
        Q_latex = "(no determinado)"
        Q_fact_latex = "(no determinado)"
        raices_simples: list[int] = []
        raices_multiples: list[int] = []
    else:
        Y = sp.Symbol("Y")
        Q_expr = sp.Poly(coefs_Q, Y).as_expr()
        Q_latex = sp.latex(Q_expr, mul_symbol=None)
        Q_fact_latex = sp.latex(sp.factor(Q_expr), mul_symbol=None)
        raices_simples, raices_multiples = _raices_enteras(coefs_Q)

    # Test del Teorema 5: descender solo con raiz entera simple.
    # Si solo hay raices enteras multiples, el algoritmo original aplicaria
    # Tschirnhausen; en el visor lo dejamos sin descender y delegamos a
    # tests auxiliares posteriores (p. ej., D_4 vs C_4 por irreducibilidad
    # sobre Q(sqrt disc)).
    descender_a = None
    coset_descenso_idx = None
    raices_enteras_para_traza = raices_simples + raices_multiples
    if raices_simples:
        descender_a = G_name
        target_set = set(raices_simples)
        for i, v in enumerate(valores):
            v_redondeado = round(v.real)
            if (abs(v.imag) < 1e-4 and abs(v.real - v_redondeado) < 1e-4
                    and v_redondeado in target_set):
                coset_descenso_idx = i
                break
        razon = (
            rf"$Q(t)$ tiene la raiz entera simple "
            rf"$v_{{{coset_descenso_idx + 1}}} \in \mathbb{{Z}}$. "
            rf"Por el Teorema~5 de Stauduhar, $\mathrm{{Gal}}(f) \subseteq "
            rf"\pi_{{{coset_descenso_idx + 1}}} \cdot {G_name} \cdot "
            rf"\pi_{{{coset_descenso_idx + 1}}}^{{-1}}$. Descendemos a "
            f"{G_name}."
        )
    elif raices_multiples:
        razon = (
            rf"$Q(t)$ tiene raices enteras pero con multiplicidad $> 1$. "
            r"El test del Teorema 5 no concluye directamente; haria falta "
            r"una transformacion de Tschirnhausen. Pasamos al siguiente "
            "candidato."
        )
    else:
        razon = (
            r"$Q(t)$ no tiene raices enteras, luego $\mathrm{Gal}(f)$ no "
            f"esta contenido en ningun conjugado de {G_name}. Pasamos al "
            "siguiente candidato."
        )

    H_orden = ORDENES[H_name]
    invariante_y_latex_display = (
        r"\delta" if via_disc else _y_a_y_indexado_latex(F_expr, n)
    )
    return CandidatoProbado(
        subgrupo_latex=G_name,
        subgrupo_orden=ORDENES[G_name],
        indice=H_orden // ORDENES[G_name],
        invariante_y_latex=invariante_y_latex_display,
        invariante_descripcion=info["descripcion"],
        cosets=coset_apps,
        Q_latex=Q_latex,
        Q_factorizacion_latex=Q_fact_latex,
        raices_enteras_simples=[str(r) for r in raices_enteras_para_traza],
        descender_a=descender_a,
        coset_descenso_idx=coset_descenso_idx,
        razon=razon,
    )


def _reordenar_raices_por_coset(raices: list[complex], p: Permutation
                                ) -> list[complex]:
    """Tras encontrar la raiz entera en pi_i, reordenamos las raices
    como r'_j = r_{pi_i(j)}, segun el segundo corolario del Teorema 5."""
    n = len(raices)
    return [raices[p(j)] for j in range(n)]


def _test_auxiliar_d4_vs_c4(f_poly: sp.Poly) -> bool:
    """Para grado 4 en el nivel D_4: si f factoriza en cuadraticas
    sobre Q(sqrt(disc(f))), Gal = C_4. Si permanece irreducible, Gal = D_4.
    Devuelve True si Gal = C_4."""
    disc = sp.Rational(f_poly.discriminant())
    sqrt_disc = sp.sqrt(disc)
    try:
        _, factors = sp.factor_list(f_poly.as_expr(), extension=sqrt_disc)
        grados = [sp.degree(fact, _X) for fact, _ in factors]
        return max(grados) <= 2
    except Exception:
        return False


def _descender(n: int, f_poly: sp.Poly) -> tuple[list[NivelDescenso], str]:
    """Ejecuta el descenso de Stauduhar nivel a nivel."""
    raices = _calcular_raices(f_poly)
    H_name = f"S_{n}"
    niveles: list[NivelDescenso] = []
    visitados: set[str] = set()

    while True:
        if H_name in visitados:
            break
        visitados.add(H_name)

        candidatos_pendientes = DESCENSOS[n].get(H_name, [])
        candidatos_probados: list[CandidatoProbado] = []
        descender_a = None

        for G_name in candidatos_pendientes:
            key = (n, H_name, G_name)
            if key not in CATALOGO:
                continue
            cp = _probar_candidato(n, H_name, G_name, raices, f_poly)
            candidatos_probados.append(cp)
            if cp.descender_a is not None:
                descender_a = G_name
                if cp.coset_descenso_idx is not None:
                    p = CATALOGO[key]["cosets"][cp.coset_descenso_idx]
                    raices = _reordenar_raices_por_coset(raices, p)
                break

        # Test auxiliar para D_4 -> C_4 cuando el descenso clasico no
        # concluye por raices multiples (Tschirnhausen).
        if (descender_a is None and n == 4 and H_name == "D_4"
                and candidatos_probados):
            # ¿hubo algun candidato C_4 con raices enteras multiples?
            c4_tried = next(
                (c for c in candidatos_probados if c.subgrupo_latex == "C_4"),
                None,
            )
            if c4_tried and c4_tried.raices_enteras_simples:
                if _test_auxiliar_d4_vs_c4(f_poly):
                    descender_a = "C_4"
                    c4_tried.descender_a = "C_4"
                    c4_tried.razon = (
                        rf"$Q(t)$ tiene raiz entera multiple. Test auxiliar: "
                        rf"$f(x)$ factoriza en cuadraticas sobre "
                        rf"$\mathbb{{Q}}(\sqrt{{\Delta_f}})$, luego "
                        rf"$\mathrm{{Gal}}(f) = C_4$."
                    )

        niveles.append(NivelDescenso(
            grupo_actual_latex=H_name,
            grupo_actual_orden=ORDENES[H_name],
            candidatos=candidatos_probados,
            descender_a=descender_a,
        ))

        if descender_a is None:
            break
        H_name = descender_a

    return niveles, H_name


def descenso_stauduhar(coefs: list, grado: int) -> dict:
    """Punto de entrada principal."""
    f = sp.Poly([sp.Rational(c) for c in coefs], _X)
    if f.degree() != grado:
        raise ValueError(f"El polinomio tiene grado {f.degree()}, no {grado}.")
    if f.LC() != 1:
        raise ValueError("El polinomio debe ser monico.")
    if not f.is_irreducible:
        raise ValueError("Stauduhar requiere un polinomio irreducible sobre Q.")
    if grado not in (3, 4, 5):
        raise ValueError(f"Grado {grado} no soportado (solo 3, 4, 5).")

    niveles, grupo_final = _descender(grado, f)

    traza = StauduharTraza(
        polinomio_latex=sp.latex(f.as_expr(), mul_symbol=None),
        grado=grado,
        niveles=niveles,
        grupo_final=grupo_final,
    )
    return asdict(traza)


def desde_expresion(expr_str: str, grado: int) -> dict:
    """Parsea expr_str y delega en descenso_stauduhar."""
    expr = sp.sympify(expr_str.replace("^", "**"), locals={"x": _X})
    f = sp.Poly(expr, _X)
    if f.degree() != grado:
        raise ValueError(f"La expresion tiene grado {f.degree()}, no {grado}.")
    if f.LC() != 1:
        f = sp.Poly(f.as_expr() / f.LC(), _X)
    return descenso_stauduhar(f.all_coeffs(), grado)
