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
    branch_x: list[Complejo] = Field(
        default_factory=list,
        description=(
            "Raices dobles de P en x: para cada α_b en la "
            "ramificacion, los ceros simultaneos de P(x, α_b) = 0 y "
            "∂P/∂x(x, α_b) = 0. Sirven al frontend para pintarlos "
            "en el plano x como marcadores 'fantasma'."
        ),
    )
    coefs_alpha: list[list[Complejo]] = Field(
        ...,
        description=(
            "Coeficientes del polinomio en x con cada coeficiente "
            "expandido como polinomio en alpha. coefs_alpha[k] es la "
            "lista de coeficientes de a_k(alpha), en orden de grado "
            "decreciente en alpha. coefs_alpha[0] = a_n (lider, "
            "normalmente [{1, 0}] por monicidad)."
        ),
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


class GrupoObjetivoResponse(BaseModel):
    """Identificación del grupo de Galois "objetivo" del polinomio
    sobre C(α). Se calcula al cargar la página para que el frontend
    sepa cuándo el subgrupo descubierto ya alcanza el grupo total."""

    estructura: str
    orden: int


class PolinomioRequest(BaseModel):
    """Petición del frontend para cambiar el polinomio actual.

    La expresión se admite con sintaxis sympy estándar (`x**5 - x + alpha`)
    o con `^` como sinónimo de `**` (`x^5 - x + alpha`). Se acepta
    también `α` como alias de `alpha`."""

    expresion: str = Field(..., min_length=1)


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


# -- Stauduhar (caso no parametrico, grado 3 a 5) -------------------

class StauduharRequest(BaseModel):
    """Polinomio f(x) sobre Q como expresion ('x^4 - 2', 'x**3 - x - 1')
    y su grado, para el descenso de Stauduhar."""

    expresion: str = Field(..., min_length=1)
    grado: int = Field(..., ge=3, le=5)


class CosetApp(BaseModel):
    """Aplicacion de un representante pi_i de una clase lateral derecha
    de G en H sobre el invariante F."""

    idx: int
    representante_latex: str
    representante_cycle: list[list[int]]
    conjugado_y_latex: str
    conjugado_alpha_latex: str
    valor_numerico_latex: str
    valor_es_entero: bool


class CandidatoProbado(BaseModel):
    """Prueba completa de un candidato G en el nivel H actual."""

    subgrupo_latex: str
    subgrupo_orden: int
    indice: int
    invariante_y_latex: str
    invariante_descripcion: str
    cosets: list[CosetApp]
    Q_latex: str
    Q_factorizacion_latex: str
    raices_enteras_simples: list[str]
    descender_a: str | None = None
    coset_descenso_idx: int | None = None
    razon: str


class NivelDescenso(BaseModel):
    grupo_actual_latex: str
    grupo_actual_orden: int
    candidatos: list[CandidatoProbado]
    descender_a: str | None = None


class StauduharResponse(BaseModel):
    polinomio_latex: str
    grado: int
    niveles: list[NivelDescenso]
    grupo_final: str
