"""M-memory S3 — executor-level injection proofs, each driving the REAL ``run_team`` over the
two_node team with the engine adapter mocked (offline, no LLM). The mutation-real complement to the
pure ``test_context_compiler.py`` + ``test_memory_retrieval.py``:

* ``retrieve_memory_step`` maps the executing node to its AUTHORED origin id
  (``cloned_from_node_id``, fallback to own id) and threads the owner + repo_key into
  ``retrieve_for_node``.
* a pinned account-tier memory is INJECTED end-to-end — it reaches the executed node's compiled
  instruction (a ``REMEMBERED LESSONS`` force-section) AND its ``context_manifest`` (a memory part
  + the injected id/polarity). DELETE the run_graph retrieval wiring and this FAILS.
* a forced retrieval failure is BEST-EFFORT — the run still completes, with no memory part.
* an empty in-scope set is INERT — no memory part, byte-identical to a no-memory run.

Each test OWNS its run with a FRESH account (+ dummy provider creds) so another test's account-tier
memories never leak into the scope (and a pinned/no-embedding fact keeps the offline path network-
free — HOT needs no embed).
"""

import shutil
import uuid
from pathlib import Path

from conftest import _seed_dummy_credentials, auth_user_id
from dbos import DBOS, SetWorkflowID
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from tvashtr.control_plane import team_run
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult
from tvashtr.main import app
from tvashtr.models import AgentInvocation, AgentNode, NodeMemory, Run

_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / ".tvashtr_workspaces"


def _fresh_owner_with_creds() -> uuid.UUID:
    """Register a fresh account (+ dummy encrypted creds for every test provider) so a run it owns
    resolves its agent key offline AND its memory scope is pristine (no other test's rows)."""
    plain = TestClient(app)
    plain.cookies.clear()
    resp = plain.post(
        "/api/auth/register",
        json={"email": f"s3exec-{uuid.uuid4().hex}@tvashtr.local", "password": "pw-123456"},
    )
    assert resp.status_code == 200, resp.text
    owner_id = resp.json()["id"]
    _seed_dummy_credentials(owner_id)
    return uuid.UUID(owner_id)


def _seed_run(
    run_id: str, team_graph_id: str, idea: str, *, owner_id: uuid.UUID, repo_path: str | None = None
) -> None:
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=owner_id,
                idea=idea,
                workflow_id=run_id,
                status="running",
                repo_path=repo_path,
            )
        )


def _seed_memory(
    owner_id: uuid.UUID,
    *,
    content: str,
    repo_key: str | None = None,
    node_id: uuid.UUID | None = None,
    pinned: bool = False,
    polarity: str = "context",
) -> str:
    with session_scope() as session:
        row = NodeMemory(
            owner_id=owner_id,
            repo_key=repo_key,
            node_id=node_id,
            content=content,
            pinned=pinned,
            polarity=polarity,
            status="active",
            embedding=None,
        )
        session.add(row)
        session.flush()
        session.refresh(row)
        return str(row.id)


class _FakeAdapter:
    """Greenfield fake adapter: services the entry (report-only) node's REPORT.md, records the
    WORKER's compiled instruction, writes a deliverable so ``ship_step`` has something to commit."""

    name = "openhands"

    def __init__(self, captured: dict) -> None:
        self._captured = captured

    def run(self, task, on_event=None):
        ws = Path(task.workspace_dir)
        if "REPORT-ONLY NODE" in task.instruction:
            (ws / "REPORT.md").write_text("PRD: greeting", encoding="utf-8")
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        self._captured["instruction"] = task.instruction
        (ws / "greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def _manifests(run_id: str) -> list[dict | None]:
    with session_scope() as session:
        return [
            row[0]
            for row in session.execute(
                select(AgentInvocation.context_manifest).where(AgentInvocation.run_id == run_id)
            ).all()
        ]


def _run_to_completion(run_id: str, idea: str, monkeypatch) -> tuple[dict, dict]:
    """Drive ``run_team`` to completion with the fake adapter + auto-approved gates; return
    ``(result, captured)``. Caller has already seeded the run + any memories."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    captured: dict = {}
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _FakeAdapter(captured))
    workspace = _WORKSPACE_ROOT / run_id
    try:
        with SetWorkflowID(run_id):
            handle = DBOS.start_workflow(team_run.run_team, idea)
        return handle.get_result(), captured
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


# ---- retrieve_memory_step: executing-node → authored-origin mapping + owner/repo threading ----


def test_retrieve_memory_step_maps_to_authored_id_and_threads_owner_repo(client, monkeypatch):
    authored = uuid.uuid4()
    owner = auth_user_id()
    team_graph_id = build_two_node_team()
    with session_scope() as session:
        exec_node = (
            session.execute(
                select(AgentNode.id).where(AgentNode.team_graph_id == uuid.UUID(team_graph_id))
            )
            .scalars()
            .first()
        )
        session.execute(
            update(AgentNode).where(AgentNode.id == exec_node).values(cloned_from_node_id=authored)
        )
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "idea", owner_id=owner, repo_path="/repos/demo")

    captured: dict = {}
    monkeypatch.setattr(
        team_run,
        "retrieve_for_node",
        lambda o, repo, authored_node_id, q, **kw: (
            captured.update(owner=o, repo=repo, authored=authored_node_id, query=q) or []
        ),
    )
    # A clone → the AUTHORED origin id is used for the node tier (+ owner/repo_key threaded).
    team_run.retrieve_memory_step(run_id, str(exec_node), 1, "the query")
    assert captured["authored"] == authored
    assert captured["repo"] == "/repos/demo"
    assert captured["owner"] == owner
    assert captured["query"] == "the query"

    # A non-clone (cloned_from_node_id NULL) → falls back to the node's OWN id.
    with session_scope() as session:
        session.execute(
            update(AgentNode).where(AgentNode.id == exec_node).values(cloned_from_node_id=None)
        )
    captured.clear()
    team_run.retrieve_memory_step(run_id, str(exec_node), 1, "q2")
    assert captured["authored"] == exec_node


# ---- end-to-end: a pinned account memory reaches the instruction + manifest -------------------


def test_pinned_account_memory_is_injected_into_instruction_and_manifest(client, monkeypatch):
    owner = _fresh_owner_with_creds()
    mem_id = _seed_memory(
        owner, content="Always add a trailing newline.", pinned=True, polarity="require"
    )
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "Add a greeting.", owner_id=owner)  # greenfield → account tier

    result, captured = _run_to_completion(run_id, "Add a greeting.", monkeypatch)
    assert result["status"] == "completed"

    # Reached the executed WORKER's compiled instruction as a MUST force-section.
    assert "--- REMEMBERED LESSONS ---" in captured["instruction"]
    assert "MUST:" in captured["instruction"]
    assert "- Always add a trailing newline." in captured["instruction"]

    # …and the invocation ``context_manifest``: a ``memory`` part + the injected id/polarity.
    manifests = [m for m in _manifests(run_id) if m and "memory" in m]
    assert manifests, "no invocation manifest carried a memory key"
    assert any(any(p["name"] == "memory" for p in m["parts"]) for m in manifests)
    injected = [entry for m in manifests for entry in m["memory"]]
    assert {"id": mem_id, "polarity": "require"} in injected


# ---- best-effort: a retrieval failure never crashes or changes a run -----------------------------


def test_retrieval_failure_is_best_effort_run_completes_with_no_memory_part(client, monkeypatch):
    owner = _fresh_owner_with_creds()
    _seed_memory(owner, content="should never appear", pinned=True)
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "Add a greeting.", owner_id=owner)

    def boom(*args, **kwargs):
        raise RuntimeError("retrieval exploded")

    monkeypatch.setattr(team_run, "retrieve_for_node", boom)
    result, captured = _run_to_completion(run_id, "Add a greeting.", monkeypatch)

    assert result["status"] == "completed"  # NOT crashed by the retrieval failure
    manifests = [m for m in _manifests(run_id) if m]
    assert manifests
    assert all("memory" not in m for m in manifests)
    assert all(all(p["name"] != "memory" for p in m["parts"]) for m in manifests)
    assert "--- REMEMBERED LESSONS ---" not in captured.get("instruction", "")


# ---- inert: an empty in-scope set adds no memory part --------------------------------------------


def test_empty_scope_is_inert_no_memory_part(client, monkeypatch):
    owner = _fresh_owner_with_creds()  # fresh ⇒ zero memories in scope
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "Add a greeting.", owner_id=owner)

    result, captured = _run_to_completion(run_id, "Add a greeting.", monkeypatch)
    assert result["status"] == "completed"
    manifests = [m for m in _manifests(run_id) if m]
    assert manifests
    assert all("memory" not in m for m in manifests)
    assert "--- REMEMBERED LESSONS ---" not in captured.get("instruction", "")


# ---- COLD end-to-end offline: the run-path embed closure + cosine ranking + on-run metering ------


def test_cold_memory_injected_end_to_end_with_on_run_embed_cost(client, monkeypatch):
    """Drive a real COLD candidate through the REAL retrieve_memory_step run-path closure offline (a
    deterministic fake gateway embed), proving the embed→pgvector-cosine→inject chain AND the on-run
    metering (a CostRecord ``workflow_id == run_id``) — the path the live gate covers but that
    ``make test`` otherwise never exercises (every other offline test is HOT-only or monkeypatches
    retrieval). Kills a regression to the embed wiring / owner-key resolution / on-run metering."""
    from tvashtr.config import get_settings
    from tvashtr.control_plane import memory_retrieval
    from tvashtr.gateway import EmbeddingResult
    from tvashtr.models import CostRecord

    def _fake_embed(request):
        return EmbeddingResult(
            vectors=[[0.11] * 1536 for _ in request.input],
            model=request.model,
            prompt_tokens=3,
            total_tokens=3,
            cost_usd=0.0,
            raw_provider="openai",
            latency_ms=0.1,
        )

    monkeypatch.setattr(memory_retrieval, "embed", _fake_embed)
    owner = _fresh_owner_with_creds()  # has dummy openai creds → resolve_owner_api_key succeeds
    with session_scope() as session:
        row = NodeMemory(
            owner_id=owner,
            content="COLD lesson: prefer the smallest correct diff.",
            polarity="prefer",
            pinned=False,  # a real COLD candidate (non-pinned)…
            status="active",
            embedding=[0.11] * 1536,  # …WITH an embedding, so the cosine path runs
        )
        session.add(row)
        session.flush()
        session.refresh(row)
        cold_id = str(row.id)

    embedding_model = get_settings().embedding_model
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "Add a greeting.", owner_id=owner)  # greenfield → account tier

    result, _ = _run_to_completion(run_id, "Add a greeting.", monkeypatch)
    assert result["status"] == "completed"

    # The COLD memory reached the manifest via the real embed→cosine path…
    manifests = [m for m in _manifests(run_id) if m and "memory" in m]
    injected = {e["id"] for m in manifests for e in m["memory"]}
    assert cold_id in injected
    # …and the query embed was metered ON the run (workflow_id == run_id; embeds have 0 completion).
    with session_scope() as session:
        embed_costs = list(
            session.execute(
                select(CostRecord).where(
                    CostRecord.workflow_id == run_id,
                    CostRecord.model_requested == embedding_model,
                )
            ).scalars()
        )
    assert embed_costs and all(c.completion_tokens == 0 for c in embed_costs)
