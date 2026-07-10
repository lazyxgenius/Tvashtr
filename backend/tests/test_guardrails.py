"""M-rails C8 — the first guardrail gate: ``secret_leak_scan``.

Two layers, both LLM-free / agent-free:

* **Unit** — :func:`secret_leak_scan` over a real tmp workspace: a planted secret -> ``rejected``
  with a redacted reason (names the file + the pattern, NEVER the secret value); a clean tree ->
  ``approved``; placeholders + binaries + VCS dirs do not trip it.
* **Routing (reproduce-first)** — the REAL ``run_team`` walk over a graph whose gate is a
  ``secret_leak_scan`` guardrail: it must route on the SCAN verdict with NO human pause. A planted
  secret routes down the ``rejected`` edge (stop terminal); a clean workspace routes down the
  ``approved`` edge (ship terminal). ``wait_at_gate`` is spied — a guardrail gate must NEVER call
  it. Reverting the gate arm's guardrail branch (so the gate falls through to ``wait_at_gate``)
  turns ``test_secret_gate_routes_deterministically_without_human`` RED — the reproduce-first proof
  that today's code does not handle a guardrail gate_kind deterministically.
"""

import uuid
from pathlib import Path

from conftest import auth_user_id, entry_report_result
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.guardrails import (
    GUARDRAIL_GATE_KINDS,
    guardrail_gate_step,
    secret_leak_scan,
)
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, Edge, Run, TeamGraph

# A syntactically-valid but fake AWS access-key id (AKIA + 16 upper-alnum) — matches the
# ``aws-access-key-id`` shape unconditionally, so the plant is deterministic.
_PLANTED_AWS_KEY = "AKIA1234567890ABCDEF"


# ---- unit: secret_leak_scan ------------------------------------------------


def test_scan_rejects_a_planted_aws_key_and_redacts_it(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "config.env").write_text(
        f"DEBUG=1\nAWS_ACCESS_KEY_ID={_PLANTED_AWS_KEY}\n", encoding="utf-8"
    )
    outcome, reason = secret_leak_scan(str(tmp_path))

    assert outcome == "rejected"
    assert reason is not None
    # The reason names the offending file + the pattern…
    assert "config.env" in reason
    assert "aws-access-key-id" in reason
    # …but NEVER echoes the secret value itself.
    assert _PLANTED_AWS_KEY not in reason


def test_scan_rejects_a_private_key_block(tmp_path):
    (tmp_path / "id_rsa").write_text(
        "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNz...\n-----END OPENSSH PRIVATE KEY-----\n",
        encoding="utf-8",
    )
    outcome, reason = secret_leak_scan(str(tmp_path))
    assert outcome == "rejected"
    assert reason is not None and "private-key" in reason


def test_scan_approves_a_clean_workspace(tmp_path):
    (tmp_path / "README.md").write_text("# hello\nno secrets here\n", encoding="utf-8")
    (tmp_path / "app.py").write_text("print('hello world')\n", encoding="utf-8")
    assert secret_leak_scan(str(tmp_path)) == ("approved", None)


def test_scan_ignores_obvious_placeholders(tmp_path):
    # A labelled assignment whose value is a placeholder must NOT trip (low false-positive bar).
    (tmp_path / ".env.example").write_text(
        'API_KEY="YOUR_API_KEY_HERE_PLACEHOLDER"\nTOKEN=changeme-token-goes-here\n',
        encoding="utf-8",
    )
    assert secret_leak_scan(str(tmp_path)) == ("approved", None)


def test_scan_flags_a_real_generic_api_key_assignment(tmp_path):
    (tmp_path / "settings.py").write_text(
        'SERVICE_API_KEY = "a1b2c3d4e5f6g7h8i9j0k1l2"\n', encoding="utf-8"
    )
    outcome, reason = secret_leak_scan(str(tmp_path))
    assert outcome == "rejected"
    assert reason is not None and "settings.py" in reason
    assert "a1b2c3d4e5f6g7h8i9j0k1l2" not in reason  # value never echoed


def test_scan_skips_binaries_and_vcs_dirs(tmp_path):
    # A secret INSIDE a .git dir or a binary blob is not a workspace leak — skip both.
    git = tmp_path / ".git"
    git.mkdir()
    (git / "config").write_text(f"key = {_PLANTED_AWS_KEY}\n", encoding="utf-8")
    (tmp_path / "blob.bin").write_bytes(b"\x00\x01" + _PLANTED_AWS_KEY.encode() + b"\x00")
    assert secret_leak_scan(str(tmp_path)) == ("approved", None)


def test_scan_of_missing_dir_approves(tmp_path):
    assert secret_leak_scan(str(tmp_path / "does-not-exist")) == ("approved", None)


def test_guardrail_step_none_workspace_approves(client):
    # A guardrail gate reached before any workspace exists scans nothing -> approved.
    assert guardrail_gate_step("wf-x", "node-x", "secret_leak_scan", None) == {
        "resolution": "approved",
        "reasons": None,
    }


def test_secret_leak_scan_is_a_registered_guardrail_kind():
    assert "secret_leak_scan" in GUARDRAIL_GATE_KINDS


# ---- routing: the REAL run_team walk over a guardrail gate ------------------


def _build_guardrail_graph() -> dict[str, str]:
    """A minimal walk exercising the guardrail gate arm:

        entry (completion, edits-off, writes the spec)
          -> secret_gate (gate; gate_kind=secret_leak_scan)
               --approved--> ship (terminal)
               --rejected--> stop (terminal)

    Returns ``{team_graph_id, entry, gate, ship, stop}`` (all str ids)."""
    with session_scope() as session:
        graph = TeamGraph(name="guardrail probe")
        session.add(graph)
        session.flush()

        entry = AgentNode(
            team_graph_id=graph.id,
            role_name="pm",
            kind="completion",
            model="openai/gpt-4o-mini",
            engine=None,
            prompt="Draft the spec from the idea.",
            position={"x": 0, "y": 0},
        )
        gate = AgentNode(
            team_graph_id=graph.id,
            role_name="secret_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 260, "y": 0},
            config={
                "gate_kind": "secret_leak_scan",
                "title": "Scan for leaked secrets",
                "description": "Automatic check — rejects if the workspace contains a secret.",
            },
        )
        ship = AgentNode(
            team_graph_id=graph.id,
            role_name="ship",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 520, "y": 0},
            config={"terminal_kind": "ship"},
        )
        stop = AgentNode(
            team_graph_id=graph.id,
            role_name="stop",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 260, "y": 160},
            config={"terminal_kind": "stop"},
        )
        session.add_all([entry, gate, ship, stop])
        session.flush()
        session.add_all(
            [
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=entry.id,
                    target_node_id=gate.id,
                    edge_type="work",
                    conditions=None,
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=gate.id,
                    target_node_id=ship.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
            ]
        )
        return {
            "team_graph_id": str(graph.id),
            "entry": str(entry.id),
            "gate": str(gate.id),
            "ship": str(ship.id),
            "stop": str(stop.id),
        }


def _make_run(team_graph_id: str) -> str:
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="ship a feature",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def _wire_entry_fakes(monkeypatch, workspace: Path):
    """Fake the ONE agent node (the edits-off entry) + its workspace setup — no LLM/openhands."""

    def _fake_engineer_setup_step(run_id):
        return str(workspace)

    def _fake_agent_run_step(run_id, node_prompt, model, iteration, idea, *a, **k):
        return entry_report_result(idea)  # the edits-off entry's report -> spec v1

    monkeypatch.setattr(team_run, "engineer_setup_step", _fake_engineer_setup_step)
    monkeypatch.setattr(team_run, "agent_run_step", _fake_agent_run_step)


def _gate_invocation_outcome(run_id: str, gate_id: str) -> tuple[str | None, str | None]:
    with session_scope() as session:
        row = session.execute(
            select(AgentInvocation).where(
                AgentInvocation.run_id == run_id,
                AgentInvocation.node_id == uuid.UUID(gate_id),
            )
        ).scalar_one()
        return row.outcome, row.outcome_detail


def test_secret_gate_routes_deterministically_without_human(client, monkeypatch, tmp_path):
    """REPRODUCE-FIRST: a ``secret_leak_scan`` gate over a PLANTED-SECRET workspace routes down the
    ``rejected`` edge (stop terminal) with NO human — ``wait_at_gate`` is never called. On pre-fix
    code the gate falls through to ``wait_at_gate`` (the spy fires) and the run does not reach the
    stop terminal, so this test is RED without the guardrail branch."""
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    (ws / "creds.env").write_text(f"AWS_ACCESS_KEY_ID={_PLANTED_AWS_KEY}\n", encoding="utf-8")
    _wire_entry_fakes(monkeypatch, ws)

    # Spy: a guardrail gate must NEVER take the human path.
    human_called = {"n": 0}

    def _spy_wait_at_gate(*a, **k):
        human_called["n"] += 1
        return {"resolution": "approved", "note": None}  # if wrongly reached, would ship

    monkeypatch.setattr(team_run, "wait_at_gate", _spy_wait_at_gate)

    ids = _build_guardrail_graph()
    run_id = _make_run(ids["team_graph_id"])
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "ship a feature")
    result = handle.get_result()

    # Deterministic: no human pause, and the SCAN verdict (rejected) drove the routing.
    assert human_called["n"] == 0, "a guardrail gate must not call wait_at_gate"
    assert result["status"] == "rejected"
    outcome, detail = _gate_invocation_outcome(run_id, ids["gate"])
    assert outcome == "rejected"
    assert detail is not None and "creds.env" in detail and _PLANTED_AWS_KEY not in detail


def test_secret_gate_approves_a_clean_workspace_and_ships(client, monkeypatch, tmp_path):
    """The same guardrail gate over a CLEAN workspace routes down the ``approved`` edge (ship
    terminal) -> the run completes, still with no human pause."""
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    (ws / "notes.txt").write_text("nothing secret here, just notes\n", encoding="utf-8")
    _wire_entry_fakes(monkeypatch, ws)

    human_called = {"n": 0}
    monkeypatch.setattr(
        team_run,
        "wait_at_gate",
        lambda *a, **k: (
            human_called.__setitem__("n", human_called["n"] + 1)
            or {"resolution": "rejected", "note": None}
        ),
    )

    ids = _build_guardrail_graph()
    run_id = _make_run(ids["team_graph_id"])
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "ship a feature")
    result = handle.get_result()

    assert human_called["n"] == 0
    assert result["status"] == "completed"
    outcome, _ = _gate_invocation_outcome(run_id, ids["gate"])
    assert outcome == "approved"
