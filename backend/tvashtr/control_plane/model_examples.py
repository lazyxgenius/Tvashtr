"""M2 — a model's training set, the drafts a team hands in, and the agents' side of the examples
server (brief ``prompts/m2-examples.md``).

The rules that matter most live here and in :mod:`model_examples_pure`:

* **Two sets, kept apart.** A test and a training example never share an input (normalised). The
  lock is checked on every door: a test added, edited, imported or restored (``model_tests``); a
  training example added, edited, imported, restored or accepted; a draft flipped (it then shows
  why it can't be accepted). Nothing here reads tests as training data.
* **The source check is built in.** An agent's draft is written only if the file is one of the
  batch Domain's ready files, the quote is in that file's stored text, the answer fits the model,
  the input is new and the plan has room. Each refusal is one sentence the agent can act on.
* **Hand in** (:func:`hand_in_step`) marks the batch ready; nothing is added to the model until the
  customer accepts drafts, in one step that makes one test set version and one training set
  version.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import PurePath

from dbos import DBOS
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tvashtr.control_plane import model_examples_pure as pure
from tvashtr.control_plane import model_tests
from tvashtr.control_plane import model_tests_pure as tests_pure
from tvashtr.control_plane.run_failure import node_label
from tvashtr.control_plane.run_views import TERMINAL_STATUSES
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    DomainChunk,
    DomainDocument,
    ModelExampleBatch,
    ModelExampleDraft,
    ModelTestCase,
    ModelTrainingExample,
    ModelTrainingSetVersion,
    Run,
    UserModel,
)

EXAMPLE_NOT_FOUND = "example not found"
DRAFT_NOT_FOUND = "draft not found"
VERSION_NOT_FOUND = "version not found"
NOT_HANDED_IN = "You can accept once the team hands in."
NO_EXAMPLES = "The team handed in no examples."
TOO_MANY_TRAINING = "You can have up to 2,000 training examples."
HANDED_IN = "The team has handed in. Drafts can't change now."
BAD_KIND = "Kind must be test or training."
BAD_VERDICT = "Verdict must be ok or flagged."
NEED_NOTE = "Say in one sentence why."
EDIT_OR_REJECT = "Edit it into a different case, or reject it."
NEED_DRAFTS = "Pick at least one draft."


# ---- Reading the two sets ----


def training_version_row(
    session: Session, model_id: uuid.UUID, version: int
) -> ModelTrainingSetVersion | None:
    return session.execute(
        select(ModelTrainingSetVersion).where(
            ModelTrainingSetVersion.model_id == model_id,
            ModelTrainingSetVersion.version == version,
        )
    ).scalar_one_or_none()


def examples_of(
    session: Session, version: ModelTrainingSetVersion | None
) -> list[ModelTrainingExample]:
    if version is None or not version.example_ids:
        return []
    ids = [uuid.UUID(i) for i in version.example_ids]
    rows = session.execute(
        select(ModelTrainingExample).where(ModelTrainingExample.id.in_(ids))
    ).scalars()
    by_id = {r.id: r for r in rows}
    return [by_id[i] for i in ids]


def current_training(session: Session, model: UserModel) -> list[ModelTrainingExample]:
    return examples_of(session, training_version_row(session, model.id, model.training_version))


def current_tests(session: Session, model: UserModel) -> list[ModelTestCase]:
    return model_tests.cases_of(
        session, model_tests.version_row(session, model.id, model.current_version)
    )


def _new_training_version(
    session: Session, model: UserModel, ids: list, note: str, user: uuid.UUID | None
) -> ModelTrainingSetVersion:
    """The next training set version. The caller holds the model's row lock."""
    if len(ids) > pure.MAX_TRAINING:
        raise ValueError(TOO_MANY_TRAINING)
    model.training_version += 1
    row = ModelTrainingSetVersion(
        model_id=model.id,
        version=model.training_version,
        example_ids=[str(i) for i in ids],
        change_note=note,
        created_by=user,
    )
    session.add(row)
    session.flush()
    return row


def added_by(origin: str | None, note: str | None, edited: bool) -> str:
    """The Training tab's "Added by" (and the Tests tab's source line for tests with no quote)."""
    if origin == "draft":
        return "You, edited from a draft" if edited else (note or "Example builder")
    if origin == "csv":
        return f"Imported from {note}" if note else "Imported from a CSV"
    return "You"


def _example_view(example: ModelTrainingExample, position: int) -> dict:
    return {
        "example_id": str(example.id),
        "example_key": str(example.example_key),
        "position": position,
        "input": example.input,
        "answer": example.answer,
        "source": example.source,
        "origin": example.origin,
        "added_by": added_by(example.origin, example.origin_note, example.edited),
    }


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _lock_training(input_: str, tests: list[ModelTestCase]) -> None:
    reason = pure.training_lock(input_, [t.input for t in tests])
    if reason:
        raise ValueError(reason)


# ---- The training set ----


def list_training(owner_id: uuid.UUID, model_id: uuid.UUID, version: int | None = None) -> dict:
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        number = model.training_version if version is None else version
        row = training_version_row(session, model.id, number)
        if row is None and number != 0:
            raise LookupError(VERSION_NOT_FOUND)
        examples = examples_of(session, row)
        return {
            "version": number,
            "is_current": number == model.training_version,
            "change_note": row.change_note if row else None,
            "created_at": _iso(row.created_at) if row else None,
            "examples": [_example_view(e, i) for i, e in enumerate(examples, 1)],
            "tests": len(current_tests(session, model)),
        }


def _saved_example(model: UserModel, example: ModelTrainingExample, position: int) -> dict:
    return {"example": _example_view(example, position), "version": model.training_version}


def add_example(owner_id: uuid.UUID, model_id: uuid.UUID, fields: dict) -> dict:
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id, lock=True)
        clean = pure.clean_example(
            model.answer_kind,
            list(model.choices),
            input=fields.get("input"),
            answer=fields.get("answer"),
        )
        _lock_training(clean["input"], current_tests(session, model))
        current = current_training(session, model)
        example = ModelTrainingExample(
            model_id=model.id, example_key=uuid.uuid4(), origin="hand", **clean
        )
        session.add(example)
        session.flush()
        n = len(current) + 1
        _new_training_version(
            session, model, [*(e.id for e in current), example.id], f"Added example {n}", owner_id
        )
        return _saved_example(model, example, n)


def _current_example(
    session: Session, model: UserModel, key: uuid.UUID
) -> tuple[list[ModelTrainingExample], int]:
    examples = current_training(session, model)
    for index, example in enumerate(examples):
        if example.example_key == key:
            return examples, index
    raise LookupError(EXAMPLE_NOT_FOUND)


def edit_example(owner_id: uuid.UUID, model_id: uuid.UUID, key: uuid.UUID, fields: dict) -> dict:
    """A new revision (same ``example_key``), keeping where it came from and its source."""
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id, lock=True)
        examples, index = _current_example(session, model, key)
        old = examples[index]
        clean = pure.clean_example(
            model.answer_kind,
            list(model.choices),
            input=fields.get("input"),
            answer=fields.get("answer"),
        )
        _lock_training(clean["input"], current_tests(session, model))
        example = ModelTrainingExample(
            model_id=model.id,
            example_key=key,
            source=old.source,
            origin=old.origin,
            origin_note=old.origin_note,
            edited=True,
            **clean,
        )
        session.add(example)
        session.flush()
        ids = [e.id for e in examples]
        ids[index] = example.id
        _new_training_version(session, model, ids, f"Edited example {index + 1}", owner_id)
        return _saved_example(model, example, index + 1)


def delete_example(owner_id: uuid.UUID, model_id: uuid.UUID, key: uuid.UUID) -> dict:
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id, lock=True)
        examples, index = _current_example(session, model, key)
        ids = [e.id for i, e in enumerate(examples) if i != index]
        _new_training_version(session, model, ids, f"Deleted example {index + 1}", owner_id)
        return {"version": model.training_version}


def import_training(
    owner_id: uuid.UUID, model_id: uuid.UUID, *, filename: str, text: str, dry_run: bool
) -> dict:
    """All or nothing, with a dry run: Models 1's importer for the columns ``input`` and
    ``answer``. A row that is one of the model's tests is an error on its line."""
    name = PurePath((filename or "").replace("\\", "/")).name[:200] or "a file"
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id, lock=True)
        current = current_training(session, model)
        rows, errors = pure.parse_training_csv(
            text, answer_kind=model.answer_kind, choices=list(model.choices)
        )
        if not errors:
            tests = [t.input for t in current_tests(session, model)]
            lines = _data_lines(text)
            for row, line in zip(rows, lines, strict=False):
                reason = pure.training_lock(row["input"], tests)
                if reason:
                    errors.append(f"Line {line}: {reason}")
            if len(current) + len(rows) > pure.MAX_TRAINING:
                errors.append(TOO_MANY_TRAINING)
        out = {
            "ready": 0 if errors else len(rows),
            "next_version": model.training_version + 1,
            "errors": errors,
            "imported": False,
        }
        if dry_run or errors:
            return out
        new = [
            ModelTrainingExample(
                model_id=model.id, example_key=uuid.uuid4(), origin="csv", origin_note=name, **r
            )
            for r in rows
        ]
        session.add_all(new)
        session.flush()
        note = f"Imported {len(new)} example{'' if len(new) == 1 else 's'} from {name}"
        _new_training_version(
            session, model, [*(e.id for e in current), *(e.id for e in new)], note, owner_id
        )
        return {**out, "imported": True, "version": model.training_version}


def _data_lines(text: str) -> list[int]:
    """The line each non-blank data row starts on (the header is line 1), as the parser counts."""
    reader = csv.reader(io.StringIO(text.removeprefix("﻿"), newline=""))
    next(reader, None)
    out: list[int] = []
    line = reader.line_num + 1
    for values in reader:
        started, line = line, reader.line_num + 1
        if any(v.strip() for v in values):
            out.append(started)
    return out


def list_training_versions(owner_id: uuid.UUID, model_id: uuid.UUID) -> dict:
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        rows = session.execute(
            select(ModelTrainingSetVersion)
            .where(ModelTrainingSetVersion.model_id == model.id)
            .order_by(ModelTrainingSetVersion.version.desc())
        ).scalars()
        return {
            "versions": [
                {
                    "version": r.version,
                    "change_note": r.change_note,
                    "created_at": _iso(r.created_at),
                    "examples": len(r.example_ids),
                }
                for r in rows
            ]
        }


def restore_training_version(owner_id: uuid.UUID, model_id: uuid.UUID, version: int) -> dict:
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id, lock=True)
        old = training_version_row(session, model.id, version)
        if old is None:
            raise LookupError(VERSION_NOT_FOUND)
        tests = current_tests(session, model)
        for example in examples_of(session, old):
            _lock_training(example.input, tests)
        _new_training_version(
            session, model, list(old.example_ids), f"Restored v{version}", owner_id
        )
        return {"version": model.training_version}


def download(owner_id: uuid.UUID, model_id: uuid.UUID, fmt: str) -> tuple[str, str, str]:
    """``(filename, content type, body)`` of the current training set — and only of it: a test is
    never in a download. JSONL lines carry the exact instruction a test of this model is sent."""
    if fmt not in ("jsonl", "csv"):
        raise ValueError("Download as jsonl or csv.")
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        examples = current_training(session, model)
        stem = "".join(c if c.isalnum() or c in "-_" else "-" for c in model.name).strip("-")
        stem = f"{stem or 'model'}-training-v{model.training_version}"
        if fmt == "jsonl":
            body = "".join(
                pure.jsonl_line(
                    tests_pure.build_messages(
                        model.answer_kind, model.job, list(model.choices), e.input
                    )[0]["content"],
                    e.input,
                    e.answer,
                )
                + "\n"
                for e in examples
            )
            return f"{stem}.jsonl", "application/jsonl", body
        out = io.StringIO()
        writer = csv.writer(out, lineterminator="\n")
        writer.writerow(["input", "answer", "source_file", "source_quote"])
        for e in examples:
            source = e.source or {}
            writer.writerow([e.input, e.answer, source.get("file", ""), source.get("quote", "")])
        return f"{stem}.csv", "text/csv", out.getvalue()


# ---- Batches and drafts: the customer's side ----


def batch_state(batch: ModelExampleBatch, run_status: str | None) -> str:
    """``drafting`` while the team works, ``ready`` once it handed in, ``stopped`` when the run
    ended any other way (read from the run's status, so no failure path needed a hook)."""
    if batch.status == "ready":
        return "ready"
    if run_status is None or run_status in TERMINAL_STATUSES:
        return "stopped"
    return "drafting"


def drafting_batch(session: Session, model_id: uuid.UUID) -> ModelExampleBatch | None:
    """The model's batch whose team is still working, if any (one at a time)."""
    rows = session.execute(
        select(ModelExampleBatch, Run.status)
        .outerjoin(Run, Run.id == ModelExampleBatch.run_id)
        .where(ModelExampleBatch.model_id == model_id, ModelExampleBatch.status == "drafting")
    ).all()
    for batch, status in rows:
        if batch_state(batch, status) == "drafting":
            return batch
    return None


def _blocked(draft: ModelExampleDraft, tests: list[str], training: list[str]) -> str | None:
    """Why an open draft can't be accepted as it is: the lock rule, or a copy of the set it would
    join. The card shows the sentence; the accept refuses it with the same one."""
    if draft.kind == "training":
        lock = pure.training_lock(draft.input, tests)
        if lock:
            return f"{lock} {EDIT_OR_REJECT}"
        key = pure.input_key(draft.input)
        for n, t in enumerate(training, 1):
            if pure.input_key(t) == key:
                return f"This is the same as training example {n}. {EDIT_OR_REJECT}"
        return None
    lock = pure.test_lock(draft.input, training)
    if lock:
        return lock
    key = pure.input_key(draft.input)
    for n, t in enumerate(tests, 1):
        if pure.input_key(t) == key:
            return f"This is the same as test {n}. {EDIT_OR_REJECT}"
    return None


def _draft_view(draft: ModelExampleDraft, blocked: str | None) -> dict:
    source = draft.source or {}
    return {
        "draft_id": str(draft.id),
        "number": draft.position,
        "kind": draft.kind,
        "input": draft.input,
        "answer": draft.answer,
        "must_contain": list(draft.must_contain),
        "source": {
            "file": source.get("file"),
            "quote": source.get("quote"),
            "locator": source.get("locator"),
        },
        "review": draft.review,
        "review_note": draft.review_note,
        "reviewed_by": draft.reviewed_by,
        "edited": draft.edited,
        "blocked": blocked,
        "selected": draft.review != "flagged" and blocked is None,
    }


def _batch_view(
    session: Session, batch: ModelExampleBatch, run: Run | None, drafts: list[ModelExampleDraft]
) -> dict:
    state = batch_state(batch, run.status if run else None)
    all_drafts = (
        session.execute(select(ModelExampleDraft).where(ModelExampleDraft.batch_id == batch.id))
        .scalars()
        .all()
    )
    checked = sum(1 for d in all_drafts if d.reviewed_by)
    flagged = sum(1 for d in drafts if d.review == "flagged")
    cost = batch.cost_usd
    if cost is None and run is not None:
        cost = run.cost_total_usd
        if cost is None:
            from tvashtr.metering import running_cost

            cost = running_cost(str(run.id))
    return {
        "batch_id": str(batch.id),
        "run_id": str(batch.run_id) if batch.run_id else None,
        "state": state,
        "team_id": str(batch.team_id) if batch.team_id else None,
        "team_name": batch.team_name,
        "domain_name": batch.domain_name,
        "tests_wanted": batch.tests_wanted,
        "training_wanted": batch.training_wanted,
        "handed_in": len([d for d in all_drafts if d.state != "rejected"]),
        "drafts_total": len(all_drafts),
        "created_at": _iso(batch.created_at),
        "completed_at": _iso(batch.completed_at),
        "cost_usd": float(cost) if cost is not None else None,
        "estimate_usd": float(batch.estimate_usd) if batch.estimate_usd is not None else None,
        "review_rounds": batch.review_rounds,
        "sent_back": batch.sent_back,
        "reviewer_line": pure.reviewer_line(
            checked, batch.sent_back, flagged, _last_verdict(session, batch) == "approved"
        )
        if state != "drafting"
        else None,
    }


def _last_verdict(session: Session, batch: ModelExampleBatch) -> str | None:
    """The Reviewer's last verdict in the batch's run (``approved`` / ``changes_requested``)."""
    if batch.run_id is None:
        return None
    return session.execute(
        select(AgentInvocation.outcome)
        .where(
            AgentInvocation.run_id == str(batch.run_id),
            AgentInvocation.outcome.in_(("approved", "changes_requested")),
        )
        .order_by(AgentInvocation.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def list_drafts(owner_id: uuid.UUID, model_id: uuid.UUID) -> dict:
    """The Drafts tab: batches newest first, each with its open drafts in order. Selected by
    default: every open draft except flagged ones and ones that can't be accepted as they are."""
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        tests = [t.input for t in current_tests(session, model)]
        training = [e.input for e in current_training(session, model)]
        batches = session.execute(
            select(ModelExampleBatch, Run)
            .outerjoin(Run, Run.id == ModelExampleBatch.run_id)
            .where(ModelExampleBatch.model_id == model.id)
            .order_by(ModelExampleBatch.created_at.desc())
        ).all()
        out = []
        for batch, run in batches:
            drafts = (
                session.execute(
                    select(ModelExampleDraft)
                    .where(
                        ModelExampleDraft.batch_id == batch.id, ModelExampleDraft.state == "open"
                    )
                    .order_by(ModelExampleDraft.position)
                )
                .scalars()
                .all()
            )
            view = _batch_view(session, batch, run, drafts)
            if view["state"] != "drafting" and not drafts:
                continue  # a finished batch with nothing left to review leaves the tab
            view["drafts"] = [_draft_view(d, _blocked(d, tests, training)) for d in drafts]
            out.append(view)
        return {
            "batches": out,
            "open": sum(len(b["drafts"]) for b in out if b["state"] != "drafting"),
            "test_version": model.current_version,
            "training_version": model.training_version,
            "answer_kind": model.answer_kind,
            "choices": list(model.choices),
        }


def open_drafts_count(session: Session, model_id: uuid.UUID) -> int:
    """Open drafts of finished batches (the Drafts tab's count)."""
    rows = session.execute(
        select(ModelExampleBatch, Run.status, func.count(ModelExampleDraft.id))
        .join(ModelExampleDraft, ModelExampleDraft.batch_id == ModelExampleBatch.id)
        .outerjoin(Run, Run.id == ModelExampleBatch.run_id)
        .where(ModelExampleBatch.model_id == model_id, ModelExampleDraft.state == "open")
        .group_by(ModelExampleBatch.id, Run.status)
    ).all()
    return int(sum(n for batch, status, n in rows if batch_state(batch, status) != "drafting"))


def _owned_draft(session: Session, model: UserModel, draft_id: uuid.UUID) -> ModelExampleDraft:
    draft = session.execute(
        select(ModelExampleDraft)
        .where(ModelExampleDraft.id == draft_id, ModelExampleDraft.model_id == model.id)
        .with_for_update()
    ).scalar_one_or_none()
    if draft is None or draft.state != "open":
        raise LookupError(DRAFT_NOT_FOUND)
    return draft


def _batch_drafts_inputs(session: Session, batch_id: uuid.UUID) -> list[tuple[int, str]]:
    return [
        (n, t)
        for n, t in session.execute(
            select(ModelExampleDraft.position, ModelExampleDraft.input).where(
                ModelExampleDraft.batch_id == batch_id, ModelExampleDraft.state != "rejected"
            )
        ).all()
    ]


def edit_draft(owner_id: uuid.UUID, model_id: uuid.UUID, draft_id: uuid.UUID, fields: dict) -> dict:
    """The customer's edit (input, answer, key phrases; the source stays): the answer, copy and lock
    checks run again and the card is marked "Edited by you"."""
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        draft = _owned_draft(session, model, draft_id)
        tests = [t.input for t in current_tests(session, model)]
        training = [e.input for e in current_training(session, model)]
        try:
            input_ = pure.check_input(
                fields.get("input", draft.input),
                tests=[],
                training=[],
                drafts=_batch_drafts_inputs(session, draft.batch_id),
                but=draft.position,
            )
            answer, phrases = pure.check_answer(
                model.answer_kind,
                fields.get("answer", draft.answer),
                list(model.choices),
                fields.get("must_contain", draft.must_contain),
            )
        except pure.Refused as exc:
            raise ValueError(str(exc)) from exc
        draft.input, draft.answer, draft.must_contain = input_, answer, phrases
        draft.edited = True
        session.flush()
        return {"draft": _draft_view(draft, _blocked(draft, tests, training))}


def set_draft_kind(
    owner_id: uuid.UUID, model_id: uuid.UUID, draft_id: uuid.UUID, kind: str
) -> dict:
    """The card's Test / Training switch. Flipping re-checks the lock: the card then says why it
    can't be accepted, if it can't."""
    if kind not in ("test", "training"):
        raise ValueError(BAD_KIND)
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        draft = _owned_draft(session, model, draft_id)
        draft.kind = kind
        session.flush()
        tests = [t.input for t in current_tests(session, model)]
        training = [e.input for e in current_training(session, model)]
        return {"draft": _draft_view(draft, _blocked(draft, tests, training))}


def _ids(raw: list[str] | None) -> list[uuid.UUID]:
    out = []
    for value in raw or []:
        try:
            out.append(uuid.UUID(str(value)))
        except ValueError as exc:
            raise LookupError(DRAFT_NOT_FOUND) from exc
    if not out:
        raise ValueError(NEED_DRAFTS)
    return list(dict.fromkeys(out))


def reject_drafts(owner_id: uuid.UUID, model_id: uuid.UUID, draft_ids: list[str] | None) -> dict:
    """Hide drafts for good."""
    ids = _ids(draft_ids)
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        drafts = (
            session.execute(
                select(ModelExampleDraft).where(
                    ModelExampleDraft.id.in_(ids),
                    ModelExampleDraft.model_id == model.id,
                    ModelExampleDraft.state == "open",
                )
            )
            .scalars()
            .all()
        )
        if len(drafts) != len(ids):
            raise LookupError(DRAFT_NOT_FOUND)
        for d in drafts:
            d.state = "rejected"
        return {"rejected": len(drafts)}


def accept_drafts(owner_id: uuid.UUID, model_id: uuid.UUID, draft_ids: list[str] | None) -> dict:
    """Accept drafts in one step: one new test set version and one new training set version (each
    only if it gains something). Each keeps its source. Drafts that can't be accepted stay open
    with their reason; a text model's accepted test is scored by Must contain with its phrases."""
    ids = _ids(draft_ids)
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id, lock=True)
        rows = session.execute(
            select(ModelExampleDraft, ModelExampleBatch, Run.status)
            .join(ModelExampleBatch, ModelExampleBatch.id == ModelExampleDraft.batch_id)
            .outerjoin(Run, Run.id == ModelExampleBatch.run_id)
            .where(
                ModelExampleDraft.id.in_(ids),
                ModelExampleDraft.model_id == model.id,
                ModelExampleDraft.state == "open",
            )
            .order_by(ModelExampleBatch.created_at, ModelExampleDraft.position)
        ).all()
        if len(rows) != len(ids):
            raise LookupError(DRAFT_NOT_FOUND)
        test_cases = current_tests(session, model)
        examples = current_training(session, model)
        tests = [t.input for t in test_cases]
        training = [e.input for e in examples]
        new_tests: list[ModelTestCase] = []
        new_training: list[ModelTrainingExample] = []
        refused: list[dict] = []
        team_name = None
        for draft, batch, run_status in rows:
            reason = None
            if batch_state(batch, run_status) == "drafting":
                reason = NOT_HANDED_IN
            else:
                reason = _blocked(draft, tests, training)
            if reason is None and draft.kind == "test" and len(tests) >= tests_pure.MAX_TESTS:
                reason = tests_pure.TOO_MANY_TESTS
            if reason is None and draft.kind == "training" and len(training) >= pure.MAX_TRAINING:
                reason = TOO_MANY_TRAINING
            if reason is not None:
                refused.append(
                    {"draft_id": str(draft.id), "number": draft.position, "reason": reason}
                )
                continue
            team_name = team_name or batch.team_name
            source = dict(draft.source or {})
            if draft.kind == "test":
                text_model = model.answer_kind == "text"
                new_tests.append(
                    ModelTestCase(
                        model_id=model.id,
                        case_key=uuid.uuid4(),
                        input=draft.input,
                        expected=draft.answer,
                        scoring="contains" if text_model else "exact",
                        must_contain=list(draft.must_contain) if text_model else [],
                        source=source,
                        origin="draft",
                        origin_note=batch.team_name,
                    )
                )
                tests.append(draft.input)
            else:
                new_training.append(
                    ModelTrainingExample(
                        model_id=model.id,
                        example_key=uuid.uuid4(),
                        input=draft.input,
                        answer=draft.answer,
                        source=source,
                        origin="draft",
                        origin_note=batch.team_name,
                        edited=draft.edited,
                    )
                )
                training.append(draft.input)
            draft.state = "accepted"
        session.add_all([*new_tests, *new_training])
        session.flush()
        who = team_name or "Example builder"
        if new_tests:
            n = len(new_tests)
            model_tests._new_version(
                session,
                model,
                [*(c.id for c in test_cases), *(c.id for c in new_tests)],
                f"Added {n} test{'' if n == 1 else 's'} from {who}",
                owner_id,
            )
        if new_training:
            n = len(new_training)
            _new_training_version(
                session,
                model,
                [*(e.id for e in examples), *(e.id for e in new_training)],
                f"Added {n} example{'' if n == 1 else 's'} from {who}",
                owner_id,
            )
        return {
            "accepted_tests": len(new_tests),
            "accepted_training": len(new_training),
            "test_version": model.current_version,
            "training_version": model.training_version,
            "refused": refused,
        }


# ---- The agents' side (the examples server's tools) ----


def _batch(session: Session, batch_id: uuid.UUID, *, lock: bool = False):
    query = select(ModelExampleBatch).where(ModelExampleBatch.id == batch_id)
    if lock:
        query = query.with_for_update()
    batch = session.execute(query).scalar_one()
    model = session.get(UserModel, batch.model_id)
    return batch, model


def _ready_files(session: Session, domain_id: uuid.UUID | None) -> list[DomainDocument]:
    if domain_id is None:
        return []
    return list(
        session.execute(
            select(DomainDocument)
            .where(DomainDocument.domain_id == domain_id, DomainDocument.ingest_status == "ready")
            .order_by(DomainDocument.filename, DomainDocument.id)
        ).scalars()
    )


def _passages(session: Session, document_id: uuid.UUID) -> list[tuple[str, dict | None]]:
    return [
        (t, m)
        for t, m in session.execute(
            select(DomainChunk.text, DomainChunk.meta)
            .where(DomainChunk.document_id == document_id)
            .order_by(DomainChunk.ordinal)
        ).all()
    ]


def _handed_in(session: Session, batch_id: uuid.UUID) -> dict[str, int]:
    counts = dict(
        session.execute(
            select(ModelExampleDraft.kind, func.count())
            .where(ModelExampleDraft.batch_id == batch_id, ModelExampleDraft.state != "rejected")
            .group_by(ModelExampleDraft.kind)
        ).all()
    )
    return {"test": int(counts.get("test", 0)), "training": int(counts.get("training", 0))}


def agent_brief(batch_id: uuid.UUID) -> dict:
    with session_scope() as session:
        batch, model = _batch(session, batch_id)
        handed = _handed_in(session, batch.id)
        return {
            "job": model.job,
            "kind_of_answer": "pick one of the choices"
            if model.answer_kind == "choice"
            else "write text",
            "choices": list(model.choices),
            "tests_asked": batch.tests_wanted,
            "training_examples_asked": batch.training_wanted,
            "tests_handed_in": handed["test"],
            "training_examples_handed_in": handed["training"],
            "domain": batch.domain_name,
            "files": [f.filename for f in _ready_files(session, batch.domain_id)],
            "rules": (
                "Every example quotes the file it came from, word for word. Tests and training "
                "examples must be different cases. "
                + (
                    "The answer must be exactly one of the choices."
                    if model.answer_kind == "choice"
                    else "Give 1 to 5 key phrases the answer must contain."
                )
            ),
        }


def _agent_draft(draft: ModelExampleDraft) -> dict:
    source = draft.source or {}
    return {
        "id": draft.position,
        "example_type": draft.kind,
        "input": draft.input,
        "answer": draft.answer,
        "must_contain": list(draft.must_contain),
        "source_file": source.get("file"),
        "quote": source.get("quote"),
        "review": draft.review,
        "review_note": draft.review_note,
        "flagged_before": draft.was_flagged,
    }


def agent_list(batch_id: uuid.UUID, kind: str | None = None, review: str | None = None) -> dict:
    with session_scope() as session:
        query = (
            select(ModelExampleDraft)
            .where(ModelExampleDraft.batch_id == batch_id, ModelExampleDraft.state != "rejected")
            .order_by(ModelExampleDraft.position)
        )
        if kind:
            query = query.where(ModelExampleDraft.kind == kind)
        if review:
            query = query.where(ModelExampleDraft.review == review)
        return {"drafts": [_agent_draft(d) for d in session.execute(query).scalars()]}


def _check_draft(
    session: Session,
    batch: ModelExampleBatch,
    model: UserModel,
    *,
    kind: str,
    input_: str,
    answer: str,
    source_file: str,
    quote: str,
    must_contain,
    but: int | None = None,
    room: bool = True,
) -> dict:
    """The source check, in the order an agent can best act on. Raises :class:`pure.Refused`."""
    if kind not in ("test", "training"):
        raise pure.Refused(BAD_KIND)
    files = _ready_files(session, batch.domain_id)
    name = pure.match_file(source_file, [f.filename for f in files], batch.domain_name)
    document = next(f for f in files if f.filename == name)
    passages = _passages(session, document.id)
    quote = pure.check_quote(quote, [t for t, _ in passages], name)
    clean_answer, phrases = pure.check_answer(
        model.answer_kind, answer, list(model.choices), must_contain
    )
    clean_input = pure.check_input(
        input_,
        tests=[t.input for t in current_tests(session, model)],
        training=[e.input for e in current_training(session, model)],
        drafts=_batch_drafts_inputs(session, batch.id),
        but=but,
    )
    if room:
        wanted = batch.tests_wanted if kind == "test" else batch.training_wanted
        pure.check_room(kind, wanted, _handed_in(session, batch.id)[kind])
    index = pure.locate_quote(quote, [t for t, _ in passages])
    meta = passages[index][1] if index is not None else None
    page = (meta or {}).get("page") if isinstance(meta, dict) else None
    source = {
        "file": name,
        "quote": quote,
        "domain_id": str(batch.domain_id),
        "document_id": str(document.id),
    }
    if page:
        source["locator"] = f"page {page}"
    return {
        "kind": kind,
        "input": clean_input,
        "answer": clean_answer,
        "must_contain": phrases,
        "source": source,
    }


def _writable(batch: ModelExampleBatch) -> None:
    if batch.status != "drafting":
        raise pure.Refused(HANDED_IN)


def agent_add(batch_id: uuid.UUID, fields: dict) -> dict:
    """``examples_add``: one draft, written at once if it passes the source check."""
    with session_scope() as session:
        batch, model = _batch(session, batch_id, lock=True)
        _writable(batch)
        clean = _check_draft(
            session,
            batch,
            model,
            kind=str(fields.get("kind") or "").strip().lower(),
            input_=fields.get("input") or "",
            answer=fields.get("answer") or "",
            source_file=fields.get("source_file") or "",
            quote=fields.get("quote") or "",
            must_contain=fields.get("must_contain"),
        )
        position = (
            session.execute(
                select(func.max(ModelExampleDraft.position)).where(
                    ModelExampleDraft.batch_id == batch.id
                )
            ).scalar()
            or 0
        ) + 1
        draft = ModelExampleDraft(batch_id=batch.id, model_id=model.id, position=position, **clean)
        session.add(draft)
        session.flush()
        handed = _handed_in(session, batch.id)
        return {
            "id": position,
            "tests_handed_in": handed["test"],
            "training_examples_handed_in": handed["training"],
        }


def _agent_draft_row(session: Session, batch_id: uuid.UUID, number) -> ModelExampleDraft:
    try:
        position = int(number)
    except (TypeError, ValueError) as exc:
        raise pure.Refused(f"No draft {number}. Call examples_list to see the ids.") from exc
    draft = session.execute(
        select(ModelExampleDraft)
        .where(
            ModelExampleDraft.batch_id == batch_id,
            ModelExampleDraft.position == position,
            ModelExampleDraft.state != "rejected",
        )
        .with_for_update()
    ).scalar_one_or_none()
    if draft is None:
        raise pure.Refused(f"No draft {position}. Call examples_list to see the ids.")
    return draft


def agent_update(batch_id: uuid.UUID, number, fields: dict) -> dict:
    """``examples_update``: the draft changed and checked again; its review mark is cleared."""
    with session_scope() as session:
        batch, model = _batch(session, batch_id, lock=True)
        _writable(batch)
        draft = _agent_draft_row(session, batch.id, number)
        source = draft.source or {}
        kind = str(fields.get("kind") or draft.kind).strip().lower()
        clean = _check_draft(
            session,
            batch,
            model,
            kind=kind,
            input_=fields.get("input") if fields.get("input") is not None else draft.input,
            answer=fields.get("answer") if fields.get("answer") is not None else draft.answer,
            source_file=fields.get("source_file") or source.get("file") or "",
            quote=fields.get("quote") or source.get("quote") or "",
            must_contain=(
                fields.get("must_contain")
                if fields.get("must_contain") is not None
                else draft.must_contain
            ),
            but=draft.position,
            room=kind != draft.kind,
        )
        for key, value in clean.items():
            setattr(draft, key, value)
        draft.review, draft.review_note, draft.reviewed_by = "none", None, None
        session.flush()
        return {"id": draft.position, "review": "none"}


def agent_remove(batch_id: uuid.UUID, number) -> dict:
    with session_scope() as session:
        batch, _ = _batch(session, batch_id, lock=True)
        _writable(batch)
        draft = _agent_draft_row(session, batch.id, number)
        draft.state = "rejected"
        handed = _handed_in(session, batch.id)
        return {
            "removed": draft.position,
            "tests_handed_in": handed["test"],
            "training_examples_handed_in": handed["training"],
        }


def agent_review(
    batch_id: uuid.UUID, number, verdict: str, note: str, node_id: uuid.UUID | None
) -> dict:
    """``examples_review``: the Reviewer's mark on one draft, with the reviewing node's label."""
    verdict = (verdict or "").strip().lower()
    note = " ".join((note or "").split())
    if verdict not in ("ok", "flagged"):
        raise pure.Refused(BAD_VERDICT)
    if not note:
        raise pure.Refused(NEED_NOTE)
    with session_scope() as session:
        batch, _ = _batch(session, batch_id, lock=True)
        _writable(batch)
        draft = _agent_draft_row(session, batch.id, number)
        label = "Reviewer"
        if node_id is not None:
            node = session.get(AgentNode, node_id)
            if node is not None:
                label = node_label(node.role_name, node.kind, node.config)
        draft.review, draft.review_note, draft.reviewed_by = verdict, note[:500], label
        if verdict == "flagged":
            draft.was_flagged = True
        return {"id": draft.position, "review": verdict}


# ---- Hand in ----


@DBOS.step()
def hand_in_step(run_id: str) -> dict:
    """The walk reached Hand in: mark the run's batch ready with its rounds and cost. ``ok`` is
    ``False`` when the team handed in no examples (the walk then fails the run). Idempotent: a
    replay finds the batch already ready and answers the same."""
    from tvashtr.metering import running_cost

    rid = uuid.UUID(run_id)
    with session_scope() as session:
        batch = session.execute(
            select(ModelExampleBatch).where(ModelExampleBatch.run_id == rid).with_for_update()
        ).scalar_one_or_none()
        if batch is None:
            return {"ok": False, "drafts": 0}
        drafts = session.execute(
            select(func.count()).where(
                ModelExampleDraft.batch_id == batch.id, ModelExampleDraft.state != "rejected"
            )
        ).scalar_one()
        if drafts == 0:
            return {"ok": False, "drafts": 0}
        if batch.status != "ready":
            outcomes = list(
                session.execute(
                    select(AgentInvocation.outcome).where(
                        AgentInvocation.run_id == run_id,
                        AgentInvocation.outcome.in_(("approved", "changes_requested")),
                    )
                ).scalars()
            )
            # Sent back = the Writer's passes after its first (a rejection on the last allowed
            # pass hands in instead of sending back).
            writer_passes = sum(
                1
                for (tool_config,) in session.execute(
                    select(AgentNode.tool_config)
                    .join(AgentInvocation, AgentInvocation.node_id == AgentNode.id)
                    .where(AgentInvocation.run_id == run_id)
                ).all()
                if ((tool_config or {}).get("tvashtr") or {}).get("examples") == "write"
            )
            batch.review_rounds = len(outcomes)
            batch.sent_back = max(0, writer_passes - 1)
            batch.cost_usd = Decimal(str(running_cost(run_id)))
            batch.status = "ready"
            batch.completed_at = datetime.now(UTC)
        return {"ok": True, "drafts": int(drafts)}


# ---- Home's "Needs you" ----


def inbox_items(session: Session, owner_id: uuid.UUID) -> list[dict]:
    """One line per model with open drafts from a finished batch; it goes when none are open."""
    rows = session.execute(
        select(
            UserModel.id,
            UserModel.name,
            ModelExampleBatch,
            Run.status,
            func.count(ModelExampleDraft.id),
            func.max(ModelExampleDraft.updated_at),
        )
        .join(ModelExampleBatch, ModelExampleBatch.model_id == UserModel.id)
        .join(ModelExampleDraft, ModelExampleDraft.batch_id == ModelExampleBatch.id)
        .outerjoin(Run, Run.id == ModelExampleBatch.run_id)
        .where(UserModel.owner_id == owner_id, ModelExampleDraft.state == "open")
        .group_by(UserModel.id, UserModel.name, ModelExampleBatch.id, Run.status)
    ).all()
    per_model: dict[uuid.UUID, dict] = {}
    for model_id, name, batch, status, count, newest in rows:
        if batch_state(batch, status) == "drafting":
            continue
        since = batch.completed_at or batch.created_at
        item = per_model.setdefault(
            model_id,
            {
                "key": f"model-drafts:{model_id}",
                "kind": "model_drafts",
                "_since": since,
                "_fingerprint": "",
                "count": 0,
                "model_id": str(model_id),
                "model_name": name,
            },
        )
        item["count"] += int(count)
        item["_since"] = min(item["_since"], since)
        item["_fingerprint"] = max(item["_fingerprint"], newest.isoformat())
    return list(per_model.values())
