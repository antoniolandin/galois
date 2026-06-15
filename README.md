---
title: Galois
emoji: 🌀
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Visor interactivo del grupo de Galois por monodromía

Aplicación web que acompaña al TFG *Cálculo y Visualización del Grupo de Galois mediante Monodromía* de Antonio Cabrera Landín (U-tad / UCJC, 2026).

## Visores

- **Caso paramétrico** (algoritmo de Hauenstein–Rodriguez–Sottile). El usuario dibuja lazos sobre el plano del parámetro α, observa cómo se levantan a permutaciones de las raíces sobre la superficie de Riemann y va construyendo incrementalmente el subgrupo generado.
- **Caso no paramétrico** (algoritmo de Stauduhar). Descenso paso a paso por el retículo de subgrupos transitivos maximales de S_n, con la resolvente Q(t) y la decisión de descenso explícita en cada nivel.

## Desarrollo local

Backend (FastAPI):

```bash
uv sync
uv run uvicorn backend.api:app --reload --port 8000
```

Frontend (Vite + React), en otro terminal:

```bash
cd frontend
npm install
npm run dev
```

En desarrollo, el frontend hace proxy de `/api` a `localhost:8000`. En el despliegue Docker, el backend sirve tanto la API como el bundle estático del frontend desde el mismo puerto.
