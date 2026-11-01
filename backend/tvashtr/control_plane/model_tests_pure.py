"""Models 1: the pure logic of model tests. No database, no network, no key.

Normalising and scoring an answer, reading a judge's reply, the exact messages a tested model is
sent, the cost estimate (the token counter and the price list are passed in), cleaning what a
customer typed, parsing a CSV, the score cards' badges and the compare counts. The words here are
the product's; the routes send them as they are.
"""

import csv
import io
import json
import math
import re
from collections.abc import Callable, Iterable

from tvashtr.control_plane.credentials import validate_provider_slug

MAX_TESTS = 500
MAX_CHOICES = 50
MAX_MODELS_PER_RUN = 6

NEED_NAME = "Give it a name."
NEED_JOB = "Describe the job in one sentence."
NEED_CHOICES = "Add at least two choices."
DUPLICATE_CHOICE = "That choice is already in the list."
NEED_INPUT = "Write the input first."
NEED_EXPECTED = "Write the expected answer."
NOT_A_CHOICE = "The expected answer must be one of the choices."
NEED_PHRASE = "Add at least one word or phrase it must contain."
NEED_RUBRIC = "Say what a right answer must do."
NEED_JUDGE = "Pick a judge model."
TOO_MANY_TESTS = "You can have up to 500 tests."
BAD_SLUG = "Type it as provider/model, like groq/llama-3.3-70b-versatile."
BAD_SCORING = "Scoring must be exact, contains or judge."
EMPTY_ANSWER = "The model gave an empty answer."
JUDGE_UNREADABLE = "The judge's reply couldn't be read."
CSV_NEEDS_COLUMNS = "Line 1: The first row must name input and expected."
CSV_NO_ROWS = "The file has no tests in it."

_SURROUND = "\"'`*[](){}“”‘’ \t\r\n"
_REASON_LIMIT = 300
_ANSWER_WORDS = {"pass": True, "yes": True, "fail": False, "no": False}

Verdict = tuple[str, str | None]
CountTokens = Callable[[str, list[dict[str, str]]], int]
PriceOf = Callable[[str], tuple[float, float] | None]


# ---- Normalising and scoring ----


def _collapse(text: str) -> str:
    return " ".join(text.split()).casefold()


def normalise(text: str) -> str:
    """Trim; strip surrounding quotes, backticks, asterisks and brackets; drop one final full stop;
    collapse runs of whitespace; ignore case."""
    out = text.strip(_SURROUND)
    if out.endswith("."):
        out = out[:-1].strip(_SURROUND)
    return _collapse(out)


def score_exact(answer: str, expected: str) -> Verdict:
    if not answer.strip():
        return "fail", EMPTY_ANSWER
    return ("pass", None) if normalise(answer) == normalise(expected) else ("fail", None)


def score_contains(answer: str, phrases: Iterable[str]) -> Verdict:
    if not answer.strip():
        return "fail", EMPTY_ANSWER
    hay = _collapse(answer)
    missing = [p for p in phrases if _collapse(p) not in hay]
    if missing:
        return "fail", "Missing: " + ", ".join(f'"{p}"' for p in missing)
    return "pass", None


def judge_prompt(job: str, input_: str, expected: str, rubric: str, answer: str) -> str:
    return (
        f"You are grading one answer for this job: {job}\n\n"
        f"The input:\n{input_}\n\n"
        f"The expected answer:\n{expected}\n\n"
        f"What a right answer must do:\n{rubric}\n\n"
        f"The answer to grade:\n{answer}\n\n"
        'Reply with JSON only: {"pass": true or false, "reason": "one short sentence"}'
    )


def _first_json_object(text: str) -> dict | None:
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text):
        try:
            value, _ = decoder.raw_decode(text, match.start())
        except ValueError:
            continue
        if isinstance(value, dict):
            return value
    return None


def parse_judge_reply(reply: str) -> tuple[bool, str] | None:
    """``(passed, reason)``: the first JSON object, else a first word PASS/FAIL (YES/NO); ``None``
    when neither reads."""
    found = _first_json_object(reply)
    if found is not None:
        if not isinstance(found.get("pass"), bool):
            return None
        return found["pass"], str(found.get("reason") or "").strip()[:_REASON_LIMIT]
    word = re.match(r"\W*(\w+)\W*", reply)
    if word is None or word.group(1).lower() not in _ANSWER_WORDS:
        return None
    return _ANSWER_WORDS[word.group(1).lower()], reply[word.end() :].strip()[:_REASON_LIMIT]


# ---- What a tested model is sent ----


def build_messages(
    answer_kind: str, job: str, choices: list[str], input_: str
) -> list[dict[str, str]]:
    system = job
    if answer_kind == "choice":
        listed = "\n".join(f"- {c}" for c in choices)
        system = f"{job}\n\nReply with exactly one of these choices and nothing else:\n{listed}"
    return [{"role": "system", "content": system}, {"role": "user", "content": input_}]


def answer_max_tokens(answer_kind: str) -> int:
    return 1024 if answer_kind == "choice" else 2048


# ---- The cost estimate ----


def _tokens(count: CountTokens, model: str, text: str) -> int:
    """The tokens of one text alone: a counter adds its overhead per message, an answer has none."""
    message = {"role": "user", "content": text}
    return max(0, count(model, [message]) - count(model, [{"role": "user", "content": ""}]))


def estimate_model(
    slug: str,
    answer_kind: str,
    job: str,
    choices: list[str],
    cases: list[dict],
    count: CountTokens,
    price: PriceOf,
) -> dict:
    """What running ``cases`` on one model should cost. Prompt tokens = the exact messages; answer
    tokens = choice: the longest choice + 2, text: 1.5 x the expected answer's tokens + 20. A judge
    test adds the judge prompt (the expected answer standing in for the answer) + 60 output tokens
    at the judge's own price. An unlisted model has no estimate; an unlisted judge is named."""
    listed = price(slug)
    if listed is None:
        return {
            "model": slug,
            "price_known": False,
            "estimate_usd": None,
            "model_usd": None,
            "judge_usd": None,
            "unpriced_judges": [],
        }
    longest = max((_tokens(count, slug, c) for c in choices), default=0)
    model_usd = 0.0
    judge_usd = 0.0
    unpriced: list[str] = []
    for case in cases:
        messages = build_messages(answer_kind, job, choices, case["input"])
        out_tokens = (
            longest + 2
            if answer_kind == "choice"
            else 1.5 * _tokens(count, slug, case["expected"]) + 20
        )
        model_usd += count(slug, messages) * listed[0] + out_tokens * listed[1]
        if case["scoring"] != "judge":
            continue
        judge = case["judge_model"]
        judge_price = price(judge)
        if judge_price is None:
            if judge not in unpriced:
                unpriced.append(judge)
            continue
        prompt = judge_prompt(
            job, case["input"], case["expected"], case["rubric"], case["expected"]
        )
        tokens = count(judge, [{"role": "user", "content": prompt}])
        judge_usd += tokens * judge_price[0] + 60 * judge_price[1]
    return {
        "model": slug,
        "price_known": True,
        "estimate_usd": model_usd + judge_usd,
        "model_usd": model_usd,
        "judge_usd": judge_usd,
        "unpriced_judges": unpriced,
    }


def scoring_summary(cases: list[dict]) -> dict:
    """The facts behind the estimate's judge line."""
    judges: list[str] = []
    for case in cases:
        if case["scoring"] == "judge" and case["judge_model"] not in judges:
            judges.append(case["judge_model"])
    return {
        "judge_tests": sum(1 for c in cases if c["scoring"] == "judge"),
        "judges": judges,
        "uses_exact": any(c["scoring"] == "exact" for c in cases),
        "uses_contains": any(c["scoring"] == "contains" for c in cases),
    }


# ---- Cleaning what a customer typed ----


def clean_name(name: str | None) -> str:
    out = (name or "").strip()
    if not out:
        raise ValueError(NEED_NAME)
    if len(out) > 80:
        raise ValueError("Keep the name under 80 characters.")
    return out


def clean_job(job: str | None) -> str:
    out = (job or "").strip()
    if not out:
        raise ValueError(NEED_JOB)
    if len(out) > 500:
        raise ValueError("Keep the job under 500 characters.")
    return out


def clean_choices(choices: list[str] | None) -> list[str]:
    out = [c.strip() for c in choices or [] if c.strip()]
    if len(out) < 2:
        raise ValueError(NEED_CHOICES)
    if len(out) > MAX_CHOICES:
        raise ValueError(f"You can have up to {MAX_CHOICES} choices.")
    if any(len(c) > 80 for c in out):
        raise ValueError("Keep each choice under 80 characters.")
    if len({c.casefold() for c in out}) != len(out):
        raise ValueError(DUPLICATE_CHOICE)
    return out


def clean_slug(slug: str | None) -> str:
    """A ``provider/model`` slug, or ``ValueError(BAD_SLUG)``."""
    out = (slug or "").strip()
    provider, separator, model = out.partition("/")
    if not separator or not model or re.search(r"\s", out):
        raise ValueError(BAD_SLUG)
    try:
        canonical = validate_provider_slug(provider)
    except ValueError as exc:
        raise ValueError(BAD_SLUG) from exc
    if canonical != provider:
        raise ValueError(BAD_SLUG)
    return out


def clean_case(
    answer_kind: str,
    choices: list[str],
    *,
    input: str | None,  # noqa: A002 — the product's word for it
    expected: str | None,
    scoring: str | None = None,
    must_contain: list[str] | None = None,
    rubric: str | None = None,
    judge_model: str | None = None,
) -> dict:
    """One test as it is stored, or ``ValueError`` with the product's words. A choice model always
    scores by exact match against one of its choices; a text model keeps only what its way of
    scoring uses."""
    input_text = (input or "").strip()
    expected_text = (expected or "").strip()
    if not input_text:
        raise ValueError(NEED_INPUT)
    if len(input_text) > 20_000:
        raise ValueError("Keep the input under 20,000 characters.")
    if not expected_text:
        raise ValueError(NEED_EXPECTED)
    if len(expected_text) > 5_000:
        raise ValueError("Keep the expected answer under 5,000 characters.")
    out = {
        "input": input_text,
        "expected": expected_text,
        "scoring": "exact",
        "must_contain": [],
        "rubric": None,
        "judge_model": None,
    }
    if answer_kind == "choice":
        match = next((c for c in choices if c.casefold() == expected_text.casefold()), None)
        if match is None:
            raise ValueError(NOT_A_CHOICE)
        out["expected"] = match
        return out
    way = scoring or "contains"
    if way not in ("exact", "contains", "judge"):
        raise ValueError(BAD_SCORING)
    out["scoring"] = way
    if way == "contains":
        phrases = [p.strip() for p in must_contain or [] if p.strip()]
        if not phrases:
            raise ValueError(NEED_PHRASE)
        if len(phrases) > 20:
            raise ValueError("You can list up to 20 words or phrases.")
        if any(len(p) > 200 for p in phrases):
            raise ValueError("Keep each word or phrase under 200 characters.")
        out["must_contain"] = phrases
    elif way == "judge":
        rule = (rubric or "").strip()
        if not rule:
            raise ValueError(NEED_RUBRIC)
        if len(rule) > 2_000:
            raise ValueError("Keep what a right answer must do under 2,000 characters.")
        if not (judge_model or "").strip():
            raise ValueError(NEED_JUDGE)
        out["rubric"] = rule
        out["judge_model"] = clean_slug(judge_model)
    return out


# ---- The CSV ----


def _csv_row(
    row: dict[str, str], answer_kind: str, choices: list[str], default_judge: str | None
) -> dict:
    expected = row.get("expected", "")
    if answer_kind == "choice":
        if row.get("input", "").strip() and expected.strip():
            if not any(c.casefold() == expected.strip().casefold() for c in choices):
                raise ValueError(f"“{expected.strip()}” isn't one of the choices.")
        return clean_case(answer_kind, choices, input=row.get("input"), expected=expected)
    phrases = [p for p in row.get("must_contain", "").split(";")]
    rubric = row.get("rubric", "").strip()
    scoring = row.get("scoring", "").strip().lower()
    if not scoring:
        has_phrases = any(p.strip() for p in phrases)
        scoring = "contains" if has_phrases else "judge" if rubric else "exact"
    return clean_case(
        answer_kind,
        choices,
        input=row.get("input"),
        expected=expected,
        scoring=scoring,
        must_contain=phrases,
        rubric=rubric,
        judge_model=row.get("judge_model", "").strip() or default_judge,
    )


def parse_csv(
    text: str,
    *,
    answer_kind: str,
    choices: list[str],
    default_judge: str | None,
    existing: int,
) -> tuple[list[dict], list[str]]:
    """``(tests, errors)``: all or nothing, so any error means no tests. An error names the line its
    row starts on (the header is line 1)."""
    reader = csv.reader(io.StringIO(text.removeprefix("﻿"), newline=""))
    try:
        header = [h.strip().lower() for h in next(reader, [])]
    except csv.Error:
        return [], [CSV_NEEDS_COLUMNS]
    if "input" not in header or "expected" not in header:
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
        try:
            rows.append(_csv_row(row, answer_kind, choices, default_judge))
        except ValueError as exc:
            errors.append(f"Line {started}: {exc}")
    if errors:
        return [], errors
    if not rows:
        return [], [CSV_NO_ROWS]
    if existing + len(rows) > MAX_TESTS:
        return [], [TOO_MANY_TESTS]
    return rows, []


# ---- Score cards and compare ----


def _rank(run: dict) -> tuple[int, float]:
    """Best score first; on a tie the lower cost, an unlisted cost last."""
    cost = run["total_usd"] if run["price_known"] else math.inf
    return -run["passed"], cost


def best_runs(runs: list[dict], limit: int = 3) -> list[dict]:
    """The finished runs, best first ("Best on your tests")."""
    return sorted((r for r in runs if r["status"] == "completed"), key=_rank)[:limit]


def pick_badges(runs: list[dict]) -> tuple[str | None, str | None]:
    """``(best score run, lowest cost run)`` among the finished runs. Lowest cost needs two or more
    finished runs and a listed price."""
    done = [r for r in runs if r["status"] == "completed"]
    if not done:
        return None, None
    best = min(done, key=_rank)["run_id"]
    priced = [r for r in done if r["price_known"]]
    if len(done) < 2 or not priced:
        return best, None
    return best, min(priced, key=lambda r: r["total_usd"])["run_id"]


def compare_counts(pairs: Iterable[tuple[bool, bool]]) -> dict[str, int]:
    """``pairs`` = (A right, B right) per test. "Agree" = both right or both wrong."""
    both_right = both_wrong = only_a = only_b = 0
    for a, b in pairs:
        if a and b:
            both_right += 1
        elif a:
            only_a += 1
        elif b:
            only_b += 1
        else:
            both_wrong += 1
    return {
        "total": both_right + both_wrong + only_a + only_b,
        "agree": both_right + both_wrong,
        "both_right": both_right,
        "both_wrong": both_wrong,
        "only_a": only_a,
        "only_b": only_b,
    }
