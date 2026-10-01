"""The spike proof routes don't exist in hosted mode (S1 ship, architect ruling 3).

``POST /api/spike/generate-doc`` starts a model call on the server's default model with no owner
and no limit, so in hosted mode (production) any signed-in account could spend the server's key.
The four proof routes therefore answer 404 there, before any sign-in check, like a route that
isn't served. Without hosted mode (local) nothing changes. ``GET /api/spike/run-events/{run_id}``
(the run view reads it) is not a proof route and is unchanged."""

import uuid

import pytest
from dbos import DBOS
from toolkit_helpers import fresh_account

from tvashtr.config import get_settings
from tvashtr.control_plane import doc_writer
from tvashtr.gateway import CompletionResult

_PROOF_ROUTES = [
    ("post", "/api/spike/hello-durable", None),
    ("get", "/api/spike/hello-durable/{id}", None),
    ("post", "/api/spike/generate-doc", {"topic": "a notes app"}),
    ("get", "/api/spike/generate-doc/{id}", None),
]


def _call(c, method, path, body):
    url = path.format(id=uuid.uuid4())
    return c.post(url, json=body) if method == "post" else c.get(url)


@pytest.mark.parametrize(("method", "path", "body"), _PROOF_ROUTES)
def test_proof_route_answers_404_in_hosted_mode(
    client, unauth_client, monkeypatch, method, path, body
):
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    for c in (client, unauth_client):  # signed in, and not: the same answer as no route at all
        resp = _call(c, method, path, body)
        assert (resp.status_code, resp.json()) == (404, {"detail": "Not found"}), resp.text


def test_run_events_is_unchanged_in_hosted_mode(client, monkeypatch):
    ghost = f"/api/spike/run-events/{uuid.uuid4()}"
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    local = client.get(ghost)
    monkeypatch.setattr(get_settings(), "hosted_mode", True)
    hosted = client.get(ghost)
    # The route's own unknown-run answer in both postures, not the proof routes' 404.
    assert (hosted.status_code, hosted.json()) == (local.status_code, local.json())
    assert hosted.json() == {"detail": "run not found"}


def test_proof_routes_still_work_without_hosted_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    monkeypatch.setattr(
        doc_writer,
        "complete",
        lambda request: CompletionResult(
            text="A PRD.",
            model_requested="m",
            model_used="m",
            prompt_tokens=1,
            completion_tokens=2,
            total_tokens=3,
            cost_usd=0.0,
            raw_provider="openrouter",
            latency_ms=1.0,
        ),
    )
    c, _ = fresh_account()

    started = c.post("/api/spike/hello-durable")
    assert started.status_code == 200, started.text
    wf = started.json()["workflow_id"]
    DBOS.retrieve_workflow(wf).get_result()
    status = c.get(f"/api/spike/hello-durable/{wf}").json()
    assert status["status"] == "SUCCESS" and len(status["events"]) == 3

    started = c.post("/api/spike/generate-doc", json={"topic": "a notes app"})
    assert started.status_code == 200, started.text
    wf = started.json()["workflow_id"]
    DBOS.retrieve_workflow(wf).get_result()
    status = c.get(f"/api/spike/generate-doc/{wf}").json()
    assert status["status"] == "SUCCESS" and len(status["costs"]) == 1
