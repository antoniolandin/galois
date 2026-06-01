"""Identificación abstracta de subgrupos vía GAP en subproceso persistente.

GAP arranca lento (~1.6 s de cold start) pero ejecuta una vez arrancado
es rápido (milisegundos por consulta).  Mantenemos un único proceso
GAP vivo durante toda la sesión del backend, mandando comandos por
stdin y leyendo respuestas hasta un sentinel.  El primer `/api/grupo`
paga el coste de arranque; los siguientes son casi instantáneos.

Si GAP no está instalado o el proceso muere, las funciones devuelven
`None` y el caller cae al identificador basado en sympy.

La normalización (`_normalizar_estructura`) traduce la convención de
GAP a la del proyecto:

- Diédricos: GAP usa `D_{2n}` para el diédrico de orden 2n; nosotros
  preferimos `D_n` para el diédrico actuando sobre n puntos.
- Cíclicos, simétricos, alternados: GAP los emite como `C5`, `S5`, `A5`
  (sin guión bajo); aquí se reescriben a `C_5`, `S_5`, `A_5` para
  encajar con el formato que ya consume el frontend.
"""

from __future__ import annotations

import re
import subprocess
import threading
from typing import Sequence

import sympy.combinatorics as comb


# -- Sentinel para marcar el final de cada respuesta -----------------
_SENTINEL = "__GAP_END_42a7b8c1__"


class _GapProcess:
    """Subproceso persistente de GAP. Único y thread-safe."""

    def __init__(self) -> None:
        self._proc: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()

    def _ensure_started(self) -> None:
        if self._proc is not None and self._proc.poll() is None:
            return
        # GAP con -q -b: sin banner ni prompts. stderr a DEVNULL para
        # silenciar los "#I  packagemanager package is not available"
        # y similares que ensucian el parser.
        self._proc = subprocess.Popen(
            ["gap", "-q", "-b"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )

    def query(self, script: str, timeout: float = 30.0) -> str | None:
        """Envía `script` a GAP y devuelve la salida hasta el sentinel.
        Devuelve None si GAP no se puede arrancar o se muere."""
        with self._lock:
            try:
                self._ensure_started()
            except (FileNotFoundError, PermissionError, OSError):
                return None
            proc = self._proc
            if proc is None or proc.stdin is None or proc.stdout is None:
                return None

            payload = script + f'\nPrint("{_SENTINEL}\\n");\n'
            try:
                proc.stdin.write(payload)
                proc.stdin.flush()
            except (BrokenPipeError, OSError):
                self._proc = None
                return None

            lines: list[str] = []
            # Leer hasta encontrar el sentinel. Como subprocess no
            # ofrece readline con timeout directo en stdlib, confiamos
            # en que GAP responde en tiempo razonable.
            while True:
                try:
                    line = proc.stdout.readline()
                except OSError:
                    self._proc = None
                    return None
                if not line:
                    # EOF: GAP murió
                    self._proc = None
                    return None
                if _SENTINEL in line:
                    idx = line.index(_SENTINEL)
                    if idx > 0:
                        lines.append(line[:idx])
                    break
                lines.append(line)
            return "".join(lines)


# Instancia global del proceso GAP (thread-safe via _lock interno).
_gap = _GapProcess()


# -- Construcción del script GAP -------------------------------------
def _perm_a_gap(perm: comb.Permutation) -> str:
    """Convierte una sympy Permutation a notación GAP (ciclos 1-indexed)."""
    cycles = perm.cyclic_form
    if not cycles:
        return "()"
    return "".join(
        "(" + ",".join(str(i + 1) for i in c) + ")" for c in cycles
    )


def _construir_script(
    generadores: Sequence[comb.Permutation], grado: int
) -> str:
    perm_strs = [_perm_a_gap(p) for p in generadores]
    gens_gap = "[" + ", ".join(perm_strs) + "]"
    return (
        f"G := Group({gens_gap});;\n"
        f"n := {grado};;\n"
        f"ord := Order(G);;\n"
        f"desc := StructureDescription(G);;\n"
        f"trans := IsTransitive(G, [1..n]);;\n"
        f'Print("ORD:", ord, "\\n");\n'
        f'Print("DESC:", desc, "\\n");\n'
        f"if trans and n <= 48 then\n"
        f"    tid := TransitiveIdentification(G);;\n"
        f'    Print("TID:", tid, "\\n");\n'
        f"fi;"
    )


# -- Normalización del formato ---------------------------------------
_RE_D = re.compile(r"\bD(\d+)\b")
_RE_LETRA = re.compile(r"\b([CSA])(\d+)\b")


def _normalizar_estructura(desc: str) -> str:
    """Pasa la descripción de GAP al formato del proyecto.

    `S5` → `S_5`, `A5` → `A_5`, `C5` → `C_5`, `D10` → `D_5`.  Para
    expresiones compuestas (`C2 x C3`, `C5 : C4`) reescribe cada
    factor por separado, conservando `x` y `:` que el frontend luego
    transforma en × y ⋊ respectivamente.
    """
    def replace_d(m: re.Match[str]) -> str:
        n = int(m.group(1))
        if n % 2 == 0:
            return f"D_{n // 2}"
        return f"D_{n}"  # raro

    desc = _RE_D.sub(replace_d, desc)
    desc = _RE_LETRA.sub(lambda m: f"{m.group(1)}_{m.group(2)}", desc)
    return desc


# -- API pública -----------------------------------------------------
def identificar_grupo_via_gap(
    generadores: Sequence[comb.Permutation],
    grado: int,
) -> dict | None:
    """Identifica el subgrupo via GAP. Devuelve dict con `estructura`,
    `orden` y `tid` (T-number de TransitiveIdentification, o None si
    no es transitivo o grado > 48). Devuelve None si GAP no responde.
    """
    if not generadores:
        return {"estructura": "trivial", "orden": 1, "tid": None}

    script = _construir_script(generadores, grado)
    output = _gap.query(script)
    if output is None:
        return None

    orden: int | None = None
    desc: str | None = None
    tid: int | None = None
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("ORD:"):
            try:
                orden = int(line[4:].strip())
            except ValueError:
                pass
        elif line.startswith("DESC:"):
            desc = line[5:].strip()
        elif line.startswith("TID:"):
            try:
                tid = int(line[4:].strip())
            except ValueError:
                pass

    if orden is None or desc is None:
        return None

    return {
        "estructura": _normalizar_estructura(desc),
        "orden": orden,
        "tid": tid,
    }
