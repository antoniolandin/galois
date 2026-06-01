"""Fixtures compartidos por los tests del backend."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.api import app


@pytest.fixture
def client() -> TestClient:
    """Cliente HTTP de pruebas. Llama directamente a la app FastAPI in-process."""
    return TestClient(app)


def lazo_circular(
    centro: complex,
    radio: float,
    base: complex,
    n_pasos: int,
) -> np.ndarray:
    """Construye un lazo basado en `base` que rodea `centro` con `radio`.

    Tres tramos: ida en recta de `base` a un punto del circulo, circulo
    completo, y vuelta en recta a `base`. La longitud total es n_pasos.

    Util para los tests funcionales y de rendimiento."""
    n_in = max(2, n_pasos // 20)
    n_out = n_in
    n_circ = n_pasos - n_in - n_out
    direccion = (base - centro) / abs(base - centro)
    pe = centro + direccion * radio
    in_pts = np.linspace(base, pe, n_in)
    theta0 = float(np.angle(pe - centro))
    theta = theta0 + np.linspace(0, 2 * np.pi, n_circ)
    circ = centro + radio * np.exp(1j * theta)
    out_pts = np.linspace(pe, base, n_out)
    return np.concatenate([in_pts, circ, out_pts])


def serializar_lazo(lazo: np.ndarray) -> list[dict]:
    """Convierte un array de complejos a la representacion JSON
    esperada por el endpoint."""
    return [{"re": float(z.real), "im": float(z.imag)} for z in lazo]
