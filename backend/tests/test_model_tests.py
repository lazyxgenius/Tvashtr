"""Models 1 (brief ``prompts/models-1.md``): the API, the versions, the CSV import, the estimate,
the durable runner, stop, the stale read, Last run per revision and compare. Offline: the gateway
and its price helpers are faked, DBOS is real."""

import json
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from home_fixtures import fresh_account
from sqlalchemy import select, text, update

from tvashtr import gateway
from tvashtr.control_plane import credentials, model_tests_run
from tvashtr.control_plane.credentials import encrypt_secret
from tvashtr.db import session_scope
from tvashtr.gateway import CompletionResult
from tvashtr.gateway import gateway as gateway_core
from tvashtr.models import (
    ModelTestCase,
    ModelTestResult,
    ModelTestRun,
    ModelTestSetVersion,
    ProviderCredential,
)

A = "deepseek/deepseek-chat"
B = "groq/openai/gpt-oss-120b"
JUDGE = "openai/gpt-4o-mini"
UNLISTED = "mistral/not-listed"
SECRET = "sk-the-real-secret-key-value-000"


def _keys(owner, *providers):
    with session_scope() as s:
        for p in providers:
            s.add(
                ProviderCredential(
                    owner_id=owner,
                    provider=p,
                    secret_encrypted=encrypt_secret(SECRET),
                    key_last4=SECRET[-4:],
                )
            )


def _account(*providers):
    c, owner = fresh_account("mt")
    _keys(owner, *providers)
    return c, owner


def _choice_model(c, name="Claims triage"):
    resp = c.post(
        "/api/models",
        json={
            "name": name,
            "job": "Sort the claim.",
            "answer_kind": "choice",
            "choices": ["Motor", "Home"],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["model_id"]


def _text_model(c, name="Router"):
    resp = c.post("/api/models", json={"name": name, "job": "Route it.", "answer_kind": "text"})
    assert resp.status_code == 201, resp.text
    return resp.json()["model_id"]


def _add(c, mid, **body):
    resp = c.post(
        f"/api/models/{mid}/tests", json={"input": "a claim", "expected": "Motor", **body}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _reply(request, text_, model=None, cost=0.001):
    return CompletionResult(
        text=text_,
        model_requested=request.model,
        model_used=model or request.model,
        prompt_tokens=10,
        completion_tokens=2,
        total_tokens=12,
        cost_usd=cost,
        raw_provider=request.model.split("/")[0],
        latency_ms=1400.0,
    )


@pytest.fixture
def fake(monkeypatch):
    """A scripted gateway: ``answers[slug]`` is the text (or an exception, or a callable)."""
    state = {"answers": {}, "requests": []}

    def complete(request):
        state["requests"].append(request)
        answer = state["answers"].get(request.model, "Motor")
        if callable(answer):
            answer = answer(request)
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, CompletionResult):
            return answer
        return _reply(request, answer)

    monkeypatch.setattr(gateway, "complete", complete)
    return state


def _wait(c, mid, run_ids, timeout=30):
    deadline = time.monotonic() + timeout
    while True:
        runs = [c.get(f"/api/models/{mid}/runs/{r}").json() for r in run_ids]
        if all(r["status"] != "running" for r in runs):
            return runs
        assert time.monotonic() < deadline, runs
        time.sleep(0.05)


def _run(c, mid, *models):
    resp = c.post(f"/api/models/{mid}/runs", json={"models": list(models)})
    assert resp.status_code == 202, resp.text
    return _wait(c, mid, [r["run_id"] for r in resp.json()["runs"]])


# -------------------------------------------------------------------------------------- models


def test_a_new_model_has_no_version_and_shows_in_the_list(client):
    c, _ = _account()
    mid = _choice_model(c)
    assert c.get(f"/api/models/{mid}").json()["current_version"] == 0
    card = c.get("/api/models").json()["models"][0]
    assert (card["tests"], card["badge"], card["best"]) == (0, "not_run", [])
    assert card["choices"] == ["Motor", "Home"]


@pytest.mark.parametrize(
    ("body", "word"),
    [
        ({"name": " ", "job": "J", "answer_kind": "text"}, "Give it a name."),
        ({"name": "N", "job": " ", "answer_kind": "text"}, "Describe the job in one sentence."),
        (
            {"name": "N", "job": "J", "answer_kind": "choice", "choices": ["A"]},
            "Add at least two choices.",
        ),
        (
            {"name": "N", "job": "J", "answer_kind": "choice", "choices": ["A", "a"]},
            "That choice is already in the list.",
        ),
    ],
)
def test_creating_a_model_refuses_in_the_products_words(client, body, word):
    c, _ = _account()
    resp = c.post("/api/models", json=body)
    assert (resp.status_code, resp.json()["detail"]) == (422, word)


def test_a_name_is_unique_per_account_ignoring_case(client):
    c, _ = _account()
    mid = _choice_model(c, "Claims")
    other = _text_model(c, "Other")
    resp = c.post("/api/models", json={"name": "CLAIMS", "job": "J", "answer_kind": "text"})
    assert (resp.status_code, resp.json()["detail"]) == (422, "That name is taken. Pick another.")
    resp = c.patch(f"/api/models/{other}", json={"name": "claims"})
    assert (resp.status_code, resp.json()["detail"]) == (422, "That name is taken. Pick another.")
    assert c.patch(f"/api/models/{mid}", json={"name": "CLAIMS"}).status_code == 200


def test_deleting_a_model_takes_everything_with_it(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    case = _add(c, mid)["test"]
    run = _run(c, mid, A)[0]
    assert c.delete(f"/api/models/{mid}").status_code == 204
    assert c.get(f"/api/models/{mid}").status_code == 404
    with session_scope() as s:
        assert s.get(ModelTestRun, uuid.UUID(run["run_id"])) is None
        assert s.get(ModelTestCase, uuid.UUID(case["case_id"])) is None


# ------------------------------------------------------------------------------------- versions


def test_every_save_makes_a_version_and_old_ones_never_change(client):
    c, _ = _account()
    mid = _choice_model(c)
    first = _add(c, mid)
    assert first["version"] == 1
    second = _add(c, mid, input="second")
    assert second["version"] == 2
    key = first["test"]["case_key"]
    edited = c.put(
        f"/api/models/{mid}/tests/{key}", json={"input": "edited", "expected": "Home"}
    ).json()
    assert edited["version"] == 3
    assert edited["test"]["case_key"] == key
    assert edited["test"]["case_id"] != first["test"]["case_id"]
    assert c.delete(f"/api/models/{mid}/tests/{second['test']['case_key']}").json()["version"] == 4

    versions = c.get(f"/api/models/{mid}/versions").json()["versions"]
    assert [(v["version"], v["change_note"], v["tests"]) for v in versions] == [
        (4, "Deleted test 2", 1),
        (3, "Edited test 1", 2),
        (2, "Added test 2", 2),
        (1, "Added test 1", 1),
    ]
    assert [t["input"] for t in c.get(f"/api/models/{mid}/tests?version=1").json()["tests"]] == [
        "a claim"
    ]
    assert [t["input"] for t in c.get(f"/api/models/{mid}/tests?version=2").json()["tests"]] == [
        "a claim",
        "second",
    ]
    now = c.get(f"/api/models/{mid}/tests").json()
    assert (now["version"], now["is_current"]) == (4, True)
    assert [t["input"] for t in now["tests"]] == ["edited"]
    assert c.get(f"/api/models/{mid}/tests?version=9").status_code == 404


def test_an_unchanged_test_is_the_same_revision_in_every_version(client):
    c, _ = _account()
    mid = _choice_model(c)
    first = _add(c, mid)["test"]
    _add(c, mid, input="other")
    with session_scope() as s:
        rows = s.execute(
            select(ModelTestSetVersion).order_by(ModelTestSetVersion.created_at.desc()).limit(2)
        ).scalars()
        assert all(first["case_id"] in r.case_ids for r in rows)


def test_the_job_and_the_choices_make_a_version_a_rename_does_not(client):
    c, _ = _account()
    mid = _choice_model(c)
    c.patch(f"/api/models/{mid}", json={"job": "Before any test."})  # nothing to version yet
    assert c.get(f"/api/models/{mid}").json()["current_version"] == 0
    _add(c, mid)
    assert c.patch(f"/api/models/{mid}", json={"name": "New name"}).json()["current_version"] == 1
    assert c.patch(f"/api/models/{mid}", json={"job": "Sort it."}).json()["current_version"] == 2
    same = c.patch(f"/api/models/{mid}", json={"job": "Sort it."}).json()
    assert same["current_version"] == 2
    moved = c.patch(f"/api/models/{mid}", json={"choices": ["Motor", "Home", "Travel"]}).json()
    assert moved["current_version"] == 3
    notes = [v["change_note"] for v in c.get(f"/api/models/{mid}/versions").json()["versions"]]
    assert notes == ["Changed the choices", "Changed the job", "Added test 1"]


def test_changing_the_choices_cant_strand_a_test(client):
    c, _ = _account()
    mid = _choice_model(c)
    _add(c, mid)
    resp = c.patch(f"/api/models/{mid}", json={"choices": ["Home", "Travel"]})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Test 1: The expected answer must be one of the choices."


def test_restore_makes_a_new_version_with_the_old_tests_job_and_choices(client):
    c, _ = _account()
    mid = _choice_model(c)
    _add(c, mid)
    c.patch(f"/api/models/{mid}", json={"job": "Changed."})
    _add(c, mid, input="more")
    out = c.post(f"/api/models/{mid}/versions/1/restore").json()
    assert out["version"] == 4
    assert out["model"]["job"] == "Sort the claim."
    assert [t["input"] for t in c.get(f"/api/models/{mid}/tests").json()["tests"]] == ["a claim"]
    assert (
        c.get(f"/api/models/{mid}/versions").json()["versions"][0]["change_note"] == "Restored v1"
    )
    assert c.post(f"/api/models/{mid}/versions/9/restore").status_code == 404


@pytest.mark.parametrize(
    ("body", "word"),
    [
        ({"input": " ", "expected": "x"}, "Write the input first."),
        ({"input": "i", "expected": ""}, "Write the expected answer."),
        ({"input": "i", "expected": "x", "scoring": "contains"}, None),
    ],
)
def test_test_words_on_a_text_model(client, body, word):
    c, _ = _account()
    mid = _text_model(c)
    resp = c.post(f"/api/models/{mid}/tests", json=body)
    assert resp.status_code == 422
    assert resp.json()["detail"] == (word or "Add at least one word or phrase it must contain.")


def test_a_choice_models_expected_answer_must_be_a_choice(client):
    c, _ = _account()
    mid = _choice_model(c)
    resp = c.post(f"/api/models/{mid}/tests", json={"input": "i", "expected": "Moto"})
    assert resp.json()["detail"] == "The expected answer must be one of the choices."


def test_the_cap_is_500_tests(client):
    c, _ = _account()
    mid = _choice_model(c)
    rows = "\n".join(f"case {i},Motor" for i in range(500))
    assert c.post(
        f"/api/models/{mid}/tests/import", json={"csv": f"input,expected\n{rows}\n"}
    ).json()["imported"]
    resp = c.post(f"/api/models/{mid}/tests", json={"input": "i", "expected": "Motor"})
    assert (resp.status_code, resp.json()["detail"]) == (422, "You can have up to 500 tests.")


# ------------------------------------------------------------------------------------ the import


def test_import_preview_then_appends_one_version(client):
    c, _ = _account()
    mid = _choice_model(c)
    _add(c, mid)
    body = {"filename": "claims.csv", "csv": "input,expected\none,Motor\ntwo,Home\n"}
    preview = c.post(f"/api/models/{mid}/tests/import", json={**body, "dry_run": True}).json()
    assert preview == {"ready": 2, "next_version": 2, "errors": [], "imported": False}
    assert c.get(f"/api/models/{mid}").json()["current_version"] == 1
    out = c.post(f"/api/models/{mid}/tests/import", json=body).json()
    assert out["imported"] is True
    assert [t["input"] for t in c.get(f"/api/models/{mid}/tests").json()["tests"]] == [
        "a claim",
        "one",
        "two",
    ]
    note = c.get(f"/api/models/{mid}/versions").json()["versions"][0]["change_note"]
    assert note == "Imported 2 tests from claims.csv"


def test_import_with_a_bad_row_imports_nothing(client):
    c, _ = _account()
    mid = _choice_model(c)
    out = c.post(
        f"/api/models/{mid}/tests/import", json={"csv": "input,expected\nok,Motor\nbad,Moto\n"}
    ).json()
    assert out["imported"] is False
    assert out["errors"] == ["Line 3: “Moto” isn't one of the choices."]
    assert c.get(f"/api/models/{mid}").json()["current_version"] == 0


def test_import_judge_defaults_to_the_last_judge_used(client):
    c, _ = _account()
    mid = _text_model(c)
    _add(c, mid, scoring="judge", rubric="R", judge_model=JUDGE)
    c.post(f"/api/models/{mid}/tests/import", json={"csv": "input,expected,rubric\nq,e,R2\n"})
    tests = c.get(f"/api/models/{mid}/tests").json()["tests"]
    assert tests[1]["judge_model"] == JUDGE


# ---------------------------------------------------------------------------------- the estimate


@pytest.fixture
def prices(monkeypatch):
    table = {A: (1e-6, 2e-6), JUDGE: (3e-6, 4e-6)}
    monkeypatch.setattr(gateway_core, "price_per_token", table.get)
    monkeypatch.setattr(
        gateway_core,
        "count_tokens",
        lambda model, messages: sum(len(m["content"]) for m in messages),
    )


def test_the_estimate_prices_listed_models_and_names_unlisted_ones(client, prices):
    c, _ = _account()
    mid = _choice_model(c)
    _add(c, mid, input="abc")
    out = c.post(f"/api/models/{mid}/estimate", json={"models": [A, UNLISTED]}).json()
    assert (out["tests"], out["version"]) == (1, 1)
    listed, unlisted = out["models"]
    # System 79 + user 3 in; "Motor" 5 + 2 out.
    system = "Sort the claim.\n\nReply with exactly one of these choices and nothing else:\n"
    tokens_in = len(system) + len("- Motor\n- Home") + 3
    assert listed["estimate_usd"] == pytest.approx(tokens_in * 1e-6 + 7 * 2e-6)
    assert unlisted["price_known"] is False
    assert unlisted["estimate_usd"] is None
    assert out["summary"]["judge_tests"] == 0


def test_the_estimate_adds_the_judge(client, prices):
    c, _ = _account()
    mid = _text_model(c)
    _add(c, mid, scoring="judge", rubric="R", judge_model=JUDGE)
    out = c.post(f"/api/models/{mid}/estimate", json={"models": [A]}).json()
    row = out["models"][0]
    assert row["judge_usd"] > 60 * 4e-6
    assert row["estimate_usd"] == pytest.approx(row["model_usd"] + row["judge_usd"])
    assert out["summary"]["judges"] == [JUDGE]


def test_the_estimate_refuses_a_slug_that_isnt_provider_model(client):
    c, _ = _account()
    mid = _text_model(c)
    resp = c.post(f"/api/models/{mid}/estimate", json={"models": ["nope"]})
    assert resp.json()["detail"] == "Type it as provider/model, like groq/llama-3.3-70b-versatile."


# ----------------------------------------------------------------------------- starting a run


def test_start_refuses_no_model_no_tests_and_too_many(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    assert c.post(f"/api/models/{mid}/runs", json={"models": []}).json()["detail"] == (
        "Pick at least one model."
    )
    resp = c.post(f"/api/models/{mid}/runs", json={"models": [A]})
    assert (resp.status_code, resp.json()["detail"]) == (422, "Add a test first.")
    _add(c, mid)
    seven = [f"deepseek/m{i}" for i in range(7)]
    assert c.post(f"/api/models/{mid}/runs", json={"models": seven}).status_code == 422


def test_start_refuses_missing_providers_including_the_judges(client, fake):
    c, _ = _account("deepseek")
    mid = _text_model(c)
    _add(c, mid, scoring="judge", rubric="R", judge_model=JUDGE)
    resp = c.post(f"/api/models/{mid}/runs", json={"models": [A, B]})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["missing_providers"] == ["groq", "openai"]
    assert detail["message"] == "You have no key for: groq, openai. Add it under Engines first."
    assert fake["requests"] == []


# ------------------------------------------------------------------------------- the workflow


def test_a_run_scores_its_tests_and_fills_the_totals(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    _add(c, mid, input="second", expected="Home")
    run = _run(c, mid, A)[0]
    assert run["status"] == "completed"
    assert (run["passed"], run["failed"], run["errors"], run["cases_total"]) == (1, 1, 0, 2)
    assert run["cost_usd"] == pytest.approx(0.002)
    assert run["avg_latency_ms"] == 1400
    assert run["model_name"] == "deepseek-chat"
    with session_scope() as s:
        row = s.get(ModelTestRun, uuid.UUID(run["run_id"]))
        assert (row.passed, row.failed, row.errors) == (1, 1, 0)
        assert float(row.cost_usd) == pytest.approx(0.002)
        assert row.avg_latency_ms == 1400
        assert row.completed_at is not None


def test_the_tested_model_is_sent_the_exact_messages(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    text_mid = _text_model(c)
    _add(c, text_mid, scoring="exact")
    _run(c, mid, A)
    _run(c, text_mid, A)
    choice, plain = fake["requests"]
    assert choice.messages == [
        {
            "role": "system",
            "content": (
                "Sort the claim.\n\nReply with exactly one of these choices and nothing else:\n"
                "- Motor\n- Home"
            ),
        },
        {"role": "user", "content": "a claim"},
    ]
    assert (choice.temperature, choice.max_tokens, choice.api_key) == (0, 1024, SECRET)
    assert plain.messages[0] == {"role": "system", "content": "Route it."}
    assert plain.max_tokens == 2048


def test_runs_use_the_versions_snapshot_of_the_job(client, fake):
    c, _ = _account("deepseek")
    mid = _text_model(c)
    _add(c, mid, scoring="exact")
    with session_scope() as s:
        case_id = s.execute(
            select(ModelTestSetVersion.case_ids).where(
                ModelTestSetVersion.model_id == uuid.UUID(mid)
            )
        ).scalar_one()[0]
    c.patch(f"/api/models/{mid}", json={"job": "A new job."})
    _run(c, mid, A)
    assert fake["requests"][0].messages[0]["content"] == "A new job."
    assert case_id  # the current version's revision is the same row


def test_a_different_model_answering_is_an_error_not_a_score(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    _add(c, mid, input="second")
    fake["answers"][A] = lambda r: _reply(
        r, "Motor", model="deepseek/other" if r.messages[1]["content"] == "second" else None
    )
    run = _run(c, mid, A)[0]
    assert (run["passed"], run["errors"]) == (1, 1)
    assert run["first_error"] == "Answered by deepseek/other, so it isn't counted."


def test_an_empty_answer_fails(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    _add(c, mid, input="second")
    fake["answers"][A] = lambda r: "  " if r.messages[1]["content"] == "second" else "Motor"
    run = _run(c, mid, A)[0]
    assert (run["passed"], run["failed"], run["errors"]) == (1, 1, 0)
    with session_scope() as s:
        reasons = s.execute(
            select(ModelTestResult.reason).where(
                ModelTestResult.run_id == uuid.UUID(run["run_id"]),
                ModelTestResult.verdict == "fail",
            )
        ).scalars()
        assert list(reasons) == ["The model gave an empty answer."]


def test_a_call_that_raises_is_an_error_with_its_first_line(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    _add(c, mid, input="second")
    fake["answers"][A] = lambda r: (
        IndexError("list index out of range\nand more")
        if r.messages[1]["content"] == "second"
        else "Motor"
    )
    run = _run(c, mid, A)[0]
    assert run["status"] == "completed"
    assert run["first_error"] == "list index out of range"


def test_a_run_where_every_test_errors_is_failed(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    fake["answers"][A] = RuntimeError("401 bad key")
    run = _run(c, mid, A)[0]
    assert run["status"] == "failed"
    assert run["error_message"] == "401 bad key"


def test_an_error_never_carries_the_key(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    fake["answers"][A] = RuntimeError(f"Incorrect API key provided: {SECRET}")
    run = _run(c, mid, A)[0]
    assert SECRET not in run["error_message"]
    with session_scope() as s:
        reason = s.execute(
            select(ModelTestResult.reason).where(ModelTestResult.run_id == uuid.UUID(run["run_id"]))
        ).scalar_one()
    assert SECRET not in reason


def _judged(c):
    mid = _text_model(c)
    _add(c, mid, input="q", expected="e", scoring="judge", rubric="R", judge_model=JUDGE)
    return mid


def test_the_judge_gets_the_fixed_prompt_and_its_cost_is_kept_apart(client, fake):
    c, _ = _account("deepseek", "openai")
    mid = _judged(c)
    fake["answers"][A] = "the answer"
    fake["answers"][JUDGE] = lambda r: _reply(
        r, '{"pass": true, "reason": "Names the app."}', cost=0.01
    )
    run = _run(c, mid, A)[0]
    assert (run["passed"], run["cost_usd"], run["judge_cost_usd"]) == (1, 0.001, 0.01)
    assert run["total_usd"] == pytest.approx(0.011)
    request = fake["requests"][1]
    assert (request.model, request.temperature, request.max_tokens) == (JUDGE, 0, 1024)
    assert request.messages == [
        {
            "role": "user",
            "content": (
                "You are grading one answer for this job: Route it.\n\n"
                "The input:\nq\n\nThe expected answer:\ne\n\n"
                "What a right answer must do:\nR\n\nThe answer to grade:\nthe answer\n\n"
                'Reply with JSON only: {"pass": true or false, "reason": "one short sentence"}'
            ),
        }
    ]
    key = c.get(f"/api/models/{mid}/tests").json()["tests"][0]["case_key"]
    result = c.get(f"/api/models/{mid}/tests/{key}/results").json()["results"][0]
    assert (result["verdict"], result["reason"]) == ("pass", "Names the app.")
    assert result["judge_model"] == JUDGE


def test_an_unreadable_judge_is_an_error(client, fake):
    c, _ = _account("deepseek", "openai")
    mid = _judged(c)
    _add(c, mid, scoring="exact", expected="the answer")
    fake["answers"][A] = "the answer"
    fake["answers"][JUDGE] = "Hmm, not sure."
    run = _run(c, mid, A)[0]
    assert run["first_error"] == "The judge's reply couldn't be read."
    assert (run["passed"], run["errors"]) == (1, 1)


def test_a_contains_test_says_what_is_missing(client, fake):
    c, _ = _account("deepseek")
    mid = _text_model(c)
    _add(c, mid, scoring="contains", must_contain=["high urgency"])
    fake["answers"][A] = "the app"
    run = _run(c, mid, A)[0]
    assert run["failed"] == 1
    with session_scope() as s:
        reason = s.execute(
            select(ModelTestResult.reason).where(ModelTestResult.run_id == uuid.UUID(run["run_id"]))
        ).scalar_one()
    assert reason == 'Missing: "high urgency"'


def test_stop_ends_before_the_next_test(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    for i in range(3):
        _add(c, mid, input=f"case {i}")

    holder = {}

    def stop_on_first(request):
        if not holder.get("stopped"):
            holder["stopped"] = True
            with session_scope() as s:
                s.execute(
                    update(ModelTestRun)
                    .values(stop_requested=True)
                    .where(ModelTestRun.model_id == uuid.UUID(mid))
                )
        return "Motor"

    fake["answers"][A] = stop_on_first
    run = _run(c, mid, A)[0]
    assert run["status"] == "stopped"
    assert (run["done"], run["cases_total"]) == (1, 3)
    assert len(fake["requests"]) == 1


def test_the_stop_route_sets_the_flag_only_on_a_running_run(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    run = _run(c, mid, A)[0]
    assert c.post(f"/api/models/{mid}/runs/{run['run_id']}/stop").json()["status"] == "completed"
    with session_scope() as s:
        assert s.get(ModelTestRun, uuid.UUID(run["run_id"])).stop_requested is False


def test_a_retried_step_replaces_its_own_row(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    run = _run(c, mid, A)[0]
    with session_scope() as s:
        case_id = s.execute(
            select(ModelTestResult.case_id).where(
                ModelTestResult.run_id == uuid.UUID(run["run_id"])
            )
        ).scalar_one()
    fake["answers"][A] = "Home"
    out = model_tests_run.model_test_case_step(run["run_id"], str(case_id), 1)
    assert out == {"verdict": "fail"}
    with session_scope() as s:
        rows = (
            s.execute(
                select(ModelTestResult).where(ModelTestResult.run_id == uuid.UUID(run["run_id"]))
            )
            .scalars()
            .all()
        )
    assert [(r.verdict, r.answer) for r in rows] == [("fail", "Home")]


def test_a_run_quiet_for_15_minutes_reads_as_failed(client, monkeypatch):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    monkeypatch.setattr(model_tests_run.DBOS, "start_workflow", lambda *a, **k: None)
    run = c.post(f"/api/models/{mid}/runs", json={"models": [A]}).json()["runs"][0]
    assert run["status"] == "running"
    with session_scope() as s:
        s.execute(
            update(ModelTestRun)
            .where(ModelTestRun.id == uuid.UUID(run["run_id"]))
            .values(created_at=datetime.now(UTC) - timedelta(minutes=16))
        )
    stale = c.get(f"/api/models/{mid}/runs/{run['run_id']}").json()
    assert (stale["status"], stale["error_message"]) == (
        "failed",
        "The test run stopped before it finished.",
    )


def test_a_run_that_cant_start_is_failed_at_once(client, monkeypatch):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)

    def broken(*a, **k):
        raise RuntimeError("no")

    monkeypatch.setattr(model_tests_run.DBOS, "start_workflow", broken)
    run = c.post(f"/api/models/{mid}/runs", json={"models": [A]}).json()["runs"][0]
    assert (run["status"], run["error_message"]) == ("failed", "The test run couldn’t start.")


def test_a_model_whose_price_isnt_listed_runs_with_price_known_false(client, fake, monkeypatch):
    monkeypatch.setattr(gateway_core, "price_per_token", lambda m: None)
    c, _ = _account("mistral")
    mid = _choice_model(c)
    _add(c, mid)
    run = _run(c, mid, UNLISTED)[0]
    assert (run["price_known"], run["estimate_usd"]) == (False, None)


# ------------------------------------------------------------------------- no key in DBOS, ever


def test_no_key_reaches_a_workflow_or_a_step(client, fake, monkeypatch):
    c, _ = _account("deepseek", "openai")
    mid = _judged(c)
    fake["answers"][JUDGE] = '{"pass": true, "reason": "ok"}'
    real = model_tests_run.DBOS.start_workflow
    seen = []

    def spy(fn, *args, **kwargs):
        handle = real(fn, *args, **kwargs)
        seen.append((fn.__name__, args, kwargs, handle.get_workflow_id()))
        return handle

    monkeypatch.setattr(model_tests_run.DBOS, "start_workflow", spy)
    _run(c, mid, A)
    name, args, kwargs, workflow_id = seen[0]
    assert name == "run_model_test_workflow"
    assert kwargs == {}
    assert len(args) == 2
    uuid.UUID(args[0])
    assert all(uuid.UUID(i) for i in args[1])
    # What DBOS itself recorded for this workflow: its input, each step's result.
    status = model_tests_run.DBOS.get_workflow_status(workflow_id)
    assert SECRET not in repr((status.input, status.output))
    steps = model_tests_run.DBOS.list_workflow_steps(workflow_id)
    assert [s["function_name"].rsplit(".", 1)[-1] for s in steps] == [
        "model_test_case_step",
        "finish_model_test_run_step",
    ]
    assert steps[0]["output"] == {"verdict": "pass"}
    assert SECRET not in repr(steps)


def test_no_key_in_any_of_the_new_tables(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    run = _run(c, mid, A)[0]
    with session_scope() as s:
        for table in (
            "user_models",
            "model_test_cases",
            "model_test_set_versions",
            "model_test_runs",
            "model_test_results",
        ):
            found = s.execute(
                text(f"SELECT count(*) FROM {table} t WHERE t::text LIKE :k"),
                {"k": f"%{SECRET}%"},
            ).scalar_one()
            assert found == 0, table
    assert SECRET not in json.dumps(run)


def test_the_key_is_resolved_inside_the_step(client, fake, monkeypatch):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    calls = []
    real = credentials.resolve_owner_api_key

    def spy(owner, model):
        calls.append(model)
        return real(owner, model)

    monkeypatch.setattr(credentials, "resolve_owner_api_key", spy)
    _run(c, mid, A)
    assert calls == [A]


# ------------------------------------------------------------------------- reading runs back


def test_last_run_is_per_revision(client, fake):
    c, _ = _account("deepseek", "groq")
    mid = _choice_model(c)
    first = _add(c, mid)["test"]
    _add(c, mid, input="second", expected="Home")
    fake["answers"][B] = "Home"
    _run(c, mid, A)
    _run(c, mid, B)
    view = c.get(f"/api/models/{mid}/tests").json()
    assert [r["model_name"] for r in view["last_runs"]] == ["gpt-oss-120b", "deepseek-chat"]
    assert [t["last_run"] for t in view["tests"]] == [
        [{"verdict": "fail"}, {"verdict": "pass"}],
        [{"verdict": "pass"}, {"verdict": "fail"}],
    ]
    c.put(
        f"/api/models/{mid}/tests/{first['case_key']}", json={"input": "new", "expected": "Motor"}
    )
    after = c.get(f"/api/models/{mid}/tests").json()
    assert [t["last_run"] for t in after["tests"]] == [
        [None, None],
        [{"verdict": "pass"}, {"verdict": "fail"}],
    ]
    assert c.get(f"/api/models/{mid}/tests/{first['case_key']}/results").json()["results"] == []
    # Restoring brings the old revision, and its chips, back.
    c.post(f"/api/models/{mid}/versions/2/restore")
    restored = c.get(f"/api/models/{mid}/tests").json()
    assert restored["tests"][0]["last_run"] == [{"verdict": "fail"}, {"verdict": "pass"}]


def test_a_stopped_run_is_not_a_last_run(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    run = _run(c, mid, A)[0]
    with session_scope() as s:
        s.execute(
            update(ModelTestRun)
            .where(ModelTestRun.id == uuid.UUID(run["run_id"]))
            .values(status="stopped")
        )
    assert c.get(f"/api/models/{mid}/tests").json()["last_runs"] == []


def test_results_are_per_version_with_badges(client, fake):
    c, _ = _account("deepseek", "groq")
    mid = _choice_model(c)
    _add(c, mid)
    _add(c, mid, input="second")
    fake["answers"][B] = lambda r: _reply(r, "Home", cost=0.0001)
    (run_a, run_b) = _run(c, mid, A, B)
    out = c.get(f"/api/models/{mid}/runs").json()
    assert out["version"] == 2
    assert out["best_run_id"] == run_a["run_id"]
    assert out["lowest_cost_run_id"] == run_b["run_id"]
    _add(c, mid, input="third")
    assert c.get(f"/api/models/{mid}/runs").json()["runs"] == []
    now = c.get(f"/api/models/{mid}/runs").json()
    assert now["versions_with_runs"] == [{"version": 2, "runs": 2}]
    older = c.get(f"/api/models/{mid}/runs?version=2").json()
    assert len(older["runs"]) == 2


def test_the_list_card_badges(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    _run(c, mid, A)
    card = c.get("/api/models").json()["models"][0]
    assert card["badge"] == "tested"
    assert card["tested_at"]
    assert [b["model_name"] for b in card["best"]] == ["deepseek-chat"]
    _add(c, mid, input="more")
    card = c.get("/api/models").json()["models"][0]
    assert (card["badge"], card["best"]) == ("changed", [])


def test_pre_checked_is_the_last_runs_models(client, fake):
    c, _ = _account("deepseek", "groq")
    mid = _choice_model(c)
    _add(c, mid)
    assert c.get(f"/api/models/{mid}").json()["pre_checked"]  # the account's default
    _run(c, mid, A, B)
    assert c.get(f"/api/models/{mid}").json()["pre_checked"] == [A, B]


def test_compare_counts_and_rows(client, fake):
    c, _ = _account("deepseek", "groq")
    mid = _choice_model(c)
    _add(c, mid, input="both right", expected="Motor")
    _add(c, mid, input="both wrong", expected="Home")
    _add(c, mid, input="a right", expected="Motor")
    _add(c, mid, input="b right", expected="Home")
    answers = {"both right": "Motor", "both wrong": "Motor", "a right": "**Motor.**"}
    fake["answers"][A] = lambda r: answers.get(r.messages[1]["content"], "Motor")
    fake["answers"][B] = lambda r: {
        "both right": "Motor",
        "both wrong": "Motor",
        "a right": "Home",
        "b right": "Home",
    }[r.messages[1]["content"]]
    run_a, run_b = _run(c, mid, A, B)
    out = c.get(f"/api/models/{mid}/compare?a={run_a['run_id']}&b={run_b['run_id']}").json()
    assert out["counts"] == {
        "total": 4,
        "agree": 2,
        "both_right": 1,
        "both_wrong": 1,
        "only_a": 1,
        "only_b": 1,
    }
    assert [r["differ"] for r in out["rows"]] == [False, False, True, True]
    assert out["rows"][2]["a"]["answer"] == "**Motor.**"  # exactly as the model gave it
    assert out["rows"][2]["a"]["right"] is True


def test_compare_counts_an_error_as_wrong(client, fake):
    c, _ = _account("deepseek", "groq")
    mid = _choice_model(c)
    _add(c, mid)
    _add(c, mid, input="second")
    fake["answers"][B] = lambda r: (
        RuntimeError("boom") if r.messages[1]["content"] == "second" else "Motor"
    )
    run_a, run_b = _run(c, mid, A, B)
    out = c.get(f"/api/models/{mid}/compare?a={run_a['run_id']}&b={run_b['run_id']}").json()
    assert out["counts"]["only_a"] == 1


def test_compare_refuses_other_versions_and_unfinished_runs(client, fake):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    first = _run(c, mid, A)[0]
    _add(c, mid, input="more")
    second = _run(c, mid, A)[0]
    resp = c.get(f"/api/models/{mid}/compare?a={first['run_id']}&b={second['run_id']}")
    assert (resp.status_code, resp.json()["detail"]) == (
        422,
        "Only runs on the same test set version can be compared.",
    )
    third = _run(c, mid, A)[0]
    with session_scope() as s:
        s.execute(
            update(ModelTestRun)
            .where(ModelTestRun.id == uuid.UUID(third["run_id"]))
            .values(status="stopped")
        )
    resp = c.get(f"/api/models/{mid}/compare?a={second['run_id']}&b={third['run_id']}")
    assert (resp.status_code, resp.json()["detail"]) == (
        422,
        "Compare needs two finished runs on this version.",
    )
