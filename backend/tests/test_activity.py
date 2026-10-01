"""M2 live run view — the Activity line mapping (``control_plane/activity.py``), pure.

Rows are stand-ins with the ORM's attribute names; the payload shapes are the engines' own:
OpenHands ``str(Action)`` / ``str(Observation)`` (pydantic ``field='value'`` form) and the Desktop
runner's JSON tool input with plain-text tool results.
"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from tvashtr.control_plane import activity

T0 = datetime(2026, 10, 2, 10, 0, 0, tzinfo=UTC)
RUN_ID = "11111111-1111-1111-1111-111111111111"
WS = f"/Users/me/backend/.tvashtr_workspaces/{RUN_ID}"


def _at(s: float) -> datetime:
    return T0 + timedelta(seconds=s)


def _node(role, kind="agent", x=0, config=None, model="openrouter/x"):
    return SimpleNamespace(
        id=uuid.uuid4(),
        role_name=role,
        kind=kind,
        config=config,
        position={"x": x, "y": 0},
        cloned_from_node_id=uuid.uuid4(),
        model=model if kind in ("agent", "completion") else None,
    )


def _inv(inv_id, node, status="done", iteration=1, start=0, end=None, outcome=None, detail=None):
    return SimpleNamespace(
        id=inv_id,
        run_id=RUN_ID,
        node_id=node.id,
        iteration=iteration,
        status=status,
        outcome=outcome,
        outcome_detail=detail,
        started_at=_at(start),
        ended_at=_at(end) if end is not None else None,
    )


class _Events:
    def __init__(self):
        self.rows = []

    def add(self, inv_id, s, kind, payload):
        self.rows.append(
            SimpleNamespace(
                id=len(self.rows) + 1,
                invocation_id=inv_id,
                kind=kind,
                payload=payload,
                created_at=_at(s),
            )
        )


def _run(status="running", **kw):
    values = dict(
        id=uuid.UUID(RUN_ID),
        workflow_id=RUN_ID,
        status=status,
        created_at=T0,
        updated_at=_at(1358),
        github_repo="lazyxgenius/trade_mcp",
        local_repo_label=None,
        repo_path=None,
        base_ref="main",
        pr_url=None,
        ship_branch=None,
        failure_code=None,
        failure_message=None,
        failed_node_id=None,
        desktop_target=False,
        subpath=None,
    )
    values.update(kw)
    return SimpleNamespace(**values)


def _build(run, nodes, invocations, events=(), tasks=(), versions=(), edges=(), **kw):
    kw.setdefault("live_by_inv", {})
    kw.setdefault("spent_usd", 1.12)
    return activity.build(
        run, list(nodes), list(edges), list(invocations), list(events), list(tasks),
        list(versions), **kw
    )  # fmt: skip


def _terminal(command):
    return {
        "tool_name": "terminal",
        "thought": "SECRET-THOUGHT I should run the tests",
        "action": f"command='{command}' is_input=False timeout=None reset=False "
        "kind='TerminalAction'",
    }


def _terminal_out(text, exit_code=0):
    return {
        "tool_name": "terminal",
        "observation": f"content=[TextContent(cache_prompt=False, type='text', text={text!r})] "
        f"is_error=False command='x' exit_code={exit_code} timeout=False "
        "metadata=CmdOutputMetadata(exit_code=-1, pid=-1) kind='TerminalObservation'",
    }


def _editor(command, path, **fields):
    rendered = " ".join(f"{k}={v!r}" for k, v in fields.items())
    return {
        "tool_name": "file_editor",
        "thought": "SECRET-THOUGHT",
        "action": f"command={command!r} path='{WS}/{path}' {rendered} kind='FileEditorAction'",
    }


def _texts(reply):
    return [(line["kind"], line["text"]) for line in reply["lines"]]


def _engineer_world(status="running"):
    pm, eng = _node("pm", x=0), _node("engineer", x=200)
    invs = [_inv(1, pm, end=30), _inv(2, eng, status=status, start=40, end=None)]
    return pm, eng, invs


# ---------------------------------------------------------------------------- reads and edits


def test_consecutive_reads_collapse_into_one_line():
    pm, eng, invs = _engineer_world()
    ev = _Events()
    ev.add(2, 41, "action", _editor("view", "core/indicators.py"))
    ev.add(2, 42, "observation", {"tool_name": "file_editor", "observation": "..."})
    ev.add(2, 43, "action", _editor("view", "core/rsi.py"))
    ev.add(2, 44, "action", _editor("view", "tests/test_rsi.py"))
    ev.add(2, 45, "action", _editor("view", "core/rsi.py"))  # a re-read counts once
    ev.add(2, 46, "action", {"tool_name": "Read", "action": json.dumps({"file_path": "README.md"})})
    ev.add(2, 50, "action", _terminal("make lint"))
    ev.add(2, 51, "action", _editor("view", "core/macd.py"))
    reply = _build(_run(), [pm, eng], invs, ev.rows)
    lines = [ln for ln in reply["lines"] if ln["kind"] == "read"]
    assert [ln["text"] for ln in lines] == [
        "Read 4 files in core/ and tests/",
        "Read core/macd.py",
    ]
    assert lines[0]["refs"]["files"] == [
        "core/indicators.py",
        "core/rsi.py",
        "tests/test_rsi.py",
        "README.md",
    ]
    assert lines[0]["id"] == "ev:1" and lines[0]["label"] == "Engineer"
    assert lines[0]["iteration"] == 1 and lines[0]["tone"] == "neutral"
    assert "*" not in lines[0]["text"] and "<" not in lines[0]["text"]  # plain text


def test_an_edit_counts_its_added_and_removed_lines():
    pm, eng, invs = _engineer_world()
    ev = _Events()
    ev.add(
        2,
        41,
        "action",
        _editor(
            "str_replace",
            "core/indicators.py",
            old_str="def rsi():\n    pass\n",
            new_str="def rsi(prices):\n    gains = []\n    losses = []\n    return 50\n",
        ),
    )
    ev.add(2, 42, "action", _editor("create", "tests/test_rsi.py", file_text="a\nb\nc\n"))
    ev.add(
        2,
        43,
        "action",
        {
            "tool_name": "Edit",
            "thought": "",
            "action": json.dumps(
                {"file_path": "README.md", "old_string": "MIT.", "new_string": "MIT.\nBuilt"}
            ),
        },
    )
    reply = _build(_run(), [pm, eng], invs, ev.rows)
    edits = [ln for ln in reply["lines"] if ln["kind"] == "edited"]
    assert [(ln["text"], ln["refs"]) for ln in edits] == [
        ("Edited core/indicators.py", {"file": "core/indicators.py", "added": 4, "removed": 2}),
        ("Edited tests/test_rsi.py", {"file": "tests/test_rsi.py", "added": 3, "removed": 0}),
        ("Edited README.md", {"file": "README.md", "added": 1, "removed": 0}),
    ]


# ---------------------------------------------------------------------------- commands and tests


def test_a_running_command_shows_its_start_and_is_sent_again_until_it_ends():
    pm, eng, invs = _engineer_world()
    ev = _Events()
    ev.add(2, 41, "action", _editor("view", "core/rsi.py"))
    ev.add(2, 42, "observation", {"tool_name": "file_editor", "observation": "..."})
    ev.add(2, 50, "action", _terminal("python -m pytest -q"))
    reply = _build(_run(), [pm, eng], invs, ev.rows)
    line = reply["lines"][-1]
    assert line["kind"] == "command" and line["text"] == "Running python -m pytest -q"
    assert line["refs"]["running"] is True
    assert line["refs"]["started_at"] == _at(50).isoformat()
    assert line["refs"]["exit_code"] is None and line["refs"]["output_tail"] == []
    # The cursor stops before the line that is still changing: polling again re-sends it.
    assert reply["cursor"].endswith("|ev:1")
    again = _build(_run(), [pm, eng], invs, ev.rows, after=reply["cursor"])
    assert [ln["id"] for ln in again["lines"]] == ["ev:3"]
    assert again["total"] == reply["total"]


def test_a_finished_command_carries_its_exit_code_and_last_lines():
    pm, eng, invs = _engineer_world()
    ev = _Events()
    ev.add(2, 50, "action", _terminal("make lint"))
    output = "\n".join(f"line {i}" for i in range(20)) + "\n\nerror: 2 problems\n"
    ev.add(2, 53, "observation", _terminal_out(output, exit_code=2))
    reply = _build(_run(), [pm, eng], invs, ev.rows)
    line = reply["lines"][-1]
    assert (line["kind"], line["text"], line["tone"]) == ("command", "Ran make lint", "warn")
    assert line["refs"]["running"] is False and line["refs"]["exit_code"] == 2
    assert line["refs"]["output_tail"] == [f"line {i}" for i in range(9, 20)] + [
        "error: 2 problems"
    ]
    assert reply["cursor"].endswith("|ev:1")


def test_the_test_summary_becomes_a_tests_line():
    pm, eng, invs = _engineer_world()
    ev = _Events()
    ev.add(2, 50, "action", _terminal("python -m pytest -q"))
    ev.add(2, 52, "observation", _terminal_out("..F.\nFAILED t.py::x\n3 failed, 38 passed in 1.2s"))
    ev.add(2, 60, "action", _terminal("python -m pytest -q"))
    ev.add(2, 62, "observation", _terminal_out("........\n41 passed in 0.80s", exit_code=0))
    # The Desktop runner (Claude Code): JSON tool input, plain-text result.
    ev.add(2, 70, "action", {"tool_name": "Bash", "action": json.dumps({"command": "pytest"})})
    ev.add(2, 71, "observation", {"tool_name": "Bash", "observation": "=== 1 failed in 0.1s ==="})
    reply = _build(_run(), [pm, eng], invs, ev.rows)
    tests = [ln for ln in reply["lines"] if ln["kind"] == "tests"]
    assert [(ln["text"], ln["tone"]) for ln in tests] == [
        ("Ran the tests: 3 failed, 38 passed", "warn"),
        ("Ran the tests: all 41 passed", "ok"),
        ("Ran the tests: 1 failed", "warn"),
    ]
    assert tests[0]["refs"]["passed"] == 38 and tests[0]["refs"]["failed"] == 3
    assert tests[0]["refs"]["command"] == "python -m pytest -q"
    assert tests[1]["refs"]["passed"] == 41 and tests[1]["refs"]["failed"] == 0
    assert tests[1]["refs"]["output_tail"] == ["........", "41 passed in 0.80s"]


def test_test_summaries_from_other_runners():
    parse = activity.parse_test_summary
    assert parse("Tests:       1 failed, 40 passed, 41 total") == (40, 1)
    assert parse(" Tests  2 failed | 39 passed (41)") == (39, 2)
    assert parse("==== 2 passed, 1 error in 0.3s ====") == (2, 1)
    assert parse("Ran 12 tests in 0.1s\n\nOK") is None
    assert parse("nothing to see") is None


def test_a_search_command_is_a_searched_line():
    pm, eng, invs = _engineer_world()
    ev = _Events()
    ev.add(2, 50, "action", _terminal('grep -rn "INDICATORS" core/'))
    ev.add(2, 51, "observation", _terminal_out("core/x.py:1:INDICATORS = {}"))
    ev.add(2, 52, "action", {"tool_name": "Grep", "action": json.dumps({"pattern": "def rsi"})})
    reply = _build(_run(), [pm, eng], invs, ev.rows)
    searched = [ln for ln in reply["lines"] if ln["kind"] == "searched"]
    assert [(ln["text"], ln["refs"]) for ln in searched] == [
        ("Searched for INDICATORS", {"query": "INDICATORS"}),
        ("Searched for def rsi", {"query": "def rsi"}),
    ]


def test_model_reasoning_never_reaches_a_line():
    pm, eng, invs = _engineer_world(status="done")
    ev = _Events()
    ev.add(2, 41, "action", _editor("view", "core/rsi.py"))
    ev.add(2, 42, "message", {"source": "claude", "text": "SECRET-THOUGHT let me think"})
    ev.add(2, 43, "message", {"source": "grok:thinking", "text": "SECRET-THOUGHT hmm"})
    ev.add(2, 44, "action", {"tool_name": "finish", "thought": "SECRET-THOUGHT", "action": "x"})
    reply = _build(_run(), [pm, eng], invs, ev.rows)
    assert "SECRET-THOUGHT" not in json.dumps(reply)
    assert reply["lines"][-1]["kind"] == "message"
    assert reply["lines"][-1]["text"] == "Finished its step"


# ---------------------------------------------------------------------------- host events


def test_retry_backup_and_stalled_lines():
    pm, eng, invs = _engineer_world()
    ev = _Events()
    ev.add(
        2,
        41,
        "retry",
        {"attempt": 1, "of": 3, "wait_s": 10.0, "next_at": "n", "reason": "busy", "model": "a/x"},
    )
    ev.add(2, 52, "backup_model", {"from_model": "a/x", "to_model": "openai/gpt-4.1-mini"})
    ev.add(2, 60, "stalled", {"after_s": 1200, "message": "m"})
    reply = _build(_run(), [pm, eng], invs, ev.rows)
    assert [(ln["kind"], ln["text"], ln["tone"]) for ln in reply["lines"][-3:]] == [
        ("retry", "Model busy (too many requests). Trying again in 10 s · 1 of 3", "warn"),
        ("backup", "Switched to the backup model, openai/gpt-4.1-mini", "warn"),
        ("stalled", "Stopped responding: no update for 20 minutes", "danger"),
    ]
    assert reply["lines"][-3]["refs"] == {
        "attempt": 1,
        "of": 3,
        "wait_s": 10.0,
        "next_at": "n",
        "reason": "busy",
    }
    assert reply["lines"][-2]["refs"] == {"from_model": "a/x", "to_model": "openai/gpt-4.1-mini"}
    assert reply["lines"][-1]["refs"] == {"after_s": 1200}


def test_a_retrying_step_is_pinned_with_its_backup():
    pm, eng, invs = _engineer_world()
    ev = _Events()
    ev.add(2, 41, "retry", {"attempt": 2, "of": 3, "wait_s": 20.0, "reason": "busy"})
    ev.rows[-1].payload["backup_model"] = "openai/gpt-4.1-mini"
    live = {
        2: {
            "live_state": "retrying",
            "last_event_at": _at(41).isoformat(),
            "activity": "Model busy · trying again in 20 s (2 of 3)",
            "activity_started_at": _at(41).isoformat(),
            "retry": {"attempt": 2, "of": 3, "next_at": "n"},
            "backup_model": None,
        }
    }
    reply = _build(_run(), [pm, eng], invs, ev.rows, live_by_inv=live)
    assert reply["pinned"] == {
        "kind": "retrying",
        "node_id": str(eng.id),
        "label": "Engineer",
        "title": "The Engineer’s model is busy",
        "body": (
            "Tvashtr tries again in 20 seconds. If it is still busy, the Engineer switches to its "
            "backup model, openai/gpt-4.1-mini, and carries on. You don’t need to do anything."
        ),
        "task_id": None,
        "backup_model": "openai/gpt-4.1-mini",
        "gate_kind": None,
    }
    agent = {a["label"]: a for a in reply["agents"]}["Engineer"]
    assert agent["live_state"] == "retrying" and agent["retry"]["attempt"] == 2
    assert reply["live_state"] == "retrying"


# ---------------------------------------------------------------------------- gates and verdicts


def _review_world():
    pm = _node("pm", x=0)
    gate = _node("prd_gate", kind="gate", x=100, config={"gate_kind": "prd_approval"})
    eng = _node("engineer", x=200)
    rev = _node("reviewer", x=300)
    ship = _node("ship", kind="terminal", x=400, config={"terminal_kind": "ship"})
    edges = [
        {"source": str(rev.id), "target": str(eng.id), "edge_type": "work",
         "conditions": {"loop_limit": 3}},
    ]  # fmt: skip
    return pm, gate, eng, rev, ship, edges


def _gate_task(task_id, gate, status="pending", resolution=None, opened=31, resolved=None):
    return SimpleNamespace(
        id=task_id,
        kind="prd_approval",
        blocking=True,
        topic=f"gate:{RUN_ID}:{gate.id}",
        title="Approve the PRD before the Engineer builds",
        description="The PM wrote the PRD. Approve to let the Engineer build it.",
        status=status,
        resolution=resolution,
        created_at=_at(opened),
        resolved_at=_at(resolved) if resolved is not None else None,
    )


def test_an_open_gate_is_a_line_the_pinned_callout_and_needs_you():
    pm, gate, eng, rev, ship, edges = _review_world()
    invs = [_inv(1, pm, end=30), _inv(2, gate, status="running", start=31)]
    reply = _build(
        _run("awaiting_human"),
        [pm, gate, eng, rev, ship],
        invs,
        tasks=[_gate_task(7, gate)],
        edges=edges,
    )
    line = reply["lines"][-1]
    assert (line["id"], line["kind"], line["text"], line["tone"]) == (
        "task:7:open",
        "gate_waiting",
        "Waiting for you to approve the spec",
        "warn",
    )
    assert line["refs"] == {"task_id": 7, "title": "Approve the PRD before the Engineer builds"}
    assert line["node_id"] == str(gate.id) and line["label"] == "Approval"
    assert reply["pinned"] == {
        "kind": "gate",
        "node_id": str(gate.id),
        "label": "Approval",
        "title": "The approval gate is waiting for you",
        "body": "Read the spec, then approve or reject it. The run is paused until you decide.",
        "task_id": 7,
        "backup_model": None,
        "gate_kind": "prd_approval",
    }
    agents = {a["label"]: a for a in reply["agents"]}
    assert agents["Approval"]["live_state"] == "needs_you"
    assert agents["Approval"]["activity"] == "Waiting for you"
    assert agents["Approval"]["last_event_at"] == _at(31).isoformat()
    assert agents["Engineer"]["live_state"] == "waiting" and agents["Engineer"]["activity"] is None
    assert agents["Engineer"]["rounds_limit"] == 3 and agents["Reviewer"]["rounds_limit"] == 3
    assert agents["PM"]["rounds_limit"] is None
    assert [a["kind"] for a in reply["agents"]] == ["agent", "gate", "agent", "agent", "ship"]
    assert reply["live_state"] == "needs_you"


def test_a_shipped_run_reads_start_to_finish():
    pm, gate, eng, rev, ship, edges = _review_world()
    invs = [
        _inv(1, pm, end=30),
        _inv(2, gate, start=31, end=60, outcome="approved"),
        _inv(3, eng, start=61, end=300, outcome="built"),
        _inv(4, rev, start=301, end=400, outcome="changes_requested",
             detail="1. Handle an empty price list\n2. Add a test for period=1"),
        _inv(5, eng, iteration=2, start=401, end=700, outcome="built"),
        _inv(6, rev, iteration=2, start=701, end=800, outcome="approved"),
        _inv(7, ship, start=801, end=1358, outcome="shipped"),  # the run ends here
    ]  # fmt: skip
    ev = _Events()
    ev.add(5, 600, "action", _terminal("python -m pytest -q"))
    ev.add(5, 610, "observation", _terminal_out("41 passed in 0.8s"))
    spec = SimpleNamespace(
        document_id=uuid.uuid4(),
        version_no=1,
        created_at=_at(29),
        created_by="agent:entry",
        idempotency_key=f"{RUN_ID}:pm-prd-v1",
        author_node_id=pm.cloned_from_node_id,
    )
    spec2 = SimpleNamespace(
        document_id=spec.document_id,
        version_no=2,
        created_at=_at(500),
        created_by="human",
        idempotency_key="human-edit",
        author_node_id=None,
    )
    run = _run(
        "completed",
        pr_url="https://github.com/lazyxgenius/trade_mcp/pull/42",
        ship_branch="tvashtr/run-12",
    )
    reply = _build(
        run,
        [pm, gate, eng, rev, ship],
        invs,
        ev.rows,
        tasks=[_gate_task(7, gate, status="resolved", resolution="approved", resolved=59)],
        versions=[(spec, "spec"), (spec2, "spec")],
        edges=edges,
    )
    assert _texts(reply) == [
        ("started", "Started on lazyxgenius/trade_mcp, branch main"),
        ("started", "Started"),
        ("wrote_doc", "Wrote the spec (v1)"),
        ("gate_waiting", "Waiting for you to approve the spec"),
        ("gate_approved", "You approved the spec"),
        ("started", "Started"),
        ("started", "Started"),
        ("verdict", "Asked for 2 fixes: Handle an empty price list; Add a test for period=1"),
        ("started", "Started round 2 with the reviewer's notes"),
        ("wrote_doc", "You edited the spec (v2)"),
        ("tests", "Ran the tests: all 41 passed"),
        ("started", "Started round 2"),
        ("verdict", "Approved"),
        ("pr", "Pushed branch tvashtr/run-12 and opened pull request #42"),
        ("done", "Done in 22m 38s · $1.12"),
    ]
    by_id = {ln["id"]: ln for ln in reply["lines"]}
    assert by_id["run:start"]["refs"] == {"repo": "lazyxgenius/trade_mcp", "branch": "main"}
    assert by_id["run:start"]["node_id"] is None and by_id["run:start"]["label"] == "Run"
    assert by_id["inv:4:end"]["refs"] == {
        "verdict": "changes_requested",
        "reasons": ["Handle an empty price list", "Add a test for period=1"],
    }
    assert by_id[f"doc:{spec.document_id}:v1"]["node_id"] == str(pm.id)
    assert by_id[f"doc:{spec.document_id}:v1"]["refs"] == {
        "document_id": str(spec.document_id),
        "version": 1,
        "name": "spec",
    }
    assert by_id["run:pr"]["node_id"] == str(ship.id)
    assert by_id["run:pr"]["refs"] == {
        "pr_url": "https://github.com/lazyxgenius/trade_mcp/pull/42",
        "pr_number": 42,
        "branch": "tvashtr/run-12",
    }
    assert by_id["run:done"]["refs"] == {"elapsed_s": 1358, "cost_usd": 1.12}
    assert reply["summary"] == {
        "pr_url": "https://github.com/lazyxgenius/trade_mcp/pull/42",
        "pr_number": 42,
        "rounds": 2,
        "elapsed_s": 1358,
        "cost_usd": 1.12,
        "branch": "tvashtr/run-12",
        "base_ref": "main",
        "tests_passed": 41,
    }
    assert reply["pinned"] is None and reply["live_state"] == "done"
    # A finished agent's activity is its last line; a gate says who decided and when.
    agents = {a["label"]: a for a in reply["agents"]}
    assert agents["Engineer"]["activity"] == "Ran the tests: all 41 passed"
    assert agents["Engineer"]["last_event_at"] == _at(600).isoformat()
    assert agents["Engineer"]["iteration"] == 2
    assert agents["Reviewer"]["activity"] == "Approved"
    assert agents["PM"]["activity"] == "Wrote the spec (v1)"
    assert agents["Approval"]["activity"] == "You approved"  # the frontend adds the local time
    assert agents["Approval"]["last_event_at"] == _at(59).isoformat()
    assert agents["Ship"]["activity"] == (
        "Pushed branch tvashtr/run-12 and opened pull request #42"
    )
    assert all(a["live_state"] == "done" for a in reply["agents"])


def test_a_failed_run_pins_its_failure_and_ends_with_a_failed_line():
    pm, eng, _ = _engineer_world()
    invs = [
        _inv(1, pm, end=30),
        _inv(2, eng, status="failed", start=40, end=1358,
             detail="the model didn't answer after 3 tries"),
    ]  # fmt: skip
    run = _run("failed", failed_node_id=eng.id, failure_message="Engineer: it broke")
    reply = _build(run, [pm, eng], invs)
    assert _texts(reply)[-2:] == [
        ("error", "Failed: the model didn't answer after 3 tries"),
        ("done", "Failed after 22m 38s · $1.12"),
    ]
    assert reply["lines"][-2]["tone"] == "danger"
    assert reply["lines"][-2]["refs"] == {"message": "the model didn't answer after 3 tries"}
    assert reply["pinned"]["kind"] == "failed" and reply["pinned"]["node_id"] == str(eng.id)
    assert reply["pinned"]["title"] == "Engineer failed"
    assert reply["pinned"]["body"] == "Engineer: it broke. Nothing was shipped."
    assert reply["summary"] is None and reply["live_state"] == "failed"


def test_a_stopped_run_says_nothing_shipped():
    pm, eng, invs = _engineer_world(status="running")
    reply = _build(_run("cancelled"), [pm, eng], invs)
    assert _texts(reply)[-1] == ("done", "Stopped. Nothing shipped.")
    assert {a["label"]: a["live_state"] for a in reply["agents"]}["Engineer"] == "stopped"


def test_after_returns_only_newer_lines_and_an_unknown_cursor_returns_all():
    pm, eng, invs = _engineer_world(status="done")
    ev = _Events()
    ev.add(2, 41, "action", _editor("view", "core/rsi.py"))
    ev.add(2, 50, "action", _terminal("make lint"))
    ev.add(2, 51, "observation", _terminal_out("ok"))
    full = _build(_run(), [pm, eng], invs, ev.rows)
    first_three = full["lines"][2]
    newer = _build(
        _run(), [pm, eng], invs, ev.rows, after=f"{first_three['at']}|{first_three['id']}"
    )
    assert newer["lines"] == full["lines"][3:]
    assert newer["total"] == full["total"] == len(full["lines"])
    assert full["cursor"] == f"{full['lines'][-1]['at']}|{full['lines'][-1]['id']}"
    unknown = _build(_run(), [pm, eng], invs, ev.rows, after="2026-10-02T10:00:00+00:00|ev:999")
    assert unknown["lines"] == full["lines"]


def test_a_stalled_step_is_pinned_and_outranks_a_retrying_one():
    pm, eng, invs = _engineer_world()
    rev = _node("reviewer", x=300)
    invs.append(_inv(3, rev, status="running", start=40))
    block = {"activity": "x", "activity_started_at": None, "retry": None, "backup_model": None}
    live = {
        2: {**block, "live_state": "stalled", "last_event_at": _at(41).isoformat()},
        3: {**block, "live_state": "retrying", "last_event_at": _at(400).isoformat()},
    }
    reply = _build(_run(), [pm, eng, rev], invs, live_by_inv=live, now=_at(41 + 360))
    assert reply["pinned"] == {
        "kind": "stalled",
        "node_id": str(eng.id),
        "label": "Engineer",
        "title": "The Engineer may be stuck",
        "body": "No update for 6m 00s. Its last step: x. Nothing has shipped.",
        "task_id": None,
        "backup_model": None,
        "gate_kind": None,
    }
    assert reply["live_state"] == "stalled"


def test_verdict_reasons_given_as_a_list():
    assert activity._reasons("['Don\\'t divide by zero', 'Add a test']") == [
        "Don't divide by zero",
        "Add a test",
    ]
    assert activity._reasons('["a", "b"]') == ["a", "b"]
    assert activity._reasons("- one\n* two\n3) three") == ["one", "two", "three"]
    assert activity._reasons(None) == []


# ---------------------------------------------------------------------------- cost per poll


def test_a_second_build_does_not_parse_the_same_events_again(monkeypatch):
    activity._memo.clear()
    calls = {"args": 0, "edits": 0}
    real_args, real_edits = activity._args, activity._edit_counts

    def counting_args(text):
        calls["args"] += 1
        return real_args(text)

    def counting_edits(args):
        calls["edits"] += 1
        return real_edits(args)

    monkeypatch.setattr(activity, "_args", counting_args)
    monkeypatch.setattr(activity, "_edit_counts", counting_edits)
    pm, eng, invs = _engineer_world()
    ev = _Events()
    ev.add(2, 41, "action", _editor("str_replace", "core/rsi.py", old_str="a", new_str="a\nb"))
    ev.add(2, 50, "action", _terminal("python -m pytest -q"))
    ev.add(2, 52, "observation", _terminal_out("41 passed in 0.8s"))
    first = _build(_run(), [pm, eng], invs, ev.rows)
    parsed = dict(calls)
    assert parsed["args"] >= 3 and parsed["edits"] == 1
    second = _build(_run(), [pm, eng], invs, ev.rows)
    assert calls == parsed  # nothing parsed again: no regex, no difflib
    assert second == first
    # A changed payload under the same id is parsed afresh.
    ev.rows[1].payload = _terminal("make lint")
    third = _build(_run(), [pm, eng], invs, ev.rows)
    assert calls["args"] > parsed["args"]
    assert {ln["id"]: ln for ln in third["lines"]}["ev:2"]["refs"]["command"] == "make lint"


# ---------------------------------------------------------------------------- secrets

_KEY = "sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z"


def test_secrets_never_reach_a_line_an_agent_or_the_pinned_callout():
    pm, eng, _ = _engineer_world()
    invs = [
        _inv(1, pm, end=30),
        _inv(2, eng, status="failed", start=40, end=200, detail=f"bad key {_KEY}"),
    ]
    ev = _Events()
    ev.add(2, 41, "action", _terminal('curl -H "Authorization: Bearer abc123token" https://x.io'))
    ev.add(2, 42, "observation", _terminal_out("{}"))
    ev.add(2, 50, "action", _terminal("env"))
    dump = f"PATH=/usr/bin\nOPENAI_API_KEY={_KEY}\nGITHUB_TOKEN=shorty\nDB_PASSWORD=hunter2\n"
    ev.add(2, 51, "observation", _terminal_out(dump + "HOME=/root"))
    ev.add(2, 60, "action", _terminal(f"export OPENAI_API_KEY={_KEY} && make deploy"))
    ev.add(2, 61, "error", {"error": f"AuthenticationError: Incorrect API key: {_KEY}"})
    ev.add(2, 70, "error", {"error": f"AuthenticationError: Incorrect API key: {_KEY}"})
    run = _run("failed", failed_node_id=eng.id, failure_message=f"Engineer: bad key {_KEY}")
    reply = _build(run, [pm, eng], invs, ev.rows)
    text = json.dumps(reply, ensure_ascii=False)
    for secret in (_KEY, "abc123token", "shorty", "hunter2"):
        assert secret not in text
    by_id = {ln["id"]: ln for ln in reply["lines"]}
    assert by_id["ev:1"]["text"] == 'Ran curl -H "Authorization: Bearer ••••" https://x.io'
    assert by_id["ev:3"]["refs"]["output_tail"] == [
        "PATH=/usr/bin",
        "OPENAI_API_KEY=••••",
        "GITHUB_TOKEN=••••",
        "DB_PASSWORD=••••",
        "HOME=/root",
    ]
    assert by_id["ev:5"]["refs"]["command"] == "export OPENAI_API_KEY=•••• && make deploy"
    assert by_id["ev:7"]["text"] == "Hit an error: AuthenticationError: Incorrect API key: ••••"
    assert by_id["inv:2:end"]["text"] == "Failed: bad key ••••"
    engineer = {a["label"]: a for a in reply["agents"]}["Engineer"]
    assert engineer["activity"] == "Failed: bad key ••••"
    assert reply["pinned"]["body"] == "Engineer: bad key ••••. Nothing was shipped."


def test_an_error_settles_the_command_it_answers_and_later_results_pair_right():
    pm, eng, invs = _engineer_world()  # the step still runs
    ev = _Events()
    ev.add(2, 50, "action", _terminal("bad --flag"))
    ev.add(2, 51, "error", {"error": "Tool 'terminal' failed: bad: unknown flag --flag\nusage"})
    ev.add(2, 60, "action", _terminal("python -m pytest -q"))
    ev.add(2, 62, "observation", _terminal_out("....\n4 passed in 0.2s"))
    reply = _build(_run(), [pm, eng], invs, ev.rows)
    by_id = {ln["id"]: ln for ln in reply["lines"]}
    bad = by_id["ev:1"]
    assert (bad["kind"], bad["text"], bad["tone"]) == ("command", "Ran bad --flag", "danger")
    assert bad["refs"]["running"] is False and bad["refs"]["exit_code"] is None
    assert bad["refs"]["output_tail"] == [
        "Tool 'terminal' failed: bad: unknown flag --flag",
        "usage",
    ]
    assert "ev:2" not in by_id  # the error is the command's result, not a line of its own
    tests = by_id["ev:3"]
    assert (tests["kind"], tests["text"], tests["tone"]) == (
        "tests",
        "Ran the tests: all 4 passed",
        "ok",
    )
    assert tests["refs"]["running"] is False
    assert reply["cursor"] == f"{tests['at']}|ev:3"  # nothing is left open


def test_the_summary_counts_passing_tests_only_when_the_last_run_was_green():
    pm, eng, _ = _engineer_world()
    invs = [_inv(1, pm, end=30), _inv(2, eng, start=40, end=100)]
    ev = _Events()
    ev.add(2, 50, "action", _terminal("python -m pytest -q"))
    ev.add(2, 52, "observation", _terminal_out("41 passed in 0.8s"))
    ev.add(2, 60, "action", _terminal("python -m pytest -q"))
    ev.add(2, 62, "observation", _terminal_out("2 failed, 39 passed in 0.9s", exit_code=1))
    reply = _build(_run("completed"), [pm, eng], invs, ev.rows)
    assert reply["summary"]["tests_passed"] is None


def test_a_decided_gate_says_its_latest_decision_without_a_clock():
    pm, gate, eng, rev, ship, edges = _review_world()
    invs = [_inv(1, pm, end=30), _inv(2, gate, start=31, end=60, outcome="approved")]
    tasks = [
        _gate_task(7, gate, status="resolved", resolution="rejected", opened=31, resolved=40),
        _gate_task(8, gate, status="resolved", resolution="approved", opened=45, resolved=59),
    ]
    reply = _build(_run(), [pm, gate, eng, rev, ship], invs, tasks=tasks, edges=edges)
    approval = {a["label"]: a for a in reply["agents"]}["Approval"]
    assert approval["activity"] == "You approved"
    assert approval["last_event_at"] == _at(59).isoformat()
    reversed_order = _build(
        _run(), [pm, gate, eng, rev, ship], invs, tasks=tasks[::-1], edges=edges
    )
    assert {a["label"]: a for a in reversed_order["agents"]}["Approval"] == approval


def test_the_done_time_is_the_runs_last_step_not_a_later_write():
    pm, eng, _ = _engineer_world()
    invs = [_inv(1, pm, end=30), _inv(2, eng, start=40, end=900)]
    ev = _Events()
    ev.add(2, 950, "message", {"source": "agent", "text": "done"})
    run = _run("completed", updated_at=_at(5000))  # a later write moved updated_at
    reply = _build(run, [pm, eng], invs, ev.rows)
    done = reply["lines"][-1]
    assert (done["kind"], done["text"]) == ("done", "Done in 15m 50s · $1.12")
    assert done["at"] == _at(950).isoformat()
    assert done["refs"]["elapsed_s"] == 950 and reply["summary"]["elapsed_s"] == 950
    # No step and no event yet: the run's own last write is all there is.
    bare = _build(_run("failed", updated_at=_at(7)), [pm, eng], [])
    assert bare["lines"][-1]["text"] == "Failed after 7s · $1.12"
