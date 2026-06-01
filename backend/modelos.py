"""Modelos Pydantic para la API.

Los numeros complejos se serializan como {"re": float, "im": float}
para mantener el JSON legible por el frontend. Las permutaciones se
serializan en formato one-line (lista de imagenes) y en forma ciclica
(lista de listas de indices)."""

from pydantic import BaseModel, Field


class Complejo(BaseModel):
    re: float
    im: float

    @classmethod
    def desde(cls, z: complex) -> "Complejo":
        return cls(re=float(z.real), im=float(z.imag))

    def a_complex(self) -> complex:
        return complex(self.re, self.im)


class PolinomioInfo(BaseModel):
    """Snapshot del polinomio actual y de su geometria asociada."""

    expresion: str = Field(..., description="Expresion simbolica de P(x, alpha)")
    grado: int = Field(..., description="Grado de P en x")
    alpha_estrella: Complejo = Field(..., description="Punto base de los lazos")
    puntos_de_ramificacion: list[Complejo] = Field(
        ..., description="Ceros del discriminante respecto a x"
    )
    raices_base: list[Complejo] = Field(
        ..., description="Raices de P(x, alpha_estrella), en el orden de np.roots"
    )


class LazoRequest(BaseModel):
    """Polilinea dibujada por el usuario en el plano alpha."""

    lazo: list[Complejo] = Field(..., min_length=2)
    cerrar_en_alpha_estrella: bool = Field(
        True,
        description=(
            "Si True, antepone y pospone alpha_estrella al lazo para "
            "garantizar que esta basado en el punto base."
        ),
    )


class PermutacionResponse(BaseModel):
    """Resultado de procesar un lazo: permutacion inducida y
    trayectorias completas para animacion en el frontend."""

    asignacion: list[int] = Field(
        ...,
        description=(
            "Permutacion en formato one-line: asignacion[i] = j "
            "significa que la raiz inicial i acaba en la posicion j."
        ),
    )
    cycles: list[list[int]] = Field(
        ..., description="Permutacion en forma ciclica disjunta"
    )
    trayectorias: list[list[Complejo]] = Field(
        ...,
        description=(
            "Posiciones de las n raices en cada paso del lazo. "
            "Shape: [n_raices][n_pasos]."
        ),
    )


class SubgrupoRequest(BaseModel):
    """Lista de generadores (cada uno en formato one-line) y grado del
    grupo simetrico ambiente."""

    generadores: list[list[int]] = Field(...)
    grado: int = Field(..., ge=1)


class LatticeNodo(BaseModel):
    id: int
    orden: int
    estructura: str
    tam_clase: int  # número de subgrupos conjugados en esta clase
    es_normal: bool


class Lattice(BaseModel):
    nodos: list[LatticeNodo]
    aristas: list[tuple[int, int]]  # (j, i): clase j es subgrupo maximal de i


class SubgrupoResponse(BaseModel):
    orden: int
    estructura: str
    grado: int
    orbitas: list[list[int]]
    # Información adicional que GAP devuelve (None si GAP no disponible).
    is_abelian: bool | None = None
    is_solvable: bool | None = None
    is_nilpotent: bool | None = None
    is_perfect: bool | None = None
    is_simple: bool | None = None
    is_transitive: bool | None = None
    is_primitive: bool | None = None
    tid: int | None = None
    center_order: int | None = None
    composition_factors: list[str] = []
    lattice: Lattice | None = None
