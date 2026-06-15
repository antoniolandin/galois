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
        # Lo envolvemos en `stdbuf -oL` para forzar line-buffering en
        # stdout: sin TTY (caso Docker / subprocess sin pty) GAP bloque-
        # buffea por defecto y el lector se cuelga esperando respuesta.
        self._proc = subprocess.Popen(
            ["stdbuf", "-oL", "gap", "-q", "-b"],
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
        f'Print("ORD:", Order(G), "\\n");\n'
        f'Print("DESC:", StructureDescription(G), "\\n");\n'
        f'Print("ABEL:", IsAbelian(G), "\\n");\n'
        f'Print("SOLV:", IsSolvable(G), "\\n");\n'
        f'Print("NILP:", IsNilpotent(G), "\\n");\n'
        f'Print("PERF:", IsPerfect(G), "\\n");\n'
        f'Print("SIMP:", IsSimple(G), "\\n");\n'
        f'Print("CENT:", Order(Center(G)), "\\n");\n'
        f"cs := CompositionSeries(G);;\n"
        f"cf := List([1..Length(cs)-1], i -> StructureDescription(cs[i]/cs[i+1]));;\n"
        f'Print("CF:", JoinStringsWithSeparator(cf, "|"), "\\n");\n'
        f"trans := IsTransitive(G, [1..n]);;\n"
        f'Print("TRAN:", trans, "\\n");\n'
        f"if trans and n <= 48 then\n"
        f'    Print("TID:", TransitiveIdentification(G), "\\n");\n'
        f'    Print("PRIM:", IsPrimitive(G, [1..n]), "\\n");\n'
        f"fi;\n"
        # --- Retículo de subgrupos (por clases de conjugación) ---
        # Usamos @ como delimitador entre campos de LC porque la
        # estructura puede contener ":" (p. ej. "C5 : C4", grupo de
        # Frobenius F_20). Y "@" no aparece en StructureDescription.
        f"L := LatticeSubgroups(G);;\n"
        f"cc := ConjugacyClassesSubgroups(L);;\n"
        f"nl := Length(cc);;\n"
        f'Print("LN:", nl, "\\n");\n'
        f"for i in [1..nl] do\n"
        f"    rep := Representative(cc[i]);;\n"
        f'    Print("LC@", i, "@", Order(rep), "@", StructureDescription(rep), "@", Size(cc[i]), "@", IsNormal(G, rep), "\\n");\n'
        f"od;\n"
        f"for i in [1..nl] do\n"
        f"    rep := Representative(cc[i]);;\n"
        f"    if Order(rep) > 1 then\n"
        f"        for m in MaximalSubgroupClassReps(rep) do\n"
        f"            for j in [1..nl] do\n"
        f"                if m in cc[j] then\n"
        f'                    Print("LE@", j, "@", i, "\\n");\n'
        f"                    break;\n"
        f"                fi;\n"
        f"            od;\n"
        f"        od;\n"
        f"    fi;\n"
        f"od;"
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
def _parsear_bool(s: str) -> bool | None:
    s = s.strip().lower()
    if s == "true":
        return True
    if s == "false":
        return False
    return None


def identificar_grupo_via_gap(
    generadores: Sequence[comb.Permutation],
    grado: int,
) -> dict | None:
    """Identifica el subgrupo via GAP. Devuelve un dict con:
    - `estructura`: descripción normalizada (`S_5`, `D_5`, etc.).
    - `orden`: cardinal del subgrupo.
    - `is_abelian`, `is_solvable`, `is_nilpotent`, `is_perfect`,
      `is_simple`: booleanos.
    - `is_transitive`: bool.
    - `is_primitive`: bool o None (solo si transitivo y grado ≤ 48).
    - `tid`: T-number de TransitiveIdentification o None.
    - `center_order`: orden del centro Z(G).
    - `composition_factors`: lista de descripciones de los factores
      de la serie de composición, ya normalizadas.

    Devuelve None si GAP no responde correctamente o no está disponible.
    """
    if not generadores:
        return {
            "estructura": "trivial",
            "orden": 1,
            "is_abelian": True,
            "is_solvable": True,
            "is_nilpotent": True,
            "is_perfect": True,
            "is_simple": False,
            "is_transitive": False,
            "is_primitive": None,
            "tid": None,
            "center_order": 1,
            "composition_factors": [],
            "lattice": {
                "nodos": [
                    {
                        "id": 1,
                        "orden": 1,
                        "estructura": "trivial",
                        "tam_clase": 1,
                        "es_normal": True,
                    }
                ],
                "aristas": [],
            },
        }

    script = _construir_script(generadores, grado)
    output = _gap.query(script)
    if output is None:
        return None

    fields: dict[str, str] = {}
    # Líneas LC (nodos del retículo) y LE (aristas) las recogemos
    # aparte porque hay una por nodo / arista, no una sola por tag.
    lattice_nodes_lines: list[str] = []
    lattice_edge_lines: list[str] = []
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("LC@"):
            lattice_nodes_lines.append(line[3:])
            continue
        if line.startswith("LE@"):
            lattice_edge_lines.append(line[3:])
            continue
        for tag in (
            "ORD", "DESC", "ABEL", "SOLV", "NILP", "PERF", "SIMP",
            "CENT", "CF", "TRAN", "TID", "PRIM", "LN",
        ):
            if line.startswith(f"{tag}:"):
                fields[tag] = line[len(tag) + 1:].strip()
                break

    if "ORD" not in fields or "DESC" not in fields:
        return None

    try:
        orden = int(fields["ORD"])
        center_order = int(fields["CENT"])
    except (ValueError, KeyError):
        return None

    cf_raw = fields.get("CF", "")
    composition_factors = (
        [_normalizar_estructura(c) for c in cf_raw.split("|") if c]
        if cf_raw
        else []
    )

    tid = None
    if "TID" in fields:
        try:
            tid = int(fields["TID"])
        except ValueError:
            pass

    # Parsear nodos del retículo: cada línea LC tiene el formato
    # "id:orden:estructura:tam_clase:es_normal".
    nodos = []
    for raw in lattice_nodes_lines:
        parts = raw.split("@")
        if len(parts) < 5:
            continue
        try:
            nodos.append({
                "id": int(parts[0]),
                "orden": int(parts[1]),
                "estructura": _normalizar_estructura(parts[2]),
                "tam_clase": int(parts[3]),
                "es_normal": parts[4].strip().lower() == "true",
            })
        except ValueError:
            continue

    # Aristas: cada línea LE tiene el formato "j@i" (clase j es
    # subgrupo maximal de clase i). Pueden venir duplicadas; las
    # deduplicamos por par.
    aristas_set: set[tuple[int, int]] = set()
    for raw in lattice_edge_lines:
        parts = raw.split("@")
        if len(parts) < 2:
            continue
        try:
            aristas_set.add((int(parts[0]), int(parts[1])))
        except ValueError:
            continue
    aristas = sorted(aristas_set)

    return {
        "estructura": _normalizar_estructura(fields["DESC"]),
        "orden": orden,
        "is_abelian": _parsear_bool(fields.get("ABEL", "")),
        "is_solvable": _parsear_bool(fields.get("SOLV", "")),
        "is_nilpotent": _parsear_bool(fields.get("NILP", "")),
        "is_perfect": _parsear_bool(fields.get("PERF", "")),
        "is_simple": _parsear_bool(fields.get("SIMP", "")),
        "is_transitive": _parsear_bool(fields.get("TRAN", "")),
        "is_primitive": _parsear_bool(fields["PRIM"]) if "PRIM" in fields else None,
        "tid": tid,
        "center_order": center_order,
        "composition_factors": composition_factors,
        "lattice": {"nodos": nodos, "aristas": list(aristas)},
    }
