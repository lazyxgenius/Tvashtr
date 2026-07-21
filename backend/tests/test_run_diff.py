"""M-changes — the Run Changes (diff) view: reproduce + owner-isolation tests for
``GET /api/runs/{run_id}/diff`` (mirrors the /trajectory owner-scoping).

These are mutation-real: each seeds a KNOWN change on disk (a brownfield ``tvashtr/<run_id>``
branch, or a greenfield shipped workspace) and asserts the endpoint returns the EXACT per-file
status + additions/deletions — so they fail against a stub that returns an empty list. The
owner-isolation test asserts a foreign authenticated user is 404 (the suite's convention, not 403;
existence is not even probeable — see ``_require_owned_run``).
"""

import shutil
import subprocess
import uuid
from pathlib import Path

from conftest import auth_user_id
from fastapi.testclient import TestClient

from tvashtr.control_plane.shipping import idempotent_ship, init_workspace_repo
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import Run, RunArtifact

# The greenfield workspace root the executor + the /diff endpoint both resolve from run_id.
# backend/tests/test_run_diff.py -> parents[1] == backend/ (matches the executor's _WORKSPACE_ROOT
# and control_plane.run_diff._WORKSPACE_ROOT). Kept local so the test never imports openhands.
_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / ".tvashtr_workspaces"


def _git(ws: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(ws), *args], check=True, capture_output=True, text=True)


def _init_fixture(path: Path) -> Path:
    """A real git repo on branch ``main`` with two committed files (the brownfield base)."""
    path.mkdir(parents=True, exist_ok=True)
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", "t@t.local")
    _git(path, "config", "user.name", "tester")
    (path / "calculator.py").write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")
    (path / "CLAUDE.md").write_text("Keep functions tiny.\n", encoding="utf-8")
    _git(path, "add", "-A")
    _git(path, "commit", "-qm", "init")
    return path


def _seed_run(run_id: str, **cols) -> None:
    team_graph_id = build_two_node_team()
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea=cols.pop("idea", "x"),
                workflow_id=run_id,
                status=cols.pop("status", "completed"),
                **cols,
            )
        )


def test_run_diff_excludes_remember_capture_sidecar(tmp_path):
    """M-memory S4: even if the ``TVASHTR_REMEMBER.jsonl`` capture sidecar reached a commit, the run
    diff never surfaces it (defense-in-depth beside the ship-time exclusion)."""
    from tvashtr.control_plane.run_diff import compute_run_diff

    run_id = str(uuid.uuid4())
    fixture = _init_fixture(tmp_path / "repo")
    _git(fixture, "checkout", "-qb", f"tvashtr/{run_id}")
    (fixture / "feature.py").write_text("x = 1\n", encoding="utf-8")
    (fixture / "TVASHTR_REMEMBER.jsonl").write_text('{"content":"y"}\n', encoding="utf-8")
    _git(fixture, "add", "-A")
    _git(fixture, "commit", "-qm", "change + capture")

    result = compute_run_diff(
        run_id=run_id,
        repo_path=str(fixture),
        base_ref="main",
        ship_branch=f"tvashtr/{run_id}",
    )
    paths = [f["path"] for f in result["files"]]
    assert "feature.py" in paths
    assert "TVASHTR_REMEMBER.jsonl" not in paths  # capture sidecar never in the diff


def test_run_diff_brownfield_reports_exact_per_file_status(client, tmp_path):
    """Brownfield /diff = ``git diff base_ref..tvashtr/<run_id>``: the exact per-file add / modify /
    delete class + real ±line counts (fails against a stub returning [])."""
    run_id = str(uuid.uuid4())
    fixture = _init_fixture(tmp_path / "repo")

    # Build the ship branch BY HAND with a KNOWN change (add + modify + delete).
    _git(fixture, "checkout", "-q", "-b", f"tvashtr/{run_id}")
    # MODIFY calculator.py: append a two-line sub() (+2 / -0).
    (fixture / "calculator.py").write_text(
        "def add(a, b):\n    return a + b\ndef sub(a, b):\n    return a - b\n", encoding="utf-8"
    )
    # ADD newmod.py (+1 / -0).
    (fixture / "newmod.py").write_text("x = 1\n", encoding="utf-8")
    # DELETE CLAUDE.md (-1).
    _git(fixture, "rm", "-q", "CLAUDE.md")
    _git(fixture, "add", "-A")
    _git(fixture, "commit", "-qm", "known change")
    _git(fixture, "checkout", "-q", "main")  # leave the base branch checked out

    _seed_run(
        run_id,
        idea="Add a subtract(a, b) to calculator.py.",
        status="completed",
        repo_path=str(fixture),
        base_ref="main",
        ship_branch=f"tvashtr/{run_id}",
    )

    resp = client.get(f"/api/runs/{run_id}/diff")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 3, body
    by_path = {f["path"]: f for f in body["files"]}
    assert set(by_path) == {"calculator.py", "newmod.py", "CLAUDE.md"}

    assert by_path["calculator.py"]["status"] == "modified"
    assert by_path["calculator.py"]["additions"] == 2
    assert by_path["calculator.py"]["deletions"] == 0
    assert "def sub" in by_path["calculator.py"]["patch"]

    assert by_path["newmod.py"]["status"] == "added"
    assert by_path["newmod.py"]["additions"] == 1
    assert by_path["newmod.py"]["deletions"] == 0

    assert by_path["CLAUDE.md"]["status"] == "deleted"
    assert by_path["CLAUDE.md"]["additions"] == 0
    assert by_path["CLAUDE.md"]["deletions"] == 1


def test_run_diff_greenfield_reports_produced_files_as_added(client):
    """Greenfield /diff = the produced files under the run workspace, each reported ``added`` with
    its content as the patch (the ship commit vs the empty init tree)."""
    run_id = str(uuid.uuid4())
    ws = _WORKSPACE_ROOT / run_id
    ws.mkdir(parents=True, exist_ok=True)
    try:
        init_workspace_repo(str(ws))
        (ws / "greeting.txt").write_text("hello\nworld\n", encoding="utf-8")
        ship = idempotent_ship(str(ws), run_id)
        _seed_run(
            run_id,
            idea="build greeting.txt",
            status="completed",
            ship_commit_sha=ship["sha"],
            ship_tag=ship["tag"],
        )

        resp = client.get(f"/api/runs/{run_id}/diff")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1, body
        f = body["files"][0]
        assert f["path"] == "greeting.txt"
        assert f["status"] == "added"
        assert f["additions"] == 2
        assert f["deletions"] == 0
        assert "hello" in f["patch"]
    finally:
        shutil.rmtree(ws, ignore_errors=True)


def test_run_diff_empty_when_nothing_to_diff(client):
    """A completed greenfield run whose workspace is gone (nothing to diff) -> [] with 200, not an
    error."""
    run_id = str(uuid.uuid4())
    _seed_run(run_id, idea="nothing", status="completed")  # no workspace, no repo_path
    resp = client.get(f"/api/runs/{run_id}/diff")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["files"] == []
    assert body["total"] == 0


def test_run_diff_endpoint_is_owner_scoped(client):
    """/diff is owner-scoped: a DIFFERENT authenticated user gets 404 (existence not even
    probeable), an absent run is 404, and the owner gets 200."""
    run_id = str(uuid.uuid4())
    _seed_run(run_id, idea="owned", status="completed")

    other = TestClient(app)
    other.cookies.clear()
    reg = other.post(
        "/api/auth/register",
        json={"email": f"rundiff-other-{uuid.uuid4().hex}@tvashtr.local", "password": "pw-123456"},
    )
    assert reg.status_code == 200, reg.text

    assert other.get(f"/api/runs/{run_id}/diff").status_code == 404  # foreign owner
    assert other.get(f"/api/runs/{uuid.uuid4()}/diff").status_code == 404  # absent run
    assert client.get(f"/api/runs/{run_id}/diff").status_code == 200  # the owner


def test_run_diff_survives_non_utf8_file_content(client, tmp_path):
    """A tracked file with non-UTF-8 bytes must NOT 500 the endpoint — the module's 'never raises'
    contract (git emits the raw byte in the patch; text=True decoding must not abort)."""
    run_id = str(uuid.uuid4())
    fixture = _init_fixture(tmp_path / "repo")
    _git(fixture, "checkout", "-q", "-b", f"tvashtr/{run_id}")
    # latin-1 bytes git treats as TEXT (no NUL) — the +line in the patch carries the raw 0xe9.
    (fixture / "latin.txt").write_bytes(b"caf\xe9\n")
    _git(fixture, "add", "-A")
    _git(fixture, "commit", "-qm", "add latin1 text")
    _git(fixture, "checkout", "-q", "main")
    _seed_run(
        run_id,
        status="completed",
        repo_path=str(fixture),
        base_ref="main",
        ship_branch=f"tvashtr/{run_id}",
    )
    resp = client.get(f"/api/runs/{run_id}/diff")
    assert resp.status_code == 200, resp.text
    assert "latin.txt" in {f["path"] for f in resp.json()["files"]}


def test_run_diff_brownfield_ignores_base_advances_after_cut(client, tmp_path):
    """Brownfield diff is a MERGE-BASE compare (three-dot): commits made on the BASE branch AFTER
    the run's branch was cut must NOT appear in the run's diff — only the run's own change does."""
    run_id = str(uuid.uuid4())
    fixture = _init_fixture(tmp_path / "repo")  # main: calculator.py + CLAUDE.md
    # The run cuts its branch and makes its ONLY change (modify calculator.py).
    _git(fixture, "checkout", "-q", "-b", f"tvashtr/{run_id}")
    (fixture / "calculator.py").write_text(
        "def add(a, b):\n    return a + b\ndef mul(a, b):\n    return a * b\n", encoding="utf-8"
    )
    _git(fixture, "add", "-A")
    _git(fixture, "commit", "-qm", "the run's change")
    # The BASE branch advances AFTER the cut: an unrelated commit to CLAUDE.md on main.
    _git(fixture, "checkout", "-q", "main")
    (fixture / "CLAUDE.md").write_text("Keep functions tiny. And documented.\n", encoding="utf-8")
    _git(fixture, "add", "-A")
    _git(fixture, "commit", "-qm", "unrelated base advance")
    _seed_run(
        run_id,
        status="completed",
        repo_path=str(fixture),
        base_ref="main",
        ship_branch=f"tvashtr/{run_id}",
    )
    resp = client.get(f"/api/runs/{run_id}/diff")
    assert resp.status_code == 200, resp.text
    paths = {f["path"] for f in resp.json()["files"]}
    assert paths == {"calculator.py"}, f"diff must show ONLY the run's change, got {paths}"


# ---------------------------------------------------------------------------------------------
# THE DURABLE SNAPSHOT (M-wsgc S1) — serving a greenfield diff from ``run_artifacts``.
#
# ``ship_step`` stores the whole ``compute_run_diff`` result for a greenfield run while the
# workspace still exists, which is what lets the reaper reclaim the directory afterwards. So the
# endpoint gains ONE branch: a greenfield run WITH a snapshot returns the stored dict verbatim; a
# greenfield run WITHOUT one falls through to the live workspace read exactly as before (mid-flight,
# or a run that never shipped). Brownfield is untouched — it never reaches the branch at all.
#
# The branch lives in the ROUTER, not in ``run_diff``. That module is deliberately pure
# ``subprocess`` + ``pathlib`` — no DBOS, no database, no openhands — so it stays importable
# anywhere and unit-testable against a throwaway temp repo; the router already holds a
# ``session_scope``. ``test_the_diff_module_stays_pure`` is the fence on that.
# ---------------------------------------------------------------------------------------------


def _persist_artifact(run_id: str, files: list[dict]) -> dict:
    snapshot = {
        "run_id": run_id,
        "base_ref": None,
        "ship_branch": None,
        "files": files,
        "total": len(files),
    }
    with session_scope() as session:
        session.add(RunArtifact(run_id=uuid.UUID(run_id), files=snapshot))
    return snapshot


def _file(path: str, patch: str = "+x\n") -> dict:
    return {"path": path, "status": "added", "additions": 1, "deletions": 0, "patch": patch}


def test_greenfield_diff_is_served_from_the_snapshot_once_the_workspace_is_gone(client):
    """THE MILESTONE. A shipped greenfield run whose workspace has been reclaimed still serves its
    "Changes" tab — from the database, byte-identical in shape to the live computation. On the
    pre-change code this is the degraded ``[]``/200 path: 200, and empty, and the deliverable
    unviewable forever."""
    run_id = str(uuid.uuid4())
    _seed_run(run_id, idea="build greeting.txt", status="completed")  # greenfield, no workspace
    _persist_artifact(run_id, [_file("greeting.txt", "+hello\n+world\n")])

    resp = client.get(f"/api/runs/{run_id}/diff")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1, "the reaped run's Changes tab is empty — the snapshot was not read"
    assert body["files"][0]["path"] == "greeting.txt"
    assert "hello" in body["files"][0]["patch"]
    assert set(body) == {"run_id", "base_ref", "ship_branch", "files", "total"}


def test_the_snapshot_is_authoritative_over_a_live_recompute(client):
    """Proves the endpoint genuinely READS the row rather than recomputing and coincidentally
    agreeing. The workspace is still on disk and holds ``greeting.txt``; the stored snapshot names a
    different file, and the stored one must win. Without this, a no-op "fix" that never touches the
    database passes the test above for as long as the directory happens to survive."""
    run_id = str(uuid.uuid4())
    ws = _WORKSPACE_ROOT / run_id
    ws.mkdir(parents=True, exist_ok=True)
    try:
        init_workspace_repo(str(ws))
        (ws / "greeting.txt").write_text("hello\n", encoding="utf-8")
        ship = idempotent_ship(str(ws), run_id)
        _seed_run(run_id, status="completed", ship_commit_sha=ship["sha"], ship_tag=ship["tag"])
        _persist_artifact(run_id, [_file("snapshotted.txt")])

        body = client.get(f"/api/runs/{run_id}/diff").json()

        assert [f["path"] for f in body["files"]] == ["snapshotted.txt"], (
            "the live workspace was recomputed instead of reading the durable snapshot"
        )
    finally:
        shutil.rmtree(ws, ignore_errors=True)


def test_a_greenfield_run_without_a_snapshot_still_reads_the_live_workspace(client):
    """THE FALL-THROUGH, and the hard invariant's other face: mid-flight and never-shipped runs have
    no row, and must keep reading the workspace exactly as before this table existed. (Their
    workspace is correspondingly still SPARED — see ``test_workspace_gc.py``.)"""
    run_id = str(uuid.uuid4())
    ws = _WORKSPACE_ROOT / run_id
    ws.mkdir(parents=True, exist_ok=True)
    try:
        init_workspace_repo(str(ws))
        (ws / "in_progress.txt").write_text("wip\n", encoding="utf-8")
        ship = idempotent_ship(str(ws), run_id)
        _seed_run(run_id, status="running", ship_commit_sha=ship["sha"], ship_tag=ship["tag"])

        body = client.get(f"/api/runs/{run_id}/diff").json()

        assert [f["path"] for f in body["files"]] == ["in_progress.txt"]
    finally:
        shutil.rmtree(ws, ignore_errors=True)


def test_a_brownfield_run_never_reads_the_snapshot(client, tmp_path):
    """Brownfield is byte-identical to before: it diffs the user's REAL repo, whose branch is the
    durable deliverable and which can move after the run. Even with a row planted on it (nothing
    writes one — ``ship_step`` gates on ``repo_path IS NULL``), the endpoint must ignore it: reading
    a snapshot here would silently freeze the tab at ship time and diverge from the repo."""
    run_id = str(uuid.uuid4())
    fixture = _init_fixture(tmp_path / "repo")
    _git(fixture, "checkout", "-q", "-b", f"tvashtr/{run_id}")
    (fixture / "newmod.py").write_text("x = 1\n", encoding="utf-8")
    _git(fixture, "add", "-A")
    _git(fixture, "commit", "-qm", "the run's change")
    _git(fixture, "checkout", "-q", "main")
    _seed_run(
        run_id,
        status="completed",
        repo_path=str(fixture),
        base_ref="main",
        ship_branch=f"tvashtr/{run_id}",
    )
    _persist_artifact(run_id, [_file("never-read.txt")])

    body = client.get(f"/api/runs/{run_id}/diff").json()

    assert [f["path"] for f in body["files"]] == ["newmod.py"], (
        "a brownfield diff was served from a snapshot instead of the real repo"
    )


def test_the_diff_module_stays_pure():
    """THE BOUNDARY FENCE. ``run_diff`` must import NOTHING but ``subprocess`` + ``pathlib``: no
    ``dbos`` (``main.py`` imports this transitively and startup must stay openhands-free), no
    ``tvashtr.db`` (the snapshot read belongs to the router, which already holds a session), no
    ``tvashtr.models``. Parsed from the source rather than probed with ``hasattr`` so a LAZY import
    tucked inside a function is caught too — that is precisely how this boundary would erode."""
    import ast

    from tvashtr.control_plane import run_diff

    tree = ast.parse(Path(run_diff.__file__).read_text(encoding="utf-8"))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            # A RELATIVE import (``from .db import ...``, level > 0) has no module root of its own,
            # so recording only absolute ones would let the most compact evasion through. Name it
            # by its dots instead, so any relative import at all breaks the equality below.
            roots.add(node.module.split(".")[0] if node.level == 0 else "." * node.level)

    assert roots == {"subprocess", "pathlib"}, f"run_diff grew an import: {sorted(roots)}"
