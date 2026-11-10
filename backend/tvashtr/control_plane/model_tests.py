"""Models 1: a customer's models, their versioned test sets, and reading runs back.

A model is one job. Every save of its tests makes a new, immutable test set version; a test's
revision (``model_test_cases``) is immutable too, so an unchanged test is the same row in every
version and earlier results stay tied to what they ran. Running the tests lives in
``model_tests_run``; the pure rules live in ``model_tests_pure``.

Every function is owner-scoped: another account's model answers ``LookupError("model not found")``.
``ValueError`` carries the product's words for a 422.
"""

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import PurePath

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tvashtr.control_plane import model_tests_pure as pure
from tvashtr.control_plane.credentials import held_provider_slugs, provider_for_model
from tvashtr.control_plane.teams import PROVIDER_CATALOGUE, account_default_model
from tvashtr.db import session_scope
from tvashtr.models import (
    ModelTestCase,
    ModelTestResult,
    ModelTestRun,
    ModelTestSetVersion,
    UserModel,
)

MODEL_NOT_FOUND = "model not found"
TEST_NOT_FOUND = "test not found"
VERSION_NOT_FOUND = "version not found"
RUN_NOT_FOUND = "run not found"
NAME_TAKEN = "That name is taken. Pick another."
# A run still "running" with no new result for this long lost its workflow (DBOS only recovers
# workflows of its own application version, so a deploy mid-run leaves such a run behind).
RUN_STALE_AFTER = timedelta(minutes=15)
RUN_STOPPED = "The test run stopped before it finished."


# ---- Loading ----


def owned_model(
    session: Session, owner_id: uuid.UUID, model_id: uuid.UUID, *, lock: bool = False
) -> UserModel:
    query = select(UserModel).where(UserModel.id == model_id, UserModel.owner_id == owner_id)
    if lock:
        query = query.with_for_update()
    model = session.execute(query).scalar_one_or_none()
    if model is None:
        raise LookupError(MODEL_NOT_FOUND)
    return model


def version_row(session: Session, model_id: uuid.UUID, version: int) -> ModelTestSetVersion | None:
    return session.execute(
        select(ModelTestSetVersion).where(
            ModelTestSetVersion.model_id == model_id, ModelTestSetVersion.version == version
        )
    ).scalar_one_or_none()


def cases_of(session: Session, version: ModelTestSetVersion | None) -> list[ModelTestCase]:
    """A version's test revisions, in its order."""
    if version is None or not version.case_ids:
        return []
    ids = [uuid.UUID(i) for i in version.case_ids]
    rows = session.execute(select(ModelTestCase).where(ModelTestCase.id.in_(ids))).scalars().all()
    by_id = {r.id: r for r in rows}
    return [by_id[i] for i in ids]


def _new_version(
    session: Session, model: UserModel, case_ids: list[uuid.UUID | str], note: str, user: uuid.UUID
) -> ModelTestSetVersion:
    """The next version, snapshotting what the model sees. The caller holds the model's row lock."""
    model.current_version += 1
    row = ModelTestSetVersion(
        model_id=model.id,
        version=model.current_version,
        job=model.job,
        answer_kind=model.answer_kind,
        choices=list(model.choices),
        case_ids=[str(i) for i in case_ids],
        change_note=note,
        created_by=user,
    )
    session.add(row)
    session.flush()
    return row


# ---- The views ----


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def provider_label(slug: str) -> str:
    provider = provider_for_model(slug)
    entry = PROVIDER_CATALOGUE.get(provider)
    return entry["label"] if entry else provider.capitalize()


def _run_tallies(session: Session, run_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """Per run: the verdict counts, the costs, the mean latency, the first error and the last
    result's time, added up from its results."""
    tallies: dict[uuid.UUID, dict] = {}
    if not run_ids:
        return tallies
    rows = session.execute(
        select(
            ModelTestResult.run_id,
            ModelTestResult.verdict,
            func.count(),
            func.sum(ModelTestResult.cost_usd),
            func.sum(ModelTestResult.judge_cost_usd),
            func.sum(ModelTestResult.latency_ms),
            func.count(ModelTestResult.latency_ms),
            func.max(ModelTestResult.created_at),
        )
        .where(ModelTestResult.run_id.in_(run_ids))
        .group_by(ModelTestResult.run_id, ModelTestResult.verdict)
    ).all()
    for run_id, verdict, n, cost, judge, latency, timed, last in rows:
        t = tallies.setdefault(
            run_id,
            {
                "pass": 0,
                "fail": 0,
                "error": 0,
                "cost": 0.0,
                "judge": 0.0,
                "latency": 0,
                "timed": 0,
                "last": None,
                "first_error": None,
            },
        )
        t[verdict] = int(n)
        t["cost"] += float(cost or 0)
        t["judge"] += float(judge or 0)
        t["latency"] += int(latency or 0)
        t["timed"] += int(timed or 0)
        t["last"] = max(t["last"], last) if t["last"] else last
    errored = [r for r, t in tallies.items() if t["error"]]
    if errored:
        firsts = session.execute(
            select(ModelTestResult.run_id, ModelTestResult.reason)
            .where(ModelTestResult.run_id.in_(errored), ModelTestResult.verdict == "error")
            .order_by(ModelTestResult.run_id, ModelTestResult.position)
            .distinct(ModelTestResult.run_id)
        ).all()
        for run_id, reason in firsts:
            tallies[run_id]["first_error"] = reason
    return tallies


def run_view(run: ModelTestRun, tally: dict | None) -> dict:
    """One run for a score card. A run still ``running`` with no new result for 15 minutes reads as
    failed."""
    t = tally or {}
    status, error = run.status, run.error_message
    last = t.get("last") or run.created_at
    if status == "running" and last < datetime.now(UTC) - RUN_STALE_AFTER:
        status, error = "failed", error or RUN_STOPPED
    passed, failed, errors = t.get("pass", 0), t.get("fail", 0), t.get("error", 0)
    cost, judge = t.get("cost", 0.0), t.get("judge", 0.0)
    timed = t.get("timed", 0)
    return {
        "run_id": str(run.id),
        "model_slug": run.model_slug,
        "model_name": run.model_slug.rsplit("/", 1)[-1],
        "provider_label": provider_label(run.model_slug),
        "version": run.version,
        "status": status,
        "stop_requested": bool(run.stop_requested),
        "cases_total": run.cases_total,
        "done": passed + failed + errors,
        "passed": passed,
        "failed": failed,
        "errors": errors,
        "first_error": t.get("first_error"),
        "price_known": bool(run.price_known),
        "estimate_usd": float(run.estimate_usd) if run.estimate_usd is not None else None,
        "cost_usd": cost,
        "judge_cost_usd": judge,
        "total_usd": cost + judge,
        "avg_latency_ms": round(t["latency"] / timed) if timed else None,
        "error_message": error,
        "created_at": _iso(run.created_at),
        "completed_at": _iso(run.completed_at),
    }


def _model_runs(session: Session, model_id: uuid.UUID) -> list[dict]:
    """Every run of a model, newest first."""
    runs = (
        session.execute(
            select(ModelTestRun)
            .where(ModelTestRun.model_id == model_id)
            .order_by(ModelTestRun.created_at.desc(), ModelTestRun.id.desc())
        )
        .scalars()
        .all()
    )
    tallies = _run_tallies(session, [r.id for r in runs])
    return [run_view(r, tallies.get(r.id)) for r in runs]


def _judge_default(session: Session, model: UserModel) -> str | None:
    """The last judge used in this model, else the account's default thinking model."""
    last = session.execute(
        select(ModelTestCase.judge_model)
        .where(ModelTestCase.model_id == model.id, ModelTestCase.judge_model.is_not(None))
        .order_by(ModelTestCase.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    return last or account_default_model(held_provider_slugs(model.owner_id), "thinker")


def _pre_checked(session: Session, model: UserModel) -> list[str]:
    """The models of this model's last run, else the account's default thinking model."""
    newest = session.execute(
        select(func.max(ModelTestRun.created_at)).where(ModelTestRun.model_id == model.id)
    ).scalar_one_or_none()
    if newest is not None:
        # The runs of one click share a transaction, so a creation time.
        slugs = session.execute(
            select(ModelTestRun.model_slug).where(
                ModelTestRun.model_id == model.id, ModelTestRun.created_at == newest
            )
        ).scalars()
        return sorted(set(slugs))
    default = account_default_model(held_provider_slugs(model.owner_id), "thinker")
    return [default] if default else []


def _model_card(session: Session, model: UserModel) -> dict:
    """A model for the Models list: its chips, its status badge and "Best on your tests"."""
    version = version_row(session, model.id, model.current_version)
    runs = _model_runs(session, model.id)
    current = [r for r in runs if r["version"] == model.current_version]
    finished = [r for r in current if r["status"] == "completed"]
    if finished:
        badge = "tested"
    elif runs and not current:
        badge = "changed"
    else:
        badge = "not_run"
    return {
        "model_id": str(model.id),
        "name": model.name,
        "job": model.job,
        "answer_kind": model.answer_kind,
        "choices": list(model.choices),
        "current_version": model.current_version,
        "tests": len(version.case_ids) if version else 0,
        "badge": badge,
        "tested_at": max((r["completed_at"] or "" for r in finished), default=None),
        "best": pure.best_runs(current),
    }


def model_detail(session: Session, model: UserModel) -> dict:
    version = version_row(session, model.id, model.current_version)
    runs = session.execute(
        select(func.count())
        .select_from(ModelTestRun)
        .where(ModelTestRun.model_id == model.id, ModelTestRun.version == model.current_version)
    ).scalar_one()
    return {
        "model_id": str(model.id),
        "name": model.name,
        "job": model.job,
        "answer_kind": model.answer_kind,
        "choices": list(model.choices),
        "current_version": model.current_version,
        "tests": len(version.case_ids) if version else 0,
        "runs_on_current": int(runs),
        **_examples_counts(session, model),
        "edited_at": _iso(version.created_at) if version else None,
        "judge_default": _judge_default(session, model),
        "pre_checked": _pre_checked(session, model),
        "created_at": _iso(model.created_at),
    }


def _examples_counts(session: Session, model: UserModel) -> dict:
    """M2: the Training examples and Drafts tabs' counts, and whether a team is drafting."""
    from tvashtr.control_plane import model_examples  # it imports this module

    return {
        "training_version": model.training_version,
        "training": len(model_examples.current_training(session, model)),
        "drafts": model_examples.open_drafts_count(session, model.id),
        "drafting": model_examples.drafting_batch(session, model.id) is not None,
    }


def _lock_test(session: Session, model: UserModel, input_: str) -> None:
    """M2: a test can't be a current training example (inputs compared normalised)."""
    from tvashtr.control_plane import model_examples
    from tvashtr.control_plane import model_examples_pure as examples_pure

    training = [e.input for e in model_examples.current_training(session, model)]
    reason = examples_pure.test_lock(input_, training)
    if reason:
        raise ValueError(reason)


def _source_of(case: ModelTestCase) -> str | None:
    """M2: the Tests tab's Source line for a test with no quote."""
    if case.source:
        return None
    if case.origin == "csv":
        return f"Imported from {case.origin_note}" if case.origin_note else "Imported from a CSV"
    return "Added by you"


def _case_view(case: ModelTestCase, position: int) -> dict:
    return {
        "case_id": str(case.id),
        "case_key": str(case.case_key),
        "position": position,
        "input": case.input,
        "expected": case.expected,
        "scoring": case.scoring,
        "must_contain": list(case.must_contain),
        "rubric": case.rubric,
        "judge_model": case.judge_model,
        "source": case.source,
        "origin": case.origin,
        "added_by": _source_of(case),
    }


def _last_runs(
    session: Session, model_id: uuid.UUID, case_ids: list[uuid.UUID]
) -> list[ModelTestRun]:
    """The latest two finished runs, on any version, that ran at least one of these revisions."""
    if not case_ids:
        return []
    ran = select(ModelTestResult.run_id).where(ModelTestResult.case_id.in_(case_ids))
    return list(
        session.execute(
            select(ModelTestRun)
            .where(
                ModelTestRun.model_id == model_id,
                ModelTestRun.status == "completed",
                ModelTestRun.id.in_(ran),
            )
            .order_by(ModelTestRun.created_at.desc(), ModelTestRun.id.desc())
            .limit(2)
        ).scalars()
    )


def _last_run_view(run: ModelTestRun) -> dict:
    return {
        "run_id": str(run.id),
        "model_slug": run.model_slug,
        "model_name": run.model_slug.rsplit("/", 1)[-1],
        "completed_at": _iso(run.completed_at),
    }


# ---- Models ----


def list_models(owner_id: uuid.UUID) -> list[dict]:
    with session_scope() as session:
        models = (
            session.execute(
                select(UserModel)
                .where(UserModel.owner_id == owner_id)
                .order_by(UserModel.created_at, UserModel.id)
            )
            .scalars()
            .all()
        )
        return [_model_card(session, m) for m in models]


def _name_free(session: Session, owner_id: uuid.UUID, name: str, but: uuid.UUID | None) -> None:
    query = select(UserModel.id).where(
        UserModel.owner_id == owner_id, func.lower(UserModel.name) == name.lower()
    )
    if but is not None:
        query = query.where(UserModel.id != but)
    if session.execute(query).first() is not None:
        raise ValueError(NAME_TAKEN)


def create_model(
    owner_id: uuid.UUID,
    *,
    name: str | None,
    job: str | None,
    answer_kind: str | None,
    choices: list[str] | None = None,
) -> dict:
    clean = pure.clean_name(name)
    clean_job = pure.clean_job(job)
    if answer_kind not in ("choice", "text"):
        raise ValueError("Pick what kind of answer you expect.")
    clean_choices = pure.clean_choices(choices) if answer_kind == "choice" else []
    try:
        with session_scope() as session:
            _name_free(session, owner_id, clean, None)
            model = UserModel(
                owner_id=owner_id,
                name=clean,
                job=clean_job,
                answer_kind=answer_kind,
                choices=clean_choices,
            )
            session.add(model)
            session.flush()
            return model_detail(session, model)
    except IntegrityError as exc:  # two creates raced past the check
        raise ValueError(NAME_TAKEN) from exc


def get_model(owner_id: uuid.UUID, model_id: uuid.UUID) -> dict:
    with session_scope() as session:
        return model_detail(session, owned_model(session, owner_id, model_id))


def update_model(
    owner_id: uuid.UUID,
    model_id: uuid.UUID,
    *,
    name: str | None = None,
    job: str | None = None,
    choices: list[str] | None = None,
) -> dict:
    """Renaming isn't a version. A change of the job or the choices is: the model sees both with
    every test. (Before the first test there is nothing to version yet.)"""
    try:
        with session_scope() as session:
            model = owned_model(session, owner_id, model_id, lock=True)
            if name is not None:
                clean = pure.clean_name(name)
                _name_free(session, owner_id, clean, model.id)
                model.name = clean
            job_changed = job is not None and pure.clean_job(job) != model.job
            if job_changed:
                model.job = pure.clean_job(job)
            choices_changed = False
            if choices is not None and model.answer_kind == "choice":
                clean_choices = pure.clean_choices(choices)
                choices_changed = clean_choices != list(model.choices)
                if choices_changed:
                    _expected_answers_fit(session, model, clean_choices)
                    model.choices = clean_choices
            if (job_changed or choices_changed) and model.current_version > 0:
                what = " and the ".join(
                    w for w, on in (("job", job_changed), ("choices", choices_changed)) if on
                )
                current = version_row(session, model.id, model.current_version)
                _new_version(
                    session, model, list(current.case_ids), f"Changed the {what}", owner_id
                )
            session.flush()
            return model_detail(session, model)
    except IntegrityError as exc:
        raise ValueError(NAME_TAKEN) from exc


def _expected_answers_fit(session: Session, model: UserModel, choices: list[str]) -> None:
    allowed = {c.casefold() for c in choices}
    current = version_row(session, model.id, model.current_version)
    for position, case in enumerate(cases_of(session, current), 1):
        if case.expected.casefold() not in allowed:
            raise ValueError(f"Test {position}: {pure.NOT_A_CHOICE}")


def delete_model(owner_id: uuid.UUID, model_id: uuid.UUID) -> None:
    """Its tests, every test set version and every result go with it (ON DELETE CASCADE)."""
    with session_scope() as session:
        owned_model(session, owner_id, model_id, lock=True)
        session.execute(delete(UserModel).where(UserModel.id == model_id))


# ---- Tests ----


def list_tests(owner_id: uuid.UUID, model_id: uuid.UUID, version: int | None = None) -> dict:
    """A version's tests (the current one by default) and the Last run columns: each test's verdict
    in the latest two finished runs that ran THIS revision, so an edit clears only its own chips."""
    with session_scope() as session:
        model = owned_model(session, owner_id, model_id)
        number = model.current_version if version is None else version
        row = version_row(session, model.id, number)
        if row is None and number != 0:
            raise LookupError(VERSION_NOT_FOUND)
        cases = cases_of(session, row)
        ids = [c.id for c in cases]
        runs = _last_runs(session, model.id, ids)
        verdicts: dict[tuple[uuid.UUID, uuid.UUID], ModelTestResult] = {}
        if runs:
            results = session.execute(
                select(ModelTestResult).where(
                    ModelTestResult.run_id.in_([r.id for r in runs]),
                    ModelTestResult.case_id.in_(ids),
                )
            ).scalars()
            verdicts = {(r.run_id, r.case_id): r for r in results}
        tests = []
        for position, case in enumerate(cases, 1):
            view = _case_view(case, position)
            view["last_run"] = [
                (
                    {"verdict": verdicts[(r.id, case.id)].verdict}
                    if (r.id, case.id) in verdicts
                    else None
                )
                for r in runs
            ]
            tests.append(view)
        return {
            "version": number,
            "is_current": number == model.current_version,
            "change_note": row.change_note if row else None,
            "created_at": _iso(row.created_at) if row else None,
            "tests": tests,
            "last_runs": [_last_run_view(r) for r in runs],
        }


def _current_case(
    session: Session, model: UserModel, case_key: uuid.UUID
) -> tuple[list[ModelTestCase], int]:
    """The current version's tests and the index of the one with ``case_key``."""
    cases = cases_of(session, version_row(session, model.id, model.current_version))
    for index, case in enumerate(cases):
        if case.case_key == case_key:
            return cases, index
    raise LookupError(TEST_NOT_FOUND)


def _saved(session: Session, model: UserModel, case: ModelTestCase, position: int) -> dict:
    return {
        "test": _case_view(case, position),
        "version": model.current_version,
        "model": model_detail(session, model),
    }


def add_test(owner_id: uuid.UUID, model_id: uuid.UUID, fields: dict) -> dict:
    with session_scope() as session:
        model = owned_model(session, owner_id, model_id, lock=True)
        clean = pure.clean_case(model.answer_kind, list(model.choices), **fields)
        _lock_test(session, model, clean["input"])
        current = version_row(session, model.id, model.current_version)
        ids = list(current.case_ids) if current else []
        if len(ids) >= pure.MAX_TESTS:
            raise ValueError(pure.TOO_MANY_TESTS)
        case = ModelTestCase(model_id=model.id, case_key=uuid.uuid4(), origin="hand", **clean)
        session.add(case)
        session.flush()
        _new_version(session, model, [*ids, case.id], f"Added test {len(ids) + 1}", owner_id)
        return _saved(session, model, case, len(ids) + 1)


def edit_test(owner_id: uuid.UUID, model_id: uuid.UUID, case_key: uuid.UUID, fields: dict) -> dict:
    """A new revision of the test (same ``case_key``) and a version whose list swaps one id."""
    with session_scope() as session:
        model = owned_model(session, owner_id, model_id, lock=True)
        cases, index = _current_case(session, model, case_key)
        clean = pure.clean_case(model.answer_kind, list(model.choices), **fields)
        _lock_test(session, model, clean["input"])
        old = cases[index]
        case = ModelTestCase(
            model_id=model.id,
            case_key=case_key,
            source=old.source,
            origin=old.origin,
            origin_note=old.origin_note,
            **clean,
        )
        session.add(case)
        session.flush()
        ids = [c.id for c in cases]
        ids[index] = case.id
        _new_version(session, model, ids, f"Edited test {index + 1}", owner_id)
        return _saved(session, model, case, index + 1)


def delete_test(owner_id: uuid.UUID, model_id: uuid.UUID, case_key: uuid.UUID) -> dict:
    with session_scope() as session:
        model = owned_model(session, owner_id, model_id, lock=True)
        cases, index = _current_case(session, model, case_key)
        ids = [c.id for i, c in enumerate(cases) if i != index]
        _new_version(session, model, ids, f"Deleted test {index + 1}", owner_id)
        return {"version": model.current_version, "model": model_detail(session, model)}


def case_results(owner_id: uuid.UUID, model_id: uuid.UUID, case_key: uuid.UUID) -> dict:
    """The drawer's Last run box: the same rule as the Tests tab, with the judge's reason."""
    with session_scope() as session:
        model = owned_model(session, owner_id, model_id)
        cases, index = _current_case(session, model, case_key)
        case = cases[index]
        out = []
        for run in _last_runs(session, model.id, [c.id for c in cases]):
            result = session.execute(
                select(ModelTestResult).where(
                    ModelTestResult.run_id == run.id, ModelTestResult.case_id == case.id
                )
            ).scalar_one_or_none()
            if result is not None:
                out.append(
                    {
                        **_last_run_view(run),
                        "verdict": result.verdict,
                        "reason": result.reason,
                        "judge_model": result.judge_model,
                        "answer": result.answer,
                    }
                )
        return {"results": out}


def import_tests(
    owner_id: uuid.UUID, model_id: uuid.UUID, *, filename: str, text: str, dry_run: bool
) -> dict:
    """All or nothing. ``dry_run`` answers the preview; otherwise the tests are appended as one new
    version. Bad rows come back in ``errors`` (a real import with errors changes nothing)."""
    name = PurePath((filename or "").replace("\\", "/")).name[:200] or "a file"
    with session_scope() as session:
        model = owned_model(session, owner_id, model_id, lock=True)
        current = version_row(session, model.id, model.current_version)
        ids = list(current.case_ids) if current else []
        rows, errors = pure.parse_csv(
            text,
            answer_kind=model.answer_kind,
            choices=list(model.choices),
            default_judge=_judge_default(session, model),
            existing=len(ids),
        )
        if not errors:
            from tvashtr.control_plane import model_examples, model_examples_pure

            training = [e.input for e in model_examples.current_training(session, model)]
            lines = model_examples._data_lines(text)
            for row, line in zip(rows, lines, strict=False):
                reason = model_examples_pure.test_lock(row["input"], training)
                if reason:
                    errors.append(f"Line {line}: {reason}")
            if errors:
                rows = []
        out = {
            "ready": len(rows),
            "next_version": model.current_version + 1,
            "errors": errors,
            "imported": False,
        }
        if dry_run or errors:
            return out
        cases = [
            ModelTestCase(
                model_id=model.id, case_key=uuid.uuid4(), origin="csv", origin_note=name, **r
            )
            for r in rows
        ]
        session.add_all(cases)
        session.flush()
        note = f"Imported {len(cases)} test{'' if len(cases) == 1 else 's'} from {name}"
        _new_version(session, model, [*ids, *(c.id for c in cases)], note, owner_id)
        return {**out, "imported": True, "model": model_detail(session, model)}


# ---- Versions ----


def list_versions(owner_id: uuid.UUID, model_id: uuid.UUID) -> dict:
    with session_scope() as session:
        model = owned_model(session, owner_id, model_id)
        rows = (
            session.execute(
                select(ModelTestSetVersion)
                .where(ModelTestSetVersion.model_id == model.id)
                .order_by(ModelTestSetVersion.version.desc())
            )
            .scalars()
            .all()
        )
        counts = dict(
            session.execute(
                select(ModelTestRun.version, func.count())
                .where(ModelTestRun.model_id == model.id)
                .group_by(ModelTestRun.version)
            ).all()
        )
        return {
            "versions": [
                {
                    "version": r.version,
                    "change_note": r.change_note,
                    "created_at": _iso(r.created_at),
                    "tests": len(r.case_ids),
                    "runs": int(counts.get(r.version, 0)),
                }
                for r in rows
            ]
        }


def restore_version(owner_id: uuid.UUID, model_id: uuid.UUID, version: int) -> dict:
    """A new version with the old one's tests, job and choices. Its unchanged revisions keep their
    results."""
    with session_scope() as session:
        model = owned_model(session, owner_id, model_id, lock=True)
        old = version_row(session, model.id, version)
        if old is None:
            raise LookupError(VERSION_NOT_FOUND)
        for case in cases_of(session, old):
            _lock_test(session, model, case.input)
        model.job = old.job
        model.choices = list(old.choices)
        _new_version(session, model, list(old.case_ids), f"Restored v{version}", owner_id)
        return {"version": model.current_version, "model": model_detail(session, model)}
