"""FastAPI application + in-process DBOS Transact runtime.

``DBOS(fastapi=app, ...)`` wires ``DBOS.launch()`` into FastAPI startup. On
launch, DBOS recovers any PENDING workflows assigned to this executor — that is
what makes ``hello_durable`` resume after a ``kill -9``.
"""

from dbos import DBOS, DBOSConfig
from fastapi import FastAPI
from pydantic import BaseModel
from sqlalchemy import select

from tvashtr import db
from tvashtr.config import get_settings
from tvashtr.control_plane.hello_durable import hello_durable
from tvashtr.models import SpikeHelloEvent
from tvashtr.routers import router as api_router

settings = get_settings()

app = FastAPI(title="Tvashtr Control Plane", version="0.0.1")

_dbos_config: DBOSConfig = {
    "name": settings.dbos_app_name,
    "system_database_url": settings.database_url,
    "run_admin_server": settings.run_dbos_admin_server,
}
DBOS(fastapi=app, config=_dbos_config)

# P0.2 gateway + document-layer endpoints (generate-doc, documents, costs).
app.include_router(api_router)


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


@app.post("/api/spike/hello-durable", response_model=StartResponse)
def start_hello_durable() -> StartResponse:
    """Start hello_durable in the background; return its workflow id."""
    handle = DBOS.start_workflow(hello_durable, "demo", get_settings().hello_sleep_seconds)
    return StartResponse(workflow_id=handle.workflow_id)


@app.get("/api/spike/hello-durable/{workflow_id}")
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
