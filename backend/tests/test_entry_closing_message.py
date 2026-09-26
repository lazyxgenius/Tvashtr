"""revamp-e2e Phase 1 — the entry node's closing message is the spec when REPORT.md is missing.

Live (2026-09-26, runs e62d9995 / 69752d58 / 185c6848 / ae026ff5 / 99539c30): the PM on OpenAI
models ended its agent loop with the PRD in its closing message (the ``finish`` tool's message, or
a plain chat reply) and never wrote ``REPORT.md``. ``team_run`` then failed every run with "entry
node produced no REPORT.md". These tests drive the REAL ``run_team`` with a fake adapter that ends
the entry the same way, through the REAL ``_payload_of`` event mapping, and pin the fix:

* the closing message becomes the spec version exactly as ``REPORT.md`` would, and the run records
  the warning the run view shows;
* no ``REPORT.md`` AND no usable closing message still fails exactly as before;
* only THIS invocation's closing message counts (never an earlier round's), and a Desktop-routed
  entry's final text (kept on its job row) counts too.
"""

import uuid
from pathlib import Path

from conftest import auth_user_id
from dbos import DBOS, SetWorkflowID
from openhands.sdk.event import ActionEvent, MessageEvent
from openhands.sdk.llm import Message, MessageToolCall, TextContent
from openhands.sdk.tool.builtins.finish import FinishAction
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.documents.service import get_document_with_versions
from tvashtr.engines.base import AgentRunResult, EngineEvent
from tvashtr.engines.openhands_adapter import _kind_of, _payload_of
from tvashtr.models import AgentInvocation, AgentNode, DesktopNodeJob, Run, RunEvent, RunWarning

WARNING = "The PM didn't save REPORT.md, so its final message was used"

PRD = (
    "# Mini-PRD: Demo Proof\n\n"
    "Add a new file at docs/DEMO_PROOF.md titled 'Demo Proof'.\n\n"
    "Exact file path: docs/DEMO_PROOF.md\n" + "Acceptance: the file lists the repo layout.\n" * 80
)


def _finish_event(message: str) -> ActionEvent:
    """A real SDK ``finish`` tool call, as the agent emits it when it ends the loop."""
    return ActionEvent(
        source="agent",
        thought=[TextContent(text="The PRD is ready.")],
        action=FinishAction(message=message),
        tool_name="finish",
        tool_call_id="call_finish",
        tool_call=MessageToolCall(
            id="call_finish", name="finish", arguments="{}", origin="completion"
        ),
        llm_response_id="resp_finish",
    )


def _chat_reply_event(text: str) -> MessageEvent:
    """A real SDK agent reply with no tool call — the other way an agent ends the loop."""
    return MessageEvent(
        source="agent",
        llm_message=Message(role="assistant", content=[TextContent(text=text)]),
    )


def _engine_event(seq: int, oh_event) -> EngineEvent:
    kind = _kind_of(oh_event)
    return EngineEvent(seq=seq, kind=kind, payload=_payload_of(oh_event, kind), ts=0.0)


class _ClosingMessageAdapter:
    """The live failure, faithfully: the report-only ENTRY streams its closing event(s) through
    ``on_event`` (the same ``_payload_of`` mapping the real adapters use) and writes NO REPORT.md;
    a worker writes its deliverable."""

    name = "openhands"

    def __init__(self, closing_events):
        self._closing = closing_events

    def run(self, task, on_event=None):
        ws = Path(task.workspace_dir)
        if "REPORT-ONLY NODE" in task.instruction:
            for seq, oh_event in enumerate(self._closing):
                if on_event is not None:
                    on_event(_engine_event(seq, oh_event))
        else:
            (ws / "greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(status="completed", summary="ok", events=[], files_changed=[])


def _seed_run(run_id: str, team_graph_id: str, idea: str) -> None:
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea=idea,
                workflow_id=run_id,
                status="running",
            )
        )


def _run_two_node(monkeypatch, tmp_path, closing_events, pm_config=None) -> tuple[str, dict]:
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(
        team_run, "resolve_adapter", lambda name: _ClosingMessageAdapter(closing_events)
    )
    team_graph_id = build_two_node_team()
    if pm_config:
        with session_scope() as session:
            pm = session.execute(
                select(AgentNode).where(
                    AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                    AgentNode.role_name == "pm",
                )
            ).scalar_one()
            pm.config = {**(pm.config or {}), **pm_config}
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "build it")
    with SetWorkflowID(run_id):
        result = DBOS.start_workflow(team_run.run_team, "build it").get_result()
    return run_id, result


def _warnings(run_id: str) -> list[tuple[str, str, str]]:
    with session_scope() as session:
        return [
            (w.source_kind, w.name, w.reason)
            for w in session.execute(
                select(RunWarning).where(RunWarning.run_id == uuid.UUID(run_id))
            ).scalars()
        ]


# ============================ the event mapping keeps the closing text ===========================


def test_payload_of_keeps_the_full_finish_message():
    """The finish action's payload carries the WHOLE closing message (the PRD is longer than the
    2,000-char ``action`` preview), and stays JSON-serializable for ``run_events``."""
    import json

    payload = _payload_of(_finish_event(PRD), "action")
    assert len(PRD) > 2000
    assert payload["message"] == PRD
    json.dumps(payload)


def test_payload_of_keeps_an_agent_replys_full_text():
    payload = _payload_of(_chat_reply_event(PRD), "message")
    assert payload["content"] == PRD


def test_payload_of_leaves_a_user_message_without_a_content_copy():
    """Only the agent's own words can be a closing message — the instruction (a user message) is
    not copied a second time into the event log."""
    user = MessageEvent(
        source="user", llm_message=Message(role="user", content=[TextContent(text="do it")])
    )
    assert "content" not in _payload_of(user, "message")


# ============================ the executor uses it ===============================================


def test_entry_finish_message_becomes_the_spec_when_report_md_is_missing(
    client, monkeypatch, tmp_path
):
    """THE REPRODUCTION: the entry calls ``finish`` with the PRD and writes no REPORT.md. The run
    must complete, with the PRD as spec v1 and the warning recorded."""
    run_id, result = _run_two_node(monkeypatch, tmp_path, [_finish_event(PRD)])

    assert result["status"] == "completed", result
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        pm = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == run.team_graph_id, AgentNode.role_name == "pm"
            )
        ).scalar_one()
        inv = session.execute(
            select(AgentInvocation).where(AgentInvocation.node_id == pm.id)
        ).scalar_one()
    doc = get_document_with_versions(run.pm_document_id)
    assert [v.version_no for v in doc.versions] == [1]
    assert doc.versions[0].content == PRD
    assert doc.versions[0].created_by == "agent:entry"
    assert inv.status == "done" and inv.outcome == "prd_written"
    assert _warnings(run_id) == [("spec", "pm", WARNING)]


def test_entry_chat_reply_becomes_the_spec_when_report_md_is_missing(client, monkeypatch, tmp_path):
    """Run e62d9995's shape: the PM answered with the PRD as a plain reply (no ``finish`` call)."""
    run_id, result = _run_two_node(monkeypatch, tmp_path, [_chat_reply_event(PRD)])

    assert result["status"] == "completed", result
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
    assert get_document_with_versions(run.pm_document_id).versions[0].content == PRD
    assert _warnings(run_id) == [("spec", "pm", WARNING)]


def test_the_last_closing_message_wins(client, monkeypatch, tmp_path):
    """An agent that replied, then kept working and finished, closed with the ``finish`` message."""
    run_id, result = _run_two_node(
        monkeypatch, tmp_path, [_chat_reply_event("an early draft"), _finish_event(PRD)]
    )
    assert result["status"] == "completed", result
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
    assert get_document_with_versions(run.pm_document_id).versions[0].content == PRD


def test_the_output_format_check_reads_the_closing_message(client, monkeypatch, tmp_path):
    """An entry with an authored output format is checked against the text that became the spec —
    not reported as "no REPORT.md to check"."""
    run_id, result = _run_two_node(
        monkeypatch,
        tmp_path,
        [_finish_event('{"title": "Demo Proof"}')],
        pm_config={"output_schema": {"type": "object", "required": ["title"]}},
    )
    assert result["status"] == "completed", result
    assert _warnings(run_id) == [("spec", "pm", WARNING)]  # no output_schema miss


def test_a_blank_closing_message_still_fails_the_run(client, monkeypatch, tmp_path):
    """No REPORT.md and nothing usable to fall back on fails exactly as before — no empty spec."""
    run_id, result = _run_two_node(monkeypatch, tmp_path, [_finish_event("   \n ")])

    assert result["status"] == "failed"
    assert "REPORT.md" in result["error"]
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
    assert run.status == "failed"
    assert run.pm_document_id is None
    assert _warnings(run_id) == []


# ============================ the step reads only this invocation ================================


def _add_event(run_id: str, invocation_id: int | None, seq: int, oh_event) -> None:
    ev = _engine_event(seq, oh_event)
    with session_scope() as session:
        session.add(
            RunEvent(
                run_id=run_id,
                invocation_id=invocation_id,
                seq=ev.seq,
                kind=ev.kind,
                payload=ev.payload,
            )
        )


def _seed_bare_run() -> str:
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "build it")
    return run_id


def test_closing_message_step_ignores_another_invocations_message(client):
    run_id = _seed_bare_run()
    _add_event(run_id, 1001, 0, _finish_event("round one's PRD"))

    assert team_run.entry_closing_message_step(run_id, "pm-node", 1002, "pm") is None
    assert _warnings(run_id) == []
    assert team_run.entry_closing_message_step(run_id, "pm-node", 1001, "pm") == "round one's PRD"
    assert _warnings(run_id) == [("spec", "pm", WARNING)]


def test_closing_message_step_reads_a_desktop_entrys_final_text(client):
    """A Desktop-routed entry (Claude Code / Grok CLI) sends back only its final text, kept on the
    node's job row — that text is its closing message."""
    run_id = _seed_bare_run()
    with session_scope() as session:
        session.add(
            DesktopNodeJob(
                owner_id=auth_user_id(),
                run_id=run_id,
                node_id="pm-node",
                attempt_key=f"{run_id}:pm-node:1",
                invocation_id=2001,
                provider="claude",
                model="claude-sonnet-5",
                instruction="write the PRD",
                workspace_dir="/tmp/ws",
                sidecars=[],
                status="completed",
                result_text=PRD,
            )
        )

    assert team_run.entry_closing_message_step(run_id, "pm-node", 2001, "pm") == PRD
