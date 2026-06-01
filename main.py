"""POC del visualizador interactivo del grupo de Galois por monodromia.

Stack: Trame (UI web) + Plotly (vista 2D del plano alpha con dibujo a
mano alzada) + sympy (calculo del subgrupo y de las orbitas).

Polinomio fijo: P(x, alpha) = x^5 - x + alpha (caso canonico del TFG).
Punto base: alpha* = 0.

Uso:
    uv sync
    uv run python main.py
    # Abrir http://localhost:8080 en el navegador

Funcionamiento de la UI:
    1. Haz clic y arrastra sobre el plano alpha para trazar un lazo,
       partiendo cerca del triangulo negro (alpha*) y rodeando uno o
       varios puntos de ramificacion (circulos rojos).
    2. Pulsa "Calcular permutacion" para procesar el lazo trazado.
    3. El panel lateral mostrara la permutacion incorporada y el
       subgrupo generado hasta el momento.
    4. Repite para descubrir nuevos generadores. "Reset" limpia el
       estado y borra los lazos dibujados.
"""

import re

import numpy as np
import plotly.graph_objects as go
import sympy.combinatorics as comb

from trame.app import get_server
from trame.ui.vuetify3 import SinglePageLayout
from trame.widgets import html, plotly, vuetify3

from galois.monodromia import (
    describir_grupo,
    orbitas,
    permutacion_de_lazo,
    subgrupo_generado,
)
from galois.polinomio import x5_menos_x_mas_alpha
from galois.raices import raices_en
from galois.ramificacion import puntos_de_ramificacion


# ---------------------------------------------------------------------
# Setup matematico (constante durante toda la sesion del POC)
# ---------------------------------------------------------------------
P = x5_menos_x_mas_alpha()
N = P.grado
ALPHA_ESTRELLA = 0 + 0j
RAMIFICACION = puntos_de_ramificacion(P)
RAICES_BASE = raices_en(P, ALPHA_ESTRELLA)

# Paleta Okabe-Ito
COLOR_RAMIF = "#D55E00"
COLOR_BASE = "#000000"
COLOR_LAZO = "#0072B2"


# ---------------------------------------------------------------------
# Utilidades de formato
# ---------------------------------------------------------------------
def formato_orbitas(orbs) -> str:
    return "   ".join(
        "{" + ", ".join(str(i) for i in sorted(o)) + "}" for o in orbs
    )


def formato_permutacion(p: comb.Permutation) -> str:
    cycles = p.cyclic_form
    if not cycles:
        return "id"
    return " ".join(
        "(" + " ".join(str(i) for i in c) + ")" for c in cycles
    )


def formato_lista_permutaciones(perms) -> str:
    if not perms:
        return "(ninguna)"
    return "\n".join(formato_permutacion(p) for p in perms)


# ---------------------------------------------------------------------
# Construccion de la figura
# ---------------------------------------------------------------------
def construir_figura_alpha() -> go.Figure:
    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=RAMIFICACION.real,
            y=RAMIFICACION.imag,
            mode="markers",
            marker=dict(
                color=COLOR_RAMIF,
                size=14,
                line=dict(color="black", width=1.4),
            ),
            name="puntos de ramificación",
            hovertemplate="ramificación<br>α = %{x:.3f} %{y:+.3f}i<extra></extra>",
        )
    )
    fig.add_trace(
        go.Scatter(
            x=[ALPHA_ESTRELLA.real],
            y=[ALPHA_ESTRELLA.imag],
            mode="markers",
            marker=dict(
                color=COLOR_BASE,
                symbol="triangle-up",
                size=16,
                line=dict(color="black", width=1.4),
            ),
            name="α* (base)",
            hovertemplate="α* = 0<extra></extra>",
        )
    )
    fig.update_layout(
        dragmode="drawopenpath",
        newshape=dict(line=dict(color=COLOR_LAZO, width=2.5)),
        xaxis=dict(
            range=[-0.9, 0.9],
            scaleanchor="y",
            scaleratio=1,
            zeroline=True,
            zerolinecolor="#dddddd",
            title="Re α",
        ),
        yaxis=dict(
            range=[-0.9, 0.9],
            zeroline=True,
            zerolinecolor="#dddddd",
            title="Im α",
        ),
        plot_bgcolor="white",
        paper_bgcolor="white",
        margin=dict(l=40, r=20, t=20, b=40),
        showlegend=True,
        legend=dict(x=0.01, y=0.99, bgcolor="rgba(255,255,255,0.8)"),
    )
    return fig


# Plotly entrega el path como 'M-0.12,0.45L-0.11,0.47L...', sin
# espacios entre los comandos SVG y las coordenadas. Reemplazamos las
# letras de comando y las comas por espacios y leemos pares de floats.
_RE_COMANDOS_SVG = re.compile(r"[MLHVCSQTAZmlhvcsqtaz]")


def lazo_desde_path(path_str: str) -> np.ndarray | None:
    """Parsea una cadena SVG 'M x0,y0 L x1,y1 L ...' a un array de
    complejos. Devuelve None si el path no contiene al menos dos
    coordenadas."""
    if not path_str:
        return None
    limpio = _RE_COMANDOS_SVG.sub(" ", path_str).replace(",", " ")
    tokens = limpio.split()
    coords: list[complex] = []
    for i in range(0, len(tokens) - 1, 2):
        try:
            x = float(tokens[i])
            y = float(tokens[i + 1])
            coords.append(x + 1j * y)
        except ValueError:
            continue
    if len(coords) < 2:
        return None
    return np.asarray(coords, dtype=complex)


# ---------------------------------------------------------------------
# Trame server
# ---------------------------------------------------------------------
server = get_server(client_type="vue3")
state, ctrl = server.state, server.controller

generadores: list[comb.Permutation] = []

# Referencia al widget Plotly. Se asigna al construir el layout y se
# utiliza desde reset() para inyectar una figura nueva (los lazos
# dibujados por el usuario forman parte de la layout de Plotly, asi
# que para borrarlos basta con sustituir la figura entera).
fig_widget: plotly.Figure | None = None

state.shapes_dibujadas = []
state.estructura_grupo = "trivial"
state.orden_grupo = 1
state.generadores_str = "(ninguna)"
state.orbitas_str = formato_orbitas([{i} for i in range(N)])
state.mensaje_status = ""


def actualizar_panel() -> None:
    G = subgrupo_generado(generadores, N)
    state.estructura_grupo = describir_grupo(G, N)
    state.orden_grupo = G.order()
    state.generadores_str = formato_lista_permutaciones(generadores)
    state.orbitas_str = formato_orbitas(orbitas(G))


def on_relayout(event=None):
    if not event:
        return
    if "shapes" in event and isinstance(event["shapes"], list):
        state.shapes_dibujadas = event["shapes"]


def calcular_permutacion():
    shapes = list(state.shapes_dibujadas or [])
    if not shapes:
        state.mensaje_status = "No hay lazos dibujados."
        return
    ultima = shapes[-1]
    path_str = ultima.get("path") if isinstance(ultima, dict) else None
    if not path_str:
        state.mensaje_status = "El último elemento dibujado no es un trazo libre."
        return
    lazo = lazo_desde_path(path_str)
    if lazo is None or len(lazo) < 3:
        state.mensaje_status = "El lazo es demasiado corto."
        return
    # Cerrar forzando inicio y fin en alpha_estrella.
    lazo = np.concatenate([[ALPHA_ESTRELLA], lazo, [ALPHA_ESTRELLA]])
    try:
        sigma = permutacion_de_lazo(P, ALPHA_ESTRELLA, lazo, RAICES_BASE)
    except Exception as exc:  # noqa: BLE001
        state.mensaje_status = f"Error en la continuación: {exc}"
        return
    generadores.append(sigma)
    actualizar_panel()
    state.mensaje_status = (
        f"Permutación añadida: {formato_permutacion(sigma)}. "
        f"Subgrupo actual: {state.estructura_grupo} (orden {state.orden_grupo})."
    )


def reset():
    generadores.clear()
    if fig_widget is not None:
        fig_widget.update(construir_figura_alpha())
    state.shapes_dibujadas = []
    state.mensaje_status = "Reset."
    actualizar_panel()


ctrl.on_relayout = on_relayout
ctrl.calcular = calcular_permutacion
ctrl.reset = reset


# ---------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------
INSTRUCCIONES = (
    "1. Haz clic y arrastra sobre el plano para trazar un lazo "
    "partiendo del triángulo negro (α*).\n"
    "2. Rodea uno o varios puntos de ramificación (círculos rojos) y "
    "vuelve cerca del punto base.\n"
    "3. Pulsa \"Calcular permutación\" para procesar el lazo.\n"
    "4. Repite para añadir más generadores. \"Reset\" reinicia todo."
)

with SinglePageLayout(server) as layout:
    layout.title.set_text("Visualizador de monodromía — POC")

    with layout.content:
        with vuetify3.VContainer(fluid=True, classes="pa-2"):
            with vuetify3.VRow(no_gutters=True):
                # --- Columna del gráfico (plano alpha) ---
                with vuetify3.VCol(cols=8, classes="pa-2"):
                    fig_widget = plotly.Figure(
                        figure=construir_figura_alpha(),
                        relayout=(ctrl.on_relayout, "[$event]"),
                        style="width: 100%; height: 78vh;",
                    )

                # --- Columna del panel lateral ---
                with vuetify3.VCol(cols=4, classes="pa-2"):
                    with vuetify3.VCard(classes="mb-3"):
                        vuetify3.VCardTitle("Instrucciones")
                        vuetify3.VCardText(
                            INSTRUCCIONES,
                            style="white-space: pre-wrap; font-size: 0.9em;",
                        )

                    with vuetify3.VCard(classes="mb-3"):
                        vuetify3.VCardTitle("Controles")
                        with vuetify3.VCardActions():
                            vuetify3.VBtn(
                                "Calcular permutación",
                                color="primary",
                                variant="elevated",
                                click=ctrl.calcular,
                            )
                            vuetify3.VBtn(
                                "Reset",
                                color="warning",
                                variant="outlined",
                                click=ctrl.reset,
                            )
                        vuetify3.VCardText(
                            "{{ mensaje_status }}",
                            style="font-size: 0.85em; color: #555; min-height: 1.5em;",
                        )

                    with vuetify3.VCard():
                        vuetify3.VCardTitle("Subgrupo descubierto")
                        with vuetify3.VCardText(
                            style="font-family: monospace; line-height: 1.7;"
                        ):
                            with html.Div():
                                html.Span("Estructura: ")
                                html.Strong("{{ estructura_grupo }}")
                            with html.Div():
                                html.Span("Orden: ")
                                html.Strong("{{ orden_grupo }}")
                            html.Br()
                            html.Strong("Generadores:")
                            html.Div(
                                "{{ generadores_str }}",
                                style="white-space: pre; margin-top: 4px;",
                            )
                            html.Br()
                            html.Strong("Órbitas:")
                            html.Div(
                                "{{ orbitas_str }}",
                                style="white-space: pre; margin-top: 4px;",
                            )


if __name__ == "__main__":
    server.start()
