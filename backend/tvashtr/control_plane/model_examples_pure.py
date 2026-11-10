"""M2 — the example builder's pure checks: no DB, no network.

The source check every example from an agent must pass (the file, the quote, the answer, copies,
room in the plan), the lock rule that keeps tests and training examples apart, the JSONL line a
training example downloads as, the drafting estimate and the pause amount. Every refusal is one
plain sentence an agent (or a person) can act on: :class:`Refused` carries it."""

from __future__ import annotations

import csv
import io
import json
import math
from collections.abc import Callable, Iterable

from tvashtr.control_plane import model_tests_pure as tests_pure

PriceOf = Callable[[str], tuple[float, float] | None]

MAX_TESTS_PER_BATCH = 25
MAX_TRAINING_PER_BATCH = 75
MAX_TRAINING = 2_000
MAX_INPUT = 20_000
MAX_ANSWER = 5_000
QUOTE_MIN, QUOTE_MAX = 20, 600
PHRASES_MIN, PHRASES_MAX = 1, 5
PAUSE_FLOOR = 0.5

# What one seat is allowed per call (the first estimate, before any history): tokens in, tokens out.
READER_ALLOWANCE = (20_000, 2_000)  # once
WRITER_ALLOWANCE = (6_000, 400)  # per example
REVIEWER_ALLOWANCE = (5_000, 200)  # per sampled example

NEED_INPUT = "Write the input."
NEED_ANSWER = "Write the answer."
QUOTE_LENGTH = "A quote must be 20 to 600 characters long."
NEED_PHRASES = "Give 1 to 5 key phrases the answer must contain."
TEST_IS_TRAINING = (
    "This is already a training example, so it can't be a test. Remove it there first."
)
INPUT_TOO_LONG = "The input can be up to 20,000 characters."
ANSWER_TOO_LONG = "The answer can be up to 5,000 characters."

_STRAIGHT = str.maketrans(
    {
        "‘": "'",
        "’": "'",
        "‚": "'",
        "‛": "'",
        "′": "'",
        "“": '"',
        "”": '"',
        "„": '"',
        "‟": '"',
        "″": '"',
        "‐": "-",
        "‑": "-",
        "‒": "-",
        "–": "-",
        "—": "-",
        "―": "-",
        "−": "-",
        " ": " ",
    }
)


class Refused(ValueError):
    """A check said no; ``str()`` is the sentence to show."""


# ---- Normalising ----


def input_key(text: str) -> str:
    """How two inputs are compared: trimmed, whitespace runs collapsed, case ignored."""
    return " ".join((text or "").split()).casefold()


def quote_key(text: str) -> str:
    """How a quote is matched against a file: curly quotes and dashes straightened, whitespace
    collapsed, case ignored."""
    return " ".join((text or "").translate(_STRAIGHT).split()).casefold()


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


# ---- The source check ----


def match_file(name: str, files: list[str], domain: str = "the Domain") -> str:
    """The file ``name`` names among the Domain's ready files (ignoring case)."""
    want = (name or "").strip().casefold()
    for f in files:
        if f.casefold() == want:
            return f
    listed = ", ".join(files) if files else "none yet"
    raise Refused(f"No file named {(name or '').strip()} in {domain}. Its files are: {listed}.")


def check_quote(quote: str, passages: list[str], file: str) -> str:
    """The quote, trimmed, if it is 20–600 characters and appears in the file's stored text: in one
    passage, or across two neighbouring passages joined."""
    quote = (quote or "").strip()
    if not QUOTE_MIN <= len(quote) <= QUOTE_MAX:
        raise Refused(QUOTE_LENGTH)
    if locate_quote(quote, passages) is not None:
        return quote
    raise Refused(f"That quote isn't in {file}. Quote the file's own words exactly.")


def locate_quote(quote: str, passages: list[str]) -> int | None:
    """The index of the passage the quote is in (or starts in, when it runs into the next one)."""
    want = quote_key(quote)
    keys = [quote_key(p) for p in passages]
    for i, key in enumerate(keys):
        if want in key:
            return i
    for i, (a, b) in enumerate(zip(keys, keys[1:], strict=False)):
        if want in f"{a} {b}":
            return i
    return None


def clean_phrases(phrases: Iterable[str] | None) -> list[str]:
    return [" ".join(p.split()) for p in phrases or [] if isinstance(p, str) and p.strip()]


def check_answer(
    kind: str, answer: str, choices: list[str], must_contain: Iterable[str] | None
) -> tuple[str, list[str]]:
    """``(the answer to store, its key phrases)``. A choice model's answer is stored as the choice
    itself (Models 1's exact-match normalising); a text model's carries 1–5 key phrases, each in
    it."""
    answer = (answer or "").strip()
    if not answer:
        raise Refused(NEED_ANSWER)
    if len(answer) > MAX_ANSWER:
        raise Refused(ANSWER_TOO_LONG)
    if kind == "choice":
        want = tests_pure.normalise(answer)
        for c in choices:
            if tests_pure.normalise(c) == want:
                return c, []
        raise Refused("The answer must be one of: " + ", ".join(choices) + ".")
    phrases = clean_phrases(must_contain)
    if not PHRASES_MIN <= len(phrases) <= PHRASES_MAX:
        raise Refused(NEED_PHRASES)
    verdict, _ = tests_pure.score_contains(answer, phrases)
    if verdict != "pass":
        hay = input_key(answer)
        missing = next(p for p in phrases if input_key(p) not in hay)
        raise Refused(f'The answer doesn\'t contain "{missing}". Every key phrase must be in it.')
    return answer, phrases


def check_input(
    input_: str,
    *,
    tests: list[str],
    training: list[str],
    drafts: list[tuple[int, str]],
    but: int | None = None,
) -> str:
    """The input, trimmed, if it isn't empty and isn't a copy of a current test (numbered from 1),
    a current training example, or another draft of this batch (``but`` = the draft itself)."""
    input_ = (input_ or "").strip()
    if not input_:
        raise Refused(NEED_INPUT)
    if len(input_) > MAX_INPUT:
        raise Refused(INPUT_TOO_LONG)
    key = input_key(input_)
    same = next((f"test {i}" for i, t in enumerate(tests, 1) if input_key(t) == key), None)
    same = same or next(
        (f"training example {i}" for i, t in enumerate(training, 1) if input_key(t) == key), None
    )
    same = same or next((f"draft {n}" for n, t in drafts if n != but and input_key(t) == key), None)
    if same:
        raise Refused(f"This is the same as {same}. Write a different case.")
    return input_


def check_room(kind: str, wanted: int, handed_in: int) -> None:
    if handed_in >= wanted:
        asked = (
            _plural(wanted, "test", "tests")
            if kind == "test"
            else _plural(wanted, "training example", "training examples")
        )
        raise Refused(
            f"The plan asked for {asked} and you have handed in {handed_in}. "
            "Remove one to replace it."
        )


# ---- A training example by hand or from a CSV ----

NEED_INPUT_FIRST = "Write the input first."
NOT_A_CHOICE = "The answer must be one of the choices."
CSV_NEEDS_COLUMNS = "Line 1: The first row must name input and answer."
CSV_NO_ROWS = "The file has no training examples in it."


def clean_example(answer_kind: str, choices: list[str], *, input: str | None, answer: str | None):  # noqa: A002
    """One training example as stored, or ``ValueError`` with the product's words. A choice model's
    answer is stored as the choice itself."""
    input_text = (input or "").strip()
    answer_text = (answer or "").strip()
    if not input_text:
        raise ValueError(NEED_INPUT_FIRST)
    if len(input_text) > MAX_INPUT:
        raise ValueError(INPUT_TOO_LONG)
    if not answer_text:
        raise ValueError(NEED_ANSWER)
    if len(answer_text) > MAX_ANSWER:
        raise ValueError(ANSWER_TOO_LONG)
    if answer_kind == "choice":
        want = tests_pure.normalise(answer_text)
        match = next((c for c in choices if tests_pure.normalise(c) == want), None)
        if match is None:
            raise ValueError(NOT_A_CHOICE)
        answer_text = match
    return {"input": input_text, "answer": answer_text}


def parse_training_csv(
    text: str, *, answer_kind: str, choices: list[str]
) -> tuple[list[dict], list[str]]:
    """``(examples, errors)``: all or nothing, as Models 1's test import. An error names the line
    its row starts on (the header is line 1)."""
    reader = csv.reader(io.StringIO(text.removeprefix("\ufeff"), newline=""))
    try:
        header = [h.strip().lower() for h in next(reader, [])]
    except csv.Error:
        return [], [CSV_NEEDS_COLUMNS]
    if "input" not in header or "answer" not in header:
        return [], [CSV_NEEDS_COLUMNS]
    rows: list[dict] = []
    errors: list[str] = []
    line = reader.line_num + 1
    while True:
        try:
            values = next(reader, None)
        except csv.Error as exc:
            errors.append(f"Line {line}: {exc}")
            break
        if values is None:
            break
        started = line
        line = reader.line_num + 1
        if not any(v.strip() for v in values):
            continue
        row = dict(zip(header, values, strict=False))
        answer = row.get("answer", "")
        try:
            if answer_kind == "choice" and row.get("input", "").strip() and answer.strip():
                want = tests_pure.normalise(answer)
                if not any(tests_pure.normalise(c) == want for c in choices):
                    raise ValueError(f"“{answer.strip()}” isn't one of the choices.")
            rows.append(clean_example(answer_kind, choices, input=row.get("input"), answer=answer))
        except ValueError as exc:
            errors.append(f"Line {started}: {exc}")
    if errors:
        return [], errors
    if not rows:
        return [], [CSV_NO_ROWS]
    return rows, []


# ---- The lock rule: an input is a test or a training example, never both ----


def test_lock(input_: str, training: list[str]) -> str | None:
    """Why ``input_`` can't be a test (it is a current training example), or ``None``."""
    key = input_key(input_)
    return TEST_IS_TRAINING if any(input_key(t) == key for t in training) else None


def training_lock(input_: str, tests: list[str]) -> str | None:
    """Why ``input_`` can't be trained on (it matches current test ``n``), or ``None``."""
    key = input_key(input_)
    for n, t in enumerate(tests, 1):
        if input_key(t) == key:
            return f"This matches test {n}, so it can't be trained on."
    return None


# ---- The training download ----


def jsonl_line(system: str, input_: str, answer: str) -> str:
    """One training example as a chat: the exact instruction a test of this model is sent, the
    input, the answer."""
    return json.dumps(
        {
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": input_},
                {"role": "assistant", "content": answer},
            ]
        },
        ensure_ascii=False,
    )


# ---- The drafting estimate ----


def review_sample(n: int) -> int:
    """How many drafts the Reviewer checks: a third, at least five, or all when fewer."""
    return n if n <= 5 else max(5, math.ceil(n / 3))


def first_estimate(
    seats: list[tuple[str, str]],
    tests: int,
    training: int,
    price: PriceOf,
    learned: dict[str, float | None],
) -> dict:
    """What a drafting run should cost from each seat's listed price, before any history. A seat is
    ``(role, slug)`` with role ``reader`` (once), ``writer`` (per example) or ``reviewer`` (per
    sampled example). A learned answer size (Part B) raises a seat's output where it is larger. A
    seat with no listed price is named and left out."""
    n = tests + training
    total = 0.0
    unpriced: list[str] = []
    for role, slug in seats:
        listed = price(slug)
        if listed is None:
            if slug not in unpriced:
                unpriced.append(slug)
            continue
        if role == "writer":
            (tin, tout), times = WRITER_ALLOWANCE, n
        elif role == "reviewer":
            (tin, tout), times = REVIEWER_ALLOWANCE, review_sample(n)
        else:
            (tin, tout), times = READER_ALLOWANCE, 1
        if learned.get(slug) is not None:
            tout = max(tout, learned[slug])
        total += times * (tin * listed[0] + tout * listed[1])
    return {"estimate_usd": total, "unpriced": unpriced}


def history_estimate(n: int, past: list[tuple[float, int]]) -> float | None:
    """``n`` drafts at the mean real cost per draft of past drafting runs ``(cost, drafts)``."""
    cost = sum(c for c, d in past if d > 0)
    drafts = sum(d for _, d in past if d > 0)
    return None if drafts == 0 else n * cost / drafts


def pause_at(estimate: float | None) -> float:
    """The run's budget cap: the larger of $0.50 and 4 x the estimate, up to the next $0.50."""
    raw = max(PAUSE_FLOOR, 4 * (estimate or 0.0))
    return math.ceil(round(raw / PAUSE_FLOOR, 9)) * PAUSE_FLOOR


# ---- The batch bar ----


def _times(n: int) -> str:
    return {1: "once", 2: "twice"}.get(n, f"{n} times")


def reviewer_line(checked: int, sent_back: int, still_flagged: int) -> str:
    """ "Reviewer checked 10, sent back once, then approved" (or "…; 3 still flagged")."""
    if checked == 0:
        return "The Reviewer checked none"
    line = f"Reviewer checked {checked}"
    if sent_back:
        line += f", sent back {_times(sent_back)}"
    if still_flagged:
        return f"{line}; {still_flagged} still flagged"
    return f"{line}, then approved" if sent_back else f"{line} and approved"
