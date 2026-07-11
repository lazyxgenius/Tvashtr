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
from tvashtr.models import Run

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
