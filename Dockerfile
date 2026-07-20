# Tvashtr — the deployed image (M-h4). ONE image serves BOTH the API and the built frontend, which
# is what makes the session cookie first-party (see main.mount_frontend): the SPA is baked in here
# and served by the same FastAPI process that answers /api.
#
# NOTHING SECRET IS BAKED IN. The ten production credentials (DATABASE_URL, the session/Fernet/HMAC
# secrets, the Fly token, the GitHub App creds) are Fly secrets, injected as env at runtime — see
# .dockerignore, which keeps .env out of the build context entirely.

# syntax=docker/dockerfile:1

# ---- Stage 1: build the SPA ---------------------------------------------------------------------
# Vite has no `base` override and the app calls relative /api paths, so its output is served
# straight from the domain root with no build-time configuration at all.
FROM node:22-slim AS frontend

WORKDIR /build
# package.json + lockfile first: this layer only rebuilds when dependencies actually change, so an
# ordinary source edit skips the slowest step of the build.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# `npm run build` is `tsc --noEmit && vite build` — the same strict type gate CI runs, so a type
# error fails the IMAGE rather than shipping a silently-stale bundle.
RUN npm run build

# ---- Stage 2: the backend runtime ---------------------------------------------------------------
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS runtime

# git is NOT optional: a hosted run clones the user's repository server-side and pushes the ship
# branch back (control_plane/github_app.py shells out to git), and brownfield runs use `git
# worktree`. Without it those paths fail at the first subprocess call, long after boot looks fine.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONPATH=/app/backend \
    PATH="/app/backend/.venv/bin:$PATH"

# The backend is the working directory so `tvashtr.main` imports and `alembic.ini` sits alongside —
# which is what lets fly.toml's release_command be a bare `alembic upgrade head`.
WORKDIR /app/backend

# Dependencies before source, again for layer caching: uv.lock pins the exact resolution `make test`
# runs against, and --frozen makes a lockfile that drifted from pyproject.toml fail the build
# instead of quietly resolving something else.
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-install-project --no-dev

# The application itself. Only what the server needs at runtime — no tests, no scripts, no .env.
COPY backend/tvashtr ./tvashtr
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./alembic.ini

# The built SPA, at the path config.frontend_dist defaults to.
COPY --from=frontend /build/dist /app/frontend/dist

EXPOSE 8080

# No --reload (that is the dev-only flag) and 0.0.0.0 rather than 127.0.0.1, so Fly's proxy can
# reach the port it forwards to.
CMD ["uvicorn", "tvashtr.main:app", "--host", "0.0.0.0", "--port", "8080"]
