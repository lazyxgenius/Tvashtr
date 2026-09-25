"""FastAPI application + in-process DBOS Transact runtime.

``DBOS(fastapi=app, ...)`` wires ``DBOS.launch()`` into FastAPI startup. On
launch, DBOS recovers any PENDING workflows assigned to this executor — that is
what makes ``hello_durable`` resume after a ``kill -9``.

The ``lifespan`` runs the agent-server orphan sweep (docker sandbox mode only)
*before* that recovery: DBOS launches on ``lifespan.startup.complete``, which is
emitted only after the lifespan's startup phase, so the sweep precedes any resumed
``engineer_run_step`` (P1.3a, DQ2).
"""

from contextlib import asynccontextmanager
from pathlib import Path

from dbos import DBOS, DBOSConfig
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select

import tvashtr.control_plane.domain_ingest  # noqa: F401  — register DBOS workflow
from tvashtr import db
from tvashtr.auth import auth_router, get_current_user
from tvashtr.config import get_settings
from tvashtr.control_plane import github_app
from tvashtr.control_plane.clone_reaper import sweep_orphaned_clones
from tvashtr.control_plane.domain_embedding import public_embedding_presets
from tvashtr.control_plane.fly_reaper import sweep_orphaned_fly_apps
from tvashtr.control_plane.hello_durable import hello_durable
from tvashtr.control_plane.provider_directory import public_provider_directory
from tvashtr.control_plane.teams import public_provider_catalogue
from tvashtr.control_plane.tool_skill_catalog import (
    public_skill_presets,
    public_tool_catalogue,
)
from tvashtr.control_plane.workspace_reaper import sweep_orphaned_workspaces
from tvashtr.engines.docker_runtime import sweep_orphaned_agent_containers
from tvashtr.mcp.domains import get_domains_mcp
from tvashtr.models import SpikeHelloEvent
from tvashtr.routers import router as api_router
from tvashtr.routes import account as revamp_account
from tvashtr.routes import documents as revamp_documents
from tvashtr.routes import engines as revamp_engines
from tvashtr.routes import home as revamp_home
from tvashtr.routes import local_repo as revamp_local_repo
from tvashtr.routes import memory_extra as revamp_memory
from tvashtr.routes import nodes as revamp_nodes
from tvashtr.routes import toolkit as revamp_toolkit

settings = get_settings()

# Phase 4b: Domains MCP (streamable HTTP). path="/" so the mount root is the MCP endpoint
# (client URL ends at /mcp/domains). http_app() is unavailable on this FastMCP version.
_domains_mcp = get_domains_mcp()
_domains_mcp.settings.streamable_http_path = "/"
_domains_mcp_http = _domains_mcp.streamable_http_app()


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Reap ORPHANED agent-server containers before DBOS recovers any PENDING run, so a resumed
    agent step starts on a clean container + a free host port (P1.3a, DQ2).

    Runs whenever ``agent_sandbox_mode == "docker"`` — which is the DEFAULT (``config.py``), so it
    fires on essentially every boot, INCLUDING the FastAPI lifespan that ``make test`` triggers via
    ``with TestClient(app)``. It is therefore per-run-safe (M-reaper): the sweep spares a container
    owned by a LIVE run in another process (via the host-side registry) and reaps only genuine
    orphans (unknown or dead owner). Skipped only under ``local`` mode (the fast dev/test
    targets opt in with ``TVASHTR_AGENT_SANDBOX=local``); a no-op (warn only) if docker is
    unavailable — so startup stays ``openhands``-free and robust on any host.

    Phase 4b: wraps the Domains MCP streamable-HTTP session manager so tool calls on
    ``/mcp/domains`` have a live task group for the life of the process."""
    # Starlette sub-app has no ``.lifespan`` helper (unlike newer FastMCP ``http_app``); enter the
    # router lifespan context that runs ``session_manager.run()``.
    async with _domains_mcp_http.router.lifespan_context(_domains_mcp_http):
        if settings.agent_sandbox_mode == "docker":
            sweep_orphaned_agent_containers()
        elif settings.agent_sandbox_mode == "fly":
            # M-h2b: same idea one substrate up. A ``kill -9`` mid-hosted-run leaves a Fly app that
            # BILLS until something deletes it, and nothing in-process survives to do so. Sweeping
            # here — before DBOS recovery, for the same reason the docker sweep is here — means the
            # next boot cleans up the last crash. Reads liveness from the ``runs`` table (Fly apps
            # outlive any single process), so a run legitimately parked at a gate is SPARED, and
            # never touches an app that is not ours. Never raises: startup must not fail over cost
            # hygiene.
            sweep_orphaned_fly_apps()
        # M-clonegc: the same reconcile one substrate down — orphaned hosted-GitHub clones on local
        # disk. NOT mode-gated, unlike the two sweeps above: a clone is created by any run with a
        # ``github_repo``, whatever the sandbox is, so the backstop has to run wherever the backend
        # runs. Self-hosted / greenfield deployments never create the root, and the sweep returns 0
        # without touching the disk — which is what keeps those paths byte-identical to before.
        sweep_orphaned_clones()
        # M-wsgc: same reconcile for per-run agent workspaces. NOT mode-gated either, and for a
        # stronger version of the clone sweep's reason: a workspace is created by EVERY run that
        # reaches an agent step, in every sandbox mode, so this is the one sweep that always has
        # something to reconcile. Before DBOS recovery for the usual reason — a workspace belonging
        # to a run about to be RECOVERED must be spared; the reaper reads liveness from ``runs``.
        sweep_orphaned_workspaces()
        yield


app = FastAPI(title="Tvashtr Control Plane", version="0.0.1", lifespan=_lifespan)

_dbos_config: DBOSConfig = {
    "name": settings.dbos_app_name,
    "system_database_url": settings.database_url,
    "run_admin_server": settings.run_dbos_admin_server,
}
DBOS(fastapi=app, config=_dbos_config)

# M-accounts Slice A: auth endpoints (register/login/logout/me) — NO login dependency (these are
# how you obtain a session). Everything else under /api requires a logged-in user.
app.include_router(auth_router)
# P0.2 gateway + document-layer endpoints (generate-doc, documents, costs). M-accounts Slice A: the
# whole product surface now requires a session — one router-level dependency gates EVERY endpoint in
# routers.py. /api/auth/* (above) and /health (below) stay open.
# Frontend revamp (spec §3.4): one router module per area, included BEFORE ``routers.py`` so a new
# literal path (e.g. ``/api/tool-library/import``) is never shadowed by an older ``{id}`` route.
for _revamp_router in (
    revamp_engines.router,
    revamp_toolkit.router,
    revamp_home.router,
    revamp_account.router,
    revamp_nodes.router,
    revamp_documents.router,
    revamp_memory.router,
    revamp_local_repo.router,
):
    app.include_router(_revamp_router, dependencies=[Depends(get_current_user)])
app.include_router(api_router, dependencies=[Depends(get_current_user)])


class HealthResponse(BaseModel):
    status: str
    db: str


class StartResponse(BaseModel):
    workflow_id: str


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    try:
        db.ping()
        return HealthResponse(status="ok", db="ok")
    except Exception:
        return HealthResponse(status="degraded", db="down")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """The DB-FREE liveness check — what the platform's health probe points at (M-h4).

    ``/health`` above pings Postgres, which is exactly right for a human asking "is the whole thing
    up?" and exactly wrong for an automated probe: the deployed database (Neon, free tier) scales to
    zero after a few idle minutes, and a probe that pings it every few seconds would wake it forever
    and burn the free compute-hours this deployment is built to stay inside. This answers purely
    from the process — if it responds, the app is serving — so an idle machine can go quiet and let
    the database follow it down. ``/health`` is unchanged and stays the human answer."""
    return {"status": "ok"}


class ProviderCatalogueEntry(BaseModel):
    """One provider as the FE sees it — slugs only, split by SEAT (M-seat).

    ``worker_default`` is ``str | None``: ``None`` means the provider serves no model that can drive
    the agent loop, and the picker must not offer its models for a worker node."""

    provider: str
    thinker_default: str | None
    worker_default: str | None
    thinker_presets: list[str]
    worker_presets: list[str]
    # Revamp: display metadata for the model picker (see ``teams.PROVIDER_CATALOGUE``).
    label: str
    model_labels: dict[str, str]
    subscription: str | None
    byok_probed: bool


class ProviderDirectoryEntry(BaseModel):
    """One provider the Engines Add-key picker lists (``control_plane.provider_directory``)."""

    provider: str
    monogram: str
    name: str
    label: str
    example_model: str | None
    subscription: str | None
    embeddings: bool
    hint: str | None


class EmbeddingPresetEntry(BaseModel):
    """One Domains embedding preset (``domain_embedding.EMBEDDING_PRESETS``)."""

    id: str
    label: str
    slug: str
    provider: str
    dim: int
    notes: str


class ConfigResponse(BaseModel):
    hosted_mode: bool
    github_install_url: str
    github_manage_url: str
    # M-runnable: the backend-owned provider catalogue — provider + model SLUGS only, never keys.
    # The FE derives its model quick-picks + provider suggestions from it, so a slug lives in one
    # place (``control_plane.teams.PROVIDER_CATALOGUE``). Public, like the rest of this response.
    provider_catalogue: list[ProviderCatalogueEntry]
    # Revamp (Engines): every provider an API key can be added for, with picker copy; the Domains
    # embedding presets; and the operator's default per-run budget (``null`` = uncapped).
    provider_directory: list[ProviderDirectoryEntry]
    embedding_presets: list[EmbeddingPresetEntry]
    default_run_budget_usd: float | None


@app.get("/api/config", response_model=ConfigResponse)
def config() -> ConfigResponse:
    """PUBLIC client bootstrap (open, like ``/health``): the posture the FE needs BEFORE login. In
    HOSTED mode the AuthWizard shows only "Continue with GitHub" linking to ``github_install_url``
    (the OAuth sign-in door), and the launch panel offers ``github_manage_url`` (the SECONDARY "add
    repositories" install page) when a signed-in user's installation covers no repos; when
    ``hosted_mode`` is False it stays the email/password wizard unchanged. Also serves the public
    ``provider_catalogue`` (slugs only) the FE derives its model picker from — carrying M-seat's
    thinker/worker split, so the picker can offer a worker node only models proven to drive the
    agent loop. Exposes ONLY public fields — the client secret and private key are never
    serializable here."""
    settings = get_settings()
    budget = settings.default_run_budget_usd
    return ConfigResponse(
        hosted_mode=settings.hosted_mode,
        github_install_url=github_app.build_install_url() if settings.hosted_mode else "",
        github_manage_url=github_app.build_manage_url() if settings.hosted_mode else "",
        provider_catalogue=[
            ProviderCatalogueEntry(**entry) for entry in public_provider_catalogue()
        ],
        provider_directory=[
            ProviderDirectoryEntry(**entry) for entry in public_provider_directory()
        ],
        embedding_presets=[EmbeddingPresetEntry(**p) for p in public_embedding_presets()],
        default_run_budget_usd=float(budget) if budget is not None else None,
    )


@app.get("/api/tool-catalog")
def tool_catalog() -> dict:
    """PUBLIC built-in MCP tool catalogue (static; no secrets). FE shelves derive Free /
    Needs ``${SECRET}`` / Needs GitHub App badges from ``access`` / ``badge``."""
    return {"tools": public_tool_catalogue()}


@app.get("/api/skill-presets")
def skill_presets() -> dict:
    """PUBLIC skill presets (vendored inline; opt-in via skill library attach)."""
    return {"skills": public_skill_presets()}


@app.post(
    "/api/spike/hello-durable",
    response_model=StartResponse,
    dependencies=[Depends(get_current_user)],
)
def start_hello_durable() -> StartResponse:
    """Start hello_durable in the background; return its workflow id."""
    handle = DBOS.start_workflow(hello_durable, "demo", get_settings().hello_sleep_seconds)
    return StartResponse(workflow_id=handle.workflow_id)


@app.get("/api/spike/hello-durable/{workflow_id}", dependencies=[Depends(get_current_user)])
def get_hello_durable(workflow_id: str) -> dict:
    """Return the DBOS workflow status plus recorded events for this workflow."""
    status = DBOS.get_workflow_status(workflow_id)
    with db.session_scope() as session:
        rows = (
            session.execute(
                select(SpikeHelloEvent)
                .where(SpikeHelloEvent.workflow_id == workflow_id)
                .order_by(SpikeHelloEvent.id)
            )
            .scalars()
            .all()
        )
        events = [
            {
                "id": r.id,
                "step_name": r.step_name,
                "pid": r.pid,
                "executed_at": r.executed_at.isoformat(),
            }
            for r in rows
        ]
    return {
        "workflow_id": workflow_id,
        "status": status.status if status is not None else "NOT_FOUND",
        "events": events,
    }


def mount_frontend(app: FastAPI, dist_dir: str) -> bool:
    """Serve the built SPA from THIS app, one-origin with ``/api`` (M-h4). ``True`` if it mounted.

    One origin is the point. When the frontend sits on its own origin the session cookie is
    third-party — which is the fragility M-h1b kept paying for (CORS, SameSite negotiation, a
    redirect that has to carry the cookie across a port). Serving ``/`` and ``/api/*`` from one
    process makes the cookie first-party and same-site, and ``SameSite=lax`` becomes a complete
    answer rather than a compromise.

    A MISSING BUILD IS A DELIBERATE NO-OP. Locally there is no ``dist`` at the configured path (the
    default is the in-image one) and Vite serves the frontend instead, so this adds NO routes at
    all and a local backend stays byte-identical to pre-M-h4: ``/`` 404s exactly as it did. That is
    why the check is on ``index.html`` rather than the directory — a stale empty ``dist/`` should
    fall back to "no frontend", not to serving a blank page.

    MUST BE CALLED LAST, after every router. The catch-all matches any path, and FastAPI resolves
    routes in registration order, so registering it earlier would swallow the API."""
    dist = Path(dist_dir).resolve()
    index = dist / "index.html"
    if not index.is_file():
        return False

    assets = dist / "assets"
    if assets.is_dir():
        # Vite emits content-hashed filenames here, so these are the immutably-cacheable files.
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        """Any non-API GET returns the app shell, so client-side routes survive a reload.

        ``/dashboard`` is a route only the browser's router knows about; a hard refresh on it is a
        real HTTP GET this server has never heard of, and returning 404 there is the classic
        deep-link break."""
        # An unknown /api path must stay a JSON 404. Swallowing it into index.html would turn every
        # frontend API bug into a silent 200 of HTML that the client then fails to parse — a much
        # harder thing to debug than a 404.
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")

        # Real built files (favicon, robots.txt, anything Vite copied from public/) serve as
        # themselves; everything else is a client route. ``resolve()`` + the containment check keep
        # a crafted path from reading outside the build directory.
        #
        # The whole probe is wrapped because BOTH calls touch the filesystem with a
        # caller-controlled string: a NUL byte raises ValueError and an over-long segment raises
        # OSError, and an unhandled exception here would turn a junk URL into a 500 with a
        # traceback. Any path we cannot even evaluate is, by definition, not a built file — so it
        # falls through to the app shell exactly like any other unknown route.
        try:
            candidate = (dist / full_path).resolve()
            if full_path and candidate.is_file() and candidate.is_relative_to(dist):
                return FileResponse(candidate)
        except (OSError, ValueError):
            pass
        return FileResponse(index)

    return True


# Phase 4b: Domains MCP streamable HTTP — before SPA catch-all so /mcp/domains is not swallowed.
app.mount("/mcp/domains", _domains_mcp_http)

# LAST, deliberately (see mount_frontend): every API router above is already registered, so the
# catch-all can only ever see paths nothing else claimed.
mount_frontend(app, settings.frontend_dist)
