"""M2 Part B — honest model-test estimates. The answer tokens per test are the larger of Models 1's
formula and the mean real answer size of that slug in the account's past test results (pass/fail
only, newest 200, same kind of answer, at least 5). The estimate says when it learned, and whether
the model thinks before it answers. Fixed fake prices and history give exact dollar figures."""

import dataclasses

import pytest
from test_model_tests import _account, _add, _choice_model, _reply, _run, _text_model
from test_model_tests_pure import CHOICES

from tvashtr import gateway
from tvashtr.control_plane import model_tests_pure as pure
from tvashtr.gateway import gateway as gateway_core

SLUG = "deepseek/deepseek-chat"


def _count(model, messages):
    return sum(len(m["content"]) for m in messages) + 3 * len(messages)


def _price(model):
    return {"m/cheap": (1e-6, 2e-6)}.get(model)


def _case(**over):
    return {
        "input": "abc",
        "expected": "Motor",
        "scoring": "exact",
        "rubric": None,
        "judge_model": None,
        **over,
    }


# ------------------------------------------------------------------------------------ pure maths


def test_fewer_than_five_past_answers_teach_nothing():
    assert pure.learned_answer_tokens([100, 200, 300, 400]) is None
    assert pure.learned_answer_tokens([]) is None


def test_the_learned_size_is_the_mean_of_the_past_answers():
    assert pure.learned_answer_tokens([100, 200, 300, 400, 500]) == 300


def test_a_learned_size_larger_than_the_formula_wins():
    # 92 tokens in (as Models 1's choice test); 400 learned out instead of 12 + 2.
    out = pure.estimate_model(
        "m/cheap", "choice", "J", CHOICES, [_case()], _count, _price, learned_out=400
    )
    assert out["estimate_usd"] == pytest.approx(92 * 1e-6 + 400 * 2e-6)  # $0.000892
    assert out["learned"] is True


def test_a_learned_size_smaller_than_the_formula_keeps_the_formula():
    out = pure.estimate_model(
        "m/cheap", "choice", "J", CHOICES, [_case()], _count, _price, learned_out=3
    )
    assert out["estimate_usd"] == pytest.approx(0.00012)
    assert out["learned"] is True


def test_without_history_the_estimate_is_models_ones():
    out = pure.estimate_model("m/cheap", "choice", "J", CHOICES, [_case()], _count, _price)
    assert out["estimate_usd"] == pytest.approx(0.00012)
    assert out["learned"] is False


# ------------------------------------------------------------------------------ gateway helper


def test_litellm_marks_the_thinking_models():
    assert gateway_core.thinks_before_answering("vertex_ai/gemini-3-flash-preview") is True
    assert gateway_core.thinks_before_answering("deepseek/deepseek-chat") is False
    assert gateway_core.thinks_before_answering("made-up/not-a-model") is False


# ------------------------------------------------------------------------------------- the API


@pytest.fixture
def priced(monkeypatch):
    monkeypatch.setattr(gateway_core, "price_per_token", {SLUG: (1e-6, 2e-6)}.get)
    monkeypatch.setattr(
        gateway_core,
        "count_tokens",
        lambda model, messages: sum(len(m["content"]) for m in messages),
    )


@pytest.fixture
def big_answers(monkeypatch):
    """Every answer is "Motor" but reports 400 completion tokens (a model that thinks first)."""

    def complete(request):
        return dataclasses.replace(_reply(request, "Motor"), completion_tokens=400)

    monkeypatch.setattr(gateway, "complete", complete)


def _tokens_in():
    system = "Sort the claim.\n\nReply with exactly one of these choices and nothing else:\n"
    return len(system) + len("- Motor\n- Home") + len("a claim")


def test_the_estimate_learns_from_the_accounts_past_tests(client, priced, big_answers):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    for _ in range(5):
        _add(c, mid)
    before = c.post(f"/api/models/{mid}/estimate", json={"models": [SLUG]}).json()["models"][0]
    assert before["learned"] is False
    assert before["estimate_usd"] == pytest.approx(5 * (_tokens_in() * 1e-6 + 7 * 2e-6))
    _run(c, mid, SLUG)
    after = c.post(f"/api/models/{mid}/estimate", json={"models": [SLUG]}).json()["models"][0]
    assert after["learned"] is True
    assert after["estimate_usd"] == pytest.approx(5 * (_tokens_in() * 1e-6 + 400 * 2e-6))


def test_another_kind_of_answer_teaches_nothing(client, priced, big_answers):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    for _ in range(5):
        _add(c, mid)
    _run(c, mid, SLUG)
    text_mid = _text_model(c)
    _add(c, text_mid, scoring="contains", must_contain=["Motor"])
    row = c.post(f"/api/models/{text_mid}/estimate", json={"models": [SLUG]}).json()["models"][0]
    assert row["learned"] is False


def test_another_account_teaches_nothing(client, priced, big_answers):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    for _ in range(5):
        _add(c, mid)
    _run(c, mid, SLUG)
    other, _ = _account("deepseek")
    other_mid = _choice_model(other)
    _add(other, other_mid)
    row = other.post(f"/api/models/{other_mid}/estimate", json={"models": [SLUG]}).json()
    assert row["models"][0]["learned"] is False


def test_the_estimate_says_whether_a_model_thinks(client, priced):
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid)
    rows = c.post(
        f"/api/models/{mid}/estimate",
        json={"models": [SLUG, "vertex_ai/gemini-3-flash-preview"]},
    ).json()["models"]
    assert [r["thinks"] for r in rows] == [False, True]
