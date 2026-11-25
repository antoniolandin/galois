---
title: Galois
emoji: 🌀
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Interactive viewer of the Galois group via monodromy

Web application accompanying the bachelor's thesis *Computation and Interactive Visualisation of the Galois Group via Monodromy* in Computational Mathematics (U-tad, 2026), by Antonio Cabrera Landín.

The root URL (`/`) opens the monodromy viewer directly; the landing page lives at `/home`.

## Viewers

- **Parametric case** (Hauenstein–Rodriguez–Sottile algorithm). The user draws loops on the parameter plane α, watches them lift to permutations of the roots on the Riemann surface, and incrementally builds up the generated subgroup.
- **Non-parametric case** (Stauduhar's algorithm). Step-by-step descent through the lattice of maximal transitive subgroups of S_n, with the resolvent Q(t) and the descent decision made explicit at each level.

## Local development

Backend (FastAPI):

```bash
uv sync
uv run uvicorn backend.api:app --reload --port 8000
```

Frontend (Vite + React), in another terminal:

```bash
cd frontend
npm install
npm run dev
```

In development, the frontend proxies `/api` to `localhost:8000`. In the Docker deployment, the backend serves both the API and the frontend's static bundle from the same port.
