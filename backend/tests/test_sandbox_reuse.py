"""M-unify U2 — the sandbox-reuse SEAM, proven mutation-real offline.

Drives the REAL ``run_team`` over a forced multi-round ``review_loop`` (no LLM, no openhands) with a
fake adapter injected at the ``resolve_adapter`` seam — so the REAL ``agent_run_step`` builds the
REAL ``AgentTask`` and the fake reads ``task.session_key`` + consults the REAL ``sandbox_cache``
(get → build-on-miss → put), exactly as the real adapters do. The SAME node (the Engineer, twice)
must be a cache HIT on round 2 while a DIFFERENT node (the entry/PM) gets its OWN key + a MISS.

Mutation teeth: if the reuse wiring is a no-op (``session_key`` un-threaded → every key ``None``),
``sandbox_cache.put(None, …)`` is a no-op and ``get(None)`` is always a MISS, so the round-2 HIT
assertion AND the distinct-key assertion both fail — the test cannot pass without the real wiring.
"""

import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from conftest import auth_user_id, maybe_write_entry_report
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import session_scope
from tvashtr.engines import openhands_adapter as local_mod
from tvashtr.engines import sandbox_cache
from tvashtr.engines.base import AgentRunResult, AgentTask
from tvashtr.models import AgentNode, Run

_VERDICT = "REVIEW_VERDICT.json"


def _seed_run(run_id: str, team_graph_id: str, idea: str, **extra) -> None:
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea=idea,
                workflow_id=run_id,
                status="running",
                **extra,
            )
        )


class _FakeSession:
    """Stands in for a live sandbox handle in the cache (no container). A no-op ``close``."""

    def close(self) -> None:
        pass


class _ReuseRecordingAdapter:
    """Fake adapter that records, per ``run()`` call, the ``AgentTask.session_key`` and whether it
    was ALREADY in the REAL ``sandbox_cache`` (a HIT) — the same get→build-on-miss→put dance the
    real adapters do. Services the entry (REPORT.md) + worker (greeting.txt) deliverables like the
    U1 ``_ScriptedAdapter`` so the forced review loop ships."""

    name = "openhands"

    def __init__(self, calls: list):
        self._calls = calls

    def run(self, task, on_event=None):
        key = task.session_key
        hit = sandbox_cache.get(key) is not None
        if not hit:
            sandbox_cache.put(
                key,
                sandbox_cache.CachedSandbox(handle=_FakeSession(), close=lambda: None),
            )
        self._calls.append(
            SimpleNamespace(key=key, hit=hit, report_only="REPORT-ONLY NODE" in task.instruction)
        )
        ws = Path(task.workspace_dir)
        before = {p.name for p in ws.iterdir() if p.is_file()}
        if maybe_write_entry_report(task):
            pass  # entry: REPORT.md written -> the executor versions it into the spec
        elif not (task.pull_paths is not None and _VERDICT in task.pull_paths):
            (ws / "greeting.txt").write_text("hi\n", encoding="utf-8")  # worker deliverable
        # Mirror the real scoped pull: a file this run CREATED outside the pull scope never leaves.
        if task.pull_paths is not None:
            keep = set(task.pull_paths)
            for p in list(ws.iterdir()):
                if p.is_file() and p.name not in keep and p.name not in before:
                    p.unlink()
        return AgentRunResult(status="completed", summary="ok", events=[], files_changed=[])


def test_same_node_reuses_sandbox_distinct_node_gets_its_own(client, monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")  # Engineer round 1 + one rework round
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    sandbox_cache.clear()
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    calls: list = []
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _ReuseRecordingAdapter(calls))

    team_graph_id = build_review_loop_team()
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "build it")
    try:
        with SetWorkflowID(run_id):
            result = DBOS.start_workflow(team_run.run_team, "build it").get_result()
        assert result["status"] == "completed", result

        # The forced reviewer short-circuits (no adapter); the adapter runs for entry(PM) x1 +
        # Engineer x2.
        assert len(calls) == 3, [c.key for c in calls]
        pm, eng1, eng2 = calls
        # every key is threaded + non-None (fails immediately if the seam is a no-op)
        assert pm.key and eng1.key and eng2.key, [c.key for c in calls]

        with session_scope() as session:
            run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
            by_id = {
                str(n.id): n.role_name
                for n in session.execute(
                    select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id)
                ).scalars()
            }
        roles = [by_id[c.key.split("::", 1)[1]] for c in calls]
        assert roles == ["pm", "engineer", "engineer"], roles

        # DIFFERENT node -> its OWN key; SAME node across rounds -> the SAME stable key.
        assert pm.key != eng1.key
        assert eng1.key == eng2.key
        # The mutation teeth: round 2 of the SAME node is a cache HIT; the first touches are MISSes.
        assert pm.hit is False
        assert eng1.hit is False
        assert eng2.hit is True
    finally:
        sandbox_cache.clear()


def test_local_adapter_reuses_conversation_across_rounds(tmp_path):
    """M-unify U2 local: two runs with the SAME session_key reuse ONE Conversation (round 2 is a
    FOLLOW-UP, not a fresh Conversation) and per-round usage is the delta of the cumulative metrics.
    No container — local reuse is pure conversation-carry (the agent remembers prior rounds)."""
    sandbox_cache.clear()
    convo = MagicMock()
    m1 = MagicMock(accumulated_cost=0.001)
    m1.accumulated_token_usage = MagicMock(prompt_tokens=3, completion_tokens=4)
    m2 = MagicMock(accumulated_cost=0.003)
    m2.accumulated_token_usage = MagicMock(prompt_tokens=10, completion_tokens=9)
    # read_usage calls: [round-1 after], [round-2 before (HIT baseline)], [round-2 after].
    convo.conversation_stats.get_combined_metrics.side_effect = [m1, m1, m2]
    try:
        with (
            patch.object(local_mod, "Conversation", return_value=convo) as Conv,
            patch.object(local_mod, "LLM"),
            patch.object(local_mod, "Agent"),
            patch.object(local_mod, "LLMSummarizingCondenser"),
            patch.object(local_mod, "Tool"),
            patch.object(local_mod, "TerminalTool"),
            patch.object(local_mod, "FileEditorTool"),
        ):
            key = sandbox_cache.session_key_for("run-L", "node-L")
            adapter = local_mod.OpenHandsAdapter()
            r1 = adapter.run(
                AgentTask(
                    instruction="g1",
                    workspace_dir=str(tmp_path),
                    model="m",
                    llm_api_key="byok",
                    session_key=key,
                )
            )
            r2 = adapter.run(
                AgentTask(
                    instruction="g2",
                    workspace_dir=str(tmp_path),
                    model="m",
                    llm_api_key="byok",
                    session_key=key,
                )
            )
        # Round 2 reused the SAME Conversation (no fresh one), sending a follow-up.
        assert Conv.call_count == 1
        assert convo.send_message.call_args_list == [call("g1"), call("g2")]
        assert convo.run.call_count == 2
        # Per-round usage is the DELTA: round 1 = (3,4); round 2 = (10,9)-(3,4) = (7,5).
        assert (r1.prompt_tokens, r1.completion_tokens) == (3, 4)
        assert (r2.prompt_tokens, r2.completion_tokens) == (7, 5)
    finally:
        sandbox_cache.close_run_sandboxes("run-L")
        sandbox_cache.clear()
