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

from galois.monodromia import (
    describir_grupo,
    orbitas,
    permutacion_y_trayectorias_de_lazo,
    subgrupo_generado,
)
from galois.polinomio import Polinomio, x5_menos_x_mas_alpha
from galois.raices import raices_en
from galois.ramificacion import puntos_de_ramificacion

from .modelos import (
    Complejo,
    LazoRequest,
    PermutacionResponse,
    PolinomioInfo,
    SubgrupoRequest,
    SubgrupoResponse,
)


# -------------------------------------------------------------------
# Estado matematico de la aplicacion. Fijo por ahora: cuando se anada
# el selector de polinomios, este bloque se vuelve mutable (lock + DI).
# -------------------------------------------------------------------
P: Polinomio = x5_menos_x_mas_alpha()
ALPHA_ESTRELLA: complex = 0 + 0j
RAMIFICACION: np.ndarray = puntos_de_ramificacion(P)
RAICES_BASE: np.ndarray = raices_en(P, ALPHA_ESTRELLA)


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
    return SubgrupoResponse(
        orden=G.order(),
        estructura=describir_grupo(G, req.grado),
        orbitas=[sorted(o) for o in orbitas(G)],
    )
