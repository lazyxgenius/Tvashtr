"""M-h3 — HOSTED run ceilings: the three launch caps that bound the operator's COMPUTE spend.

A hosted run is BYOK for the LLM, so the operator's real cost is a Fly microVM per IN-FLIGHT run.
These caps bound that: per-owner concurrency, fleet-wide concurrency, and a per-owner rolling-24h
launch rate. All three are enforced at the TOP of the create path (before any Run row exists) and
are gated on ``hosted_mode`` — self-hosted stays UNCAPPED.

The offline suite shares ONE Postgres across hundreds of tests (and across re-runs), so the
in-flight counts these caps read are AMBIENT. Every test here therefore MEASURES the live baseline
and sets the cap relative to it, rather than assuming an empty table — which also makes each test
exercise the real counting query against real data.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from conftest import auth_user_id
from sqlalchemy import func, select

from tvashtr.config import Settings, get_settings
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import Run

# The statuses that hold a sandbox (the Run docstring's vocabulary). ``awaiting_human`` counts:
# M-h2b SUSPENDS the microVM at a gate, but the machine still exists, so it still holds a slot.
_IN_FLIGHT = ("pending", "running", "awaiting_human")
_TERMINALS = ("completed", "failed", "rejected", "cancelled", "over_budget")


# ---------------------------------------------------------------- helpers


@pytest.fixture(autouse=True)
def _hosted_with_room(monkeypatch):
    """Run HOSTED, starting from ceilings that CANNOT fire, so each test lowers only the ONE cap it
    exercises and a failure is unambiguous about which ceiling rejected."""
    settings = get_settings()
    monkeypatch.setattr(settings, "hosted_mode", True)
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", 10_000)
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_global", 10_000)
    monkeypatch.setattr(settings, "hosted_max_runs_per_owner_per_day", 10_000)
    # A ceiling is a CREATE-path concern — never start the durable workflow behind it.
    monkeypatch.setattr("tvashtr.routers.DBOS.start_workflow", lambda *a, **k: None)


def _inflight(owner_id: uuid.UUID | None = None) -> int:
    """Live in-flight run count — the owner's when ``owner_id`` is given, else the whole fleet."""
    with session_scope() as session:
        query = select(func.count()).select_from(Run).where(Run.status.in_(_IN_FLIGHT))
        if owner_id is not None:
            query = query.where(Run.owner_id == owner_id)
        return session.execute(query).scalar_one()


def _launched_today(owner_id: uuid.UUID) -> int:
    """The owner's runs created inside the rolling 24h window (any status)."""
    since = datetime.now(UTC) - timedelta(hours=24)
    with session_scope() as session:
        return session.execute(
            select(func.count())
            .select_from(Run)
            .where(Run.owner_id == owner_id, Run.created_at >= since)
        ).scalar_one()


def _seed_run(status: str = "running", created_at: datetime | None = None) -> uuid.UUID:
    """Insert a Run row directly (no workflow) — the ambient state the ceilings count."""
    run_id = uuid.uuid4()
    run = Run(
        id=run_id,
        team_graph_id=uuid.UUID(build_two_node_team()),
        owner_id=auth_user_id(),
        idea="ceiling fixture",
        workflow_id=str(run_id),
        status=status,
    )
    if created_at is not None:
        run.created_at = created_at
    with session_scope() as session:
        session.add(run)
    return run_id


def _create(client):
    return client.post("/api/runs", json={"idea": "ceiling probe"})


# ---------------------------------------------------------------- (1) per-owner concurrency


def test_owner_concurrency_cap_rejects_the_launch_past_the_cap(client, monkeypatch):
    """The cap-th create SUCCEEDS; the (cap+1)-th is refused 429 naming the owner concurrency."""
    cap = _inflight(auth_user_id()) + 2
    monkeypatch.setattr(get_settings(), "hosted_max_concurrent_runs_per_owner", cap)

    assert _create(client).status_code == 200
    assert _create(client).status_code == 200  # still AT the cap — the last legal launch

    resp = _create(client)
    assert resp.status_code == 429, resp.text
    assert resp.json()["detail"]["code"] == "owner_concurrency_limit"


def test_a_terminal_run_does_not_count_toward_concurrency(client, monkeypatch):
    """A run in ANY terminal status has no sandbox, so it must not consume a concurrency slot."""
    for terminal in _TERMINALS:
        _seed_run(status=terminal)

    cap = _inflight(auth_user_id()) + 1  # room for exactly ONE more in-flight run
    monkeypatch.setattr(get_settings(), "hosted_max_concurrent_runs_per_owner", cap)

    # If the count included the 5 terminals just seeded, this first create would already be over.
    assert _create(client).status_code == 200
    assert _create(client).status_code == 429


# ---------------------------------------------------------------- (2) global concurrency


def test_global_concurrency_cap_rejects_the_launch_past_the_cap(client, monkeypatch):
    """The fleet-wide ceiling counts EVERY owner's in-flight runs, not just the launcher's."""
    cap = _inflight() + 1
    monkeypatch.setattr(get_settings(), "hosted_max_concurrent_runs_global", cap)

    assert _create(client).status_code == 200

    resp = _create(client)
    assert resp.status_code == 429, resp.text
    assert resp.json()["detail"]["code"] == "global_concurrency_limit"


# ---------------------------------------------------------------- (3) per-owner daily rate


def test_the_daily_cap_counts_by_the_created_at_window(client, monkeypatch):
    """Runs that aged OUT of the rolling 24h window free the owner's daily budget back up."""
    stale = datetime.now(UTC) - timedelta(hours=25)
    for _ in range(3):
        _seed_run(status="completed", created_at=stale)  # terminal: perturbs rate, not concurrency

    cap = _launched_today(auth_user_id()) + 1
    monkeypatch.setattr(get_settings(), "hosted_max_runs_per_owner_per_day", cap)

    # If the window were ignored, the 3 stale runs would already have spent this budget.
    assert _create(client).status_code == 200

    resp = _create(client)
    assert resp.status_code == 429, resp.text
    assert resp.json()["detail"]["code"] == "owner_daily_limit"


# ---------------------------------------------------------------- the A/B pair costs TWO slots


def test_an_ab_run_counts_as_two_toward_the_ceiling(client, monkeypatch):
    """An A/B launch creates a PAIR, so it needs room for 2 — otherwise it is a one-call bypass."""
    settings = get_settings()
    baseline = _inflight(auth_user_id())

    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", baseline + 1)
    resp = client.post("/api/ab-runs", json={"idea": "ceiling probe"})
    assert resp.status_code == 429, resp.text  # room for ONE is not room for a pair
    assert resp.json()["detail"]["code"] == "owner_concurrency_limit"

    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", baseline + 2)
    resp = client.post("/api/ab-runs", json={"idea": "ceiling probe"})
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["runs"]) == 2


def test_an_ab_run_is_refused_whole_leaving_no_half_pair(client, monkeypatch):
    """A refused pair must create NEITHER side — the ceiling runs before any Run row is written."""
    before = _inflight(auth_user_id())
    monkeypatch.setattr(get_settings(), "hosted_max_concurrent_runs_per_owner", before + 1)

    assert client.post("/api/ab-runs", json={"idea": "ceiling probe"}).status_code == 429
    assert _inflight(auth_user_id()) == before  # no orphan side-A run


# ---------------------------------------------------------------- the self-hosted invariant


def test_self_hosted_is_uncapped_by_every_ceiling(client, monkeypatch):
    """hosted_mode False ⇒ the helper no-ops: the caps are set to 1 and blown past, and creates
    still succeed. Self-hosted is the operator's OWN machine — there is nothing to bound."""
    settings = get_settings()
    monkeypatch.setattr(settings, "hosted_mode", False)
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", 1)
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_global", 1)
    monkeypatch.setattr(settings, "hosted_max_runs_per_owner_per_day", 1)

    for _ in range(4):
        _seed_run()  # far past every cap

    for _ in range(3):
        assert _create(client).status_code == 200


# ---------------------------------------------------------------- the shipped defaults


def test_shipped_ceiling_defaults_are_finite_and_operator_tunable():
    """Safety-by-default (invariant 6): forgetting the posture still lands BOUNDED, and each cap is
    dialable from the environment in the house style. Asserted on the FIELD default so an operator
    ``.env`` override can never make this test lie about what ships."""
    expected = {
        "hosted_max_concurrent_runs_per_owner": (3, "TVASHTR_HOSTED_MAX_CONCURRENT_RUNS_PER_OWNER"),
        "hosted_max_concurrent_runs_global": (25, "TVASHTR_HOSTED_MAX_CONCURRENT_RUNS_GLOBAL"),
        "hosted_max_runs_per_owner_per_day": (20, "TVASHTR_HOSTED_MAX_RUNS_PER_OWNER_PER_DAY"),
    }
    for name, (default, env_var) in expected.items():
        field = Settings.model_fields[name]
        assert field.default == default, name
        assert env_var in field.validation_alias.choices, name


def test_a_ceiling_is_overridable_from_the_environment(monkeypatch):
    monkeypatch.setenv("TVASHTR_HOSTED_MAX_CONCURRENT_RUNS_PER_OWNER", "7")
    assert Settings().hosted_max_concurrent_runs_per_owner == 7
