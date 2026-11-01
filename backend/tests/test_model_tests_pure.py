"""Models 1: the pure logic — normalising, scoring, judge replies, the exact messages, the cost
estimate, CSV parsing, the badges and the compare counts. No database, no network."""

import pytest

from tvashtr.control_plane import model_tests_pure as pure

CHOICES = ["Motor", "Fraud review"]

# ------------------------------------------------------------------------------- normalising


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("  Motor  ", "motor"),
        ("**Motor**", "motor"),
        ("`Motor`", "motor"),
        ('"Motor"', "motor"),
        ("[Motor]", "motor"),
        ("(Motor)", "motor"),
        ("“Motor”", "motor"),
        ("Motor.", "motor"),
        ("Motor..", "motor."),
        ('"Motor".', "motor"),
        ("**Motor.**", "motor"),
        ("Fraud   \n review", "fraud review"),
        ("FRAUD review", "fraud review"),
        ("", ""),
    ],
)
def test_normalise(raw, want):
    assert pure.normalise(raw) == want


# --------------------------------------------------------------------------------- the scorers


def test_exact_ignores_what_the_rule_ignores():
    assert pure.score_exact(" **fraud   REVIEW.** ", "Fraud review") == ("pass", None)


def test_exact_fails_on_another_answer():
    assert pure.score_exact("Motor", "Fraud review") == ("fail", None)


def test_an_empty_answer_fails_whatever_the_scoring():
    empty = ("fail", "The model gave an empty answer.")
    assert pure.score_exact("  \n ", "Motor") == empty
    assert pure.score_contains("", ["a"]) == empty


def test_contains_needs_every_phrase_ignoring_case_and_whitespace_runs():
    answer = "Product: Mobile app.\nUrgency:   HIGH urgency."
    assert pure.score_contains(answer, ["mobile app", "high urgency"]) == ("pass", None)


def test_contains_names_what_is_missing():
    assert pure.score_contains("the app", ["App", "high urgency"]) == (
        "fail",
        'Missing: "high urgency"',
    )
    assert pure.score_contains("x", ["a", "b"]) == ("fail", 'Missing: "a", "b"')


# ------------------------------------------------------------------------------- judge replies


def test_judge_json_reply():
    assert pure.parse_judge_reply('{"pass": true, "reason": "Names the app."}') == (
        True,
        "Names the app.",
    )


def test_judge_json_inside_prose_and_a_fence():
    reply = 'Here it is:\n```json\n{"pass": false, "reason": "Too low."}\n```'
    assert pure.parse_judge_reply(reply) == (False, "Too low.")


def test_judge_skips_a_brace_that_is_not_json():
    assert pure.parse_judge_reply('{oops} {"pass": true}') == (True, "")


def test_judge_first_word():
    assert pure.parse_judge_reply("PASS - it names the app") == (True, "it names the app")
    assert pure.parse_judge_reply("Fail.") == (False, "")
    assert pure.parse_judge_reply("yes") == (True, "")
    assert pure.parse_judge_reply("**NO**: wrong team") == (False, "wrong team")


@pytest.mark.parametrize("reply", ["", "Maybe it is fine", '{"verdict": true}', '{"pass": "yes"}x'])
def test_judge_unreadable(reply):
    assert pure.parse_judge_reply(reply) is None


def test_judge_reason_is_cut_at_300():
    (_, reason) = pure.parse_judge_reply('{"pass": true, "reason": "' + "x" * 400 + '"}')
    assert reason == "x" * 300


def test_judge_prompt_is_the_fixed_words():
    assert pure.judge_prompt("JOB", "IN", "EXP", "RUB", "ANS") == (
        "You are grading one answer for this job: JOB\n\n"
        "The input:\nIN\n\n"
        "The expected answer:\nEXP\n\n"
        "What a right answer must do:\nRUB\n\n"
        "The answer to grade:\nANS\n\n"
        'Reply with JSON only: {"pass": true or false, "reason": "one short sentence"}'
    )


# -------------------------------------------------------------------------------- the messages


def test_choice_messages_are_exact():
    assert pure.build_messages("choice", "Sort it.", ["A", "B"], "the claim") == [
        {
            "role": "system",
            "content": (
                "Sort it.\n\nReply with exactly one of these choices and nothing else:\n- A\n- B"
            ),
        },
        {"role": "user", "content": "the claim"},
    ]


def test_text_messages_are_exact():
    assert pure.build_messages("text", "Sort it.", [], "the claim") == [
        {"role": "system", "content": "Sort it."},
        {"role": "user", "content": "the claim"},
    ]


def test_max_tokens_leave_room_for_thinking_models():
    assert pure.answer_max_tokens("choice") == 1024
    assert pure.answer_max_tokens("text") == 2048


# --------------------------------------------------------------------------------- the estimate


def _count(model, messages):
    """One token per character, plus 3 per message (so the overhead must not count as answer)."""
    return sum(len(m["content"]) for m in messages) + 3 * len(messages)


def _price(model):
    return {"m/cheap": (1e-6, 2e-6), "j/judge": (3e-6, 4e-6)}.get(model)


def _case(**over):
    return {
        "input": "abc",
        "expected": "Motor",
        "scoring": "exact",
        "rubric": None,
        "judge_model": None,
        **over,
    }


def test_estimate_of_a_choice_test():
    # System: 83 chars + user 3 + 3 per message = 92 in; longest choice 12 + 2 = 14 out.
    out = pure.estimate_model("m/cheap", "choice", "J", CHOICES, [_case()], _count, _price)
    assert out["price_known"] is True
    assert out["estimate_usd"] == pytest.approx(0.00012)
    assert out["model_usd"] == pytest.approx(0.00012)
    assert out["judge_usd"] == 0


def test_estimate_of_a_text_test():
    # System 1 + user 2 + 6 overhead = 9 in; 1.5 x 4 + 20 = 26 out at twice the price.
    case = _case(input="xy", expected="abcd", scoring="contains")
    out = pure.estimate_model("m/cheap", "text", "J", [], [case], _count, _price)
    assert out["estimate_usd"] == pytest.approx(9e-6 + 52e-6)


def test_estimate_adds_the_judge_at_the_judges_own_price():
    case = _case(input="xy", expected="abcd", scoring="judge", rubric="R", judge_model="j/judge")
    out = pure.estimate_model("m/cheap", "text", "J", [], [case], _count, _price)
    judge_in = len(pure.judge_prompt("J", "xy", "abcd", "R", "abcd")) + 3
    assert out["model_usd"] == pytest.approx(61e-6)
    assert out["judge_usd"] == pytest.approx(judge_in * 3e-6 + 60 * 4e-6)
    assert out["estimate_usd"] == pytest.approx(out["model_usd"] + out["judge_usd"])


def test_a_model_with_no_listed_price_has_no_estimate():
    out = pure.estimate_model("m/unknown", "choice", "J", CHOICES, [_case()], _count, _price)
    assert out["price_known"] is False
    assert out["estimate_usd"] is None


def test_a_judge_with_no_listed_price_is_named_and_left_out():
    case = _case(scoring="judge", rubric="R", judge_model="j/unknown")
    out = pure.estimate_model("m/cheap", "text", "J", [], [case], _count, _price)
    assert out["price_known"] is True
    assert out["judge_usd"] == 0
    assert out["unpriced_judges"] == ["j/unknown"]


def test_estimate_line_facts():
    judged = _case(scoring="judge", rubric="R", judge_model="j/judge")
    assert pure.scoring_summary([_case(), _case()]) == {
        "judge_tests": 0,
        "judges": [],
        "uses_exact": True,
        "uses_contains": False,
    }
    assert pure.scoring_summary([_case(scoring="contains"), judged, judged]) == {
        "judge_tests": 2,
        "judges": ["j/judge"],
        "uses_exact": False,
        "uses_contains": True,
    }


# ------------------------------------------------------------------------------- cleaning a test


@pytest.mark.parametrize(
    ("over", "word"),
    [
        ({"input": "  "}, "Write the input first."),
        ({"expected": ""}, "Write the expected answer."),
        ({"scoring": "contains", "must_contain": ["  "]}, pure.NEED_PHRASE),
        ({"scoring": "contains", "must_contain": []}, pure.NEED_PHRASE),
        ({"scoring": "judge", "rubric": " ", "judge_model": "a/b"}, pure.NEED_RUBRIC),
        ({"scoring": "judge", "rubric": "R", "judge_model": ""}, pure.NEED_JUDGE),
        ({"scoring": "judge", "rubric": "R", "judge_model": "nope"}, pure.BAD_SLUG),
        ({"scoring": "wat"}, pure.BAD_SCORING),
    ],
)
def test_clean_case_words_for_a_text_model(over, word):
    fields = {"input": "i", "expected": "e", "scoring": "exact", **over}
    with pytest.raises(ValueError, match=word.replace(".", r"\.")):
        pure.clean_case("text", [], **fields)


def test_clean_case_limits():
    for over in (
        {"input": "x" * 20_001},
        {"expected": "x" * 5_001},
        {"scoring": "contains", "must_contain": ["p"] * 21},
        {"scoring": "contains", "must_contain": ["x" * 201]},
        {"scoring": "judge", "rubric": "x" * 2_001, "judge_model": "a/b"},
    ):
        with pytest.raises(ValueError):
            pure.clean_case("text", [], **{"input": "i", "expected": "e", **over})


def test_clean_case_a_choice_model_only_scores_by_exact_match():
    out = pure.clean_case(
        "choice",
        CHOICES,
        input=" i ",
        expected=" motor ",
        scoring="judge",
        must_contain=["x"],
        rubric="r",
        judge_model="a/b",
    )
    assert out == {
        "input": "i",
        "expected": "Motor",
        "scoring": "exact",
        "must_contain": [],
        "rubric": None,
        "judge_model": None,
    }


def test_clean_case_the_expected_answer_must_be_a_choice():
    with pytest.raises(ValueError, match="The expected answer must be one of the choices."):
        pure.clean_case("choice", CHOICES, input="i", expected="Moto")


def test_clean_case_drops_the_fields_its_scoring_does_not_use():
    out = pure.clean_case(
        "text",
        [],
        input="i",
        expected="e",
        scoring="contains",
        must_contain=[" a ", "", "b"],
        rubric="r",
        judge_model="a/b",
    )
    assert out["must_contain"] == ["a", "b"]
    assert out["rubric"] is None
    assert out["judge_model"] is None


@pytest.mark.parametrize(
    "slug", ["groq/llama-3.3-70b-versatile", "groq/openai/gpt-oss-120b", "vertex_ai/gemini-3"]
)
def test_clean_slug_takes_provider_model(slug):
    assert pure.clean_slug(slug) == slug


@pytest.mark.parametrize("slug", ["", "nope", "/x", "a/", "a b/c", "a/b c", "A!/b"])
def test_clean_slug_refuses_anything_else(slug):
    with pytest.raises(ValueError, match="Type it as provider/model"):
        pure.clean_slug(slug)


# ------------------------------------------------------------------------------- cleaning a model


@pytest.mark.parametrize(
    ("name", "word"),
    [("  ", "Give it a name."), ("x" * 81, "Keep the name under 80 characters.")],
)
def test_clean_name(name, word):
    with pytest.raises(ValueError, match=word):
        pure.clean_name(name)


def test_clean_job():
    assert pure.clean_job(" Sort it. ") == "Sort it."
    with pytest.raises(ValueError, match="Describe the job in one sentence."):
        pure.clean_job(" ")
    with pytest.raises(ValueError):
        pure.clean_job("x" * 501)


@pytest.mark.parametrize(
    ("choices", "word"),
    [
        (["A"], "Add at least two choices."),
        (["A", " "], "Add at least two choices."),
        (["A", "a "], "That choice is already in the list."),
        (["x" * 81, "b"], "Keep each choice under 80 characters."),
        ([str(i) for i in range(51)], "You can have up to 50 choices."),
    ],
)
def test_clean_choices_words(choices, word):
    with pytest.raises(ValueError, match=word):
        pure.clean_choices(choices)


def test_clean_choices_trims():
    assert pure.clean_choices([" A ", "B"]) == ["A", "B"]


# ------------------------------------------------------------------------------------- the CSV


def _csv(text, kind="choice", choices=CHOICES, default_judge=None, existing=0):
    return pure.parse_csv(
        text, answer_kind=kind, choices=choices, default_judge=default_judge, existing=existing
    )


def test_csv_good_choice_rows_and_a_bom():
    rows, errors = _csv("﻿input,expected\nfirst,motor\nsecond,Fraud review\n")
    assert errors == []
    assert [(r["input"], r["expected"], r["scoring"]) for r in rows] == [
        ("first", "Motor", "exact"),
        ("second", "Fraud review", "exact"),
    ]


def test_csv_names_every_bad_row_by_its_line():
    rows, errors = _csv("input,expected\nok,Motor\nbad,Moto\n,Motor\nnext,\n")
    assert rows == []
    assert errors == [
        "Line 3: “Moto” isn't one of the choices.",
        "Line 4: Write the input first.",
        "Line 5: Write the expected answer.",
    ]


def test_csv_line_numbers_count_a_quoted_field_spread_over_lines():
    _, errors = _csv('input,expected\n"two\nlines",Motor\nbad,Moto\n')
    assert errors == ["Line 4: “Moto” isn't one of the choices."]


def test_csv_needs_both_columns():
    assert _csv("input,answer\na,b\n")[1] == ["Line 1: The first row must name input and expected."]
    assert _csv("")[1] == ["Line 1: The first row must name input and expected."]


def test_csv_header_ignores_case_and_spaces_and_blank_rows_are_skipped():
    rows, errors = _csv(" Input , EXPECTED \na,Motor\n,\n\n")
    assert errors == []
    assert len(rows) == 1


def test_csv_choice_models_ignore_the_text_columns():
    rows, errors = _csv("input,expected,scoring,rubric\na,Motor,judge,R\n")
    assert errors == []
    assert rows[0]["scoring"] == "exact"
    assert rows[0]["rubric"] is None


def test_csv_text_model_works_out_the_missing_scoring():
    rows, errors = _csv(
        "input,expected,scoring,must_contain,rubric,judge_model\n"
        "a,e,,one; two,,\n"
        "b,e,,,R,x/y\n"
        "c,e,,,,\n"
        "d,e,contains,w,,\n",
        kind="text",
        choices=[],
    )
    assert errors == []
    assert [r["scoring"] for r in rows] == ["contains", "judge", "exact", "contains"]
    assert rows[0]["must_contain"] == ["one", "two"]
    assert rows[1]["judge_model"] == "x/y"


def test_csv_text_model_default_judge_and_the_words():
    rows, errors = _csv(
        "input,expected,rubric\na,e,R\n", kind="text", choices=[], default_judge="d/j"
    )
    assert errors == []
    assert rows[0]["judge_model"] == "d/j"
    _, errors = _csv(
        "input,expected,scoring,rubric\na,e,judge,R\nb,e,what,\nc,e,contains,\n",
        kind="text",
        choices=[],
    )
    assert errors == [
        "Line 2: Pick a judge model.",
        f"Line 3: {pure.BAD_SCORING}",
        "Line 4: Add at least one word or phrase it must contain.",
    ]


def test_csv_respects_the_cap():
    _, errors = _csv("input,expected\na,Motor\nb,Motor\n", existing=499)
    assert errors == ["You can have up to 500 tests."]


def test_csv_with_no_rows_is_an_error():
    assert _csv("input,expected\n")[1] == ["The file has no tests in it."]


# ---------------------------------------------------------------------- badges, cards, compare


def _run(rid, passed, cost, known=True, status="completed"):
    return {
        "run_id": rid,
        "status": status,
        "passed": passed,
        "total_usd": cost,
        "price_known": known,
    }


def test_badges_best_score_and_lowest_cost():
    runs = [_run("a", 46, 0.21), _run("b", 43, 0.04), _run("c", 41, 0.02)]
    assert pure.pick_badges(runs) == ("a", "c")


def test_badges_a_tie_goes_to_the_lower_cost_and_both_can_sit_on_one_card():
    assert pure.pick_badges([_run("a", 5, 0.2), _run("b", 5, 0.1)]) == ("b", "b")


def test_badges_lowest_cost_needs_two_finished_runs():
    assert pure.pick_badges([_run("a", 5, 0.2), _run("b", 9, 0.1, status="stopped")]) == ("a", None)


def test_badges_skip_unlisted_prices_for_lowest_cost():
    runs = [_run("a", 5, 0.0, known=False), _run("b", 4, 0.1)]
    assert pure.pick_badges(runs) == ("a", "b")


def test_badges_with_nothing_finished():
    assert pure.pick_badges([_run("a", 5, 0.2, status="failed")]) == (None, None)


def test_best_on_your_tests_is_three_finished_runs_best_first():
    runs = [
        _run("a", 1, 0.1),
        _run("b", 3, 0.3),
        _run("c", 3, 0.1),
        _run("d", 2, 0.1),
        _run("e", 9, 0.1, status="running"),
    ]
    assert [r["run_id"] for r in pure.best_runs(runs)] == ["c", "b", "d"]


def test_compare_counts():
    pairs = [(True, True)] * 40 + [(False, False)] * 3 + [(True, False)] * 6 + [(False, True)]
    assert pure.compare_counts(pairs) == {
        "total": 50,
        "agree": 43,
        "both_right": 40,
        "both_wrong": 3,
        "only_a": 6,
        "only_b": 1,
    }
