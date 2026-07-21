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


# ---- Tvashtr-79 item 7: the MID-RUN failover re-resolves the FALLBACK provider's own key --------
#
# The pre-flight swap (Slice A) resolved ``fallback_model`` -> provider -> owner key before any
# agent ran. The mid-run failover must do the SAME resolution rather than carry the primary's key
# across: the Engineer's ``openrouter/...`` and the fallback's ``openai/...`` are different
# providers, so re-using the primary's key would hand provider B a credential minted for provider A.

_FALLBACK_MODEL = "openai/gpt-4o-mini"


def _make_owner_with_distinct_key_per_provider(providers: set[str]) -> uuid.UUID:
    """Like ``_make_owner_with_keys_for``, but each provider gets its OWN distinguishable value —
    so the captured key identifies WHICH provider it was resolved for."""
    uid = uuid.uuid4()
    with session_scope() as session:
        session.add(User(id=uid, email=f"failover-{uid.hex}@tvashtr.local", password_hash="x"))
        session.flush()
        for provider in providers:
            session.add(
                ProviderCredential(
                    owner_id=uid,
                    provider=provider,
                    secret_encrypted=encrypt_secret(f"OWNER-KEY-{provider}"),
                    key_last4=provider[-4:],
                )
            )
    return uid


class _FailoverKeyCapturingAdapter:
    """Hard-fails the worker's FIRST attempt the way a dead provider key does (status ``failed`` +
    ``provider_failure``), then succeeds — capturing the ``(model, key)`` of every worker
    attempt."""

    name = "openhands"

    def __init__(self, seen: list) -> None:
        self._seen = seen

    def run(self, task, on_event=None):
        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        self._seen.append((task.model, task.llm_api_key))
        if len(self._seen) == 1:
            return AgentRunResult(
                status="failed",
                summary="dead key",
                events=[],
                files_changed=[],
                error=(
                    "litellm.AuthenticationError: OpenrouterException - No auth credentials found"
                ),
                provider_failure=True,
            )
        (Path(task.workspace_dir) / "greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def test_the_mid_run_failover_resolves_the_fallback_providers_own_key(client, monkeypatch):
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    team_graph_id = build_two_node_team()
    fallback_provider = provider_for_model(_FALLBACK_MODEL)
    owner_id = _make_owner_with_distinct_key_per_provider(
        _providers_for_team(team_graph_id) | {fallback_provider}
    )
    with session_scope() as session:
        engineer = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                AgentNode.role_name == "engineer",
            )
        ).scalar_one()
        primary_model = engineer.model
        engineer.config = {**(engineer.config or {}), "fallback_model": _FALLBACK_MODEL}
    assert provider_for_model(primary_model) != fallback_provider, (
        "the fallback must live on a DIFFERENT provider or this proves nothing"
    )

    seen: list = []
    monkeypatch.setattr(
        team_run, "resolve_adapter", lambda name: _FailoverKeyCapturingAdapter(seen)
    )

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
            result = DBOS.start_workflow(team_run.run_team, "Add greeting.txt").get_result()
        assert result["status"] == "completed", result
        assert len(seen) == 2, seen
        (got_primary_model, got_primary_key), (got_fb_model, got_fb_key) = seen
        assert got_primary_model == primary_model
        assert got_primary_key == f"OWNER-KEY-{provider_for_model(primary_model)}"
        assert got_fb_model == _FALLBACK_MODEL
        assert got_fb_key == f"OWNER-KEY-{fallback_provider}"
        assert got_fb_key != got_primary_key  # the key was RE-resolved, not carried over
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
