"""M2 (brief ``prompts/m2-examples.md``) — the example builder, offline: the launch (the run's copy
is stamped, the saved team never), the walk to Hand in with a fake agent that calls the examples
server's functions (rounds, the escalation hand-in, zero drafts fails the run, no ship, no PR),
accept, the lock between tests and training examples on every door, the training set's versions,
import and downloads, Home's Needs you, team files and validity. DBOS is real; no model called."""

import json
import uuid

import pytest
from m2_fixtures import (
    CHOICES,
    QUOTES,
    account,
    approve_all,
    builder_id,
    choice_model,
    domain,
    draft,
    fake_team,
    options,
    start,
    wait_run,
    write_four,
)
from sqlalchemy import select

from tvashtr.control_plane import model_examples
from tvashtr.control_plane import model_examples_pure as pure
from tvashtr.control_plane.graph_validity import validate_graph
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    ModelExampleBatch,
    ModelExampleDraft,
    Run,
    TeamGraph,
)

LOCKED_TEST = "This is already a training example, so it can't be a test. Remove it there first."


def _ready_run(c, mid, did, monkeypatch, tmp_path, writes=write_four, reviews=approve_all):
    team = builder_id(c, mid)
    seen = fake_team(monkeypatch, tmp_path, writes=writes, reviews=reviews)
    resp = start(c, mid, did, team)
    assert resp.status_code == 202, resp.text
    run = wait_run(resp.json()["run_id"])
    return team, resp.json(), run, seen


def _team_tool_configs(team_id) -> list:
    with session_scope() as s:
        return [
            n.tool_config
            for n in s.execute(
                select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team_id))
            ).scalars()
        ]


# ------------------------------------------------------------------------------ the dialog


def test_the_example_builder_is_made_the_first_time_and_listed_first(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    domain(owner)
    first = options(c, mid)
    again = options(c, mid)
    assert [t["name"] for t in first["teams"]] == ["Example builder"]
    assert first["teams"][0]["team_id"] == again["teams"][0]["team_id"]  # made once
    steps = first["teams"][0]["steps"]
    assert [s["label"] for s in steps] == ["Reader", "Writer", "Reviewer", "Hand in"]
    assert [s["loops_with_next"] for s in steps] == [False, True, False, False]
    assert first["domains"][0]["ready_files"] == 3
    # Not one of Home's New-team templates.
    templates = c.get("/api/templates").json()
    names = [
        t["name"] for t in (templates if isinstance(templates, list) else templates["templates"])
    ]
    assert "Example builder" not in names


def test_the_estimate_uses_listed_prices_then_says_so(client, monkeypatch):
    from tvashtr.gateway import gateway as gateway_core

    monkeypatch.setattr(gateway_core, "price_per_token", lambda slug: (1e-6, 2e-6))
    c, owner = account("deepseek")
    mid = choice_model(c)
    team = builder_id(c, mid)
    out = c.post(
        f"/api/models/{mid}/drafting/estimate",
        json={"team_id": team, "tests": 4, "training": 6},
    ).json()
    reader = 20_000 * 1e-6 + 2_000 * 2e-6
    writer = 10 * (6_000 * 1e-6 + 400 * 2e-6)
    reviewer = 5 * (5_000 * 1e-6 + 200 * 2e-6)
    assert out["estimate_usd"] == pytest.approx(reader + writer + reviewer)
    assert out["hint"] == model_examples_launch_first_hint()
    assert out["pause_usd"] == 0.5
    assert out["agents"] == 3


def model_examples_launch_first_hint():
    from tvashtr.control_plane.model_examples_launch import FIRST_HINT

    return FIRST_HINT


@pytest.mark.parametrize(
    ("body", "status", "detail"),
    [
        ({"tests": 0, "training": 0}, 422, "Ask for at least one test or training example."),
        ({"tests": 26, "training": 0}, 422, "Tests can be 0 to 25."),
        ({"tests": 1, "training": 76}, 422, "Training examples can be 0 to 75."),
    ],
)
def test_the_counts_are_checked(client, body, status, detail):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    resp = c.post(
        f"/api/models/{mid}/drafting",
        json={"domain_id": did, "team_id": builder_id(c, mid), **body},
    )
    assert (resp.status_code, resp.json()["detail"]) == (status, detail)


def test_a_domain_with_no_ready_file_cant_start(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner, ready=False)
    resp = start(c, mid, did, builder_id(c, mid))
    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "This Domain has no ready files yet. Wait for its files, or pick another."
    )


def test_missing_keys_are_the_missing_providers_422(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    team = builder_id(c, mid)
    with session_scope() as s:
        for n in s.execute(
            select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team))
        ).scalars():
            if n.model:
                n.model = "groq/openai/gpt-oss-120b"
    resp = start(c, mid, did, team)
    assert resp.status_code == 422
    assert resp.json()["detail"]["missing_providers"] == ["groq"]


def test_a_team_without_hand_in_cant_draft(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    other = c.post("/api/teams", json={"template": "review_loop", "name": "Builders"}).json()
    resp = start(c, mid, did, other["team_graph_id"])
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Builders doesn't end in Hand in, so it can't draft examples."


# ------------------------------------------------------------------------- launch + the walk


def test_launch_stamps_the_runs_copy_and_never_the_saved_team(client, monkeypatch, tmp_path):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    team = builder_id(c, mid)
    before = _team_tool_configs(team)
    _, started, run, seen = _ready_run(c, mid, did, monkeypatch, tmp_path)
    assert run.status == "completed", run.failure_message
    assert _team_tool_configs(team) == before  # the saved team is untouched
    assert all("domains" not in ((tc or {}).get("tvashtr") or {}) for tc in before)
    grants = {g: tc for g, tc in seen}
    for grant in ("read", "write", "review"):
        assert grants[grant]["tvashtr"]["domains"] == [did], grant
        assert grants[grant]["tvashtr"]["examples"] == grant
    with session_scope() as s:
        row = s.get(Run, run.id)
        assert row.team_graph_id != uuid.UUID(team)
        assert row.library_team_id == uuid.UUID(team)
        assert row.budget_cap_usd == pytest.approx(started["pause_usd"])
        assert "Claims triage" in row.idea and "Claims handbook" in row.idea
        assert "Draft 2 tests and 2 training examples" in row.idea


def test_the_walk_hands_in_with_no_ship_and_no_pull_request(client, monkeypatch, tmp_path):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    _, started, run, _ = _ready_run(c, mid, did, monkeypatch, tmp_path)
    assert run.status == "completed"
    assert run.pr_url is None
    with session_scope() as s:
        batch = s.get(ModelExampleBatch, uuid.UUID(started["batch_id"]))
        assert (batch.status, batch.review_rounds, batch.sent_back) == ("ready", 1, 0)
        assert batch.completed_at is not None and batch.cost_usd is not None
        outcomes = [
            i.outcome
            for i in s.execute(
                select(AgentInvocation)
                .where(AgentInvocation.run_id == str(run.id))
                .order_by(AgentInvocation.id)
            ).scalars()
        ]
    assert outcomes[-1] == "handed_in"
    assert "shipped" not in outcomes
    view = c.get(f"/api/models/{mid}/drafts").json()
    (b,) = view["batches"]
    assert b["state"] == "ready"
    assert b["reviewer_line"] == "Reviewer checked 4 and approved"
    assert [d["number"] for d in b["drafts"]] == [1, 2, 3, 4]
    assert b["drafts"][1]["answer"] == "Property"  # stored as the choice itself
    assert b["drafts"][0]["source"] == {
        "file": "motor-rules.md",
        "quote": QUOTES["motor-rules.md"],
        "locator": None,
    }
    assert view["open"] == 4


def test_after_two_send_backs_the_team_hands_in_what_it_has(client, monkeypatch, tmp_path):
    passes = []

    def writes(batch_id, iteration):
        passes.append(iteration)
        write_four(batch_id, iteration)

    def reviews(batch_id, iteration):
        model_examples.agent_review(batch_id, 3, "flagged", "Not a realistic claim.", None)
        return "changes_requested"

    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    _, started, run, _ = _ready_run(
        c, mid, did, monkeypatch, tmp_path, writes=writes, reviews=reviews
    )
    assert run.status == "completed"
    assert passes == [1, 2, 3]  # the first pass + two send-backs
    with session_scope() as s:
        batch = s.get(ModelExampleBatch, uuid.UUID(started["batch_id"]))
        assert (batch.review_rounds, batch.sent_back) == (3, 2)
    (b,) = c.get(f"/api/models/{mid}/drafts").json()["batches"]
    assert b["reviewer_line"] == "Reviewer checked 1, sent back twice; 1 still flagged"
    flagged = next(d for d in b["drafts"] if d["number"] == 3)
    assert (flagged["review"], flagged["selected"]) == ("flagged", False)


def test_zero_drafts_fails_the_run(client, monkeypatch, tmp_path):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    _, _, run, _ = _ready_run(
        c, mid, did, monkeypatch, tmp_path, writes=lambda b, i: None, reviews=approve_all
    )
    assert run.status == "failed"
    assert run.failure_message == "The team handed in no examples."


def test_one_drafting_run_per_model(client, monkeypatch, tmp_path):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    team = builder_id(c, mid)
    with session_scope() as s:
        s.add(
            Run(
                id=uuid.uuid4(),
                team_graph_id=uuid.UUID(team),
                owner_id=owner,
                idea="x",
                workflow_id=str(uuid.uuid4()),
                status="running",
            )
        )
        s.flush()
        run_id = (
            s.execute(select(Run.id).where(Run.owner_id == owner).order_by(Run.created_at.desc()))
            .scalars()
            .first()
        )
        s.add(
            ModelExampleBatch(
                model_id=uuid.UUID(mid),
                owner_id=owner,
                run_id=run_id,
                domain_id=uuid.UUID(did),
                domain_name="Claims handbook",
                team_id=uuid.UUID(team),
                team_name="Example builder",
                tests_wanted=1,
                training_wanted=1,
            )
        )
    resp = start(c, mid, did, team)
    assert (resp.status_code, resp.json()["detail"]) == (
        422,
        "A team is already drafting for this model.",
    )
    assert options(c, mid)["drafting"] is True
    view = c.get(f"/api/models/{mid}/drafts").json()
    assert view["batches"][0]["state"] == "drafting"


def test_an_ordinary_run_of_a_hand_in_team_is_refused(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    team = builder_id(c, mid)
    resp = c.post("/api/runs", json={"team_graph_id": team, "idea": "anything"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "This team hands in examples. Start it from a model: Models, your model, Draft with a team."
    )


# ---------------------------------------------------------------------- the source check (DB)


def _drafting_batch(client_c, owner, mid, did):
    team = builder_id(client_c, mid)
    with session_scope() as s:
        run = Run(
            id=uuid.uuid4(),
            team_graph_id=uuid.UUID(team),
            owner_id=owner,
            idea="x",
            workflow_id="w",
            status="running",
        )
        s.add(run)
        s.flush()
        batch = ModelExampleBatch(
            model_id=uuid.UUID(mid),
            owner_id=owner,
            run_id=run.id,
            domain_id=uuid.UUID(did),
            domain_name="Claims handbook",
            team_id=uuid.UUID(team),
            team_name="Example builder",
            tests_wanted=1,
            training_wanted=2,
        )
        s.add(batch)
        s.flush()
        return batch.id


def test_the_agents_hand_ins_are_source_checked(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    c.post(f"/api/models/{mid}/tests", json={"input": "My bike was stolen.", "expected": "Motor"})
    bid = _drafting_batch(c, owner, mid, did)
    ok = model_examples.agent_add(
        bid, draft("test", "Truck hit my parked car.", "Motor", "motor-rules.md")
    )
    assert ok == {"id": 1, "tests_handed_in": 1, "training_examples_handed_in": 0}
    refusals = {
        "file": {**draft("training", "a", "Motor", "motor-rules.md"), "source_file": "x.pdf"},
        "quote": {
            **draft("training", "a", "Motor", "motor-rules.md"),
            "quote": "Damage by a parked car is always Property.",
        },
        "answer": draft("training", "a", "Car", "motor-rules.md"),
        "copy": draft("training", " my BIKE was  stolen. ", "Motor", "motor-rules.md"),
        "room": draft("test", "Another case entirely.", "Motor", "motor-rules.md"),
    }
    got = {}
    for k, fields in refusals.items():
        with pytest.raises(pure.Refused) as caught:
            model_examples.agent_add(bid, fields)
        got[k] = str(caught.value)
    assert got["file"].startswith("No file named x.pdf in Claims handbook. Its files are: ")
    assert got["quote"] == (
        "That quote isn't in motor-rules.md. Quote the file's own words exactly."
    )
    assert got["answer"] == "The answer must be one of: " + ", ".join(CHOICES) + "."
    assert got["copy"] == "This is the same as test 1. Write a different case."
    assert got["room"] == (
        "The plan asked for 1 test and you have handed in 1. Remove one to replace it."
    )
    with pytest.raises(pure.Refused) as caught:
        model_examples.agent_add(
            bid, draft("training", "truck hit my parked car.", "Motor", "motor-rules.md")
        )
    assert str(caught.value) == "This is the same as draft 1. Write a different case."


def test_update_rechecks_and_clears_the_review_and_remove_makes_room(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    bid = _drafting_batch(c, owner, mid, did)
    model_examples.agent_add(
        bid, draft("test", "Truck hit my parked car.", "Motor", "motor-rules.md")
    )
    model_examples.agent_review(bid, 1, "flagged", "Wrong team.", None)
    with pytest.raises(pure.Refused):
        model_examples.agent_update(bid, 1, {"answer": "Car"})
    out = model_examples.agent_update(bid, 1, {"answer": "motor"})
    assert out == {"id": 1, "review": "none"}
    (d,) = model_examples.agent_list(bid)["drafts"]
    assert (d["review"], d["flagged_before"]) == ("none", True)
    model_examples.agent_remove(bid, 1)
    assert (
        model_examples.agent_add(bid, draft("test", "New case.", "Motor", "motor-rules.md"))["id"]
        == 2
    )


# --------------------------------------------------------------------------------- accept


def test_accept_makes_one_version_of_each_and_keeps_sources(client, monkeypatch, tmp_path):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    c.post(f"/api/models/{mid}/tests", json={"input": "Hand test.", "expected": "Motor"})
    _ready_run(c, mid, did, monkeypatch, tmp_path)
    drafts = c.get(f"/api/models/{mid}/drafts").json()["batches"][0]["drafts"]
    out = c.post(
        f"/api/models/{mid}/drafts/accept", json={"draft_ids": [d["draft_id"] for d in drafts]}
    ).json()
    assert out == {
        "accepted_tests": 2,
        "accepted_training": 2,
        "test_version": 2,
        "training_version": 1,
        "refused": [],
    }
    versions = c.get(f"/api/models/{mid}/versions").json()["versions"]
    assert versions[0]["change_note"] == "Added 2 tests from Example builder"
    tv = c.get(f"/api/models/{mid}/training/versions").json()["versions"]
    assert [v["change_note"] for v in tv] == ["Added 2 examples from Example builder"]
    tests = c.get(f"/api/models/{mid}/tests").json()["tests"]
    assert tests[0]["added_by"] == "Added by you" and tests[0]["source"] is None
    assert tests[1]["source"]["file"] == "motor-rules.md"
    assert tests[1]["origin"] == "draft" and tests[1]["scoring"] == "exact"
    training = c.get(f"/api/models/{mid}/training").json()
    assert [e["added_by"] for e in training["examples"]] == ["Example builder"] * 2
    assert training["examples"][0]["source"]["quote"] == QUOTES["fraud-rules.md"]
    assert c.get(f"/api/models/{mid}/drafts").json()["batches"] == []  # nothing left to review


def test_a_blocked_draft_stays_with_its_reason(client, monkeypatch, tmp_path):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    _ready_run(c, mid, did, monkeypatch, tmp_path)
    drafts = c.get(f"/api/models/{mid}/drafts").json()["batches"][0]["drafts"]
    training = next(d for d in drafts if d["kind"] == "training")
    # A hand-written test made equal to the training draft.
    c.post(f"/api/models/{mid}/tests", json={"input": training["input"], "expected": "Motor"})
    view = c.get(f"/api/models/{mid}/drafts").json()["batches"][0]["drafts"]
    blocked = next(d for d in view if d["draft_id"] == training["draft_id"])
    assert blocked["blocked"] == (
        "This matches test 1, so it can't be trained on. Edit it into a different case, or "
        "reject it."
    )
    assert blocked["selected"] is False
    out = c.post(
        f"/api/models/{mid}/drafts/accept", json={"draft_ids": [training["draft_id"]]}
    ).json()
    assert out["accepted_training"] == 0
    assert out["refused"][0]["reason"] == blocked["blocked"]
    # Edit it into a different case: accepted, and shown as edited from a draft.
    c.put(
        f"/api/models/{mid}/drafts/{training['draft_id']}",
        json={"input": "A different case now."},
    )
    out = c.post(
        f"/api/models/{mid}/drafts/accept", json={"draft_ids": [training["draft_id"]]}
    ).json()
    assert out["accepted_training"] == 1
    examples = c.get(f"/api/models/{mid}/training").json()["examples"]
    assert examples[0]["added_by"] == "You, edited from a draft"


def test_flipping_rechecks_the_lock(client, monkeypatch, tmp_path):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    _ready_run(c, mid, did, monkeypatch, tmp_path)
    drafts = c.get(f"/api/models/{mid}/drafts").json()["batches"][0]["drafts"]
    test_draft = next(d for d in drafts if d["kind"] == "test")
    c.post(f"/api/models/{mid}/training", json={"input": test_draft["input"], "answer": "Motor"})
    flipped = c.post(
        f"/api/models/{mid}/drafts/{test_draft['draft_id']}/kind", json={"kind": "test"}
    ).json()["draft"]
    assert flipped["blocked"] == LOCKED_TEST
    flipped = c.post(
        f"/api/models/{mid}/drafts/{test_draft['draft_id']}/kind", json={"kind": "training"}
    ).json()["draft"]
    assert flipped["kind"] == "training"
    assert flipped["blocked"].startswith("This is the same as training example 1.")


def test_accepting_while_the_team_drafts_is_refused(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    bid = _drafting_batch(c, owner, mid, did)
    model_examples.agent_add(
        bid, draft("test", "Truck hit my parked car.", "Motor", "motor-rules.md")
    )
    view = c.get(f"/api/models/{mid}/drafts").json()
    assert view["open"] == 0 and view["batches"][0]["state"] == "drafting"
    did0 = view["batches"][0]["drafts"][0]["draft_id"]
    out = c.post(f"/api/models/{mid}/drafts/accept", json={"draft_ids": [did0]}).json()
    assert out["refused"][0]["reason"] == "You can accept once the team hands in."


def test_a_stopped_batch_reads_as_stopped_and_can_be_accepted(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    bid = _drafting_batch(c, owner, mid, did)
    model_examples.agent_add(
        bid, draft("test", "Truck hit my parked car.", "Motor", "motor-rules.md")
    )
    with session_scope() as s:
        batch = s.get(ModelExampleBatch, bid)
        s.get(Run, batch.run_id).status = "failed"
    view = c.get(f"/api/models/{mid}/drafts").json()
    assert view["batches"][0]["state"] == "stopped"
    assert view["open"] == 1
    d = view["batches"][0]["drafts"][0]["draft_id"]
    assert (
        c.post(f"/api/models/{mid}/drafts/accept", json={"draft_ids": [d]}).json()["accepted_tests"]
        == 1
    )


def test_reject_hides_drafts_for_good(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    bid = _drafting_batch(c, owner, mid, did)
    model_examples.agent_add(
        bid, draft("test", "Truck hit my parked car.", "Motor", "motor-rules.md")
    )
    with session_scope() as s:
        s.get(Run, s.get(ModelExampleBatch, bid).run_id).status = "completed"
        s.get(ModelExampleBatch, bid).status = "ready"
    d = c.get(f"/api/models/{mid}/drafts").json()["batches"][0]["drafts"][0]["draft_id"]
    assert c.post(f"/api/models/{mid}/drafts/reject", json={"draft_ids": [d]}).json() == {
        "rejected": 1
    }
    assert c.get(f"/api/models/{mid}/drafts").json()["batches"] == []
    with session_scope() as s:
        assert s.get(ModelExampleDraft, uuid.UUID(d)).state == "rejected"


# ------------------------------------------------------------------------- the lock, every door


def test_a_test_cant_be_a_training_example_on_any_door(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    c.post(f"/api/models/{mid}/training", json={"input": "Same Case", "answer": "Motor"})
    add = c.post(f"/api/models/{mid}/tests", json={"input": " same  case ", "expected": "Motor"})
    assert (add.status_code, add.json()["detail"]) == (422, LOCKED_TEST)
    key = c.post(f"/api/models/{mid}/tests", json={"input": "other", "expected": "Motor"}).json()[
        "test"
    ]["case_key"]
    edit = c.put(f"/api/models/{mid}/tests/{key}", json={"input": "SAME CASE", "expected": "Motor"})
    assert (edit.status_code, edit.json()["detail"]) == (422, LOCKED_TEST)
    imp = c.post(
        f"/api/models/{mid}/tests/import",
        json={"filename": "t.csv", "csv": "input,expected\nfine,Motor\nsame case,Motor\n"},
    ).json()
    assert imp["errors"] == [f"Line 3: {LOCKED_TEST}"] and imp["imported"] is False


def test_a_training_example_cant_be_a_test_on_any_door(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    c.post(f"/api/models/{mid}/tests", json={"input": "first", "expected": "Motor"})
    c.post(f"/api/models/{mid}/tests", json={"input": "Same Case", "expected": "Motor"})
    want = "This matches test 2, so it can't be trained on."
    add = c.post(f"/api/models/{mid}/training", json={"input": "same case", "answer": "Motor"})
    assert (add.status_code, add.json()["detail"]) == (422, want)
    key = c.post(f"/api/models/{mid}/training", json={"input": "x", "answer": "Motor"}).json()[
        "example"
    ]["example_key"]
    edit = c.put(
        f"/api/models/{mid}/training/{key}", json={"input": "same CASE", "answer": "Motor"}
    )
    assert (edit.status_code, edit.json()["detail"]) == (422, want)
    imp = c.post(
        f"/api/models/{mid}/training/import",
        json={"filename": "x.csv", "csv": "input,answer\nok,Motor\nsame case,Motor\n"},
    ).json()
    assert imp["errors"] == [f"Line 3: {want}"] and imp["imported"] is False


# ------------------------------------------------------------------- the training set itself


def test_training_versions_history_and_restore(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    one = c.post(f"/api/models/{mid}/training", json={"input": "a", "answer": "motor"}).json()
    assert one["example"]["answer"] == "Motor" and one["version"] == 1
    key = one["example"]["example_key"]
    c.put(f"/api/models/{mid}/training/{key}", json={"input": "a2", "answer": "Health"})
    c.delete(f"/api/models/{mid}/training/{key}")
    notes = [
        v["change_note"] for v in c.get(f"/api/models/{mid}/training/versions").json()["versions"]
    ]
    assert notes == ["Deleted example 1", "Edited example 1", "Added example 1"]
    assert c.get(f"/api/models/{mid}/training?version=2").json()["examples"][0]["input"] == "a2"
    c.post(f"/api/models/{mid}/training/versions/2/restore")
    now = c.get(f"/api/models/{mid}/training").json()
    assert (now["version"], now["change_note"]) == (4, "Restored v2")
    assert [e["input"] for e in now["examples"]] == ["a2"]
    bad = c.post(f"/api/models/{mid}/training", json={"input": "b", "answer": "Car"})
    assert bad.json()["detail"] == "The answer must be one of the choices."


def test_training_import_dry_run_then_import(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    csv_text = "input,answer\nfirst,Motor\nsecond,Other\n"
    dry = c.post(
        f"/api/models/{mid}/training/import",
        json={"filename": "seed.csv", "csv": csv_text, "dry_run": True},
    ).json()
    assert (dry["ready"], dry["next_version"], dry["imported"]) == (2, 1, False)
    real = c.post(
        f"/api/models/{mid}/training/import", json={"filename": "seed.csv", "csv": csv_text}
    ).json()
    assert real["imported"] is True
    training = c.get(f"/api/models/{mid}/training").json()
    assert training["change_note"] == "Imported 2 examples from seed.csv"
    assert training["examples"][0]["added_by"] == "Imported from seed.csv"


def test_the_downloads_carry_only_training_examples_with_the_test_instruction(client):
    from tvashtr.control_plane import model_tests_pure

    c, owner = account("deepseek")
    mid = choice_model(c)
    c.post(f"/api/models/{mid}/tests", json={"input": "a test, never trained", "expected": "Motor"})
    c.post(f"/api/models/{mid}/training", json={"input": "learn, me", "answer": "Health"})
    resp = c.get(f"/api/models/{mid}/training/download?format=jsonl")
    assert resp.status_code == 200
    assert "attachment" in resp.headers["content-disposition"]
    lines = resp.text.splitlines()
    assert len(lines) == 1
    model = c.get(f"/api/models/{mid}").json()
    system = model_tests_pure.build_messages("choice", model["job"], CHOICES, "x")[0]["content"]
    assert json.loads(lines[0]) == {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": "learn, me"},
            {"role": "assistant", "content": "Health"},
        ]
    }
    assert "never trained" not in resp.text
    csv_resp = c.get(f"/api/models/{mid}/training/download?format=csv")
    assert csv_resp.text == 'input,answer,source_file,source_quote\n"learn, me",Health,,\n'


# --------------------------------------------------------------------------- Home + the model


def test_needs_you_has_a_line_per_model_with_drafts_until_none_are_open(
    client, monkeypatch, tmp_path
):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    _ready_run(c, mid, did, monkeypatch, tmp_path)
    items = [i for i in c.get("/api/inbox").json()["items"] if i["kind"] == "model_drafts"]
    assert [(i["count"], i["model_name"], i["model_id"]) for i in items] == [
        (4, "Claims triage", mid)
    ]
    assert c.get(f"/api/models/{mid}").json()["drafts"] == 4
    ids = [d["draft_id"] for d in c.get(f"/api/models/{mid}/drafts").json()["batches"][0]["drafts"]]
    c.post(f"/api/models/{mid}/drafts/reject", json={"draft_ids": ids})
    items = [i for i in c.get("/api/inbox").json()["items"] if i["kind"] == "model_drafts"]
    assert items == []


# ------------------------------------------------------------------------ team files + validity


def test_a_hand_in_team_exports_and_imports(client):
    import yaml

    c, owner = account("deepseek")
    mid = choice_model(c)
    team = builder_id(c, mid)
    first = c.get(f"/api/teams/{team}/file", params={"format": "yaml"}).json()["content"]
    data = yaml.safe_load(first)
    assert data["ends"] == [{"id": "hand_in", "kind": "hand_in"}]
    assert sorted(a.get("examples") for a in data["agents"]) == ["read", "review", "write"]
    imported = c.post("/api/teams/import", json={"content": first})
    assert imported.status_code == 201, imported.text
    new_id = imported.json()["team_graph_id"]
    again = yaml.safe_load(c.get(f"/api/teams/{new_id}/file").json()["content"])
    data.pop("name"), again.pop("name")
    assert again == data
    with session_scope() as s:
        nodes = (
            s.execute(select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(new_id)))
            .scalars()
            .all()
        )
    assert any((n.config or {}).get("terminal_kind") == "hand_in" for n in nodes)


def test_validate_graph_wants_a_writer_for_hand_in():
    nodes = [
        {
            "id": "a",
            "kind": "completion",
            "config": {},
            "model": "m",
            "prompt": "p",
            "tool_config": None,
        },
        {
            "id": "h",
            "kind": "terminal",
            "config": {"terminal_kind": "hand_in"},
            "model": None,
            "prompt": None,
            "tool_config": None,
        },
    ]
    edges = [
        {
            "id": "e",
            "source_node_id": "a",
            "target_node_id": "h",
            "edge_type": "work",
            "conditions": None,
        }
    ]
    verdict = validate_graph(nodes, edges)
    assert [e["message"] for e in verdict["errors"]] == [
        "No agent in this team can hand in examples."
    ]
    nodes[0]["tool_config"] = {"tvashtr": {"examples": "write"}}
    assert validate_graph(nodes, edges)["runnable"] is True


def test_the_canvas_can_add_a_hand_in(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    team = builder_id(c, mid)
    resp = c.post(
        f"/api/teams/{team}/nodes", json={"node_kind": "terminal", "terminal_kind": "hand_in"}
    )
    assert resp.status_code in (200, 201), resp.text
    with session_scope() as s:
        kinds = [
            (n.config or {}).get("terminal_kind")
            for n in s.execute(
                select(AgentNode).where(
                    AgentNode.team_graph_id == uuid.UUID(team), AgentNode.kind == "terminal"
                )
            ).scalars()
        ]
    assert kinds.count("hand_in") == 2


def test_no_key_in_any_new_table(client, monkeypatch, tmp_path):
    from tvashtr.models import ModelTrainingExample

    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    _ready_run(c, mid, did, monkeypatch, tmp_path)
    ids = [d["draft_id"] for d in c.get(f"/api/models/{mid}/drafts").json()["batches"][0]["drafts"]]
    c.post(f"/api/models/{mid}/drafts/accept", json={"draft_ids": ids})
    with session_scope() as s:
        rows = [
            *s.execute(select(ModelExampleBatch)).scalars(),
            *s.execute(select(ModelExampleDraft)).scalars(),
            *s.execute(select(ModelTrainingExample)).scalars(),
            *s.execute(select(TeamGraph).where(TeamGraph.owner_id == owner)).scalars(),
        ]
        dumped = " ".join(
            repr({k: v for k, v in vars(r).items() if not k.startswith("_")}) for r in rows
        )
    assert "sk-m2-made-up" not in dumped
