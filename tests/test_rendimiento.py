"""Tests de latencia del backend.

No miden CPU bruta sino el tiempo end-to-end de cada endpoint (incluye
parsing JSON, validacion Pydantic y serializacion de respuesta), que
es lo que el frontend va a percibir.

Los limites son generosos para no romper en maquinas lentas; sirven
como red de seguridad ante regresiones obvias, no como benchmark
preciso. Los tiempos reales se imprimen en cada test."""

import time

import pytest

from tests.conftest import lazo_circular, serializar_lazo


def _medir(funcion, repeticiones: int) -> tuple[float, float]:
    """Ejecuta `funcion` varias veces y devuelve (media, mejor)
    en segundos."""
    tiempos: list[float] = []
    for _ in range(repeticiones):
        t0 = time.perf_counter()
        funcion()
        tiempos.append(time.perf_counter() - t0)
    return sum(tiempos) / len(tiempos), min(tiempos)


# ---------------------------------------------------------------------
# GET /api/polinomio - debe ser practicamente instantaneo
# ---------------------------------------------------------------------
def test_latencia_get_polinomio(client, capsys):
    def hit():
        r = client.get("/api/polinomio")
        r.raise_for_status()

    media, mejor = _medir(hit, repeticiones=20)
    with capsys.disabled():
        print(f"\n  GET /api/polinomio:   "
              f"media {media * 1000:6.2f}ms,  mejor {mejor * 1000:6.2f}ms")
    assert mejor < 0.1, f"Demasiado lento: {mejor * 1000:.1f}ms"


# ---------------------------------------------------------------------
# POST /api/grupo - identificación de subgrupo + retículo completo.
# La query GAP calcula StructureDescription, propiedades abstractas y
# el retículo de subgrupos (LatticeSubgroups + clases + maximales),
# por lo que la latencia warm es del orden de cientos de ms.
# ---------------------------------------------------------------------
def test_latencia_post_grupo_s5(client, capsys):
    payload = {
        "generadores": [
            [4, 1, 2, 3, 0],
            [0, 4, 2, 3, 1],
            [0, 1, 4, 3, 2],
            [0, 1, 2, 4, 3],
        ],
        "grado": 5,
    }

    def hit():
        r = client.post("/api/grupo", json=payload)
        r.raise_for_status()

    media, mejor = _medir(hit, repeticiones=10)
    with capsys.disabled():
        print(f"\n  POST /api/grupo (S_5): "
              f"media {media * 1000:6.2f}ms,  mejor {mejor * 1000:6.2f}ms")
    assert mejor < 0.5


# ---------------------------------------------------------------------
# POST /api/permutacion - escalado con el numero de pasos del lazo
# ---------------------------------------------------------------------
@pytest.mark.parametrize(
    "n_pasos, limite_seg",
    [
        (100, 0.5),
        (400, 2.0),
        (1000, 5.0),
    ],
)
def test_latencia_post_permutacion(client, n_pasos, limite_seg, capsys):
    """Escalado lineal aproximado con n_pasos. El frontend tipicamente
    enviara lazos de 200-500 puntos (depende de la velocidad del raton
    del usuario)."""
    lazo = lazo_circular(
        centro=0.535 + 0j,
        radio=0.15,
        base=0 + 0j,
        n_pasos=n_pasos,
    )
    payload = {
        "lazo": serializar_lazo(lazo),
        "cerrar_en_alpha_estrella": False,
    }

    def hit():
        r = client.post("/api/permutacion", json=payload)
        r.raise_for_status()

    media, mejor = _medir(hit, repeticiones=3)
    with capsys.disabled():
        print(f"\n  POST /api/permutacion (N={n_pasos:>4}): "
              f"media {media * 1000:7.1f}ms,  mejor {mejor * 1000:7.1f}ms")
    assert mejor < limite_seg, (
        f"Latencia para N={n_pasos} es {mejor:.3f}s > limite {limite_seg}s"
    )
