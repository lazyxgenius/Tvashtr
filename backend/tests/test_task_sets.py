"""M9 — Task sets and a check before saving (rulings R5, R6, R11, R12; contract
``docs/superpowers/plans/api/task-sets.md``).

A task set is a team's named list of tasks, each with the branch it starts from and a hidden check
command. A compare can run both versions on every task of a set (item by item, as two run slots
free); its runs carry the item they are for. Saving a version can start a compare of the new
version with the previous one on a set (R6), never blocking the save. The hidden check itself (its
runner and R11) is in ``test_hidden_checks.py``."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from conftest import _seed_dummy_credentials, auth_user_id
from home_fixtures import add_cost, clone_node, fresh_account, library_team, make_run
from sqlalchemy import select, text, update
from test_compare import _end, _node, _two_versions

from tvashtr.config import get_settings
from tvashtr.control_plane import compare, team_run
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    Compare,
    HiddenCheckResult,
    Run,
    TaskSet,
    TaskSetItem,
    TeamVersion,
)

ITEMS = [
    {"task": "Add an RSI indicator", "starts_from": "main", "hidden_check": "pytest -q -k rsi"},
    {"task": "Add a MACD indicator", "starts_from": None, "hidden_check": "pytest -q -k macd"},
]


def _make_set(c, team: str, name: str = "Indicators", items=None) -> dict:
    resp = c.post(f"/api/teams/{team}/task-sets", json={"name": name, "items": items or ITEMS})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _set_runs(cid: str) -> list[Run]:
    with session_scope() as session:
        rows = (
            session.execute(
                select(Run)
                .where(Run.pair_id == uuid.UUID(cid))
                .order_by(Run.created_at, Run.pair_label)
            )
            .scalars()
            .all()
        )
        for r in rows:
            session.expunge(r)
    return rows


def _items_of(set_id: str) -> list[TaskSetItem]:
    with session_scope() as session:
        rows = (
            session.execute(
                select(TaskSetItem)
                .where(TaskSetItem.task_set_id == uuid.UUID(set_id))
                .order_by(TaskSetItem.position)
            )
            .scalars()
            .all()
        )
        for r in rows:
            session.expunge(r)
    return rows


# ------------------------------------------------------------------------------------ the model


def test_migration_0050_adds_task_sets_and_hidden_check_results(client):
    def cols(table: str) -> set[str]:
        with session_scope() as session:
            return set(
                session.execute(
                    text(
                        "select column_name from information_schema.columns where table_name = :t"
                    ),
                    {"t": table},
                ).scalars()
            )

    assert cols("task_sets") == {
        "id",
        "owner_id",
        "team_graph_id",
        "name",
        "created_at",
        "updated_at",
    }
    assert cols("task_set_items") == {
        "id",
        "task_set_id",
        "position",
        "task",
        "starts_from",
        "hidden_check",
    }
    assert cols("hidden_check_results") == {
        "id",
        "run_id",
        "passed",
        "exit_code",
        "timed_out",
        "output_tail",
        "duration_s",
        "created_at",
    }
    assert {"task_set_id", "item_count"} <= cols("compares")
    assert "task_set_item_id" in cols("runs")


# ------------------------------------------------------------------------------- the CRUD routes


def test_create_list_edit_and_delete_a_task_set(client):
    team = library_team(client)
    made = _make_set(client, team)
    assert made["name"] == "Indicators"
    assert [
        (i["position"], i["task"], i["starts_from"], i["hidden_check"]) for i in made["items"]
    ] == [
        (1, "Add an RSI indicator", "main", "pytest -q -k rsi"),
        (2, "Add a MACD indicator", None, "pytest -q -k macd"),
    ]
    assert made["last_used"] is None and made["estimate"] is None

    listed = client.get(f"/api/teams/{team}/task-sets").json()["sets"]
    assert [s["id"] for s in listed] == [made["id"]]
    assert listed[0]["items"] == made["items"]

    resp = client.patch(
        f"/api/task-sets/{made['id']}",
        json={
            "name": "  Indicators v2 ",
            "items": [{"task": " Add RSI ", "starts_from": "  ", "hidden_check": " make rsi "}],
        },
    )
    assert resp.status_code == 200, resp.text
    edited = resp.json()
    assert edited["id"] == made["id"] and edited["name"] == "Indicators v2"
    assert [
        (i["position"], i["task"], i["starts_from"], i["hidden_check"]) for i in edited["items"]
    ] == [(1, "Add RSI", None, "make rsi")]
    assert len(_items_of(made["id"])) == 1  # items replaced as a whole

    assert client.delete(f"/api/task-sets/{made['id']}").status_code == 204
    assert client.get(f"/api/teams/{team}/task-sets").json() == {"sets": []}
    assert client.delete(f"/api/task-sets/{made['id']}").status_code == 404


def test_set_validation_422s_and_a_taken_name_409s(client):
    team = library_team(client)
    item = {"task": "t", "starts_from": None, "hidden_check": "true"}
    for body in (
        {"name": "   ", "items": [item]},
        {"name": "x" * 81, "items": [item]},
        {"name": "Empty", "items": []},
        {"name": "Too many", "items": [item] * 21},
        {"name": "No task", "items": [{**item, "task": "  "}]},
        {"name": "No check", "items": [{**item, "hidden_check": " "}]},
        {"name": "Long task", "items": [{**item, "task": "x" * 2001}]},
        {"name": "Long check", "items": [{**item, "hidden_check": "x" * 2001}]},
    ):
        resp = client.post(f"/api/teams/{team}/task-sets", json=body)
        assert resp.status_code == 422, (body["name"], resp.text)
    assert client.get(f"/api/teams/{team}/task-sets").json() == {"sets": []}

    ok = _make_set(client, team, "Indicators", [item] * 20)  # 20 is fine
    taken = client.post(
        f"/api/teams/{team}/task-sets", json={"name": "indicators", "items": [item]}
    )
    assert taken.status_code == 409, taken.text
    other = _make_set(client, team, "Bugs", [item])
    clash = client.patch(
        f"/api/task-sets/{other['id']}", json={"name": "INDICATORS", "items": [item]}
    )
    assert clash.status_code == 409, clash.text
    same = client.patch(f"/api/task-sets/{ok['id']}", json={"name": "Indicators", "items": [item]})
    assert same.status_code == 200, same.text
    # Another team may use the name.
    _make_set(client, library_team(client, name="Other team"), "Indicators", [item])


def test_a_set_in_a_running_compare_cannot_be_changed_and_deleting_keeps_history(client):
    owner = auth_user_id()
    team = _two_versions(client)
    ts = _make_set(client, team)
    cid = _seed_set_compare(team, owner, ts, status="running")
    for label, version in (("A", 1), ("B", 2)):
        _cell(owner, team, cid, ts["items"][0]["id"], label, version, at=_T0, check=True)
    body = {"name": "Renamed", "items": ITEMS}
    assert client.patch(f"/api/task-sets/{ts['id']}", json=body).status_code == 409
    assert client.delete(f"/api/task-sets/{ts['id']}").status_code == 409

    with session_scope() as session:
        session.execute(
            update(Compare).where(Compare.id == uuid.UUID(cid)).values(status="finished")
        )
    assert client.delete(f"/api/task-sets/{ts['id']}").status_code == 204
    with session_scope() as session:
        cmp = session.get(Compare, uuid.UUID(cid))
        assert cmp is not None and cmp.task_set_id is None and cmp.item_count == 2
        runs = session.execute(select(Run).where(Run.pair_id == uuid.UUID(cid))).scalars().all()
        assert len(runs) == 2 and {r.task_set_item_id for r in runs} == {None}
    view = client.get(f"/api/compares/{cid}").json()
    assert view["set"] == {"id": None, "name": "Indicators", "count": 2}
    assert [i["task"] for i in view["items"]] == ["Add an RSI indicator"]
    assert view["items"][0]["a"]["check"] == "passed"


# ------------------------------------------------------------------------- compare on a set


def _starts(c, team, monkeypatch, **body):
    """POST a compare (no workflow really starts, no waiter thread) and also record the idea each
    started workflow got."""
    from dbos import DBOS
    from dbos._context import get_local_dbos_context

    calls: list[tuple] = []

    def _start(fn, idea, *a, **k):  # noqa: ARG001
        ctx = get_local_dbos_context()
        calls.append((ctx.id_assigned_for_next_workflow, idea))

    waiters: list[str] = []
    with monkeypatch.context() as m:
        m.setattr(DBOS, "start_workflow", _start)
        m.setattr(compare, "_spawn", lambda cid: waiters.append(str(cid)))
        payload = {"a": 1, "b": 2, "auto_approve": True, **body}
        resp = c.post(f"/api/teams/{team}/compare", json=payload)
    return resp, calls, waiters


def test_a_set_compare_runs_both_versions_on_every_task(client, monkeypatch):
    team = _two_versions(client)
    ts = _make_set(client, team)
    monkeypatch.setattr(get_settings(), "hosted_mode", False)  # self-hosted: no caps, all at once
    resp, calls, waiters = _starts(client, team, monkeypatch, task_set_id=ts["id"])
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    try:
        assert resp.json()["status"] == "running" and waiters == []
        runs = _set_runs(cid)
        items = _items_of(ts["id"])
        assert [(r.pair_label, r.team_version_number) for r in runs] == [
            ("A", 1),
            ("B", 2),
            ("A", 1),
            ("B", 2),
        ]
        assert [r.task_set_item_id for r in runs] == [
            items[0].id,
            items[0].id,
            items[1].id,
            items[1].id,
        ]
        assert [r.idea for r in runs] == [i["task"] for i in ITEMS for _ in (0, 1)]
        assert {r.base_ref for r in runs} == {None}  # greenfield: no branch to start from
        assert sorted(calls) == sorted((str(r.id), r.idea) for r in runs)
        assert len({r.team_graph_id for r in runs}) == 4  # each run has its own snapshot
        with session_scope() as session:
            cmp = session.get(Compare, uuid.UUID(cid))
            assert (cmp.task, cmp.task_set_id, cmp.item_count) == (
                "Indicators",
                uuid.UUID(ts["id"]),
                2,
            )
        # A set compare run records the check for the walk; a one-task compare run does not.
        assert team_run.load_graph_step(str(runs[0].id))["compare"] == {
            "auto_approve": True,
            "check": True,
        }
        view = client.get(f"/api/compares/{cid}").json()
        assert view["set"] == {"id": ts["id"], "name": "Indicators", "count": 2}
        # Runs started of 2 x tasks; M8's ``waiting`` (the owner's slots) stays as it was.
        assert (view["started"], view["runs_waiting"], view["waiting"]) == (4, 0, None)
        assert [i["task"] for i in view["items"]] == [i["task"] for i in ITEMS]
        assert view["items"][0]["a"]["run_id"] == str(runs[0].id)
        assert view["items"][1]["b"]["run_id"] == str(runs[3].id)
        assert {i["a"]["status"] for i in view["items"]} == {"running"}
        assert view["results"] is None
        tab = client.get(f"/api/teams/{team}/compare").json()
        assert tab["task_sets"] == [{"id": ts["id"], "name": "Indicators", "count": 2}]
    finally:
        _end(_set_runs(cid))


def test_a_later_task_that_fails_to_launch_is_left_to_the_waiter(client, monkeypatch):
    """The compare has started (its first task's runs exist): an error launching the rest never
    turns the POST into a 500 — the waiter retries it."""
    team = _two_versions(client)
    ts = _make_set(client, team)
    monkeypatch.setattr(get_settings(), "hosted_mode", False)

    def _boom(cid):
        raise RuntimeError("snapshot failed")

    monkeypatch.setattr(compare, "try_start", _boom)
    try:
        resp, calls, waiters = _starts(client, team, monkeypatch, task_set_id=ts["id"])
        assert resp.status_code == 201, resp.text
        assert len(calls) == 2 and waiters == [resp.json()["id"]]
    finally:
        # Even when the POST fails: a half-launched set compare left running would be re-armed
        # (its next task launched for real) by the next app startup.
        with session_scope() as session:
            session.execute(
                update(Compare)
                .where(Compare.team_graph_id == uuid.UUID(team))
                .values(status="stopped", stop_requested=True)
            )
            ids = session.execute(
                select(Run.workflow_id).where(Run.library_team_id == uuid.UUID(team))
            ).scalars()
        _end(list(ids))


def test_exactly_one_of_task_and_set(client, monkeypatch):
    team = _two_versions(client)
    ts = _make_set(client, team)
    other = _make_set(client, library_team(client, name="Another"), "Theirs")
    for body, code in (
        ({"task": "x", "task_set_id": ts["id"]}, 422),
        ({}, 422),
        ({"task_set_id": str(uuid.uuid4())}, 404),
        ({"task_set_id": "not-a-uuid"}, 404),
        ({"task_set_id": other["id"]}, 404),  # a set of another team
    ):
        resp, calls, _ = _starts(client, team, monkeypatch, **body)
        assert resp.status_code == code, (body, resp.text)
        assert calls == []
    with session_scope() as session:
        assert (
            session.execute(
                select(Compare.id).where(Compare.team_graph_id == uuid.UUID(team))
            ).all()
            == []
        )


def test_a_hosted_set_that_cannot_fit_the_daily_limit_is_refused(client, monkeypatch):
    settings = get_settings()
    c, owner = fresh_account("set-daily")
    _seed_dummy_credentials(str(owner))
    team = _two_versions(c, f"Daily {uuid.uuid4().hex[:8]}")
    ts = _make_set(c, team)  # 2 tasks → 4 runs
    monkeypatch.setattr(settings, "hosted_mode", True)
    monkeypatch.setattr(settings, "hosted_max_runs_per_owner_per_day", 4)
    make_run(owner, None, status="completed")  # 1 run today: 1 + 4 > 4
    resp, calls, waiters = _starts(c, team, monkeypatch, task_set_id=ts["id"])
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == (
        "This set needs 4 runs and you can start 3 more today (4 a day). "
        "Try a smaller set, or try again later."
    )
    assert calls == [] and waiters == []
    with session_scope() as session:
        assert (
            session.execute(
                select(Compare.id).where(Compare.team_graph_id == uuid.UUID(team))
            ).all()
            == []
        )


def test_a_set_compare_launches_task_by_task_as_two_slots_free(client, monkeypatch):
    settings = get_settings()
    c, owner = fresh_account("set-queue")
    _seed_dummy_credentials(str(owner))
    team = _two_versions(c, f"Queue {uuid.uuid4().hex[:8]}")
    three = [*ITEMS, {"task": "Add Bollinger bands", "starts_from": None, "hidden_check": "true"}]
    ts = _make_set(c, team, items=three)
    monkeypatch.setattr(settings, "hosted_mode", True)
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", 3)
    busy = make_run(owner, None, status="running")[0]  # one slot taken: room for one task

    resp, calls, waiters = _starts(c, team, monkeypatch, task_set_id=ts["id"])
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    items = _items_of(ts["id"])
    try:
        assert resp.json()["status"] == "running" and waiters == [cid]
        assert [r.task_set_item_id for r in _set_runs(cid)] == [items[0].id] * 2
        view = c.get(f"/api/compares/{cid}").json()
        assert (view["started"], view["runs_waiting"], view["waiting"]) == (2, 4, None)
        assert [i["a"]["status"] for i in view["items"]] == ["running", "waiting", "waiting"]
        assert view["items"][2]["a"]["run_id"] is None

        assert compare.try_start(uuid.UUID(cid)) is False  # still no room
        armed: list = []
        monkeypatch.setattr(compare, "_spawn", armed.append)
        compare.rearm()  # a running set compare with tasks left is re-armed at startup
        assert uuid.UUID(cid) in [uuid.UUID(str(x)) for x in armed]

        with session_scope() as session:
            session.execute(
                update(Run)
                .where(Run.workflow_id.in_([busy, *(str(r.id) for r in _set_runs(cid))]))
                .values(status="completed")
            )
        recorded: list = []
        from dbos import DBOS

        with monkeypatch.context() as m:
            m.setattr(DBOS, "start_workflow", lambda fn, idea, *a, **k: recorded.append(idea))
            assert compare.try_start(uuid.UUID(cid)) is False  # task 2 started, task 3 waits
            assert recorded == ["Add a MACD indicator"] * 2
            _end(_set_runs(cid))  # task 2's runs end too
            with session_scope() as session:
                session.execute(
                    update(Run).where(Run.pair_id == uuid.UUID(cid)).values(status="completed")
                )
            assert compare.try_start(uuid.UUID(cid)) is True  # the last task started
        runs = _set_runs(cid)
        assert [r.task_set_item_id for r in runs] == [i.id for i in items for _ in (0, 1)]
        assert compare.try_start(uuid.UUID(cid)) is None  # nothing left to launch
        armed.clear()
        compare.rearm()
        assert uuid.UUID(cid) not in [uuid.UUID(str(x)) for x in armed]
        assert c.get(f"/api/compares/{cid}").json()["status"] == "running"
    finally:
        _end(_set_runs(cid))
        c.post(f"/api/compares/{cid}/stop")


def test_a_set_task_starts_from_its_own_branch(client, monkeypatch):
    """With a GitHub target, each task's runs start from the task's branch, else the target's."""
    owner = auth_user_id()
    team = _two_versions(client)
    ts = _make_set(client, team)
    cid = _seed_set_compare(team, owner, ts, status="waiting", repo="o/r", base_ref="develop")
    from dbos import DBOS

    monkeypatch.setattr(DBOS, "start_workflow", lambda *a, **k: None)
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    try:
        assert compare.try_start(uuid.UUID(cid)) is True
        runs = _set_runs(cid)
        assert [(r.github_repo, r.base_ref) for r in runs] == [
            ("o/r", "main"),
            ("o/r", "main"),
            ("o/r", "develop"),
            ("o/r", "develop"),
        ]
    finally:
        _end(_set_runs(cid))


# ---------------------------------------------------------------------------------- the view

_T0 = datetime(2026, 10, 3, 9, 0, tzinfo=UTC)


def _seed_set_compare(team: str, owner, ts: dict, *, status="finished", a=1, b=2, **extra) -> str:
    cid = uuid.uuid4()
    with session_scope() as session:
        session.add(
            Compare(
                id=cid,
                owner_id=owner,
                team_graph_id=uuid.UUID(team),
                version_a=a,
                version_b=b,
                task=ts["name"],
                task_set_id=uuid.UUID(ts["id"]),
                item_count=len(ts["items"]),
                auto_approve=True,
                status=status,
                started_at=_T0,
                **extra,
            )
        )
    return str(cid)


def _cell(
    owner,
    team: str,
    cid: str,
    item_id: str,
    label: str,
    version: int,
    *,
    at: datetime,
    status: str = "completed",
    rounds: int = 1,
    cost: str = "1.00",
    check: bool | None = None,
    output: str = "",
    failure: str | None = None,
    retries: int = 0,
) -> str:
    from tvashtr.control_plane import live_state

    with session_scope() as session:
        task = session.get(TaskSetItem, uuid.UUID(item_id)).task
    run_id, clone = make_run(
        owner,
        team,
        idea=task,
        status=status,
        pair_id=uuid.UUID(cid),
        pair_label=label,
        team_version_number=version,
        task_set_item_id=uuid.UUID(item_id),
        created_at=at,
        failure_message=failure,
        failure_code="engine_error" if failure else None,
    )
    eng = clone_node(clone, "engineer")
    with session_scope() as session:
        last = None
        for n in range(1, rounds + 1):
            step = "running" if status == "running" and n == rounds else "done"
            inv = AgentInvocation(
                run_id=run_id,
                node_id=uuid.UUID(eng),
                iteration=n,
                status=step,
                started_at=datetime.now(UTC),
            )
            session.add(inv)
            session.flush()
            last = inv.id
        if check is not None:
            session.add(
                HiddenCheckResult(
                    run_id=uuid.UUID(run_id),
                    passed=check,
                    exit_code=0 if check else 1,
                    timed_out=False,
                    output_tail=output,
                    duration_s=3.0,
                )
            )
    add_cost(run_id, cost)
    for _ in range(retries):
        live_state.record_host_event(
            run_id, last, "retry", {"attempt": 1, "of": 3, "reason": "busy", "wait_s": 8}
        )
    return run_id


def _five_task_set(client, team: str) -> dict:
    items = [
        {"task": f"Task {k}", "starts_from": None, "hidden_check": f"check {k}"}
        for k in range(1, 6)
    ]
    return _make_set(client, team, items=items)


def test_a_finished_set_compare_shows_cells_badges_and_cards(client):
    owner = auth_user_id()
    team = _two_versions(client)
    ts = _five_task_set(client, team)
    cid = _seed_set_compare(team, owner, ts)
    ids = [i["id"] for i in ts["items"]]
    # Task 1: v2 passes, v1 fails its check → "v2 better".
    _cell(owner, team, cid, ids[0], "A", 1, at=_T0, check=False, output="ok\nsignal line missing\n")
    _cell(owner, team, cid, ids[0], "B", 2, at=_T0, check=True)
    # Task 2: both pass, v2 in fewer rounds → "v2 better".
    t2 = _T0 + timedelta(minutes=1)
    _cell(owner, team, cid, ids[1], "A", 1, at=t2, check=True, rounds=3, retries=2)
    _cell(owner, team, cid, ids[1], "B", 2, at=t2, check=True, rounds=1)
    # Task 3: same, but v2 costs more → "v2 costs more".
    t3 = _T0 + timedelta(minutes=2)
    _cell(owner, team, cid, ids[2], "A", 1, at=t3, check=True, cost="0.50")
    _cell(owner, team, cid, ids[2], "B", 2, at=t3, check=True, cost="0.90")
    # Task 4: the same → "same".
    t4 = _T0 + timedelta(minutes=3)
    _cell(owner, team, cid, ids[3], "A", 1, at=t4, check=True)
    _cell(owner, team, cid, ids[3], "B", 2, at=t4, check=True)
    # Task 5: v1 failed (no check); v2 passes → "v2 better".
    t5 = _T0 + timedelta(minutes=4)
    _cell(owner, team, cid, ids[4], "A", 1, at=t5, status="failed", failure="boom happened")
    _cell(owner, team, cid, ids[4], "B", 2, at=t5, check=True)

    view = client.get(f"/api/compares/{cid}").json()
    assert view["status"] == "finished"
    assert view["set"] == {"id": ts["id"], "name": ts["name"], "count": 5}
    assert (view["started"], view["runs_waiting"]) == (10, 0)
    items = view["items"]
    assert [i["task"] for i in items] == [f"Task {k}" for k in range(1, 6)]
    assert [i["badge"] for i in items] == [
        "v2 better",
        "v2 better",
        "v2 costs more",
        "same",
        "v2 better",
    ]
    a1 = items[0]["a"]
    assert a1 | {} == {
        "run_id": a1["run_id"],
        "status": "finished",
        "now": None,
        "check": "failed",
        "rounds": 1,
        "cost_usd": 1.0,
        "note": "signal line missing",
    }
    assert items[1]["a"]["rounds"] == 3 and items[1]["b"]["rounds"] == 1
    assert items[4]["a"]["status"] == "failed" and items[4]["a"]["check"] is None
    assert items[4]["a"]["note"] == "boom happened"

    res = view["results"]
    assert res["rows"] == []
    cards = {c["key"]: c for c in res["cards"]}
    assert [c["key"] for c in res["cards"]] == ["checks", "rounds", "cost", "retries"]
    # Bare values (the page adds "v1 " / "v2 "); the tone says whether B did better or worse.
    assert cards["checks"] | {} == {
        "key": "checks",
        "label": "Hidden checks passed",
        "a": "3 of 5",
        "b": "5 of 5",
        "note": "2 more tasks really work",
        "tone": "good",
    }
    assert (cards["rounds"]["a"], cards["rounds"]["b"]) == ("1.4", "1.0")
    assert (cards["rounds"]["note"], cards["rounds"]["tone"]) == ("about the same", None)
    assert (cards["cost"]["a"], cards["cost"]["b"]) == ("$4.50", "$4.90")
    assert (cards["cost"]["note"], cards["cost"]["tone"]) == ("$0.40 more in all", "warn")
    assert (cards["retries"]["a"], cards["retries"]["b"]) == ("2", "0")
    assert (cards["retries"]["note"], cards["retries"]["tone"]) == ("steadier runs", "good")
    assert res["headline"] == "v2 did better on this set"
    assert res["current_version"] == 2 and res["restore"] is None
    assert view["cost_usd"] == pytest.approx(9.4)

    # The set list shows when it was last used, with a plain summary.
    listed = client.get(f"/api/teams/{team}/task-sets").json()["sets"]
    used = next(s for s in listed if s["id"] == ts["id"])["last_used"]
    assert used["compare_id"] == cid and (used["a"], used["b"]) == (1, 2)
    assert used["summary"] == "v2 better on 3 of 5"


def test_a_running_set_cell_says_what_it_is_doing(client):
    owner = auth_user_id()
    team = _two_versions(client)
    ts = _make_set(client, team)
    cid = _seed_set_compare(team, owner, ts, status="running")
    ids = [i["id"] for i in ts["items"]]
    a = _cell(owner, team, cid, ids[0], "A", 1, at=_T0, status="running", rounds=2)
    _cell(owner, team, cid, ids[0], "B", 2, at=_T0, check=True)
    try:
        view = client.get(f"/api/compares/{cid}").json()
        cell = view["items"][0]["a"]
        assert cell["run_id"] == a and cell["status"] == "running"
        assert cell["now"] == "Engineer · round 2"
        assert view["items"][0]["badge"] is None
        assert (view["started"], view["runs_waiting"]) == (2, 2)
        assert view["items"][1]["a"] | {} == {
            "run_id": None,
            "status": "waiting",
            "now": None,
            "check": None,
            "rounds": 0,
            "cost_usd": 0.0,
            "note": None,
        }
        assert view["results"] is None
    finally:
        _end(_set_runs(cid))
        client.post(f"/api/compares/{cid}/stop")  # no waiter at the next startup


def test_a_one_task_compare_offers_the_teams_set_as_a_bigger_sample(client):
    from test_compare import _seed_compare, _side

    owner = auth_user_id()
    team = _two_versions(client)
    cid = _seed_compare(team, owner)
    _side(owner, team, cid, "A", 1)
    _side(owner, team, cid, "B", 2)
    assert client.get(f"/api/compares/{cid}").json()["results"]["sample"] is None
    ts = _make_set(client, team)
    sample = client.get(f"/api/compares/{cid}").json()["results"]["sample"]
    assert sample == {"set_id": ts["id"], "name": "Indicators", "count": 2}


def test_the_estimate_comes_from_the_teams_finished_runs(client):
    owner = auth_user_id()
    team = _two_versions(client)
    for version in (1, 2):
        run_id = make_run(
            owner,
            team,
            status="completed",
            team_version_number=version,
            created_at=datetime.now(UTC) - timedelta(minutes=10),
        )[0]
        with session_scope() as session:
            session.execute(update(Run).where(Run.workflow_id == run_id).values(cost_total_usd=0.5))
    ts = _make_set(client, team)
    est = client.get(f"/api/teams/{team}/task-sets").json()["sets"][0]["estimate"]
    assert est["cost_usd"] == pytest.approx(2.0)  # 2 tasks x (v1 + v2) x $0.50
    assert est["minutes"] >= 10
    assert ts["id"]


# ---------------------------------------------------------------------- save and check (R6)


def test_save_and_check_starts_a_compare_of_the_new_version_with_the_previous(client, monkeypatch):
    team = library_team(client, name=f"Save check {uuid.uuid4().hex[:6]}")
    assert client.get(f"/api/teams/{team}/versions").status_code == 200  # v1
    ts = _make_set(client, team)
    eng = _node(client, team, "engineer")
    client.patch(f"/api/teams/{team}/nodes/{eng['id']}", json={"prompt": "check me"})
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    from dbos import DBOS

    monkeypatch.setattr(DBOS, "start_workflow", lambda *a, **k: None)
    resp = client.post(f"/api/teams/{team}/versions", json={"check_set": ts["id"]})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["number"] == 2 and body["check_error"] is None
    cid = body["check_started"]["compare_id"]
    try:
        assert body["check_started"]["status"] == "running"
        with session_scope() as session:
            cmp = session.get(Compare, uuid.UUID(cid))
            assert (cmp.version_a, cmp.version_b, cmp.task_set_id, cmp.auto_approve) == (
                1,
                2,
                uuid.UUID(ts["id"]),
                True,
            )
        listing = client.get(f"/api/teams/{team}/versions").json()
        assert listing["check_sets"] == [
            {"id": ts["id"], "name": "Indicators", "count": 2, "estimate": None}
        ]
        check = listing["versions"][0]["check"]
        assert check == {
            "compare_id": cid,
            "set": "Indicators",
            "passed": 0,
            "total": 2,
            "against": 1,
            "against_passed": 0,
            "cost_delta_usd": 0.0,
            "status": "running",
            "worse": False,
            "ended_at": None,
        }
        assert listing["versions"][1]["check"] is None

        # A refusal never fails the save: another compare of this team is still running.
        client.patch(f"/api/teams/{team}/nodes/{eng['id']}", json={"prompt": "again"})
        again = client.post(f"/api/teams/{team}/versions", json={"check_set": ts["id"]})
        assert again.status_code == 201, again.text
        assert again.json()["number"] == 3 and again.json()["check_started"] is None
        assert (
            again.json()["check_error"] == "This team already has a compare running. Stop it first."
        )
        # No check asked: both fields are null.
        client.patch(f"/api/teams/{team}/nodes/{eng['id']}", json={"prompt": "plain"})
        plain = client.post(f"/api/teams/{team}/versions", json={})
        assert (plain.json()["check_started"], plain.json()["check_error"]) == (None, None)
    finally:
        _end(_set_runs(cid))
        client.post(f"/api/compares/{cid}/stop")


def test_a_finished_check_that_did_worse_says_so_in_history(client):
    owner = auth_user_id()
    team = _two_versions(client)
    ts = _make_set(client, team)
    cid = _seed_set_compare(team, owner, ts, ended_at=_T0 + timedelta(minutes=30))
    ids = [i["id"] for i in ts["items"]]
    _cell(owner, team, cid, ids[0], "A", 1, at=_T0, check=True, cost="1.00")
    _cell(owner, team, cid, ids[0], "B", 2, at=_T0, check=False, cost="0.80")
    t1 = _T0 + timedelta(minutes=1)
    _cell(owner, team, cid, ids[1], "A", 1, at=t1, check=True, cost="1.00")
    _cell(owner, team, cid, ids[1], "B", 2, at=t1, check=True, cost="0.50")
    check = client.get(f"/api/teams/{team}/versions").json()["versions"][0]["check"]
    assert check == {
        "compare_id": cid,
        "set": "Indicators",
        "passed": 1,
        "total": 2,
        "against": 1,
        "against_passed": 2,
        "cost_delta_usd": -0.7,
        "status": "finished",
        "worse": True,
        "ended_at": (_T0 + timedelta(minutes=30)).isoformat(),
    }


# ------------------------------------------------------------------------------- owner scope


def test_task_set_routes_are_owner_scoped(client, monkeypatch):
    team = _two_versions(client)
    ts = _make_set(client, team)
    b, b_owner = fresh_account("sets-b")
    _seed_dummy_credentials(str(b_owner))
    item = {"task": "t", "starts_from": None, "hidden_check": "true"}
    for method, path in (
        ("get", f"/api/teams/{team}/task-sets"),
        ("post", f"/api/teams/{team}/task-sets"),
        ("patch", f"/api/task-sets/{ts['id']}"),
        ("delete", f"/api/task-sets/{ts['id']}"),
        ("patch", f"/api/task-sets/{uuid.uuid4()}"),
        ("delete", "/api/task-sets/not-a-uuid"),
    ):
        body = {"name": "Mine now", "items": [item]}
        resp = (
            getattr(b, method)(path, json=body)
            if method in ("post", "patch")
            else getattr(b, method)(path)
        )
        assert resp.status_code == 404, (method, path, resp.status_code, resp.text)
    # A's set id through B's own team: the compare and the save-and-check both 404.
    own = _two_versions(b, f"B team {uuid.uuid4().hex[:6]}")
    resp, calls, _ = _starts(b, own, monkeypatch, task_set_id=ts["id"])
    assert resp.status_code == 404 and calls == []
    eng = _node(b, own, "engineer")
    b.patch(f"/api/teams/{own}/nodes/{eng['id']}", json={"prompt": "b change"})
    resp = b.post(f"/api/teams/{own}/versions", json={"check_set": ts["id"]})
    assert resp.status_code == 404, resp.text
    with session_scope() as session:
        assert (
            len(
                session.execute(
                    select(TeamVersion.id).where(TeamVersion.team_graph_id == uuid.UUID(own))
                ).all()
            )
            == 2
        )  # B's change was not saved as v3
        kept = session.get(TaskSet, uuid.UUID(ts["id"]))
        assert kept.name == "Indicators"
    assert len(_items_of(ts["id"])) == 2


# ------------------------------------------------------------------ review fixes (M9 review)


def test_a_name_that_lowercases_differently_in_python_still_409s(client):
    """The name check compares in the database on both sides: Python's "ΟΔΟΣ".lower() ends in a
    final sigma, Postgres's doesn't — the unique index must never surface as a 500."""
    team = library_team(client)
    item = {"task": "t", "starts_from": None, "hidden_check": "true"}
    _make_set(client, team, "ΟΔΟΣ", [item])
    again = client.post(f"/api/teams/{team}/task-sets", json={"name": "ΟΔΟΣ", "items": [item]})
    assert again.status_code == 409, again.text
    other = _make_set(client, team, "Bugs", [item])
    rename = client.patch(f"/api/task-sets/{other['id']}", json={"name": "ΟΔΟΣ", "items": [item]})
    assert rename.status_code == 409, rename.text


def test_a_set_edited_while_its_compare_is_created_counts_the_tasks_it_runs(client, monkeypatch):
    """An edit that lands between the first read of the set and the compare's insert: the compare
    counts the tasks it actually launches (the set is locked at the insert), so it can finish."""
    team = _two_versions(client)
    ts = _make_set(client, team, items=[*ITEMS, {**ITEMS[0], "task": "Add an ATR indicator"}])
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    real = compare._authorise

    def _edit_meanwhile(owner_id, target):
        with session_scope() as session:  # another tab cuts the set to 2 tasks
            session.execute(
                text("delete from task_set_items where task_set_id = :s and position = 3"),
                {"s": ts["id"]},
            )
        return real(owner_id, target)

    monkeypatch.setattr(compare, "_authorise", _edit_meanwhile)
    resp, _calls, _waiters = _starts(client, team, monkeypatch, task_set_id=ts["id"])
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    try:
        with session_scope() as session:
            assert session.get(Compare, uuid.UUID(cid)).item_count == 2
        assert len(_set_runs(cid)) == 4
    finally:
        _end(_set_runs(cid))


def test_a_stop_before_the_workflows_start_cancels_them(client, monkeypatch):
    """A Stop that lands after a task's runs are committed but before their workflows exist marks
    the runs cancelled while DBOS has nothing to cancel yet: starting them then cancels them."""
    from dbos import DBOS

    started: list[str] = []
    cancelled: list[str] = []
    owner = auth_user_id()
    run_ids = [str(make_run(owner, None, status="cancelled")[0]) for _ in range(2)]
    monkeypatch.setattr(
        DBOS,
        "start_workflow",
        lambda fn, idea: started.append(idea),  # noqa: ARG005
    )
    monkeypatch.setattr(DBOS, "cancel_workflow", lambda wid: cancelled.append(wid))
    compare._start(run_ids, "Add an RSI indicator")
    assert started == ["Add an RSI indicator"] * 2
    assert sorted(cancelled) == sorted(run_ids)
    live = str(make_run(owner, None, status="running")[0])
    cancelled.clear()
    compare._start([live], "Add an RSI indicator")
    assert cancelled == []
    _end([live, *run_ids])


def test_half_a_round_apart_reads_about_1_fewer_round(client):
    owner = auth_user_id()
    team = _two_versions(client)
    item = {"task": "t", "starts_from": None, "hidden_check": "true"}
    ts = _make_set(client, team, "Pair", [item, {**item, "task": "u"}])
    cid = _seed_set_compare(team, owner, ts)
    ids = [i["id"] for i in ts["items"]]
    # A: 3 and 3 rounds (3.0); B: 3 and 2 (2.5) — half a round fewer is "about 1 fewer round".
    _cell(owner, team, cid, ids[0], "A", 1, at=_T0, check=True, rounds=3)
    _cell(owner, team, cid, ids[0], "B", 2, at=_T0, check=True, rounds=3)
    t2 = _T0 + timedelta(minutes=1)
    _cell(owner, team, cid, ids[1], "A", 1, at=t2, check=True, rounds=3)
    _cell(owner, team, cid, ids[1], "B", 2, at=t2, check=True, rounds=2)
    cards = {c["key"]: c for c in client.get(f"/api/compares/{cid}").json()["results"]["cards"]}
    assert (cards["rounds"]["note"], cards["rounds"]["tone"]) == ("about 1 fewer round", "good")
