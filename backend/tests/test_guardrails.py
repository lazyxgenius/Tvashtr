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

import subprocess
import uuid
from pathlib import Path

from conftest import auth_user_id, entry_report_result
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.guardrails import (
    GUARDRAIL_GATE_KINDS,
    diff_touches_forbidden_paths,
    guardrail_gate_step,
    output_schema_check,
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
    assert guardrail_gate_step("wf-x", "node-x", "secret_leak_scan", None, {}) == {
        "resolution": "approved",
        "reasons": None,
    }


def test_secret_leak_scan_is_a_registered_guardrail_kind():
    assert "secret_leak_scan" in GUARDRAIL_GATE_KINDS


# ---- routing: the REAL run_team walk over a guardrail gate ------------------


def _build_guardrail_graph(gate_config: dict | None = None) -> dict[str, str]:
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
            config=gate_config
            or {
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


# ============================================================================
# M-rails C9 — two MORE deterministic guardrail kinds
#   * diff_touches_forbidden_paths — REJECT when the agent's git diff touches a forbidden glob.
#   * output_schema_check — REJECT when a required output file is missing / not JSON / off-schema.
# Both mirror secret_leak_scan (stdlib+dbos only) and honor the redaction rule (name the
# file/path/key, NEVER echo a value or file contents). Each REJECT test below FAILS if its check is
# stubbed to always-approve — the reproduce-first / mutation-real proof.
# ============================================================================

# A sentinel VALUE planted inside a fixture file: the redacted reason must NEVER echo it.
_PLANTED_VALUE = "s3cr3t-value-do-not-echo-1234567890"


def _init_repo_with(tmp_path: Path, files: dict[str, str]) -> Path:
    """A git-inited workspace (empty init commit) with ``files`` written as UNCOMMITTED changes —
    exactly the state the executor sees at gate time (the agent's diff not yet shipped)."""
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    for rel, content in files.items():
        path = ws / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return ws


# ---- unit: diff_touches_forbidden_paths ------------------------------------


def test_diff_forbidden_rejects_a_touched_forbidden_path(tmp_path):
    ws = _init_repo_with(tmp_path, {".github/workflows/deploy.yml": f"secret: {_PLANTED_VALUE}\n"})
    outcome, reason = diff_touches_forbidden_paths(str(ws), {"forbidden_paths": [".github/**"]})
    assert outcome == "rejected"
    assert reason is not None
    # Names the offending file + the matched glob…
    assert ".github/workflows/deploy.yml" in reason
    assert ".github/**" in reason
    # …but NEVER the file's contents.
    assert _PLANTED_VALUE not in reason


def test_diff_forbidden_approves_when_no_forbidden_path_touched(tmp_path):
    ws = _init_repo_with(tmp_path, {"src/app.py": "print('hi')\n", "README.md": "# ok\n"})
    assert diff_touches_forbidden_paths(
        str(ws), {"forbidden_paths": [".github/**", "infra/**", "*.pem"]}
    ) == ("approved", None)


def test_diff_forbidden_approves_with_no_globs_configured(tmp_path):
    # A change is present, but nothing is forbidden -> nothing can match -> approve.
    ws = _init_repo_with(tmp_path, {"infra/main.tf": "resource {}\n"})
    assert diff_touches_forbidden_paths(str(ws), {}) == ("approved", None)
    assert diff_touches_forbidden_paths(str(ws), {"forbidden_paths": []}) == ("approved", None)


def test_diff_forbidden_matches_a_modified_tracked_file(tmp_path):
    # A file that existed at HEAD and was MODIFIED is a changed path too
    # (git diff --name-only HEAD).
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    (ws / "secrets.py").write_text("TOKEN = 'x'\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(ws), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(ws), "commit", "-q", "-m", "base"], check=True)
    (ws / "secrets.py").write_text("TOKEN = 'changed'\n", encoding="utf-8")  # modify tracked file
    outcome, reason = diff_touches_forbidden_paths(str(ws), {"forbidden_paths": ["secrets.py"]})
    assert outcome == "rejected"
    assert reason is not None and "secrets.py" in reason


def test_diff_forbidden_is_deterministic_first_hit(tmp_path):
    # Two forbidden files touched -> the lexicographically-first changed path is reported (sorted).
    ws = _init_repo_with(tmp_path, {"infra/a.tf": "x\n", "zzz/last.pem": "-----BEGIN-----\n"})
    outcome, reason = diff_touches_forbidden_paths(
        str(ws), {"forbidden_paths": ["infra/**", "*.pem"]}
    )
    assert outcome == "rejected"
    assert reason is not None and "infra/a.tf" in reason  # sorted -> infra/ before zzz/


# ---- unit: output_schema_check ---------------------------------------------

_SCHEMA = {
    "type": "object",
    "required": ["status", "count"],
    "properties": {"status": {"type": "string"}, "count": {"type": "integer"}},
}


def test_output_schema_rejects_a_missing_file(tmp_path):
    ws = _init_repo_with(tmp_path, {"README.md": "# nothing else\n"})
    outcome, reason = output_schema_check(
        str(ws), {"output_file": "result.json", "schema": _SCHEMA}
    )
    assert outcome == "rejected"
    assert reason is not None and "result.json" in reason


def test_output_schema_rejects_invalid_json_without_echoing_contents(tmp_path):
    ws = _init_repo_with(tmp_path, {"result.json": f"not json at all {_PLANTED_VALUE}"})
    outcome, reason = output_schema_check(
        str(ws), {"output_file": "result.json", "schema": _SCHEMA}
    )
    assert outcome == "rejected"
    assert reason is not None and "result.json" in reason
    assert _PLANTED_VALUE not in reason  # file contents never echoed


def test_output_schema_rejects_a_schema_violation_naming_the_key(tmp_path):
    # Valid JSON, but `count` is a string (schema wants integer) -> reject naming the failing key,
    # never the value.
    ws = _init_repo_with(
        tmp_path, {"result.json": '{"status": "ok", "count": "' + _PLANTED_VALUE + '"}'}
    )
    outcome, reason = output_schema_check(
        str(ws), {"output_file": "result.json", "schema": _SCHEMA}
    )
    assert outcome == "rejected"
    assert reason is not None and "result.json" in reason
    assert "count" in reason  # names the FIRST failing key/path
    assert _PLANTED_VALUE not in reason  # the offending value is never echoed


def test_output_schema_rejects_a_missing_required_key(tmp_path):
    ws = _init_repo_with(tmp_path, {"result.json": '{"status": "ok"}'})  # `count` missing
    outcome, reason = output_schema_check(
        str(ws), {"output_file": "result.json", "schema": _SCHEMA}
    )
    assert outcome == "rejected"
    assert reason is not None and "result.json" in reason and "count" in reason


def test_output_schema_approves_a_valid_output(tmp_path):
    ws = _init_repo_with(tmp_path, {"result.json": '{"status": "ok", "count": 3}'})
    assert output_schema_check(str(ws), {"output_file": "result.json", "schema": _SCHEMA}) == (
        "approved",
        None,
    )


def test_output_schema_approves_when_nothing_configured(tmp_path):
    ws = _init_repo_with(tmp_path, {"result.json": '{"whatever": 1}'})
    assert output_schema_check(str(ws), {}) == ("approved", None)


# ---- dispatch: guardrail_gate_step routes each new kind WITH its config -----


def test_guardrail_step_dispatches_diff_touches_forbidden_paths(client, tmp_path):
    ws = _init_repo_with(tmp_path, {"infra/main.tf": "resource {}\n"})
    out = guardrail_gate_step(
        "wf", "node", "diff_touches_forbidden_paths", str(ws), {"forbidden_paths": ["infra/**"]}
    )
    assert out["resolution"] == "rejected"
    assert out["reasons"] is not None and "infra/main.tf" in out["reasons"]


def test_guardrail_step_dispatches_output_schema_check(client, tmp_path):
    ws = _init_repo_with(tmp_path, {"result.json": '{"status": "ok"}'})  # missing `count`
    out = guardrail_gate_step(
        "wf",
        "node",
        "output_schema_check",
        str(ws),
        {"output_file": "result.json", "schema": _SCHEMA},
    )
    assert out["resolution"] == "rejected"
    assert out["reasons"] is not None and "result.json" in out["reasons"]


def test_both_new_kinds_are_registered_guardrails():
    assert "diff_touches_forbidden_paths" in GUARDRAIL_GATE_KINDS
    assert "output_schema_check" in GUARDRAIL_GATE_KINDS


# ---- routing (executor gate arm e2e): the REAL run_team walk over each new kind ----


def test_forbidden_paths_gate_routes_reject_without_human(client, monkeypatch, tmp_path):
    """Kind 1 through the executor gate arm: a `diff_touches_forbidden_paths` gate over a workspace
    whose diff touches `.github/**` auto-REJECTS (routes to the stop terminal) with NO human pause.
    RED if the check is stubbed to always-approve (it would ship instead of stop)."""
    ws = _init_repo_with(tmp_path, {".github/workflows/deploy.yml": "name: deploy\n"})
    _wire_entry_fakes(monkeypatch, ws)

    human_called = {"n": 0}

    def _spy_wait_at_gate(*a, **k):
        human_called["n"] += 1
        return {"resolution": "approved", "note": None}

    monkeypatch.setattr(team_run, "wait_at_gate", _spy_wait_at_gate)

    ids = _build_guardrail_graph(
        gate_config={
            "gate_kind": "diff_touches_forbidden_paths",
            "title": "No CI/CD edits",
            "description": "Rejects if the change touches protected paths.",
            "forbidden_paths": [".github/**", "infra/**"],
        }
    )
    run_id = _make_run(ids["team_graph_id"])
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "ship a feature")
    result = handle.get_result()

    assert human_called["n"] == 0, "a guardrail gate must not call wait_at_gate"
    assert result["status"] == "rejected"
    outcome, detail = _gate_invocation_outcome(run_id, ids["gate"])
    print(
        f"[C9-e2e] Kind1 diff_touches_forbidden_paths -> resolution={outcome!r} detail={detail!r}"
    )
    assert outcome == "rejected"
    assert detail is not None
    assert ".github/workflows/deploy.yml" in detail and ".github/**" in detail


def test_output_schema_gate_routes_approve_and_ships(client, monkeypatch, tmp_path):
    """Kind 2 through the executor gate arm: an `output_schema_check` gate over a workspace whose
    output file validates auto-APPROVES (routes to ship -> completed), no human pause."""
    ws = _init_repo_with(tmp_path, {"result.json": '{"status": "ok", "count": 2}'})
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

    ids = _build_guardrail_graph(
        gate_config={
            "gate_kind": "output_schema_check",
            "title": "Deliverable present",
            "description": "Rejects if result.json is missing or off-schema.",
            "output_file": "result.json",
            "schema": _SCHEMA,
        }
    )
    run_id = _make_run(ids["team_graph_id"])
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "ship a feature")
    result = handle.get_result()

    assert human_called["n"] == 0
    assert result["status"] == "completed"
    outcome, _ = _gate_invocation_outcome(run_id, ids["gate"])
    print(f"[C9-e2e] Kind2 output_schema_check -> resolution={outcome!r} (run completed)")
    assert outcome == "approved"
