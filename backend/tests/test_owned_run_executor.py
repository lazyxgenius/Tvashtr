"""Reproduce-first (brief §5c): an owned run whose owner HAS the credential resolves THAT key
end-to-end through the executor — threaded into the PM's ``CompletionRequest.api_key`` AND the
Engineer's ``AgentTask.llm_api_key`` — with the LLM + adapter mocked (offline, no NIM).

On the pre-Slice-B executor neither step threaded a per-owner key (the PM built a key-less request;
the agent used the proxy vkey / ``.env``), so the captured keys would be ``None``. After the swap
both carry the owner's stored key — the end-to-end proof the swap changed run behavior, not just
added code.
"""

import shutil
import uuid
from pathlib import Path

from conftest import maybe_write_entry_report
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.credentials import encrypt_secret, provider_for_model
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import AgentNode, ProviderCredential, Run, User

_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / ".tvashtr_workspaces"

# One distinct stored value the owner holds for EVERY provider the team's models use — so both the
# PM and the Engineer (whatever providers their models resolve to) recover THIS owner's key.
OWNER_KEY = "OWNER-byok-KEY-c"


def _make_owner_with_keys_for(providers: set[str]) -> uuid.UUID:
    uid = uuid.uuid4()
    with session_scope() as session:
        session.add(User(id=uid, email=f"owned-run-{uid.hex}@tvashtr.local", password_hash="x"))
        session.flush()  # insert the user before the FK-dependent credentials (no ORM relationship)
        for provider in providers:
            session.add(
                ProviderCredential(
                    owner_id=uid,
                    provider=provider,
                    secret_encrypted=encrypt_secret(OWNER_KEY),
                    key_last4=OWNER_KEY[-4:],
                )
            )
    return uid


def _providers_for_team(team_graph_id: str) -> set[str]:
    """The distinct providers across the team's node models (gate/terminal nodes carry no model)."""
    with session_scope() as session:
        models = session.execute(
            select(AgentNode.model).where(AgentNode.team_graph_id == uuid.UUID(team_graph_id))
        ).scalars()
        return {provider_for_model(m) for m in models if m}


class _KeyCapturingAdapter:
    """A fake engine adapter: capture the per-owner key the executor threaded into the AgentTask,
    write a deliverable so ``ship_step`` has something to commit, and report success — no LLM."""

    name = "openhands"

    def __init__(self, captured: dict) -> None:
        self._captured = captured

    def run(self, task, on_event=None):
        if maybe_write_entry_report(task):
            # M-unify U1: the entry (edits-off) node runs the agent path too — capture ITS threaded
            # owner key (the old "PM/completion path", now unified onto the agent path).
            self._captured["entry_api_key"] = task.llm_api_key
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        self._captured["agent_llm_api_key"] = task.llm_api_key
        (Path(task.workspace_dir) / "greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def test_owned_run_threads_the_owners_key_into_both_paths(client, monkeypatch):
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    team_graph_id = build_two_node_team()
    owner_id = _make_owner_with_keys_for(_providers_for_team(team_graph_id))
    captured: dict = {}

    # M-unify U1: the PM is now an AGENT (no direct completion) — both the entry and the worker
    # resolve the owner's key through the ONE agent path; the fake adapter captures each.
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _KeyCapturingAdapter(captured))

    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=owner_id,
                idea="Add greeting.txt",
                workflow_id=run_id,
                status="running",
            )
        )

    workspace = _WORKSPACE_ROOT / run_id
    try:
        with SetWorkflowID(run_id):
            handle = DBOS.start_workflow(team_run.run_team, "Add greeting.txt")
        result = handle.get_result()
        assert result["status"] == "completed"
        # M-unify U1: the entry (former PM) AND the Engineer both resolved THE OWNER's key on the
        # unified agent path.
        assert captured["entry_api_key"] == OWNER_KEY
        assert captured["agent_llm_api_key"] == OWNER_KEY
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
