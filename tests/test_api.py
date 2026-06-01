"""Tests funcionales del backend.

Verifican que los endpoints devuelven el resultado matematicamente
correcto. Para el polinomio canonico P(x, alpha) = x^5 - x + alpha:

  - 4 puntos de ramificacion formando un cuadrado de radio ~0.535.
  - 5 raices en alpha* = 0.
  - Lazo alrededor de un punto de ramificacion -> transposicion.
  - 4 transposiciones (una por cada punto de ramificacion) -> S_5.
"""

import pytest

from tests.conftest import lazo_circular, serializar_lazo


# ---------------------------------------------------------------------
# GET /api/polinomio
# ---------------------------------------------------------------------
def test_polinomio_devuelve_info_correcta(client):
    r = client.get("/api/polinomio")
    assert r.status_code == 200
    data = r.json()

    assert data["grado"] == 5
    assert data["expresion"] == "alpha + x**5 - x"
    assert data["alpha_estrella"] == {"re": 0.0, "im": 0.0}


def test_polinomio_cuatro_puntos_de_ramificacion(client):
    r = client.get("/api/polinomio")
    data = r.json()
    puntos = data["puntos_de_ramificacion"]
    assert len(puntos) == 4

    # Cuadrado de radio 4 / 5^(5/4) ~ 0.535 alrededor del origen.
    for p in puntos:
        radio = (p["re"] ** 2 + p["im"] ** 2) ** 0.5
        assert radio == pytest.approx(0.5350, abs=1e-3)


def test_polinomio_cinco_raices_base(client):
    r = client.get("/api/polinomio")
    data = r.json()
    raices = data["raices_base"]
    assert len(raices) == 5
    # Las raices de x^5 - x = x(x-1)(x+1)(x-i)(x+i) en alpha* = 0
    # son 0, +-1, +-i. Verificamos via modulos: cuatro valen 1, una 0.
    modulos = sorted(round((x["re"] ** 2 + x["im"] ** 2) ** 0.5, 6)
                     for x in raices)
    assert modulos == [0.0, 1.0, 1.0, 1.0, 1.0]


# ---------------------------------------------------------------------
# POST /api/permutacion
# ---------------------------------------------------------------------
def test_lazo_alrededor_de_un_punto_da_transposicion(client):
    """Un lazo simple alrededor de un punto de ramificacion debe
    inducir una transposicion (ciclo de longitud 2)."""
    lazo = lazo_circular(
        centro=0.535 + 0j,
        radio=0.15,
        base=0 + 0j,
        n_pasos=400,
    )
    payload = {
        "lazo": serializar_lazo(lazo),
        "cerrar_en_alpha_estrella": False,
    }
    r = client.post("/api/permutacion", json=payload)
    assert r.status_code == 200
    data = r.json()

    assert len(data["cycles"]) == 1
    assert len(data["cycles"][0]) == 2


def test_permutacion_devuelve_trayectorias_completas(client):
    """Las trayectorias devueltas deben tener shape [n_raices][n_pasos]."""
    n_pasos = 400
    lazo = lazo_circular(0.535 + 0j, 0.15, 0 + 0j, n_pasos)
    payload = {"lazo": serializar_lazo(lazo), "cerrar_en_alpha_estrella": False}
    r = client.post("/api/permutacion", json=payload)
    data = r.json()

    assert len(data["trayectorias"]) == 5  # n raices
    for traj in data["trayectorias"]:
        assert len(traj) == n_pasos


def test_trayectorias_empiezan_y_acaban_en_la_fibra_base(client):
    """La posicion inicial y final de cada raiz debe ser una raiz de la
    fibra base (porque el lazo es cerrado)."""
    lazo = lazo_circular(0.535 + 0j, 0.15, 0 + 0j, 400)
    payload = {"lazo": serializar_lazo(lazo), "cerrar_en_alpha_estrella": False}
    r = client.post("/api/permutacion", json=payload)
    data = r.json()

    iniciales = sorted(
        (round(t[0]["re"], 4), round(t[0]["im"], 4))
        for t in data["trayectorias"]
    )
    finales = sorted(
        (round(t[-1]["re"], 4), round(t[-1]["im"], 4))
        for t in data["trayectorias"]
    )
    assert iniciales == finales


def test_lazo_demasiado_corto_da_400(client):
    payload = {
        "lazo": [{"re": 0.0, "im": 0.0}],  # un solo punto
        "cerrar_en_alpha_estrella": False,
    }
    r = client.post("/api/permutacion", json=payload)
    assert r.status_code == 422  # Pydantic rechaza min_length=2


def test_cerrar_en_alpha_estrella_pre_pospone_el_punto_base(client):
    """Si cerrar_en_alpha_estrella=True, el lazo enviado se envuelve
    automaticamente con alpha_estrella al inicio y al final."""
    # Lazo "abierto" que NO empieza ni acaba en 0.
    lazo = lazo_circular(0.535 + 0j, 0.15, 0.05 + 0j, 200)
    payload = {
        "lazo": serializar_lazo(lazo),
        "cerrar_en_alpha_estrella": True,
    }
    r = client.post("/api/permutacion", json=payload)
    assert r.status_code == 200
    data = r.json()
    # El primer y ultimo punto de cada trayectoria debe ser una raiz
    # de la fibra base (de modulo 0 o 1 para este polinomio).
    for t in data["trayectorias"]:
        for extremo in (t[0], t[-1]):
            r2 = extremo["re"] ** 2 + extremo["im"] ** 2
            assert round(r2, 3) in {0.0, 1.0}


# ---------------------------------------------------------------------
# POST /api/grupo
# ---------------------------------------------------------------------
def test_grupo_de_cuatro_transposiciones_estrella_es_s5(client):
    """Las 4 transposiciones {(0,4), (1,4), (2,4), (3,4)} generan S_5."""
    payload = {
        "generadores": [
            [4, 1, 2, 3, 0],  # (0 4) en formato one-line
            [0, 4, 2, 3, 1],  # (1 4)
            [0, 1, 4, 3, 2],  # (2 4)
            [0, 1, 2, 4, 3],  # (3 4)
        ],
        "grado": 5,
    }
    r = client.post("/api/grupo", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["orden"] == 120
    assert data["estructura"] == "S_5"
    assert data["orbitas"] == [[0, 1, 2, 3, 4]]


def test_grupo_trivial_sin_generadores(client):
    r = client.post("/api/grupo", json={"generadores": [], "grado": 5})
    assert r.status_code == 200
    data = r.json()
    assert data["orden"] == 1
    assert data["estructura"] == "trivial"
    assert data["orbitas"] == [[0], [1], [2], [3], [4]]


def test_grupo_ciclico_3_generado_por_un_3_ciclo(client):
    payload = {
        "generadores": [[1, 2, 0, 3, 4]],  # (0 1 2)
        "grado": 5,
    }
    r = client.post("/api/grupo", json=payload)
    data = r.json()
    assert data["orden"] == 3
    assert data["estructura"] == "C_3"
    assert sorted(data["orbitas"], key=len) == [[3], [4], [0, 1, 2]]


def test_grupo_grado_incompatible_da_400(client):
    """Si un generador no tiene longitud `grado` se devuelve 400."""
    payload = {
        "generadores": [[0, 1, 2]],  # longitud 3
        "grado": 5,
    }
    r = client.post("/api/grupo", json=payload)
    assert r.status_code == 400
