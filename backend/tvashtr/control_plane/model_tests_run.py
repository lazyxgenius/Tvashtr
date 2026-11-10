"""Models 1: the cost estimate, the durable runner, stop, the Results tab and compare.

Each chosen model starts one run: its own DBOS workflow, one step per test, then a finishing step
(the pattern of ``domain_eval.run_domain_eval_workflow``). Workflow arguments are ids only and a
step returns only its verdict, so no key ever reaches DBOS's tables: each step resolves the owner's
key itself, uses it for the call and drops it.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from dbos import DBOS
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from tvashtr import gateway
from tvashtr.control_plane import credentials, guardrails, model_tests
from tvashtr.control_plane import model_tests_pure as pure
from tvashtr.control_plane.credentials import held_provider_slugs, provider_for_model
from tvashtr.db import session_scope
from tvashtr.gateway import gateway as gateway_core
from tvashtr.models import ModelTestCase, ModelTestResult, ModelTestRun, UserModel

NEED_MODEL = "Pick at least one model."
TOO_MANY_MODELS = f"Pick up to {pure.MAX_MODELS_PER_RUN} models."
NEED_TESTS = "Add a test first."
RUN_COULD_NOT_START = "The test run couldn’t start."
NOT_SAME_VERSION = "Only runs on the same test set version can be compared."
NEED_TWO_RUNS = "Compare needs two finished runs on this version."
_MAX_ESTIMATE_MODELS = 40
_ANSWER_LIMIT = 20_000
_REASON_LIMIT = 500


class MissingProviders(Exception):
    """The chosen models (or the judges) need keys the account doesn't hold. The route answers 422
    ``missing_providers``."""

    def __init__(self, providers: list[str]) -> None:
        self.providers = providers
        named = ", ".join(providers)
        super().__init__(f"You have no key for: {named}. Add it under Engines first.")


def _clean_models(models: list[str] | None) -> list[str]:
    return list(dict.fromkeys(pure.clean_slug(m) for m in models or []))


def _case_fields(case: ModelTestCase) -> dict:
    return {
        "input": case.input,
        "expected": case.expected,
        "scoring": case.scoring,
        "rubric": case.rubric,
        "judge_model": case.judge_model,
    }


def learned_answer_tokens(
    session, owner_id: uuid.UUID, slug: str, answer_kind: str
) -> float | None:
    """M2 Part B: the mean real answer size of ``slug`` in this account's past test results — pass
    or fail verdicts only, the newest 200, any of the account's models with this kind of answer;
    ``None`` with fewer than five. ``completion_tokens`` includes a thinking model's thinking
    (checked live on Gemini 3 Flash: 128 = 127 reasoning + 1 text, and the cost matches).
    A result whose provider reported no tokens (0) is left out."""
    rows = session.scalars(
        select(ModelTestResult.completion_tokens)
        .join(ModelTestRun, ModelTestRun.id == ModelTestResult.run_id)
        .join(UserModel, UserModel.id == ModelTestRun.model_id)
        .where(
            UserModel.owner_id == owner_id,
            UserModel.answer_kind == answer_kind,
            ModelTestRun.model_slug == slug,
            ModelTestResult.verdict.in_(("pass", "fail")),
            ModelTestResult.completion_tokens > 0,
        )
        .order_by(ModelTestResult.created_at.desc())
        .limit(pure.LEARN_FROM)
    ).all()
    return pure.learned_answer_tokens([int(t) for t in rows])


def _estimate(version, cases: list[dict], slug: str, learned: float | None = None) -> dict:
    row = pure.estimate_model(
        slug,
        version.answer_kind,
        version.job,
        list(version.choices),
        cases,
        gateway_core.count_tokens,
        gateway_core.price_per_token,
        learned_out=learned,
    )
    row["thinks"] = gateway_core.thinks_before_answering(slug)
    return row


def estimate(owner_id: uuid.UUID, model_id: uuid.UUID, models: list[str] | None) -> dict:
    """What running the current tests on each of ``models`` should cost, and the facts behind the
    judge line. The dialog adds up the rows it has ticked."""
    slugs = _clean_models(models)
    if len(slugs) > _MAX_ESTIMATE_MODELS:
        raise ValueError(TOO_MANY_MODELS)
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        version = model_tests.version_row(session, model.id, model.current_version)
        cases = [_case_fields(c) for c in model_tests.cases_of(session, version)]
        if version is None:
            return {"tests": 0, "version": 0, "models": [], "summary": pure.scoring_summary([])}
        return {
            "tests": len(cases),
            "version": version.version,
            "models": [
                _estimate(
                    version,
                    cases,
                    s,
                    learned_answer_tokens(session, owner_id, s, version.answer_kind),
                )
                for s in slugs
            ],
            "summary": pure.scoring_summary(cases),
        }


def start_runs(owner_id: uuid.UUID, model_id: uuid.UUID, models: list[str] | None) -> list[dict]:
    """One run per chosen model, all the current tests. Refused with ``ValueError`` (no tests, no
    model, more than six) or :class:`MissingProviders` (a tested model's or a judge's provider)."""
    slugs = _clean_models(models)
    if not slugs:
        raise ValueError(NEED_MODEL)
    if len(slugs) > pure.MAX_MODELS_PER_RUN:
        raise ValueError(TOO_MANY_MODELS)
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        version = model_tests.version_row(session, model.id, model.current_version)
        rows = model_tests.cases_of(session, version)
        if not rows:
            raise ValueError(NEED_TESTS)
        cases = [_case_fields(c) for c in rows]
        judges = pure.scoring_summary(cases)["judges"]
        needed = {provider_for_model(s) for s in [*slugs, *judges]}
        missing = sorted(needed - held_provider_slugs(owner_id))
        if missing:
            raise MissingProviders(missing)
        case_ids = [str(c.id) for c in rows]
        runs = []
        for slug in slugs:
            guess = _estimate(
                version,
                cases,
                slug,
                learned_answer_tokens(session, owner_id, slug, version.answer_kind),
            )
            runs.append(
                ModelTestRun(
                    model_id=model.id,
                    version_id=version.id,
                    version=version.version,
                    model_slug=slug,
                    cases_total=len(rows),
                    price_known=guess["price_known"] and not guess["unpriced_judges"],
                    estimate_usd=guess["estimate_usd"],
                    started_by=owner_id,
                )
            )
        session.add_all(runs)
        session.flush()
        run_ids = [r.id for r in runs]
    for run_id in run_ids:
        try:
            DBOS.start_workflow(run_model_test_workflow, str(run_id), case_ids)
        except Exception:
            with session_scope() as session:
                row = session.get(ModelTestRun, run_id)
                if row is not None:
                    row.status = "failed"
                    row.error_message = RUN_COULD_NOT_START
                    row.completed_at = datetime.now(UTC)
    with session_scope() as session:
        fresh = session.execute(select(ModelTestRun).where(ModelTestRun.id.in_(run_ids))).scalars()
        return [model_tests.run_view(r, None) for r in fresh]


# ---- One test ----


@dataclass
class _Outcome:
    verdict: str
    reason: str | None = None
    answer: str | None = None
    model_used: str | None = None
    latency_ms: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cost_usd: float = 0.0
    judge_model: str | None = None
    judge_cost_usd: float = 0.0


class _CallFailed(Exception):
    pass


def _first_line(exc: Exception, key: str | None) -> str:
    """The error's first line, never with the key in it (a provider's 401 can echo it)."""
    text = str(exc).strip().split("\n", 1)[0] or type(exc).__name__
    if key:
        text = text.replace(key, "[key]")
    return guardrails.mask_secrets(text)[:_REASON_LIMIT]


def _call(
    owner_id: uuid.UUID,
    slug: str,
    messages: list[dict[str, str]],
    max_tokens: int,
) -> gateway.CompletionResult:
    """One model call on the owner's key. Any failure becomes :class:`_CallFailed`, with its first
    line only; a thinking model's empty response can even raise a bare ``IndexError``."""
    key = None
    try:
        key = credentials.resolve_owner_api_key(owner_id, slug)
        return gateway.complete(
            gateway.CompletionRequest(
                model=slug, messages=messages, temperature=0, max_tokens=max_tokens, api_key=key
            )
        )
    except credentials.NoCredentialError as exc:
        raise _CallFailed(
            f"You have no key for: {exc.provider}. Add it under Engines first."
        ) from exc
    except Exception as exc:  # noqa: BLE001 — any failure is this test's error, never a stuck run
        raise _CallFailed(_first_line(exc, key)) from exc


def _not_the_tested_model(used: str) -> str:
    return f"Answered by {used}, so it isn't counted."


def _run_one(owner_id: uuid.UUID, slug: str, version, case: ModelTestCase) -> _Outcome:
    """Ask the tested model, then score its answer (asking the judge when the test says so)."""
    kind = version.answer_kind
    messages = pure.build_messages(kind, version.job, list(version.choices), case.input)
    try:
        result = _call(owner_id, slug, messages, pure.answer_max_tokens(kind))
    except _CallFailed as exc:
        return _Outcome("error", str(exc))
    out = _Outcome(
        "fail",
        answer=(result.text or "")[:_ANSWER_LIMIT],
        model_used=result.model_used,
        latency_ms=round(result.latency_ms),
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        cost_usd=result.cost_usd,
    )
    answer = result.text or ""
    if result.model_used != slug:
        out.verdict, out.reason = "error", _not_the_tested_model(result.model_used)
    elif not answer.strip():
        out.reason = pure.EMPTY_ANSWER
    elif case.scoring == "exact":
        out.verdict, out.reason = pure.score_exact(answer, case.expected)
    elif case.scoring == "contains":
        out.verdict, out.reason = pure.score_contains(answer, case.must_contain)
    else:
        _ask_judge(owner_id, version, case, answer, out)
    return out


def _ask_judge(
    owner_id: uuid.UUID, version, case: ModelTestCase, answer: str, out: _Outcome
) -> None:
    out.judge_model = case.judge_model
    prompt = pure.judge_prompt(version.job, case.input, case.expected, case.rubric, answer)
    try:
        reply = _call(owner_id, case.judge_model, [{"role": "user", "content": prompt}], 1024)
    except _CallFailed as exc:
        out.verdict, out.reason = "error", str(exc)
        return
    out.judge_cost_usd = reply.cost_usd
    if reply.model_used != case.judge_model:
        out.verdict, out.reason = "error", _not_the_tested_model(reply.model_used)
        return
    parsed = pure.parse_judge_reply(reply.text or "")
    if parsed is None:
        out.verdict, out.reason = "error", pure.JUDGE_UNREADABLE
        return
    out.verdict = "pass" if parsed[0] else "fail"
    out.reason = parsed[1] or None


def _save_result(run_id: uuid.UUID, case: ModelTestCase, position: int, out: _Outcome) -> bool:
    """Upsert the result: a retried step replaces its own row. ``False``: the run was deleted."""
    values = {
        "case_key": case.case_key,
        "position": position,
        "answer": out.answer,
        "verdict": out.verdict,
        "reason": out.reason,
        "model_used": out.model_used,
        "latency_ms": out.latency_ms,
        "prompt_tokens": out.prompt_tokens,
        "completion_tokens": out.completion_tokens,
        "cost_usd": Decimal(str(out.cost_usd or 0)).quantize(Decimal("0.000001")),
        "judge_model": out.judge_model,
        "judge_cost_usd": Decimal(str(out.judge_cost_usd or 0)).quantize(Decimal("0.000001")),
        "created_at": datetime.now(UTC),
    }
    statement = insert(ModelTestResult).values(
        id=uuid.uuid4(), run_id=run_id, case_id=case.id, **values
    )
    try:
        with session_scope() as session:
            session.execute(
                statement.on_conflict_do_update(
                    constraint="uq_model_test_results_run_case", set_=values
                )
            )
    except IntegrityError:
        return False
    return True


@DBOS.step()
def model_test_case_step(run_id: str, case_id: str, position: int) -> dict:
    """One test of one run. Checks the stop flag first; returns only the verdict."""
    rid = uuid.UUID(run_id)
    with session_scope() as session:
        run = session.get(ModelTestRun, rid)
        if run is None or run.stop_requested:
            return {"verdict": "stopped"}
        slug = run.model_slug
        owner_id = session.execute(
            select(UserModel.owner_id).where(UserModel.id == run.model_id)
        ).scalar_one()
        version = model_tests.version_row(session, run.model_id, run.version)
        case = session.get(ModelTestCase, uuid.UUID(case_id))
        session.expunge(version)
        session.expunge(case)
    out = _run_one(owner_id, slug, version, case)
    if not _save_result(rid, case, position, out):
        return {"verdict": "stopped"}
    return {"verdict": out.verdict}


@DBOS.step()
def finish_model_test_run_step(run_id: str) -> dict:
    """Fill the run's totals. Stopped before its last test: ``stopped``; every test an error:
    ``failed`` with the first reason."""
    rid = uuid.UUID(run_id)
    with session_scope() as session:
        run = session.execute(
            select(ModelTestRun).where(ModelTestRun.id == rid).with_for_update()
        ).scalar_one_or_none()
        if run is None:
            return {"status": "gone"}
        t = model_tests._run_tallies(session, [rid]).get(rid, {})
        passed, failed, errors = t.get("pass", 0), t.get("fail", 0), t.get("error", 0)
        done = passed + failed + errors
        run.passed, run.failed, run.errors = passed, failed, errors
        run.cost_usd = t.get("cost", 0.0)
        run.judge_cost_usd = t.get("judge", 0.0)
        timed = t.get("timed", 0)
        run.avg_latency_ms = round(t["latency"] / timed) if timed else None
        if run.stop_requested and done < run.cases_total:
            run.status = "stopped"
        elif errors == done:
            run.status = "failed"
            run.error_message = t.get("first_error") or model_tests.RUN_STOPPED
        else:
            run.status = "completed"
        run.completed_at = datetime.now(UTC)
        return {"status": run.status}


@DBOS.workflow()
def run_model_test_workflow(run_id: str, case_ids: list[str]) -> dict:
    """Every test of one run, one step each, then add up. Ids only: never a key."""
    for position, case_id in enumerate(case_ids, 1):
        if model_test_case_step(run_id, case_id, position)["verdict"] == "stopped":
            break
    return finish_model_test_run_step(run_id)


# ---- Reading runs ----


def _owned_run(session, model_id: uuid.UUID, run_id: uuid.UUID) -> ModelTestRun:
    run = session.execute(
        select(ModelTestRun).where(ModelTestRun.id == run_id, ModelTestRun.model_id == model_id)
    ).scalar_one_or_none()
    if run is None:
        raise LookupError(model_tests.RUN_NOT_FOUND)
    return run


def list_runs(owner_id: uuid.UUID, model_id: uuid.UUID, version: int | None = None) -> dict:
    """A version's runs, newest first, with the badges; and the other versions that have runs."""
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        number = model.current_version if version is None else version
        every = model_tests._model_runs(session, model.id)
        runs = [r for r in every if r["version"] == number]
        best, lowest = pure.pick_badges(runs)
        per_version: dict[int, int] = {}
        for r in every:
            per_version[r["version"]] = per_version.get(r["version"], 0) + 1
        return {
            "version": number,
            "current_version": model.current_version,
            "runs": runs,
            "best_run_id": best,
            "lowest_cost_run_id": lowest,
            "versions_with_runs": [
                {"version": v, "runs": n} for v, n in sorted(per_version.items(), reverse=True)
            ],
        }


def get_run(owner_id: uuid.UUID, model_id: uuid.UUID, run_id: uuid.UUID) -> dict:
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        run = _owned_run(session, model.id, run_id)
        return model_tests.run_view(run, model_tests._run_tallies(session, [run.id]).get(run.id))


def stop_run(owner_id: uuid.UUID, model_id: uuid.UUID, run_id: uuid.UUID) -> dict:
    """Ask the run to stop: it ends as ``stopped`` before its next test (no DBOS cancel)."""
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        run = _owned_run(session, model.id, run_id)
        if run.status == "running":
            run.stop_requested = True
            session.flush()
        return model_tests.run_view(run, model_tests._run_tallies(session, [run.id]).get(run.id))


def compare(owner_id: uuid.UUID, model_id: uuid.UUID, a: uuid.UUID, b: uuid.UUID) -> dict:
    """Two finished runs of one version, test by test. "Agree" = both right or both wrong; an error
    counts as wrong."""
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        run_a = _owned_run(session, model.id, a)
        run_b = _owned_run(session, model.id, b)
        if run_a.version != run_b.version:
            raise ValueError(NOT_SAME_VERSION)
        if run_a.status != "completed" or run_b.status != "completed":
            raise ValueError(NEED_TWO_RUNS)
        version = model_tests.version_row(session, model.id, run_a.version)
        results = session.execute(
            select(ModelTestResult).where(ModelTestResult.run_id.in_([a, b]))
        ).scalars()
        by_key = {(r.run_id, r.case_id): r for r in results}

        def side(run_id: uuid.UUID, case_id: uuid.UUID) -> dict:
            r = by_key.get((run_id, case_id))
            return {
                "answer": r.answer if r else "",
                "verdict": r.verdict if r else "error",
                "reason": r.reason if r else None,
                "right": bool(r and r.verdict == "pass"),
            }

        rows = []
        for position, case in enumerate(model_tests.cases_of(session, version), 1):
            first, second = side(a, case.id), side(b, case.id)
            rows.append(
                {
                    "position": position,
                    "case_key": str(case.case_key),
                    "input": case.input,
                    "expected": case.expected,
                    "a": first,
                    "b": second,
                    "differ": first["right"] != second["right"],
                }
            )
        tallies = model_tests._run_tallies(session, [a, b])
        return {
            "version": run_a.version,
            "a": model_tests.run_view(run_a, tallies.get(a)),
            "b": model_tests.run_view(run_b, tallies.get(b)),
            "counts": pure.compare_counts((r["a"]["right"], r["b"]["right"]) for r in rows),
            "rows": rows,
        }
