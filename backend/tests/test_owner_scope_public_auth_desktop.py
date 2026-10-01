"""Security S1-C — owner-scoping sweep: public, auth, Desktop app + Desktop runner, MCP mounts.

Every route of this family that takes an account-owned id is called by a SECOND fresh account (B)
with the first account's (A's) id and an otherwise valid request: B must get a 404 that carries
none of A's data, A's object must be unchanged, and the same request by A must not be a 404 (so
B's 404 comes from ownership, not a bad path or body). Routes that only return the caller's rows
(the runner ``claim``) must never hand B a row of A's. ``/api/auth/me`` and ``/api/auth/logout``
act only on the caller's own session. The rest of the family is public by design (health, config,
docs, login/register, OAuth callbacks, the Desktop sign-in exchange, the token-authenticated MCP
mounts) and is not exercised here.
"""

import uuid

import pytest
from dbos import DBOS, SetWorkflowID
from sqlalchemy import func, select
from toolkit_helpers import fresh_account

from tvashtr import db
from tvashtr.config import get_settings
from tvashtr.control_plane import desktop_jobs
from tvashtr.control_plane.hello_durable import hello_durable
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.models import DesktopNodeJob, RepoSnapshot, Run, RunEvent

SECRET = "A-ONLY-SECRET-7f3c"
INSTRUCTION = f"Create hello.txt ({SECRET})"


@pytest.fixture(autouse=True)
def _dbos(client):
    """The session ``client`` launches DBOS once; it is never used as account A or B."""


def _run_for(owner_id: uuid.UUID) -> str:
    rid = uuid.uuid4()
    with db.session_scope() as s:
        s.add(
            Run(
                id=rid,
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=owner_id,
                idea=f"owner-scope sweep {SECRET}",
                workflow_id=str(rid),
                status="running",
                desktop_target=True,
                desktop_subscriptions=["claude"],
            )
        )
    return str(rid)


def _enqueue(owner_id: uuid.UUID, run_id: str, workspace) -> str:
    return desktop_jobs.enqueue_job(
        owner_id=owner_id,
        run_id=run_id,
        node_id="node-a",
        iteration=1,
        invocation_id=7001,
        provider="claude",
        model="anthropic/claude-sonnet-5",
        instruction=INSTRUCTION,
        workspace_dir=str(workspace),
        sidecars=["REPORT.md"],
    )


def _job_state(job_id: str) -> tuple:
    with db.session_scope() as s:
        j = s.get(DesktopNodeJob, uuid.UUID(job_id))
        return (
            j.status,
            j.claimed_at,
            j.heartbeat_at,
            j.result_text,
            j.patch,
            j.error,
            j.usage,
            j.finished_at,
        )


def _event_count(run_id: str) -> int:
    with db.session_scope() as s:
        return s.execute(
            select(func.count()).select_from(RunEvent).where(RunEvent.run_id == run_id)
        ).scalar_one()


# ------------------------------------------------------------------ Desktop runner job routes (id)

_JOB_CALLS = {
    "snapshot": ("GET", "/api/desktop-runner/jobs/{}/snapshot", None),
    "events": (
        "POST",
        "/api/desktop-runner/jobs/{}/events",
        {"events": [{"seq": 0, "kind": "message", "payload": {"source": "b", "text": "B wrote"}}]},
    ),
    "result": (
        "POST",
        "/api/desktop-runner/jobs/{}/result",
        {"status": "completed", "final_text": "B's result", "patch": ""},
    ),
    "release": ("POST", "/api/desktop-runner/jobs/{}/release", None),
}


@pytest.mark.parametrize("name", list(_JOB_CALLS))
def test_runner_job_route_is_a_404_for_another_account(name, tmp_path, monkeypatch):
    monkeypatch.delenv("FLY_MACHINE_ID", raising=False)
    (tmp_path / "secret.txt").write_text(SECRET)
    a, a_id = fresh_account()
    b, _ = fresh_account()
    run_id = _run_for(a_id)
    job_id = _enqueue(a_id, run_id, tmp_path)
    claimed = a.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
    assert claimed["id"] == job_id  # A's job is claimed: A's own request would now succeed

    method, path, body = _JOB_CALLS[name]
    url = path.format(job_id)
    before = (_job_state(job_id), _event_count(run_id))

    theirs = b.request(method, url, json=body)
    assert theirs.status_code == 404, (name, theirs.status_code, theirs.text)
    assert SECRET not in theirs.text
    assert theirs.headers.get("content-type") != "application/gzip"
    assert (_job_state(job_id), _event_count(run_id)) == before, "B changed A's job"

    mine = a.request(method, url, json=body)  # positive control (destructive, so last)
    assert mine.status_code == 200, (name, mine.status_code, mine.text)


# ------------------------------------------------------------------ Desktop runner claim (list)


def test_claim_never_hands_another_account_a_job(tmp_path):
    a, a_id = fresh_account()
    b, _ = fresh_account()
    run_id = _run_for(a_id)
    job_id = _enqueue(a_id, run_id, tmp_path)
    before = _job_state(job_id)

    theirs = b.post("/api/desktop-runner/claim", json={"providers": ["claude", "grok"]})
    assert theirs.status_code == 200, theirs.text
    assert theirs.json() == {"job": None}
    assert job_id not in theirs.text and SECRET not in theirs.text
    assert _job_state(job_id) == before, "B's claim touched A's job"

    mine = a.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
    assert mine["id"] == job_id and mine["instruction"] == INSTRUCTION


# ------------------------------------------------------------------ ship bundle (id)


def test_ship_bundle_is_a_404_for_another_account():
    a, a_id = fresh_account()
    b, _ = fresh_account()
    rid = uuid.uuid4()
    bundle = f"git-bundle {SECRET}".encode()
    with db.session_scope() as s:
        source = RepoSnapshot(
            owner_id=a_id, kind="source", label="~/a", base_ref="main", size_bytes=0, data=b""
        )
        s.add(source)
        s.flush()
        s.add(
            Run(
                id=rid,
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=a_id,
                idea="folder run",
                workflow_id=str(rid),
                status="completed",
                base_ref="main",
                desktop_target=True,
                local_repo_label="~/a",
                local_snapshot_id=source.id,
            )
        )
        s.flush()
        source.run_id = rid
        s.add(
            RepoSnapshot(
                owner_id=a_id,
                kind="result",
                run_id=rid,
                size_bytes=len(bundle),
                data=bundle,
            )
        )

    theirs = b.get(f"/api/runs/{rid}/ship-bundle")
    assert theirs.status_code == 404, (theirs.status_code, theirs.text)
    assert SECRET.encode() not in theirs.content
    assert "x-tvashtr-branch" not in theirs.headers

    mine = a.get(f"/api/runs/{rid}/ship-bundle")
    assert mine.status_code == 200, mine.text
    assert mine.content == bundle


# ------------------------------------------------------------------ spike hello-durable (id)


def test_hello_durable_status_is_a_404_for_another_account(monkeypatch):
    """The id is A's RUN id: a run's DBOS workflow id IS its run id (``POST /api/runs`` starts
    ``run_team`` under ``SetWorkflowID(run_id)``). ``hello_durable`` stands in for ``run_team``
    under that id; the handler only looks the id up in DBOS, so the workflow function is irrelevant.
    (A workflow started on ``POST /api/spike/hello-durable`` carries its owner in its id since S1.)
    """
    monkeypatch.setattr(get_settings(), "hosted_mode", False)  # local posture (hosted: 404)
    a, a_id = fresh_account()
    b, _ = fresh_account()
    run_id = _run_for(a_id)
    with SetWorkflowID(run_id):
        DBOS.start_workflow(hello_durable, f"run {SECRET}", 0.1)
    DBOS.retrieve_workflow(run_id).get_result()

    # The route never answers 404 (S1-C exception): an id DBOS doesn't know is 200 "NOT_FOUND",
    # and B's answer for A's run must be exactly that, so it says nothing about A's run.
    ghost = str(uuid.uuid4())
    unknown = b.get(f"/api/spike/hello-durable/{ghost}")
    assert unknown.status_code == 200 and unknown.json()["status"] == "NOT_FOUND"

    theirs = b.get(f"/api/spike/hello-durable/{run_id}")
    assert (theirs.status_code, theirs.text.replace(run_id, "<id>")) == (
        unknown.status_code,
        unknown.text.replace(ghost, "<id>"),
    ), theirs.text
    assert "SUCCESS" not in theirs.text and "step1" not in theirs.text

    mine = a.get(f"/api/spike/hello-durable/{run_id}")  # positive control
    assert mine.status_code == 200, mine.text
    assert mine.json()["status"] == "SUCCESS" and len(mine.json()["events"]) == 3


# ------------------------------------------------------------------ auth me / logout (own)


def test_me_and_logout_act_only_on_the_callers_session():
    a, a_id = fresh_account()
    b, b_id = fresh_account()
    a_me = a.get("/api/auth/me").json()

    b_me = b.get("/api/auth/me")
    assert b_me.status_code == 200 and b_me.json()["id"] == str(b_id)
    assert a_me["email"] not in b_me.text and str(a_id) not in b_me.text

    assert b.post("/api/auth/logout").status_code == 204
    assert b.get("/api/auth/me").status_code == 401
    still = a.get("/api/auth/me")
    assert still.status_code == 200 and still.json() == a_me
