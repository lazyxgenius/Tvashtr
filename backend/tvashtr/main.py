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

from dbos import DBOS, DBOSConfig
from fastapi import Depends, FastAPI
from pydantic import BaseModel
from sqlalchemy import select

from tvashtr import db
from tvashtr.auth import auth_router, get_current_user
from tvashtr.config import get_settings
from tvashtr.control_plane import github_app
from tvashtr.control_plane.hello_durable import hello_durable
from tvashtr.engines.docker_runtime import sweep_orphaned_agent_containers
from tvashtr.models import SpikeHelloEvent
from tvashtr.routers import router as api_router

settings = get_settings()


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
    unavailable — so startup stays ``openhands``-free and robust on any host."""
    if settings.agent_sandbox_mode == "docker":
        sweep_orphaned_agent_containers()
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


class ConfigResponse(BaseModel):
    hosted_mode: bool
    github_install_url: str


@app.get("/api/config", response_model=ConfigResponse)
def config() -> ConfigResponse:
    """PUBLIC client bootstrap (open, like ``/health``): the posture the FE needs BEFORE login. In
    HOSTED mode the AuthWizard shows only "Continue with GitHub" linking to ``github_install_url``;
    when ``hosted_mode`` is False it stays the email/password wizard unchanged. Exposes
    ONLY public fields — the client secret and private key are never serializable here."""
    settings = get_settings()
    return ConfigResponse(
        hosted_mode=settings.hosted_mode,
        github_install_url=github_app.build_install_url() if settings.hosted_mode else "",
    )


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
