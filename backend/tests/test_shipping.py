"""Idempotent ship logic — no network, real local git in a tmp repo.

This is the durability guarantee P0.4b's crash test relies on: re-running the
agent (and thus the ship) must produce **exactly one** tagged commit. Also
proves commits work with **repo-local** git identity (no global git config).

The second half of the file covers the executor's ``ship_step`` — specifically the M-wsgc S1
GREENFIELD DIFF SNAPSHOT it takes right after the ship, which is what later licenses the workspace
reaper to reclaim the directory (see ``test_workspace_gc.py``). Those tests need Postgres; the pure
``idempotent_ship`` tests above deliberately still do not, because the persist lives in the STEP and
never in the pure ship function.
"""

import ast
import shutil
import subprocess
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from conftest import auth_user_id

from tvashtr.control_plane import run_diff, team_run
from tvashtr.control_plane.shipping import idempotent_ship, init_workspace_repo
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import Run, RunArtifact


def _tags(ws) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(ws), "tag", "--list", "ship-*"], capture_output=True, text=True
    ).stdout
    return out.split()


def _show(ws, tag, path) -> str:
    return subprocess.run(
        ["git", "-C", str(ws), "show", f"{tag}:{path}"], capture_output=True, text=True
    ).stdout


def test_idempotent_ship_commits_once_and_dedups_by_tag(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    (ws / "greeting.txt").write_text("Shipped by the team\n")

    first = idempotent_ship(str(ws), "run-abc")
    assert first["created"] is True
    assert first["tag"] == "ship-run-abc"
    assert first["sha"]

    # Re-run (simulating a crash-retry of the agent step): no new commit.
    second = idempotent_ship(str(ws), "run-abc")
    assert second["created"] is False
    assert second["sha"] == first["sha"]

    assert _tags(ws) == ["ship-run-abc"]
    assert _show(ws, "ship-run-abc", "greeting.txt") == "Shipped by the team\n"


def test_idempotent_ship_excludes_remember_capture_sidecar(tmp_path):
    """M-memory S4: the agent-remember capture sidecar (``TVASHTR_REMEMBER.jsonl``) must NEVER land
    in the shipped commit — it stays on disk (read at run-end) but `git add -A` excludes it."""
    ws = tmp_path / "ws-tv"
    ws.mkdir()
    init_workspace_repo(str(ws))
    (ws / "greeting.txt").write_text("hi\n")
    (ws / "TVASHTR_REMEMBER.jsonl").write_text('{"content":"x"}\n')

    idempotent_ship(str(ws), "run-tv")

    tracked = subprocess.run(
        ["git", "-C", str(ws), "ls-tree", "-r", "--name-only", "ship-run-tv"],
        capture_output=True,
        text=True,
    ).stdout.split()
    assert "greeting.txt" in tracked
    assert "TVASHTR_REMEMBER.jsonl" not in tracked  # capture sidecar excluded from the ship
    assert (ws / "TVASHTR_REMEMBER.jsonl").exists()  # survives on disk for the run-end read


def test_ship_with_no_changes_raises(tmp_path):
    ws = tmp_path / "ws-empty"
    ws.mkdir()
    init_workspace_repo(str(ws))
    with pytest.raises(RuntimeError):
        idempotent_ship(str(ws), "run-empty")


def test_init_workspace_repo_is_idempotent(tmp_path):
    ws = tmp_path / "ws-init"
    ws.mkdir()
    init_workspace_repo(str(ws))
    init_workspace_repo(str(ws))  # second call is a no-op, no error
    assert (ws / ".git").is_dir()


def test_idempotent_ship_recovers_commit_made_without_tag(tmp_path):
    """Crash window: the ship commit exists but the process died before tagging.

    On resume, ``idempotent_ship`` must re-tag HEAD (the dangling ship commit) and
    return ``created=False`` — NOT raise 'nothing to ship'.
    """
    ws = tmp_path / "ws-recover"
    ws.mkdir()
    init_workspace_repo(str(ws))
    (ws / "greeting.txt").write_text("Shipped\n")
    run_id = "run-recover"

    # Simulate the crash window: commit WITHOUT creating the tag.
    subprocess.run(["git", "-C", str(ws), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(ws), "commit", "-q", "-m", f"Ship: {run_id}"], check=True)
    head = subprocess.run(
        ["git", "-C", str(ws), "rev-parse", "HEAD"], capture_output=True, text=True
    ).stdout.strip()

    result = idempotent_ship(str(ws), run_id)  # must not raise

    assert result["created"] is False
    assert result["sha"] == head
    assert result["tag"] == f"ship-{run_id}"
    assert _tags(ws) == [f"ship-{run_id}"]


# revamp-e2e: the OpenHands agent's own system prompt tells it to commit ("Use `git commit -a`
# whenever possible"), and live run 42e08600's Engineer did: `git add docs/DEMO_PROOF.md && git
# commit`. Ship then found nothing staged and raised, and the run never ended. An agent's commit on
# the run's branch IS its work, so Ship ships it.


def _git(ws, *args) -> str:
    return subprocess.run(
        ["git", "-C", str(ws), *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def _agent_commits(ws, name: str, text: str) -> str:
    (Path(ws) / name).write_text(text)
    _git(ws, "add", name)
    _git(ws, "-c", "user.email=a@x", "-c", "user.name=agent", "commit", "-q", "-m", f"add {name}")
    return _git(ws, "rev-parse", "HEAD")


def _repo_with_history(path: Path) -> Path:
    """A user's repo with some history on ``main`` (not a fresh workspace)."""
    path.mkdir()
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", "u@x")
    _git(path, "config", "user.name", "user")
    (path / "README.md").write_text("repo\n")
    _git(path, "add", "README.md")
    _git(path, "commit", "-q", "-m", "first")
    (path / "app.py").write_text("print(1)\n")
    _git(path, "add", "app.py")
    _git(path, "commit", "-q", "-m", "second")
    return path


def test_ship_takes_a_commit_the_agent_made_itself(tmp_path):
    ws = tmp_path / "ws-self"
    ws.mkdir()
    init_workspace_repo(str(ws))
    head = _agent_commits(ws, "greeting.txt", "hi\n")

    first = idempotent_ship(str(ws), "run-self")
    assert first == {"sha": head, "tag": "ship-run-self", "created": True}
    assert _show(ws, "ship-run-self", "greeting.txt") == "hi\n"
    # Re-running ships nothing new.
    assert idempotent_ship(str(ws), "run-self") == {
        "sha": head,
        "tag": "ship-run-self",
        "created": False,
    }


def test_ship_takes_the_agents_commits_on_a_run_branch(tmp_path):
    """A hosted clone or a local folder: the run works on ``tvashtr/<run_id>`` branched from the
    base. The agent's commits on that branch are shipped; the base's own history is not."""
    repo = _repo_with_history(tmp_path / "repo")
    _git(repo, "checkout", "-q", "-b", "tvashtr/run-br")
    head = _agent_commits(repo, "docs.md", "# Docs\n")

    assert idempotent_ship(str(repo), "run-br") == {
        "sha": head,
        "tag": "ship-run-br",
        "created": True,
    }


def test_ship_takes_the_agents_commit_in_a_linked_worktree(tmp_path):
    repo = _repo_with_history(tmp_path / "repo")
    wt = tmp_path / "wt"
    _git(repo, "worktree", "add", "-q", "-b", "tvashtr/run-wt", str(wt), "main")
    head = _agent_commits(wt, "docs.md", "# Docs\n")

    assert idempotent_ship(str(wt), "run-wt")["sha"] == head


def _tree(ws, ref) -> list[str]:
    return _git(ws, "ls-tree", "-r", "--name-only", ref).split()


def test_ship_leaves_tvashtrs_own_files_out_of_a_run_branch(tmp_path):
    """revamp-e2e: live PR lazyxgenius/trade_mcp#14 shipped the PM's REPORT.md into the user's repo.
    A hosted or local-folder run has no Tvashtr .gitignore, so the ship itself must leave Tvashtr's
    own files out (the report, the reviewer's verdict, the spec handle) — they stay on disk."""
    repo = _repo_with_history(tmp_path / "repo")
    _git(repo, "checkout", "-q", "-b", "tvashtr/run-side")
    for name, text in (
        ("REPORT.md", "# PRD\n"),
        ("REVIEW_VERDICT.json", '{"verdict": "approved"}'),
        ("SPEC.md", "# spec\n"),
        ("feature.py", "print(2)\n"),
    ):
        (repo / name).write_text(text)

    idempotent_ship(str(repo), "run-side")

    tree = _tree(repo, "ship-run-side")
    assert "feature.py" in tree
    assert not {"REPORT.md", "REVIEW_VERDICT.json", "SPEC.md"} & set(tree)
    assert (repo / "REPORT.md").exists()


def test_ship_keeps_a_repos_own_tracked_report(tmp_path):
    """A repo that already tracks a REPORT.md owns it: the agent's edit to it ships."""
    repo = _repo_with_history(tmp_path / "repo")
    (repo / "REPORT.md").write_text("v1\n")
    _git(repo, "add", "REPORT.md")
    _git(repo, "commit", "-q", "-m", "their report")
    _git(repo, "checkout", "-q", "-b", "tvashtr/run-own")
    (repo / "REPORT.md").write_text("v2\n")

    idempotent_ship(str(repo), "run-own")

    assert _show(repo, "ship-run-own", "REPORT.md") == "v2\n"


def test_ship_still_raises_when_a_run_branch_has_nothing_new(tmp_path):
    """The base's own commits are not the agent's work: a run that produced nothing still fails."""
    repo = _repo_with_history(tmp_path / "repo")
    wt = tmp_path / "wt"
    _git(repo, "worktree", "add", "-q", "-b", "tvashtr/run-none", str(wt), "main")
    with pytest.raises(RuntimeError, match="nothing to ship"):
        idempotent_ship(str(wt), "run-none")
    _git(repo, "checkout", "-q", "-b", "tvashtr/run-none-2")
    with pytest.raises(RuntimeError, match="nothing to ship"):
        idempotent_ship(str(repo), "run-none-2")


# ---------------------------------------------------------------------------------------------
# ``ship_step`` — the durable GREENFIELD diff snapshot (M-wsgc S1, ``run_artifacts``).
#
# The whole persist-then-reap milestone hangs on this write landing, and landing at the right
# moment: INSIDE the workflow body, right after the ship, while the workspace still exists — long
# before ``_run_end_teardown`` can reclaim anything. Three properties are load-bearing.
#
#   * GREENFIELD ONLY. A brownfield/hosted run's deliverable is the ``tvashtr/<run_id>`` branch in
#     the user's real repo; it has no snapshot and needs none, and writing one would be the first
#     step toward the reaper treating the two run types as interchangeable.
#   * IDEMPOTENT. ``ship_step`` is a DBOS step, so a crash-resume re-runs it. The write is an UPSERT
#     on the UNIQUE ``run_id``, so a re-ship re-persists the same snapshot instead of
#     duplicating it.
#   * NOT IN ``idempotent_ship``. The pure ship function stays database-free and network-free.
# ---------------------------------------------------------------------------------------------


def _artifacts(run_id: str) -> list[dict]:
    """Every ``run_artifacts`` row for this run — a LIST, so a duplicate is visible rather than
    silently collapsed by a ``scalar_one_or_none``."""
    with session_scope() as session:
        return [
            row.files
            for row in session.query(RunArtifact)
            .filter(RunArtifact.run_id == uuid.UUID(run_id))
            .all()
        ]


def _seed_run(run_id: str, repo_path: str | None) -> None:
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=auth_user_id(),
                idea="ship_step snapshot fixture",
                workflow_id=run_id,
                status="running",
                repo_path=repo_path,
            )
        )


def _greenfield_workspace(run_id: str) -> Path:
    """A real shipped workspace at the path ``compute_run_diff`` resolves from ``run_id`` — the
    snapshot is taken through the SAME reader the endpoint uses, so it cannot be faked by a
    conveniently-placed tmp dir."""
    ws = run_diff._WORKSPACE_ROOT / run_id
    ws.mkdir(parents=True, exist_ok=True)
    init_workspace_repo(str(ws))
    (ws / "greeting.txt").write_text("hello\nworld\n", encoding="utf-8")
    return ws


def test_ship_step_persists_a_greenfield_runs_diff(client):
    """THE MILESTONE'S WRITE. After a greenfield ship there is exactly one ``run_artifacts`` row,
    and it holds the WHOLE ``compute_run_diff`` result — the shape ``/diff`` returns verbatim once
    the workspace is gone, not a summary or a file list."""
    run_id = str(uuid.uuid4())
    ws = _greenfield_workspace(run_id)
    try:
        _seed_run(run_id, repo_path=None)

        team_run.ship_step(run_id, str(ws))

        rows = _artifacts(run_id)
        assert len(rows) == 1, f"expected exactly one snapshot, got {len(rows)}"
        snapshot = rows[0]
        assert set(snapshot) == {"run_id", "base_ref", "ship_branch", "files", "total"}
        assert snapshot["run_id"] == run_id
        assert snapshot["total"] == 1
        assert snapshot["files"][0]["path"] == "greeting.txt"
        assert snapshot["files"][0]["status"] == "added"
        assert snapshot["files"][0]["additions"] == 2
        assert "hello" in snapshot["files"][0]["patch"]
    finally:
        shutil.rmtree(ws, ignore_errors=True)


def test_ship_step_persist_is_idempotent_across_a_crash_resume(client):
    """``ship_step`` is a DBOS step: a crash between the ship and the workflow's next checkpoint
    re-runs it. The UNIQUE ``run_id`` + UPSERT means the second pass re-persists the SAME snapshot —
    one row, not two, and no ``IntegrityError`` failing a run that had already shipped fine."""
    run_id = str(uuid.uuid4())
    ws = _greenfield_workspace(run_id)
    try:
        _seed_run(run_id, repo_path=None)

        first = team_run.ship_step(run_id, str(ws))
        second = team_run.ship_step(run_id, str(ws))  # the resume

        assert second["created"] is False and second["sha"] == first["sha"]
        rows = _artifacts(run_id)
        assert len(rows) == 1, f"the resume duplicated the snapshot ({len(rows)} rows)"
        assert rows[0]["files"][0]["path"] == "greeting.txt"
    finally:
        shutil.rmtree(ws, ignore_errors=True)


def test_ship_step_persists_a_deliverable_containing_binary_files(client):
    """A greenfield run can ship an image, a font, a compiled asset. Two things are pinned here, and
    the SECOND is a KNOWN LIMITATION recorded deliberately rather than papered over.

    1. The write survives it. ``files`` is ``JSONB``, which REJECTS ``\\u0000`` inside a string, and
       the persist is best-effort — so a raw NUL reaching the insert would raise, be swallowed, and
       silently cost that run its reap. It does not, because ``git diff`` sniffs a NUL in a file's
       first 8000 bytes and emits ``Binary files ... differ`` instead of the bytes. That is a
       property of git, not of this code, which is exactly why it is pinned. (A NUL that first
       appears AFTER 8000 bytes is not covered by git's sniff; if such a patch ever did reach the
       write, the best-effort swallow leaves no row — so the workspace stays SPARED, the safe
       direction, never a silent reap.)

    2. **The snapshot records that binary file's NAME and STATUS, NOT its bytes** — the stored patch
       is git's marker line and numstat is ``(0, 0)``. Since the row is what licenses the reaper to
       delete the workspace, a greenfield run that ships a binary has that binary's CONTENT
       reclaimed with no copy anywhere. The run-view "Changes" tab is unaffected (it showed the same
       marker before this milestone), so the shipped contract holds; but "the diff is durable" is
       NOT the same claim as "the deliverable is recoverable" for non-text files. Asserted here so
       the gap is visible and regression-guarded rather than discovered later — see STATE.md, where
       it is raised for the architect."""
    run_id = str(uuid.uuid4())
    ws = run_diff._WORKSPACE_ROOT / run_id
    ws.mkdir(parents=True, exist_ok=True)
    try:
        init_workspace_repo(str(ws))
        (ws / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n\x00\x01\x02NUL-inside\x00\xff")
        (ws / "index.html").write_text("<h1>hi</h1>\n", encoding="utf-8")
        _seed_run(run_id, repo_path=None)

        team_run.ship_step(run_id, str(ws))  # must not raise, and must persist

        rows = _artifacts(run_id)
        assert len(rows) == 1, "a binary deliverable lost its snapshot — its workspace now leaks"
        by_path = {f["path"]: f for f in rows[0]["files"]}
        assert set(by_path) == {"logo.png", "index.html"}
        assert "\x00" not in by_path["logo.png"]["patch"]
        # The text file IS recoverable from the snapshot; the binary one is NOT (2, above).
        assert "<h1>hi</h1>" in by_path["index.html"]["patch"]
        assert "Binary files" in by_path["logo.png"]["patch"]
        assert (by_path["logo.png"]["additions"], by_path["logo.png"]["deletions"]) == (0, 0)
    finally:
        shutil.rmtree(ws, ignore_errors=True)


def test_ship_step_writes_no_artifact_for_a_brownfield_run(client, tmp_path):
    """GREENFIELD ONLY, gated strictly on ``repo_path IS NULL``. A brownfield/hosted run ships onto
    the ``tvashtr/<run_id>`` branch in the user's REAL repo — that branch is the durable
    deliverable, its workspace was always a disposable checkout, and its ``/diff`` must keep reading
    the real repo rather than a snapshot that could go stale the moment the user pushes.

    The worktree is seeded AT ``.tvashtr_workspaces/<run_id>`` — where a brownfield checkout really
    lives — rather than at some tmp path, and that placement is what gives this test teeth. Put it
    anywhere else and DELETING the ``repo_path`` gate still leaves the test green, because the
    greenfield reader would find nothing there, come back empty, and be refused by the
    empty-snapshot guard. Here an ungated persist would find real files and write a real row, so the
    gate is the only thing keeping this assertion true."""
    run_id = str(uuid.uuid4())
    ws = run_diff._WORKSPACE_ROOT / run_id
    ws.mkdir(parents=True, exist_ok=True)
    try:
        init_workspace_repo(str(ws))
        (ws / "feature.py").write_text("x = 1\n", encoding="utf-8")
        _seed_run(run_id, repo_path=str(tmp_path / "real-repo"))

        team_run.ship_step(run_id, str(ws))

        assert _artifacts(run_id) == [], "a brownfield ship wrote a greenfield diff snapshot"
    finally:
        shutil.rmtree(ws, ignore_errors=True)


def test_ship_step_refuses_to_persist_an_empty_snapshot(client):
    """THE HARD INVARIANT'S LAST FENCE. ``compute_run_diff`` is crash-proof BY CONTRACT: a missing
    directory, an unresolvable ref, an absent git, a timeout and an undecodable byte all yield
    ``[]`` rather than raising. So "empty" does not mean "this run produced nothing" — it means
    "the read failed", and the run's files are still sitting on disk.

    Persisting that would be the worst possible outcome of this milestone: a row exists, so the
    reaper concludes the deliverable is durable, and it deletes the only copy. The write must
    therefore refuse, leaving NO row — which leaves the workspace spared, exactly as before this
    table existed."""
    run_id = str(uuid.uuid4())
    ws = _greenfield_workspace(run_id)
    try:
        _seed_run(run_id, repo_path=None)
        empty = {
            "run_id": run_id,
            "base_ref": None,
            "ship_branch": None,
            "files": [],
            "total": 0,
        }

        with patch.object(team_run, "compute_run_diff", return_value=empty):
            team_run.ship_step(run_id, str(ws))  # ships fine; must NOT persist

        assert _artifacts(run_id) == [], (
            "an empty snapshot was persisted — the reaper would now destroy the real deliverable"
        )
    finally:
        shutil.rmtree(ws, ignore_errors=True)


def test_ship_step_heals_a_stale_snapshot_on_re_ship(client):
    """ON CONFLICT DO **UPDATE**, not DO NOTHING and not a bare INSERT.

    This is the difference the plain-insert version hides. Because the persist is best-effort, a
    bare ``INSERT`` on a re-ship raises ``IntegrityError``, gets swallowed, and leaves whatever was
    written FIRST in place forever — so a partial or stale first snapshot would become permanent,
    and the reaper would then destroy the workspace on the strength of it. That is the hard
    invariant failing quietly rather than loudly.

    So: plant a stale row, ship, and require the real snapshot to have REPLACED it — still exactly
    one row."""
    run_id = str(uuid.uuid4())
    ws = _greenfield_workspace(run_id)
    try:
        _seed_run(run_id, repo_path=None)
        with session_scope() as session:
            session.add(
                RunArtifact(
                    run_id=uuid.UUID(run_id),
                    files={
                        "run_id": run_id,
                        "base_ref": None,
                        "ship_branch": None,
                        "files": [],
                        "total": 0,
                    },
                )
            )

        team_run.ship_step(run_id, str(ws))

        rows = _artifacts(run_id)
        assert len(rows) == 1, f"the re-ship duplicated the snapshot ({len(rows)} rows)"
        assert rows[0]["total"] == 1, "the stale snapshot was not replaced — ON CONFLICT DO UPDATE"
        assert rows[0]["files"][0]["path"] == "greeting.txt"
    finally:
        shutil.rmtree(ws, ignore_errors=True)


def test_the_ship_step_snapshot_does_not_leak_into_the_pure_ship_function():
    """The persist lives in the STEP, never in ``idempotent_ship``. ``shipping.py`` is deliberately
    pure local-git-over-subprocess — importable and testable with no database at all, which is
    exactly what the tests at the top of this file rely on. Adding the write there would pass every
    behavioural test in this file, so the boundary needs its own fence.

    PARSED from the source rather than probed with ``hasattr``, for the same reason as
    ``test_run_diff.test_the_diff_module_stays_pure``: a module attribute is invisible when the
    import sits INSIDE the function — which is precisely the shape this leak would take
    (``def idempotent_ship(...): from tvashtr.db import session_scope``). An attribute probe would
    stay green through exactly the change it exists to catch."""
    from tvashtr.control_plane import shipping

    source = Path(shipping.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imported.add(node.module or "." * node.level)

    impure = {"tvashtr", "dbos", "openhands"}
    forbidden = {name for name in imported if name.split(".")[0] in impure}
    assert not forbidden, f"the snapshot leaked into the pure ship function: {sorted(forbidden)}"
