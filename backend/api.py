"""FastAPI app del visualizador.

Endpoints:
    GET  /api/polinomio    - informacion del polinomio actual
    POST /api/permutacion  - dado un lazo, devuelve sigma y las trayectorias
    POST /api/grupo        - dado un conjunto de permutaciones, describe el subgrupo

Arrancar en desarrollo:
    uv run uvicorn backend.api:app --reload --port 8000
"""

import numpy as np
import sympy.combinatorics as comb
from fastapi import FastAPI, HTTPException

from galois.galois_objetivo import calcular_grupo_galois
from galois.identificacion import identificar_grupo_via_gap
from galois.monodromia import (
    describir_grupo,
    orbitas,
    permutacion_y_trayectorias_de_lazo,
    subgrupo_generado,
)
from galois.polinomio import Polinomio, desde_expresion, x5_menos_x_mas_alpha
from galois.raices import raices_en
from galois.ramificacion import puntos_de_ramificacion
from galois.stauduhar import desde_expresion as stauduhar_desde_expresion

from .modelos import (
    Complejo,
    GrupoObjetivoResponse,
    LazoRequest,
    PermutacionResponse,
    PolinomioInfo,
    PolinomioRequest,
    StauduharRequest,
    StauduharResponse,
    SubgrupoRequest,
    SubgrupoResponse,
)


# -------------------------------------------------------------------
# Estado matematico de la aplicacion. Fijo por ahora: cuando se anada
# el selector de polinomios, este bloque se vuelve mutable (lock + DI).
# -------------------------------------------------------------------
MARGEN_ALPHA_BRANCH: float = 0.08


def _elegir_alpha_estrella(ramif: np.ndarray) -> complex:
    """Devuelve un punto base alpha_estrella seguro: alejado al menos
    `MARGEN_ALPHA_BRANCH` de cualquier punto de ramificacion. El
    candidato por defecto es 0 + 0j (la posicion mas natural); si
    cae cerca de un branch (como en `x^4 + alpha`, donde B = {0}),
    se prueba un anillo de ocho puntos a radio `max|B| + 0.5`."""
    cand = [0 + 0j]
    if len(ramif) > 0:
        max_r = float(max(abs(b) for b in ramif))
        r_seg = max_r + 0.5
        for k in range(8):
            ang = 2 * np.pi * k / 8
            cand.append(complex(r_seg * np.cos(ang), r_seg * np.sin(ang)))
    for c in cand:
        if len(ramif) == 0:
            return c
        dist_min = float(min(abs(c - b) for b in ramif))
        if dist_min >= MARGEN_ALPHA_BRANCH:
            return c
    return cand[-1]


P: Polinomio = x5_menos_x_mas_alpha()
RAMIFICACION: np.ndarray = puntos_de_ramificacion(P)
ALPHA_ESTRELLA: complex = _elegir_alpha_estrella(RAMIFICACION)
RAICES_BASE: np.ndarray = raices_en(P, ALPHA_ESTRELLA)
# Grupo de Galois objetivo del polinomio actual sobre C(alpha). Se
# precomputa una sola vez al arrancar la API; al cambiar de polinomio
# habrá que recalcularlo igual que el resto del bloque.
GRUPO_GALOIS: dict = calcular_grupo_galois(P, ALPHA_ESTRELLA, RAMIFICACION)


app = FastAPI(
    title="Galois Monodromy API",
    description=(
        "API JSON del visualizador interactivo del grupo de Galois por "
        "monodromia. Sirve geometria base (puntos de ramificacion, "
        "fibra base) y procesa lazos del frontend devolviendo "
        "permutaciones y trayectorias precomputadas para animacion."
    ),
    version="0.1.0",
)


def _calcular_branch_x(polinomio: Polinomio, ramif: np.ndarray) -> list[complex]:
    """Para cada alpha_b en `ramif`, encuentra las raices dobles
    de P en x: ceros simultaneos de P(x, alpha_b) y dP/dx(x, alpha_b).
    Numericamente: raices de P_x en x; filtrar las que tambien
    anulan P (con tolerancia)."""
    if len(ramif) == 0:
        return []
    import sympy as sp

    x_sym, alpha_sym = sp.symbols("x alpha")
    px_expr = sp.diff(polinomio.expresion, x_sym)
    poly_px = sp.Poly(px_expr, x_sym)
    coefs_alpha = poly_px.all_coeffs()
    fila_funcs = [sp.lambdify((alpha_sym,), c, "numpy") for c in coefs_alpha]
    salida: list[complex] = []
    for a_b in ramif:
        a_b_c = complex(a_b)
        coefs_num = np.asarray(
            [complex(f(a_b_c)) for f in fila_funcs], dtype=complex
        )
        if len(coefs_num) < 2:
            continue
        roots = np.roots(coefs_num)
        for r in roots:
            r_c = complex(r)
            val = complex(polinomio.evaluar(r_c, a_b_c))
            if abs(val) < 1e-5:
                salida.append(r_c)
    return salida


def _serializar_coefs_alpha(polinomio: Polinomio) -> list[list[Complejo]]:
    """Convierte P(x, alpha) = sum_k a_k(alpha) * x^k en una lista
    serializable: coefs_alpha[k] = coeficientes de a_k(alpha) en
    orden de grado decreciente en alpha. Permite reconstruir P/Px/Pa
    desde el frontend sin recurrir a sympy."""
    import sympy as sp

    x_sym, alpha_sym = sp.symbols("x alpha")
    poly_x = sp.Poly(polinomio.expresion, x_sym)
    salida: list[list[Complejo]] = []
    for coef_expr in poly_x.all_coeffs():
        poly_a = sp.Poly(coef_expr, alpha_sym)
        all_a = poly_a.all_coeffs() or [sp.Integer(0)]
        salida.append(
            [Complejo.desde(complex(c)) for c in all_a],
        )
    return salida


@app.get("/api/polinomio", response_model=PolinomioInfo)
def polinomio_info() -> PolinomioInfo:
    """Snapshot del polinomio actual: expresion, grado, punto base,
    puntos de ramificacion y fibra sobre alpha_estrella."""
    return PolinomioInfo(
        expresion=str(P.expresion),
        grado=P.grado,
        alpha_estrella=Complejo.desde(ALPHA_ESTRELLA),
        puntos_de_ramificacion=[Complejo.desde(b) for b in RAMIFICACION],
        raices_base=[Complejo.desde(x) for x in RAICES_BASE],
        branch_x=[Complejo.desde(b) for b in _calcular_branch_x(P, RAMIFICACION)],
        coefs_alpha=_serializar_coefs_alpha(P),
    )


@app.post("/api/polinomio", response_model=PolinomioInfo)
def set_polinomio(req: PolinomioRequest) -> PolinomioInfo:
    """Reemplaza el polinomio actual por el que indica el cliente.

    Acepta sintaxis sympy estandar (`x**5 - x + alpha`), con `^` como
    sinonimo de `**` y con `α` como alias de `alpha`. Recalcula
    ALPHA_ESTRELLA, RAMIFICACION, RAICES_BASE y GRUPO_GALOIS. Si la
    expresion no es un polinomio valido en x con coeficientes en
    C[alpha] devuelve 400 sin tocar el estado global."""
    global P, ALPHA_ESTRELLA, RAMIFICACION, RAICES_BASE, GRUPO_GALOIS
    import sympy as sp

    expr_str = req.expresion.replace("^", "**").replace("α", "alpha")
    x_sym, alpha_sym = sp.symbols("x alpha")
    try:
        expr = sp.sympify(expr_str, locals={"x": x_sym, "alpha": alpha_sym})
    except (sp.SympifyError, SyntaxError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"Sintaxis invalida: {e}")
    libres = expr.free_symbols
    if x_sym not in libres:
        raise HTTPException(status_code=400, detail="La expresion debe contener la variable x.")
    if alpha_sym not in libres:
        raise HTTPException(status_code=400, detail="La expresion debe contener la variable alpha (α).")
    extras = libres - {x_sym, alpha_sym}
    if extras:
        nombres = ", ".join(sorted(str(s) for s in extras))
        raise HTTPException(
            status_code=400,
            detail=f"Solo se permiten las variables x y alpha; sobran: {nombres}.",
        )
    try:
        P_nuevo = desde_expresion(expr)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"No es un polinomio valido en x con coeficientes en C[alpha]: {e}",
        )
    P = P_nuevo
    RAMIFICACION = puntos_de_ramificacion(P)
    ALPHA_ESTRELLA = _elegir_alpha_estrella(RAMIFICACION)
    RAICES_BASE = raices_en(P, ALPHA_ESTRELLA)
    GRUPO_GALOIS = calcular_grupo_galois(P, ALPHA_ESTRELLA, RAMIFICACION)
    return polinomio_info()


@app.get("/api/galois-objetivo", response_model=GrupoObjetivoResponse)
def galois_objetivo() -> GrupoObjetivoResponse:
    """Grupo de Galois objetivo del polinomio actual sobre C(alpha).
    El resultado se precomputa al arrancar la API (ver `GRUPO_GALOIS`)
    aplicando Hauenstein sin animar y delegando en GAP, así el
    frontend puede comparar contra él en O(1) para saber si el
    subgrupo descubierto ya cubre el grupo completo."""
    return GrupoObjetivoResponse(
        estructura=str(GRUPO_GALOIS.get("estructura", "?")),
        orden=int(GRUPO_GALOIS.get("orden", 1)),
    )


@app.post("/api/permutacion", response_model=PermutacionResponse)
def permutacion(req: LazoRequest) -> PermutacionResponse:
    """Calcula la permutacion inducida por el lazo dado y devuelve las
    trayectorias completas de las n raices a lo largo del recorrido."""
    lazo = np.array([p.a_complex() for p in req.lazo], dtype=complex)
    if req.cerrar_en_alpha_estrella:
        lazo = np.concatenate([[ALPHA_ESTRELLA], lazo, [ALPHA_ESTRELLA]])

    if len(lazo) < 3:
        raise HTTPException(
            status_code=400,
            detail="El lazo debe contener al menos tres puntos tras el cierre.",
        )

    try:
        sigma, trayectorias = permutacion_y_trayectorias_de_lazo(
            P, ALPHA_ESTRELLA, lazo, RAICES_BASE
        )
    except (ZeroDivisionError, OverflowError) as exc:
        raise HTTPException(
            status_code=422,
            detail=(
                "La continuacion fallo (probablemente el lazo pasa demasiado "
                f"cerca de un punto de ramificacion): {exc}"
            ),
        ) from exc

    return PermutacionResponse(
        asignacion=list(sigma.array_form),
        cycles=[list(c) for c in sigma.cyclic_form],
        trayectorias=[
            [Complejo.desde(z) for z in trayectorias[i]]
            for i in range(P.grado)
        ],
    )


@app.post("/api/grupo", response_model=SubgrupoResponse)
def grupo(req: SubgrupoRequest) -> SubgrupoResponse:
    """Construye el subgrupo de S_n generado por las permutaciones
    dadas y devuelve su descripcion abstracta, orden y orbitas."""
    for g in req.generadores:
        if len(g) != req.grado:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Generador de longitud {len(g)} no compatible con "
                    f"grado {req.grado}."
                ),
            )

    generadores = [comb.Permutation(g, size=req.grado) for g in req.generadores]
    G = subgrupo_generado(generadores, req.grado)
    orbs = [sorted(o) for o in orbitas(G)]

    # Intentamos GAP primero para obtener la descripción completa.
    # Si GAP no responde, caemos a describir_grupo (sympy básico).
    generadores_no_triv = [g for g in generadores if g.cyclic_form]
    gap_info = identificar_grupo_via_gap(generadores_no_triv, req.grado)
    if gap_info is not None:
        return SubgrupoResponse(
            orden=gap_info["orden"],
            estructura=gap_info["estructura"],
            grado=req.grado,
            orbitas=orbs,
            is_abelian=gap_info["is_abelian"],
            is_solvable=gap_info["is_solvable"],
            is_nilpotent=gap_info["is_nilpotent"],
            is_perfect=gap_info["is_perfect"],
            is_simple=gap_info["is_simple"],
            is_transitive=gap_info["is_transitive"],
            is_primitive=gap_info["is_primitive"],
            tid=gap_info["tid"],
            center_order=gap_info["center_order"],
            composition_factors=gap_info["composition_factors"],
            lattice=gap_info.get("lattice"),
        )

    # Fallback sympy: campos extra quedan en None / [].
    return SubgrupoResponse(
        orden=G.order(),
        estructura=describir_grupo(G, req.grado, generadores=generadores),
        grado=req.grado,
        orbitas=orbs,
    )


@app.post("/api/stauduhar", response_model=StauduharResponse)
def stauduhar(req: StauduharRequest) -> StauduharResponse:
    """Descenso de Stauduhar sobre un polinomio f(x) en Q[x] para
    grado 3 o 4. Devuelve la traza paso a paso del descenso por
    discriminante y resolvente cubica, con los polinomios resolventes,
    sus factorizaciones sobre Q y la decision en cada paso."""
    try:
        resultado = stauduhar_desde_expresion(req.expresion, req.grado)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"No se pudo procesar el polinomio: {exc}",
        ) from exc
    return StauduharResponse(**resultado)


# -- Frontend compilado (solo en despliegue) ------------------------
# En desarrollo el frontend lo sirve vite con proxy /api -> :8000; en
# Docker (HF Spaces, Fly, etc.) el bundle vive en ./frontend_dist y lo
# servimos desde el mismo contenedor para evitar CORS y simplificar el
# despliegue. El mount va al final para no eclipsar las rutas /api.
from pathlib import Path
from fastapi.staticfiles import StaticFiles

_frontend_dist = Path(__file__).resolve().parent.parent / "frontend_dist"
if _frontend_dist.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=_frontend_dist, html=True),
        name="frontend",
    )
