"""M2 — the example builder's pure checks (no DB, no network): the source check (file, quote,
answer, copies, room), the lock rule between tests and training examples, the JSONL lines, the
drafting estimate and the pause amount. Red first (``CHECKS-RED``), then green."""

import json

import pytest

from tvashtr.control_plane import model_examples_pure as ex

CHOICES = ["Motor", "Property", "Health", "Travel", "Fraud review", "Other"]
FILES = ["motor-rules.md", "property-rules.md", "health-travel-fraud.md"]
PASSAGES = [
    "Damage to an insured vehicle caused by another vehicle, whether moving or parked, is\n"
    "handled by the Motor team.",
    "Storm and flood damage to the insured building is handled by the Property team.",
]


# ----------------------------------------------------------------------------------- normalising


def test_an_input_is_compared_trimmed_collapsed_and_ignoring_case():
    assert ex.input_key("  My  Car\n was HIT ") == "my car was hit"


def test_a_quote_is_straightened_and_collapsed():
    assert ex.quote_key("It’s “the”  rule — always") == 'it\'s "the" rule - always'


# -------------------------------------------------------------------------------------- the file


def test_the_file_is_matched_ignoring_case():
    assert ex.match_file("MOTOR-rules.md", FILES) == "motor-rules.md"


def test_an_unknown_file_names_the_domains_files():
    with pytest.raises(ex.Refused) as caught:
        ex.match_file("motor.pdf", FILES, domain="Claims handbook")
    assert str(caught.value) == (
        "No file named motor.pdf in Claims handbook. Its files are: motor-rules.md, "
        "property-rules.md, health-travel-fraud.md."
    )


# ------------------------------------------------------------------------------------- the quote


def test_a_quote_inside_one_passage_is_found():
    ex.check_quote(
        "caused by another vehicle, whether moving or parked", PASSAGES, "motor-rules.md"
    )


def test_a_quote_across_a_line_break_and_with_curly_quotes_is_found():
    ex.check_quote(
        "whether moving or parked, is handled by the Motor team", PASSAGES, "motor-rules.md"
    )


def test_a_quote_spanning_two_neighbouring_passages_is_found():
    ex.check_quote("handled by the Motor team. Storm and flood damage", PASSAGES, "motor-rules.md")


def test_a_quote_that_isnt_in_the_file_is_refused():
    with pytest.raises(ex.Refused) as caught:
        ex.check_quote("Damage by a parked car is always Property.", PASSAGES, "motor-rules.md")
    assert str(caught.value) == (
        "That quote isn't in motor-rules.md. Quote the file's own words exactly."
    )


@pytest.mark.parametrize("quote", ["too short", "x" * 601])
def test_a_quote_must_be_20_to_600_characters(quote):
    with pytest.raises(ex.Refused) as caught:
        ex.check_quote(quote, [quote * 3], "f.md")
    assert str(caught.value) == "A quote must be 20 to 600 characters long."


# ------------------------------------------------------------------------------------ the answer


def test_a_choice_answer_is_stored_as_the_choice_itself():
    assert ex.check_answer("choice", " **fraud REVIEW.** ", CHOICES, []) == ("Fraud review", [])


def test_a_choice_answer_that_isnt_a_choice_is_refused():
    with pytest.raises(ex.Refused) as caught:
        ex.check_answer("choice", "Car", CHOICES, [])
    assert str(caught.value) == (
        "The answer must be one of: Motor, Property, Health, Travel, Fraud review, Other."
    )


def test_a_text_answer_carries_one_to_five_key_phrases_it_contains():
    answer = "Send it to the motor team with high urgency."
    assert ex.check_answer("text", answer, [], [" Motor team ", "high  urgency"]) == (
        answer,
        ["Motor team", "high urgency"],
    )


@pytest.mark.parametrize("phrases", [[], ["a", "b", "c", "d", "e", "f"]])
def test_a_text_answer_needs_one_to_five_key_phrases(phrases):
    with pytest.raises(ex.Refused) as caught:
        ex.check_answer("text", "a b c d e f", [], phrases)
    assert str(caught.value) == "Give 1 to 5 key phrases the answer must contain."


def test_a_key_phrase_missing_from_the_answer_is_refused():
    with pytest.raises(ex.Refused) as caught:
        ex.check_answer("text", "Send it to Motor.", [], ["urgent"])
    assert (
        str(caught.value) == 'The answer doesn\'t contain "urgent". Every key phrase must be in it.'
    )


def test_an_empty_answer_is_refused():
    with pytest.raises(ex.Refused) as caught:
        ex.check_answer("text", "  ", [], ["x"])
    assert str(caught.value) == "Write the answer."


# ------------------------------------------------------------------------------------- the input


def test_an_empty_input_is_refused():
    with pytest.raises(ex.Refused) as caught:
        ex.check_input("  ", tests=[], training=[], drafts=[])
    assert str(caught.value) == "Write the input."


def test_a_copy_of_a_test_names_its_number():
    with pytest.raises(ex.Refused) as caught:
        ex.check_input(
            "my car  was HIT", tests=["a", "b", "My car was hit"], training=[], drafts=[]
        )
    assert str(caught.value) == "This is the same as test 3. Write a different case."


def test_a_copy_of_a_training_example_names_its_number():
    with pytest.raises(ex.Refused) as caught:
        ex.check_input("x y", tests=[], training=[f"t{i}" for i in range(11)] + ["X  Y"], drafts=[])
    assert str(caught.value) == "This is the same as training example 12. Write a different case."


def test_a_copy_of_another_draft_names_its_number():
    with pytest.raises(ex.Refused) as caught:
        ex.check_input("x y", tests=[], training=[], drafts=[(4, "x y")])
    assert str(caught.value) == "This is the same as draft 4. Write a different case."


def test_the_same_draft_isnt_its_own_copy():
    ex.check_input("x y", tests=[], training=[], drafts=[(4, "x y")], but=4)


# -------------------------------------------------------------------------------------- the room


def test_a_full_plan_refuses_one_more():
    with pytest.raises(ex.Refused) as caught:
        ex.check_room("test", wanted=4, handed_in=4)
    assert str(caught.value) == (
        "The plan asked for 4 tests and you have handed in 4. Remove one to replace it."
    )
    with pytest.raises(ex.Refused) as caught:
        ex.check_room("training", wanted=1, handed_in=1)
    assert str(caught.value) == (
        "The plan asked for 1 training example and you have handed in 1. Remove one to replace it."
    )


def test_room_left_is_fine():
    ex.check_room("training", wanted=6, handed_in=5)


# ---------------------------------------------------------------------------------- the lock rule


def test_a_test_that_is_a_training_example_is_refused():
    assert ex.test_lock("My car", training=["other", " my  CAR "]) == (
        "This is already a training example, so it can't be a test. Remove it there first."
    )
    assert ex.test_lock("My car", training=["other"]) is None


def test_a_training_example_that_is_a_test_names_the_test():
    assert ex.training_lock("my car", tests=["a", "My Car"]) == (
        "This matches test 2, so it can't be trained on."
    )
    assert ex.training_lock("my car", tests=["a"]) is None


# ------------------------------------------------------------------------------- the JSONL lines


def test_a_jsonl_line_is_the_test_instruction_then_the_input_then_the_answer():
    line = ex.jsonl_line("SYSTEM TEXT", "the input", "Motor")
    assert json.loads(line) == {
        "messages": [
            {"role": "system", "content": "SYSTEM TEXT"},
            {"role": "user", "content": "the input"},
            {"role": "assistant", "content": "Motor"},
        ]
    }
    assert "\n" not in line


# ------------------------------------------------------------------------------- the estimate


def _price(slug):
    return {"r/m": (1e-6, 2e-6), "w/m": (2e-6, 4e-6), "v/m": (1e-6, 1e-6)}.get(slug)


SEATS = [("reader", "r/m"), ("writer", "w/m"), ("reviewer", "v/m")]


def test_the_review_sample_is_a_third_at_least_five_or_all():
    assert [ex.review_sample(n) for n in (0, 3, 5, 10, 15, 30, 31)] == [0, 3, 5, 5, 5, 10, 11]


def test_a_first_estimate_uses_the_listed_prices_and_fixed_allowances():
    out = ex.first_estimate(SEATS, tests=4, training=6, price=_price, learned={})
    reader = 20_000 * 1e-6 + 2_000 * 2e-6  # 0.024
    writer = 10 * (6_000 * 2e-6 + 400 * 4e-6)  # 0.136
    reviewer = 5 * (5_000 * 1e-6 + 200 * 1e-6)  # 0.026
    assert out["estimate_usd"] == pytest.approx(reader + writer + reviewer)  # $0.186
    assert out["unpriced"] == []


def test_a_learned_answer_size_raises_a_seats_output():
    out = ex.first_estimate(SEATS, tests=4, training=6, price=_price, learned={"w/m": 900.0})
    reader = 20_000 * 1e-6 + 2_000 * 2e-6
    writer = 10 * (6_000 * 2e-6 + 900 * 4e-6)
    reviewer = 5 * (5_000 * 1e-6 + 200 * 1e-6)
    assert out["estimate_usd"] == pytest.approx(reader + writer + reviewer)


def test_a_seat_with_no_listed_price_is_named_and_left_out():
    out = ex.first_estimate([("writer", "x/unlisted"), ("reader", "r/m")], 1, 0, _price, {})
    assert out["unpriced"] == ["x/unlisted"]
    assert out["estimate_usd"] == pytest.approx(20_000 * 1e-6 + 2_000 * 2e-6)


def test_an_estimate_from_history_is_the_mean_cost_per_draft():
    # Two runs: $0.08 for 30 drafts and $0.04 for 10 -> $0.003 a draft.
    assert ex.history_estimate(10, [(0.08, 30), (0.04, 10)]) == pytest.approx(0.03)
    assert ex.history_estimate(10, []) is None
    assert ex.history_estimate(10, [(0.0, 0)]) is None


@pytest.mark.parametrize(
    ("estimate", "pause"),
    [(0.0, 0.5), (0.09, 0.5), (0.125, 0.5), (0.13, 1.0), (0.186, 1.0), (0.3, 1.5), (None, 0.5)],
)
def test_the_pause_amount_is_four_times_the_estimate_rounded_up_to_fifty_cents(estimate, pause):
    assert ex.pause_at(estimate) == pause


# -------------------------------------------------------------------------- the Reviewer's line


@pytest.mark.parametrize(
    ("checked", "sent_back", "flagged", "approved", "line"),
    [
        (10, 0, 0, True, "Reviewer checked 10 and approved"),
        (10, 1, 1, True, "Reviewer checked 10, sent back once, then approved"),
        (10, 2, 3, False, "Reviewer checked 10, sent back twice; 3 still flagged"),
        (10, 2, 0, True, "Reviewer checked 10, sent back twice, then approved"),
        (8, 0, 1, False, "Reviewer checked 8; 1 still flagged"),
        (6, 2, 0, False, "Reviewer checked 6, sent back twice; none still flagged"),
        (0, 0, 0, False, "The Reviewer checked none"),
    ],
)
def test_the_reviewers_line(checked, sent_back, flagged, approved, line):
    assert ex.reviewer_line(checked, sent_back, flagged, approved) == line


# --------------------------------------------------------------- training examples by hand / CSV


def test_the_quote_is_located_in_its_passage():
    assert ex.locate_quote("Storm and flood damage to the insured", PASSAGES) == 1
    assert ex.locate_quote("handled by the Motor team. Storm and flood", PASSAGES) == 0
    assert ex.locate_quote("not in the file at all, really", PASSAGES) is None


def test_a_training_example_is_cleaned():
    assert ex.clean_example("choice", CHOICES, input=" a  claim ", answer="motor") == {
        "input": "a  claim",
        "answer": "Motor",
    }
    assert ex.clean_example("text", [], input="q", answer=" an answer ") == {
        "input": "q",
        "answer": "an answer",
    }


@pytest.mark.parametrize(
    ("kind", "input_", "answer", "message"),
    [
        ("text", " ", "a", "Write the input first."),
        ("text", "q", "", "Write the answer."),
        ("choice", "q", "Car", "The answer must be one of the choices."),
    ],
)
def test_a_bad_training_example_is_refused(kind, input_, answer, message):
    with pytest.raises(ValueError) as caught:
        ex.clean_example(kind, CHOICES, input=input_, answer=answer)
    assert str(caught.value) == message


def test_a_training_csv_is_all_or_nothing_with_line_numbers():
    text = "input,answer\nfirst,Motor\n,Motor\nthird,Car\n"
    rows, errors = ex.parse_training_csv(text, answer_kind="choice", choices=CHOICES)
    assert rows == []
    assert errors == ["Line 3: Write the input first.", "Line 4: “Car” isn't one of the choices."]


def test_a_good_training_csv_reads_every_row():
    text = "﻿Input,Answer\nfirst,motor\n\nsecond,Other\n"
    rows, errors = ex.parse_training_csv(text, answer_kind="choice", choices=CHOICES)
    assert errors == []
    assert rows == [{"input": "first", "answer": "Motor"}, {"input": "second", "answer": "Other"}]


def test_a_training_csv_needs_input_and_answer_columns():
    rows, errors = ex.parse_training_csv("input,expected\na,b\n", answer_kind="text", choices=[])
    assert (rows, errors) == ([], ["Line 1: The first row must name input and answer."])
