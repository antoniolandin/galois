# === Etapa 1: build del frontend ===
FROM node:24-alpine AS frontend-build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# === Etapa 2: runtime del backend ===
FROM python:3.12-slim

# GAP + librerias indispensables que el paquete meta `gap` no incluye:
#   - gap-transgrp  → TransitiveIdentification, LatticeSubgroups.
#   - gap-smallgrp  → IdGroup (lo invoca StructureDescription para los
#                     factores de composicion y subgrupos pequeños).
#   - gap-primgrp   → IsPrimitive sobre grupos transitivos.
#   - gap-table-of-marks → TableOfMarks (usado internamente por algunas
#                          consultas del retículo).
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gap \
        gap-transgrp \
        gap-smallgrp \
        gap-primgrp \
        gap-table-of-marks \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# uv: gestor de dependencias del proyecto.
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /uvx /usr/local/bin/

# HF Spaces exige que el contenedor corra como un usuario no privilegiado.
# El directorio de trabajo se crea aqui con el chown explicito porque
# WORKDIR crea los directorios como root aunque USER ya este puesto.
RUN useradd -m -u 1000 user && \
    mkdir -p /home/user/app && \
    chown -R user:user /home/user/app

USER user
ENV HOME=/home/user \
    PATH=/home/user/app/.venv/bin:/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1

WORKDIR /home/user/app

# Dependencias Python (sin instalar el propio paquete: el paquete
# `galois` se importa directamente desde el codigo copiado).
COPY --chown=user:user pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Codigo del backend y del paquete matematico.
COPY --chown=user:user backend ./backend
COPY --chown=user:user galois ./galois

# Frontend compilado, llegado desde la etapa 1.
COPY --from=frontend-build --chown=user:user /app/dist ./frontend_dist

EXPOSE 7860

CMD ["uvicorn", "backend.api:app", "--host", "0.0.0.0", "--port", "7860"]
