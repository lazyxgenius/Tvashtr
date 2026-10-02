"""M1 live proof harness — ``TVASHTR_FORCE_HANG_ROLE``: the named node waits like a model that
never answers (no LLM call), until its run's sandboxes are closed (what the stall sweep does)."""

import threading
import time
import uuid

from home_fixtures import clone_node, fresh_account, library_team, make_run
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane import team_run
from tvashtr.db import session_scope
from tvashtr.engines import sandbox_cache
from tvashtr.models import AgentInvocation, RunEvent


def _setup():
    c, owner = fresh_account("hang")
    run_id, clone = make_run(owner, library_team(c), status="running")
    node = clone_node(clone, "engineer")
    with session_scope() as s:
        inv = AgentInvocation(run_id=run_id, node_id=uuid.UUID(node), iteration=1, status="running")
        s.add(inv)
        s.flush()
        return run_id, node, inv.id


def test_the_named_node_hangs_until_its_sandboxes_close(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "force_hang_role", "engineer")
    run_id, node, inv_id = _setup()
    out: dict = {}
    worker = threading.Thread(
        target=lambda: out.update(result=team_run._forced_hang(run_id, node, inv_id)), daemon=True
    )
    worker.start()
    for _ in range(50):
        with session_scope() as s:
            if s.execute(select(RunEvent.id).where(RunEvent.invocation_id == inv_id)).first():
                break
        time.sleep(0.1)
    time.sleep(0.3)
    assert worker.is_alive()  # still waiting on the model

    sandbox_cache.close_run_sandboxes(run_id)
    worker.join(5)
    assert not worker.is_alive()
    assert out["result"]["status"] == "failed"
    assert out["result"]["total_tokens"] == 0


def test_any_other_node_runs_normally(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "force_hang_role", "reviewer")
    run_id, node, inv_id = _setup()
    assert team_run._forced_hang(run_id, node, inv_id) is None


def test_unset_is_inert(client):
    run_id, node, inv_id = _setup()
    assert get_settings().force_hang_role is None
    assert team_run._forced_hang(run_id, node, inv_id) is None


def test_never_in_a_resumed_run(client, monkeypatch):
    """MA (R19 proof): like the forced failure, the forced hang never applies to a run that is
    itself a resume, so a stopped run can be picked up and finish for real."""
    from sqlalchemy import update

    from tvashtr.models import Run

    monkeypatch.setattr(get_settings(), "force_hang_role", "engineer")
    run_id, node, inv_id = _setup()
    earlier, _ = _setup()[:2]
    with session_scope() as s:
        s.execute(
            update(Run)
            .where(Run.workflow_id == run_id)
            .values(
                resumed_from_run_id=select(Run.id)
                .where(Run.workflow_id == earlier)
                .scalar_subquery()
            )
        )
    assert team_run._forced_hang(run_id, node, inv_id) is None
