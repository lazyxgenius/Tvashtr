"""M7 — agent tests: one saved round of one library agent, the checks on what it says, tests from a
file, and the AI check (R7). Contract: ``docs/superpowers/plans/api/agent-tests.md``.

A test keeps a COPY of what the agent got (the task, the documents it read, the change it saw as the
M3 checkpoint diff before the round, the base that diff applies to), so it replays after the run is
gone. The replays themselves run in :mod:`agent_test_runner`. Not a DBOS module: no ``@DBOS``
decorator here or there (the application version stays as it is)."""

from __future__ import annotations

import csv
import io
import json
import logging
import math
import re
import subprocess
import tempfile
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from tvashtr.config import get_settings
from tvashtr.control_plane import node_history, resume
from tvashtr.control_plane.run_failure import node_label
from tvashtr.control_plane.worktree import is_work_tree
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    AgentTest,
    AgentTestResult,
    AgentTestRun,
    AiCheckUsage,
    CostRecord,
    DocumentVersion,
    Edge,
    Run,
    RunEvent,
    TeamGraph,
)

logger = logging.getLogger(__name__)

KINDS = ("must_say", "must_not_say", "must_name_file", "ai")
LABEL = {
    "must_say": "Must say",
    "must_not_say": "Must not say",
    "must_name_file": "Must name a file",
    "ai": "AI check",
}
NAME_MAX = 120
VALUE_MAX = 500
CHECKS_MAX = 10
LABELS_MAX = 20
FILE_MAX_BYTES = 2 * 1024 * 1024
FILE_MAX_ROWS = 200
USES = ("gets", "must_say", "must_name_file", "skip")
NOT_AVAILABLE = "Not available yet"
NO_CHECKS_LEFT = "No AI checks left this month"
_CANT = "Can’t make a test from this round ({})"
_OWN_FILES = {"REPORT.md", "REVIEW_VERDICT.json", "SPEC.md", "TVASHTR_REMEMBER.jsonl"}
_TEST_SUMMARY = re.compile(
    r"\b\d+ (?:failed|passed|errors?|skipped)(?:, \d+ (?:failed|passed|errors?|skipped|warnings?))*"
)
_PAGE_CHARS = 3000


class TestsError(Exception):
    """A refusal with its HTTP status and the plain words the caller shows."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


# ------------------------------------------------------------------------------------- checks


def _norm(text: str) -> str:
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return " ".join(text.casefold().split())


def _names_file(path: str, answer: str, files: list[str]) -> bool:
    want = path.strip().removeprefix("./")
    if not want:
        return False
    if any(f.removeprefix("./") == want for f in files):
        return True
    # The whole path: "a.py" isn't named by "data.py".
    whole = re.compile(r"(?<![\w./-])" + re.escape(want) + r"(?![\w-])", re.IGNORECASE)
    return whole.search(answer) is not None


_VERDICTS = ("approved", "changes requested")


def _verdict_of(answer: str) -> str | None:
    """A reviewer's answer starts with its verdict ("Approved" / "Changes requested: …")."""
    head = _norm(answer)
    return next((v for v in _VERDICTS if head == v or head.startswith(v + ":")), None)


def evaluate(checks: list[dict], answer: str, files: list[str], ai) -> list[dict]:
    """Each check with ``met`` (True / False / None = skipped) and the ``reason`` a person reads.
    ``ai(value, answer) -> (met | None, reason)`` runs an AI check."""
    out = []
    for check in checks:
        kind, value = check["kind"], check["value"]
        verdict = _verdict_of(answer) if _norm(value) in _VERDICTS else None
        if kind == "must_say":
            # A verdict word checks the verdict: "can't be approved" doesn't say Approved.
            met = verdict == _norm(value) if verdict else _norm(value) in _norm(answer)
            reason = None if met else f"It didn’t say “{value}”."
        elif kind == "must_not_say":
            met = verdict != _norm(value) if verdict else _norm(value) not in _norm(answer)
            reason = None if met else f"It said “{value}”."
        elif kind == "must_name_file":
            met = _names_file(value, answer, files)
            reason = None if met else f"It didn’t name or change {value}."
        else:
            met, reason = ai(value, answer)
        out.append({"kind": kind, "value": value, "met": met, "reason": reason})
    return out


def passed(checks: list[dict]) -> bool:
    return all(c["met"] is not False for c in checks)


def _clean_checks(raw) -> list[dict]:
    if not isinstance(raw, list) or not raw:
        raise TestsError(422, "Add at least one check")
    if len(raw) > CHECKS_MAX:
        raise TestsError(422, f"A test can have up to {CHECKS_MAX} checks")
    checks = []
    for item in raw:
        kind = item.get("kind") if isinstance(item, dict) else None
        value = item.get("value") if isinstance(item, dict) else None
        if kind not in KINDS:
            raise TestsError(422, "Pick what each check looks for")
        value = value.strip() if isinstance(value, str) else ""
        if not value:
            raise TestsError(422, f"Fill in the {LABEL[kind]} check")
        if len(value) > VALUE_MAX:
            raise TestsError(422, f"A check can be up to {VALUE_MAX} characters")
        check = {"kind": kind, "value": value}
        if item.get("from_round") is True:
            check["from_round"] = True
        checks.append(check)
    return checks


def _clean_name(raw) -> str:
    name = raw.strip() if isinstance(raw, str) else ""
    if not name:
        raise TestsError(422, "Give the test a name")
    if len(name) > NAME_MAX:
        raise TestsError(422, f"A test name can be up to {NAME_MAX} characters")
    return name


# ----------------------------------------------------------------------------- the AI check (R7)


def _month() -> str:
    return datetime.now(UTC).strftime("%Y-%m")


def ai_status(owner_id: uuid.UUID) -> dict:
    settings = get_settings()
    limit = settings.checks_monthly_limit
    with session_scope() as session:
        used = session.execute(
            select(AiCheckUsage.count).where(
                AiCheckUsage.owner_id == owner_id, AiCheckUsage.month == _month()
            )
        ).scalar_one_or_none()
    return {
        "available": bool(settings.checks_api_key.get_secret_value()),
        "left": max(0, limit - (used or 0)),
        "limit": limit,
    }


def _take_one(owner_id: uuid.UUID) -> bool:
    """Count one AI check against this month's limit; False when the limit is reached. One atomic
    statement, so two machines can't both take the last one."""
    limit = get_settings().checks_monthly_limit
    month = _month()
    with session_scope() as session:
        taken = session.execute(
            insert(AiCheckUsage)
            .values(owner_id=owner_id, month=month, count=1)
            .on_conflict_do_update(
                index_elements=["owner_id", "month"],
                set_={"count": AiCheckUsage.count + 1},
                where=AiCheckUsage.count < limit,
            )
            .returning(AiCheckUsage.count)
        ).scalar_one_or_none()
    return taken is not None


def _give_back(owner_id: uuid.UUID) -> None:
    with session_scope() as session:
        session.execute(
            update(AiCheckUsage)
            .where(
                AiCheckUsage.owner_id == owner_id,
                AiCheckUsage.month == _month(),
                AiCheckUsage.count > 0,
            )
            .values(count=AiCheckUsage.count - 1)
        )


_AI_PROMPT = (
    "You check one answer an AI agent gave against one requirement. Reply with YES or NO on the "
    "first line, then one short sentence saying why.\n\nRequirement: {value}\n\nAnswer:\n{answer}"
)


def ai_check(owner_id: uuid.UUID, value: str, answer: str) -> tuple[bool | None, str | None]:
    """Run one AI check on Tvashtr's key (never the owner's). ``(None, reason)`` when it can't run —
    skipped, not failed."""
    from tvashtr.gateway import CompletionRequest, GatewayError, complete
    from tvashtr.metering import record_cost

    settings = get_settings()
    key = settings.checks_api_key.get_secret_value()
    if not key:
        return None, NOT_AVAILABLE
    if not _take_one(owner_id):
        return None, NO_CHECKS_LEFT
    try:
        result = complete(
            CompletionRequest(
                model=settings.checks_model,
                messages=[
                    {
                        "role": "user",
                        "content": _AI_PROMPT.format(value=value, answer=answer[:12000]),
                    }
                ],
                api_key=key,
                retries=0,
                max_tokens=120,
                temperature=0,
            )
        )
    except GatewayError:
        logger.warning("AI check failed owner_id=%s", owner_id, exc_info=True)
        _give_back(owner_id)  # a check that never answered doesn't count toward the 200
        return None, "The AI check couldn’t answer, so it was skipped"
    # On Tvashtr's key: never in the owner's spend (no run's workflow id).
    record_cost(result, workflow_id=None, idempotency_key=f"agent-check:{uuid.uuid4()}")
    text = (result.text or "").strip()
    first, _, rest = text.partition("\n")
    verdict = first.strip().strip(".:*").upper()
    reason = (rest.strip() or first.strip())[:500] or None
    if verdict.startswith("YES"):
        return True, reason
    if verdict.startswith("NO"):
        return False, reason
    return None, "The AI check couldn’t answer, so it was skipped"


# ----------------------------------------------------------------------- the round → its inputs


def _edges(session, team_graph_id: uuid.UUID) -> list[dict]:
    return [
        {
            "source": str(e.source_node_id),
            "target": str(e.target_node_id),
            "edge_type": e.edge_type,
            "conditions": e.conditions,
        }
        for e in session.execute(select(Edge).where(Edge.team_graph_id == team_graph_id)).scalars()
    ]


def blocked_rounds(session, run: Run, invocations: list[AgentInvocation]) -> dict[int, str | None]:
    """Each round's reason it can't be a test (None ⇒ it can): a round that didn't finish, a folder
    that was on the person's computer, a change before it that has no checkpoint or is too large."""
    out: dict[int, str | None] = {}
    # A Desktop folder run's copy lives on one machine only for the run: never a test. A
    # self-hosted run's own folder can be, while it's still there.
    folder_gone = run.local_snapshot_id is not None or (
        bool(run.repo_path) and not run.github_repo and not is_work_tree(run.repo_path)
    )
    rows = cps = None
    for inv in invocations:
        if inv.status != "done":
            out[inv.id] = _CANT.format("it didn’t finish")
            continue
        if folder_gone:
            out[inv.id] = _CANT.format("its folder was on your computer")
            continue
        if rows is None:
            rows = resume.step_rows(session, run, lines=[])
            cps = resume._checkpoints(session, run)
        out[inv.id] = _blocked_by_checkpoints(run, inv, rows, cps)
    return out


def _blocked_by_checkpoints(run: Run, inv, rows, cps) -> str | None:
    k = next((i for i, r in enumerate(rows) if r.get("invocation_id") == inv.id), None)
    if k is None:
        return _CANT.format("it ran before checkpoints")
    ok, cp = resume._predecessor(rows, k, cps)
    if not ok:
        if cp is not None and cp.too_large:
            return _CANT.format("its change was too large to keep")
        return _CANT.format("it ran before checkpoints")
    if run.repo_path and _base_sha(cp, cps) is None:
        return _CANT.format("it ran before checkpoints")
    return None


def _base_sha(cp, cps) -> str | None:
    """The commit the rebuilt repo is cut from: the predecessor's base, else any of the run's."""
    if cp is not None and cp.base_sha:
        return cp.base_sha
    return next((c.base_sha for c in cps.values() if c.base_sha), None)


def _numstat(diff: bytes | None) -> list[dict]:
    if not diff:
        return []
    with tempfile.TemporaryDirectory() as tmp:
        try:
            out = subprocess.run(
                ["git", "apply", "--numstat", "-"],
                input=diff,
                capture_output=True,
                cwd=tmp,
                timeout=60,
                check=True,
            ).stdout.decode(errors="replace")
        except (subprocess.SubprocessError, OSError):
            return []
    change = []
    for line in out.splitlines():
        parts = line.split("\t", 2)
        if len(parts) != 3 or parts[2].rsplit("/", 1)[-1] in _OWN_FILES:
            continue
        added, removed, path = parts
        change.append(
            {
                "path": path,
                "added": int(added) if added.isdigit() else 0,
                "removed": int(removed) if removed.isdigit() else 0,
            }
        )
    return change


def _test_output(session, run: Run, inv_ids: list[int]) -> str | None:
    """The last test summary ("3 failed, 38 passed") a command showed in these rounds."""
    for inv_id in inv_ids:
        rows = session.execute(
            select(RunEvent.payload)
            .where(
                RunEvent.run_id == str(run.id),
                RunEvent.invocation_id == inv_id,
                RunEvent.kind == "observation",
            )
            .order_by(RunEvent.seq.desc())
        ).scalars()
        for payload in rows:
            found = _TEST_SUMMARY.findall(str((payload or {}).get("observation") or ""))
            if found:
                return found[-1]
    return None


def _answered(inv: AgentInvocation, emits: bool) -> str | None:
    if not emits:
        return None
    return {"approved": "Approved", "changes_requested": "Changes requested"}.get(inv.outcome or "")


def _round(session, owner_id: uuid.UUID, node: AgentNode, invocation_id) -> dict:
    """Everything a test from this round keeps, or a 404 / 409 TestsError."""
    try:
        inv_id = int(invocation_id)
    except (TypeError, ValueError) as exc:
        raise TestsError(404, "Round not found for this agent") from exc
    inv = session.get(AgentInvocation, inv_id)
    clone = session.get(AgentNode, inv.node_id) if inv is not None else None
    if inv is None or clone is None or clone.cloned_from_node_id != node.id:
        raise TestsError(404, "Round not found for this agent")
    try:
        run = session.get(Run, uuid.UUID(inv.run_id))
    except ValueError:
        run = None
    if run is None or run.owner_id != owner_id:
        raise TestsError(404, "Round not found for this agent")
    reason = blocked_rounds(session, run, [inv])[inv.id]
    if reason:
        raise TestsError(409, reason)
    rows = resume.step_rows(session, run, lines=[])
    cps = resume._checkpoints(session, run)
    k = next(i for i, r in enumerate(rows) if r.get("invocation_id") == inv.id)
    _ok, cp = resume._predecessor(rows, k, cps)
    diff = None
    if cp is not None:
        diff = session.execute(
            select(type(cp).diff).where(type(cp).id == cp.id)
        ).scalar_one_or_none()
    edges = _edges(session, run.team_graph_id)
    from tvashtr.control_plane.team_run import node_emits_outcome

    emits = node_emits_outcome(edges, str(clone.id))
    is_entry = not any(e["target"] == str(clone.id) for e in edges)
    given = node_history._documents_given(
        inv, clone, run, node_history._run_documents(session, run), is_entry
    )
    documents = []
    for ref in given:
        try:
            doc_id = uuid.UUID(str(ref.get("document_id")))
        except ValueError:
            continue
        content = session.execute(
            select(DocumentVersion.content).where(
                DocumentVersion.document_id == doc_id,
                DocumentVersion.version_no == ref.get("version_no"),
            )
        ).scalar_one_or_none()
        if content is not None:
            documents.append(
                {
                    "name": ref.get("name") or "Spec",
                    "version_no": ref.get("version_no"),
                    "is_shared_spec": bool(ref.get("is_shared_spec")),
                    "content": content,
                }
            )
    base: dict = {"kind": "empty"}
    if run.repo_path:
        base = {
            "kind": "repo",
            "github_repo": run.github_repo,
            "repo_path": None if run.github_repo else run.repo_path,
            "sha": _base_sha(cp, cps),
            "subpath": run.subpath,
        }
    prev_inv = cp.invocation_id if cp is not None else None
    inputs = {
        "task": run.idea,
        "documents": documents,
        "feedback": (cp.state or {}).get("reviewer_feedback") if cp is not None else None,
        "iteration": inv.iteration,
        "base": base,
        # A greenfield workspace's .gitignore is Tvashtr's own file, not the agent's change.
        "change": [
            c for c in _numstat(diff) if base["kind"] == "repo" or c["path"] != ".gitignore"
        ],
        "test_output": _test_output(session, run, [i for i in (inv.id, prev_inv) if i]),
        "answered": _answered(inv, emits),
    }
    return {
        "run": run,
        "inv": inv,
        "role": node_label(node.role_name, node.kind, node.config),
        "inputs": inputs,
        "diff": diff,
        "run_number": node_history._run_number(session, run),
    }


def _gets(inputs: dict) -> dict:
    return {
        "task": inputs.get("task") or "",
        "documents": [
            {
                "name": d.get("name"),
                "version_no": d.get("version_no"),
                "pages": max(1, math.ceil(len(d.get("content") or "") / _PAGE_CHARS)),
                "is_shared_spec": bool(d.get("is_shared_spec")),
            }
            for d in inputs.get("documents") or []
        ],
        "change": list(inputs.get("change") or []),
        "test_output": inputs.get("test_output"),
        "feedback": bool(inputs.get("feedback")),
    }


def _require_node(session, owner_id, team_id, node_id) -> AgentNode:
    try:
        node = node_history.require_team_node(session, team_id, node_id, owner_id)
    except node_history.NodeHistoryNotFound as exc:
        raise TestsError(404, "Agent not found") from exc
    if node.kind not in ("agent", "completion"):
        raise TestsError(404, "Agent not found")
    return node


def from_round(owner_id: uuid.UUID, team_id: str, node_id: str, invocation_id) -> dict:
    with session_scope() as session:
        node = _require_node(session, owner_id, team_id, node_id)
        found = _round(session, owner_id, node, invocation_id)
        inputs = found["inputs"]
        checks = []
        if inputs["answered"]:
            checks.append({"kind": "must_say", "value": inputs["answered"], "from_round": True})
        est = estimate(session, node, 1)
        return {
            "invocation_id": found["inv"].id,
            "run_id": str(found["run"].id),
            "run_number": found["run_number"],
            "iteration": found["inv"].iteration,
            "role": found["role"],
            "answered": inputs["answered"],
            "gets": _gets(inputs),
            "checks": checks,
            "estimate": {"cost_usd": est["cost_usd"]} if est else None,
            "ai": ai_status(owner_id),
        }


def create_from_round(owner_id: uuid.UUID, team_id: str, node_id: str, body: dict) -> dict:
    name = _clean_name(body.get("name"))
    checks = _clean_checks(body.get("checks"))
    with session_scope() as session:
        node = _require_node(session, owner_id, team_id, node_id)
        found = _round(session, owner_id, node, body.get("invocation_id"))
        test = AgentTest(
            owner_id=owner_id,
            team_id=node.team_graph_id,
            node_id=node.id,
            name=name,
            source="round",
            source_run_id=found["run"].id,
            source_run_number=found["run_number"],
            source_invocation_id=found["inv"].id,
            source_iteration=found["inv"].iteration,
            inputs=found["inputs"],
            diff=found["diff"],
            checks=checks,
        )
        session.add(test)
        session.flush()
        return {"test": _test_view(test)}


# ----------------------------------------------------------------------------------- the file


def _parse(filename: str, content: str) -> tuple[list[str], list[dict]]:
    if not isinstance(content, str) or not content.strip():
        raise TestsError(422, "This file can’t be read: it is empty.")
    if len(content.encode("utf-8", errors="replace")) > FILE_MAX_BYTES:
        raise TestsError(422, "This file can’t be read: it is larger than 2 MB.")
    text = content.lstrip("﻿")
    looks_json = (filename or "").lower().endswith((".jsonl", ".json", ".ndjson")) or (
        text.lstrip().startswith("{")
    )
    columns: list[str] = []
    rows: list[dict] = []
    if looks_json:
        for n, line in enumerate(text.splitlines(), start=1):
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except ValueError as exc:
                raise TestsError(
                    422, f"This file can’t be read: line {n} isn’t valid JSON."
                ) from exc
            if not isinstance(obj, dict):
                raise TestsError(422, f"This file can’t be read: line {n} isn’t a JSON object.")
            for key in obj:
                if str(key) not in columns:
                    columns.append(str(key))
            rows.append(
                {
                    str(k): v if isinstance(v, str) else json.dumps(v) if v is not None else ""
                    for k, v in obj.items()
                }
            )
    else:
        try:
            reader = csv.reader(io.StringIO(text))
            table = [r for r in reader if any(cell.strip() for cell in r)]
        except csv.Error as exc:
            raise TestsError(422, f"This file can’t be read: {exc}.") from exc
        if len(table) < 2:
            raise TestsError(422, "This file can’t be read: it has no header row and no rows.")
        columns = [c.strip() or f"column {i + 1}" for i, c in enumerate(table[0])]
        for r in table[1:]:
            rows.append({c: (r[i] if i < len(r) else "") for i, c in enumerate(columns)})
    if not rows:
        raise TestsError(422, "This file can’t be read: it has no rows.")
    if len(rows) > FILE_MAX_ROWS:
        raise TestsError(422, f"This file can’t be read: it has more than {FILE_MAX_ROWS} rows.")
    return columns, rows


_GUESS = (
    ("gets", ("task", "input", "prompt", "idea", "diff", "change", "patch", "spec", "question")),
    ("must_say", ("expected", "must_say", "must say", "answer", "output", "verdict", "says")),
    ("must_name_file", ("file", "path", "must_name_file", "filename")),
)


def _guess(column: str) -> str:
    low = column.strip().lower()
    for use, words in _GUESS:
        if low in words or any(low.startswith(w) for w in words):
            return use
    return "skip"


def _clean_mapping(columns: list[str], mapping) -> dict[str, str]:
    if mapping is None:
        return {c: _guess(c) for c in columns}
    if not isinstance(mapping, dict):
        raise TestsError(422, "Pick a use for each column")
    out = {}
    for c in columns:
        use = mapping.get(c, "skip")
        if use not in USES:
            raise TestsError(422, "Pick a use for each column")
        out[c] = use
    return out


def _file_tests(columns, rows, mapping) -> list[dict]:
    gets = [c for c in columns if mapping[c] == "gets"]
    if not gets:
        raise TestsError(422, "Pick a column for What the agent gets.")
    made = []
    for n, row in enumerate(rows, start=1):
        task = (row.get(gets[0]) or "").strip()
        if not task:
            continue
        for extra in gets[1:]:
            value = (row.get(extra) or "").strip()
            if value:
                task += f"\n\n{extra}:\n{value}"
        checks = [
            {"kind": mapping[c], "value": (row.get(c) or "").strip()[:VALUE_MAX]}
            for c in columns
            if mapping[c] in ("must_say", "must_name_file") and (row.get(c) or "").strip()
        ][:CHECKS_MAX]
        if not checks:
            continue
        first_line = task.splitlines()[0].strip()
        made.append({"row": n, "task": task, "name": first_line[:NAME_MAX], "checks": checks})
    return made


def check_file(
    owner_id: uuid.UUID, team_id: str, node_id: str, filename: str, content: str, mapping
) -> dict:
    with session_scope() as session:
        _require_node(session, owner_id, team_id, node_id)
    columns, rows = _parse(filename, content)
    used = _clean_mapping(columns, mapping)
    try:
        made = _file_tests(columns, rows, used)
    except TestsError:
        made = []
    return {
        "filename": filename,
        "rows": len(rows),
        "columns": [
            {"name": c, "first": str(rows[0].get(c) or "")[:200], "use": used[c]} for c in columns
        ],
        "ready": {
            "tests": len(made),
            "must_say": sum(any(k["kind"] == "must_say" for k in t["checks"]) for t in made),
            "must_name_file": sum(
                any(k["kind"] == "must_name_file" for k in t["checks"]) for t in made
            ),
        },
    }


def import_file(
    owner_id: uuid.UUID, team_id: str, node_id: str, filename: str, content: str, mapping
) -> dict:
    if mapping is None:
        raise TestsError(422, "Pick a use for each column")
    columns, rows = _parse(filename, content)
    made = _file_tests(columns, rows, _clean_mapping(columns, mapping))
    if not made:
        raise TestsError(422, "No row has a task and something to check")
    with session_scope() as session:
        node = _require_node(session, owner_id, team_id, node_id)
        for t in made:
            session.add(
                AgentTest(
                    owner_id=owner_id,
                    team_id=node.team_graph_id,
                    node_id=node.id,
                    name=t["name"],
                    source="file",
                    source_row=t["row"],
                    inputs={
                        "task": t["task"],
                        "documents": [],
                        "feedback": None,
                        "iteration": 1,
                        "base": {"kind": "empty"},
                        "change": [],
                        "test_output": None,
                        "answered": None,
                    },
                    checks=t["checks"],
                )
            )
    return {"added": len(made)}


# ------------------------------------------------------------------------------- the views


def _meta(test: AgentTest) -> str:
    plain = sum(1 for c in test.checks if c["kind"] != "ai")
    words = f"{plain} check" + ("" if plain == 1 else "s")
    if any(c["kind"] == "ai" for c in test.checks):
        words = f"{words} + AI check" if plain else "AI check"
    if test.source == "file":
        return f"From a file · row {test.source_row} · {words}"
    number = f"run #{test.source_run_number}" if test.source_run_number else "a run"
    return f"From {number} · round {test.source_iteration} · {words}"


def _test_view(test: AgentTest) -> dict:
    if test.source == "file":
        source = {"kind": "file", "row": test.source_row}
    else:
        source = {
            "kind": "round",
            "run_id": str(test.source_run_id) if test.source_run_id else None,
            "run_number": test.source_run_number,
            "iteration": test.source_iteration,
        }
    checks = []
    for c in test.checks:
        item = {"kind": c["kind"], "value": c["value"]}
        if c.get("from_round"):
            item["from_round"] = True
        if c["kind"] == "ai":
            judge = c.get("judge")
            item["judge"] = {k: judge[k] for k in ("agree", "total", "trusted")} if judge else None
        checks.append(item)
    return {
        "id": str(test.id),
        "name": test.name,
        "meta": _meta(test),
        "source": source,
        "checks": checks,
        "gets": _gets(test.inputs),
        "created_at": test.created_at.isoformat() if test.created_at else None,
    }


def _ago(at: datetime) -> str:
    secs = max(0, int((datetime.now(UTC) - at).total_seconds()))
    if secs < 60:
        return "just now"
    if secs < 3600:
        return f"{secs // 60}m ago"
    if secs < 86400:
        return f"{secs // 3600}h ago"
    return f"{secs // 86400}d ago"


def _counts(results: list[AgentTestResult]) -> tuple[int, int, int]:
    done = sum(r.status in ("passed", "failed") for r in results)
    ok = sum(r.status == "passed" for r in results)
    return done, ok, sum(r.status == "failed" for r in results)


def _run_view(session, run: AgentTestRun) -> dict:
    results = (
        session.execute(
            select(AgentTestResult)
            .where(AgentTestResult.test_run_id == run.id)
            .order_by(AgentTestResult.position)
        )
        .scalars()
        .all()
    )
    done, ok, bad = _counts(results)
    since = None
    if run.status == "done" and run.version_number is not None:
        prev = session.execute(
            select(AgentTestRun)
            .where(
                AgentTestRun.node_id == run.node_id,
                AgentTestRun.status == "done",
                AgentTestRun.version_number < run.version_number,
            )
            .order_by(AgentTestRun.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if prev is not None:
            prev_ok = session.execute(
                select(func.count())
                .select_from(AgentTestResult)
                .where(AgentTestResult.test_run_id == prev.id, AgentTestResult.status == "passed")
            ).scalar_one()
            since = {"version": prev.version_number, "delta": ok - prev_ok}
    end = run.ended_at or datetime.now(UTC)
    return {
        "id": str(run.id),
        "status": run.status,
        "version": run.version_number,
        "trigger": run.trigger,
        "total": run.total,
        "done": done,
        "passed": ok,
        "failed": bad,
        "cost_usd": round(float(run.cost_usd or 0), 4),
        "started_at": run.created_at.isoformat(),
        "ended_at": run.ended_at.isoformat() if run.ended_at else None,
        "elapsed_s": max(0, int((end - run.created_at).total_seconds())),
        "waiting_for_slot": bool(run.waiting_for_slot) and run.status == "running",
        "error": run.error,
        "since": since,
        "results": [_result_view(r) for r in results],
    }


def _result_view(r: AgentTestResult) -> dict:
    return {
        "id": str(r.id),
        "test_id": str(r.test_id) if r.test_id else None,
        "name": r.name,
        "status": r.status,
        "answer": r.answer,
        "files": list(r.files or []),
        "checks": list(r.checks or []),
        "error": r.error,
        "cost_usd": round(float(r.cost_usd or 0), 4),
    }


def _last_line(view: dict) -> str | None:
    if view["status"] == "running" or view["ended_at"] is None:
        return None
    ended = datetime.fromisoformat(view["ended_at"])
    on = f"Last run on v{view['version']}" if view["version"] else "Last run"
    tail = f"{view['passed']} passed"
    if view["failed"]:
        tail += f", {view['failed']} failed"
    if view["status"] == "stopped":
        tail += " · stopped"
    return f"{on} · {_ago(ended)} · {tail}"


def estimate(session, node: AgentNode, count: int) -> dict | None:
    """About what ``count`` replays cost on the owner's keys and how long they take: the average of
    this agent's finished replays, else of its finished rounds; None when it never ran."""
    if count <= 0:
        return None
    rows = session.execute(
        select(AgentTestResult.cost_usd, AgentTestResult.started_at, AgentTestResult.ended_at)
        .join(AgentTestRun, AgentTestRun.id == AgentTestResult.test_run_id)
        .where(
            AgentTestRun.node_id == node.id,
            AgentTestResult.status.in_(("passed", "failed")),
            AgentTestResult.started_at.is_not(None),
            AgentTestResult.ended_at.is_not(None),
        )
        .order_by(AgentTestResult.ended_at.desc())
        .limit(20)
    ).all()
    samples = [(float(c or 0), (e - s).total_seconds()) for c, s, e in rows]
    if not samples:
        invs = session.execute(
            select(AgentInvocation.id, AgentInvocation.started_at, AgentInvocation.ended_at)
            .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
            .where(
                AgentNode.cloned_from_node_id == node.id,
                AgentInvocation.status == "done",
                AgentInvocation.ended_at.is_not(None),
            )
            .order_by(AgentInvocation.id.desc())
            .limit(10)
        ).all()
        costs = dict(
            session.execute(
                select(CostRecord.invocation_id, func.sum(CostRecord.cost_usd))
                .where(CostRecord.invocation_id.in_([i for i, _s, _e in invs]))
                .group_by(CostRecord.invocation_id)
            ).all()
        )
        samples = [(float(costs.get(i) or 0), (e - s).total_seconds()) for i, s, e in invs]
    if not samples:
        return None
    cost = sum(c for c, _ in samples) / len(samples) * count
    secs = sum(t for _, t in samples) / len(samples) * count
    return {"cost_usd": round(cost, 2), "minutes": max(1, round(secs / 60))}


def tests_view(owner_id: uuid.UUID, team_id: str, node_id: str) -> dict:
    from tvashtr.control_plane import agent_test_runner

    with session_scope() as session:
        node = _require_node(session, owner_id, team_id, node_id)
        tests = (
            session.execute(
                select(AgentTest)
                .where(AgentTest.node_id == node.id)
                .order_by(AgentTest.created_at, AgentTest.source_row.nulls_first(), AgentTest.id)
            )
            .scalars()
            .all()
        )
        run = session.execute(
            select(AgentTestRun)
            .where(AgentTestRun.node_id == node.id)
            .order_by(AgentTestRun.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if run is not None:
            agent_test_runner.end_if_stale(session, run)
        view = _run_view(session, run) if run is not None else None
        return {
            "tests": [_test_view(t) for t in tests],
            "run": view,
            "last": _last_line(view) if view else None,
            "estimate": estimate(session, node, len(tests)),
            "ai": ai_status(owner_id),
        }


def delete_test(owner_id: uuid.UUID, team_id: str, node_id: str, test_id: str) -> None:
    with session_scope() as session:
        node = _require_node(session, owner_id, team_id, node_id)
        test = _owned_test(session, node, test_id)
        session.delete(test)


def _owned_test(session, node: AgentNode, test_id: str) -> AgentTest:
    try:
        tid = uuid.UUID(str(test_id))
    except ValueError as exc:
        raise TestsError(404, "Test not found") from exc
    test = session.get(AgentTest, tid)
    if test is None or test.node_id != node.id:
        raise TestsError(404, "Test not found")
    return test


def result_detail(owner_id: uuid.UUID, team_id: str, node_id: str, result_id: str) -> dict:
    with session_scope() as session:
        node = _require_node(session, owner_id, team_id, node_id)
        try:
            rid = uuid.UUID(str(result_id))
        except ValueError as exc:
            raise TestsError(404, "Replay not found") from exc
        row = session.execute(
            select(AgentTestResult, AgentTestRun)
            .join(AgentTestRun, AgentTestRun.id == AgentTestResult.test_run_id)
            .where(AgentTestResult.id == rid, AgentTestRun.node_id == node.id)
        ).first()
        if row is None:
            raise TestsError(404, "Replay not found")
        result, run = row
        test = session.get(AgentTest, result.test_id) if result.test_id else None
        duration = (
            int((result.ended_at - result.started_at).total_seconds())
            if result.started_at and result.ended_at
            else None
        )
        return {
            **_result_view(result),
            "version": run.version_number,
            "at": (result.ended_at or result.started_at or run.created_at).isoformat(),
            "duration_s": duration,
            "gets": _gets(test.inputs) if test is not None else None,
        }


# --------------------------------------------------------------------- Check the AI check


def _closing(session, run: Run, inv: AgentInvocation) -> str | None:
    """What a non-reviewer round answered: its closing message (a replay is checked on the same)."""
    from tvashtr.control_plane.team_run import _closing_text

    for kind, payload in session.execute(
        select(RunEvent.kind, RunEvent.payload)
        .where(RunEvent.run_id == str(run.id), RunEvent.invocation_id == inv.id)
        .order_by(RunEvent.seq.desc())
    ).all():
        found = _closing_text(kind, payload)
        if found is not None:
            return found
    return None


def answers(owner_id: uuid.UUID, team_id: str, node_id: str, test_id: str) -> dict:
    """Up to 20 distinct answers this agent gave — its replays' and its rounds' — newest first.
    Only real answers: a reviewer's verdict, else the round's closing message (never its brief)."""
    with session_scope() as session:
        node = _require_node(session, owner_id, team_id, node_id)
        _owned_test(session, node, test_id)
        found: list[tuple[datetime, str, str]] = []
        for answer, version, at in session.execute(
            select(AgentTestResult.answer, AgentTestRun.version_number, AgentTestResult.ended_at)
            .join(AgentTestRun, AgentTestRun.id == AgentTestResult.test_run_id)
            .where(AgentTestRun.node_id == node.id, AgentTestResult.answer.is_not(None))
            .order_by(AgentTestResult.ended_at.desc().nulls_last())
            .limit(60)
        ).all():
            origin = f"A replay on v{version}" if version else "A replay"
            found.append((at or datetime.min.replace(tzinfo=UTC), answer, origin))
        rounds = session.execute(
            select(AgentInvocation, Run)
            .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
            .join(Run, Run.team_graph_id == AgentNode.team_graph_id)
            .where(
                AgentNode.cloned_from_node_id == node.id,
                Run.owner_id == owner_id,
                AgentInvocation.status == "done",
            )
            .order_by(AgentInvocation.id.desc())
            .limit(60)
        ).all()
        for inv, run in rounds:
            label = (
                _answered(inv, True) if inv.outcome in ("approved", "changes_requested") else None
            )
            if label:
                text = inv.outcome_detail
                text = label if not text or label == "Approved" else f"{label}: {text}"
            else:
                text = _closing(session, run, inv)
            if not text:
                continue
            number = node_history._run_number(session, run)
            origin = (
                f"Run #{number} · round {inv.iteration}" if number else f"Round {inv.iteration}"
            )
            found.append((inv.ended_at or inv.started_at, text, origin))
        found.sort(key=lambda row: row[0], reverse=True)
        seen: set[str] = set()
        out: list[dict] = []
        for _at, text, origin in found:
            text = (text or "").strip()
            if text and _norm(text) not in seen and len(out) < LABELS_MAX:
                seen.add(_norm(text))
                out.append({"text": text, "from": origin})
        return {"answers": out}


def judge(owner_id: uuid.UUID, team_id: str, node_id: str, test_id: str, body: dict) -> dict:
    """Label answers yourself; the AI check runs on each new one; trusted at ≥ 8 of 10 (R7)."""
    labels = body.get("labels")
    if not isinstance(labels, list) or not 1 <= len(labels) <= LABELS_MAX:
        raise TestsError(422, f"Label between 1 and {LABELS_MAX} answers")
    clean = []
    for item in labels:
        answer = item.get("answer") if isinstance(item, dict) else None
        you = item.get("you") if isinstance(item, dict) else None
        if not isinstance(answer, str) or not answer.strip() or not isinstance(you, bool):
            raise TestsError(422, "Each label needs an answer and Yes or No")
        clean.append((answer.strip()[:12000], you))
    with session_scope() as session:
        node = _require_node(session, owner_id, team_id, node_id)
        test = _owned_test(session, node, test_id)
        index = body.get("check")
        if (
            not isinstance(index, int)
            or not 0 <= index < len(test.checks)
            or test.checks[index]["kind"] != "ai"
        ):
            raise TestsError(422, "Pick an AI check")
        if not get_settings().checks_api_key.get_secret_value():
            raise TestsError(409, "AI checks aren’t available yet")
        value = test.checks[index]["value"]
        known = {
            _norm(row["answer"]): row
            for row in (test.checks[index].get("judge") or {}).get("labels", [])
            if row.get("ai") is not None
        }
    rows = []
    for answer, you in clean:
        prior = known.get(_norm(answer))
        if prior is not None:
            ai, reason = prior["ai"], prior.get("reason")
        else:
            ai, reason = ai_check(owner_id, value, answer)
        rows.append({"answer": answer, "you": you, "ai": ai, "reason": reason})
    judged = [r for r in rows if r["ai"] is not None]
    agree = sum(r["ai"] == r["you"] for r in judged)
    total = len(judged)
    trusted = total >= 10 and agree >= 0.8 * total
    with session_scope() as session:
        test = session.get(AgentTest, uuid.UUID(str(test_id)))
        checks = [dict(c) for c in test.checks]
        if index < len(checks) and checks[index]["kind"] == "ai":
            checks[index]["judge"] = {
                "labels": rows,
                "agree": agree,
                "total": total,
                "trusted": trusted,
            }
            test.checks = checks
            test.updated_at = datetime.now(UTC)
    return {
        "rows": rows,
        "agree": agree,
        "total": total,
        "trusted": trusted,
        "ai": ai_status(owner_id),
    }


# ------------------------------------------------------------ the canvas, History and Save as vN


def _live(run: AgentTestRun) -> bool:
    """Running, and its worker heard from lately (a restart leaves a run "running" for nobody)."""
    from tvashtr.control_plane.agent_test_runner import STALE_AFTER_S

    fresh = datetime.now(UTC) - timedelta(seconds=STALE_AFTER_S)
    return run.status == "running" and run.heartbeat_at > fresh


def graph_tests(session, node_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """``{node_id: {total, passed, ran, running}}`` for the agents that have tests."""
    if not node_ids:
        return {}
    totals = dict(
        session.execute(
            select(AgentTest.node_id, func.count())
            .where(AgentTest.node_id.in_(node_ids))
            .group_by(AgentTest.node_id)
        ).all()
    )
    if not totals:
        return {}
    runs = (
        session.execute(
            select(AgentTestRun)
            .where(AgentTestRun.node_id.in_(list(totals)))
            .order_by(AgentTestRun.node_id, AgentTestRun.created_at.desc())
        )
        .scalars()
        .all()
    )
    latest: dict[uuid.UUID, AgentTestRun] = {}
    finished: dict[uuid.UUID, AgentTestRun] = {}
    for run in runs:
        latest.setdefault(run.node_id, run)
        if run.status in ("done", "stopped"):
            finished.setdefault(run.node_id, run)
    ids = {r.id for r in list(latest.values()) + list(finished.values())}
    tally: dict[uuid.UUID, tuple[int, int]] = {}
    for run_id, status, n in session.execute(
        select(AgentTestResult.test_run_id, AgentTestResult.status, func.count())
        .where(AgentTestResult.test_run_id.in_(ids))
        .group_by(AgentTestResult.test_run_id, AgentTestResult.status)
    ).all():
        done, ok = tally.get(run_id, (0, 0))
        if status in ("passed", "failed"):
            done += n
        if status == "passed":
            ok += n
        tally[run_id] = (done, ok)
    out = {}
    for node_id, total in totals.items():
        run, fin = latest.get(node_id), finished.get(node_id)
        running = None
        if run is not None and _live(run):
            running = {"done": tally.get(run.id, (0, 0))[0], "total": run.total}
        out[node_id] = {
            "total": int(total),
            "passed": tally.get(fin.id, (0, 0))[1] if fin else None,
            "ran": fin.total if fin else None,  # "2 of 6 tests" after a stopped run too
            "stopped": bool(fin and fin.status == "stopped"),
            "running": running,
        }
    return out


def version_rows(session, team: TeamGraph) -> dict[int, dict]:
    """History's pill per version: the newest test run of each agent on it, added up."""
    runs = (
        session.execute(
            select(AgentTestRun)
            .where(AgentTestRun.team_id == team.id, AgentTestRun.version_number.is_not(None))
            .order_by(AgentTestRun.created_at.desc())
        )
        .scalars()
        .all()
    )
    newest: dict[tuple[int, uuid.UUID], AgentTestRun] = {}
    for run in runs:
        newest.setdefault((run.version_number, run.node_id), run)
    if not newest:
        return {}
    counts: dict[uuid.UUID, int] = dict(
        session.execute(
            select(AgentTestResult.test_run_id, func.count())
            .where(
                AgentTestResult.test_run_id.in_([r.id for r in newest.values()]),
                AgentTestResult.status == "passed",
            )
            .group_by(AgentTestResult.test_run_id)
        ).all()
    )
    out: dict[int, dict] = {}
    for (number, _node), run in newest.items():
        row = out.setdefault(number, {"passed": 0, "total": 0, "running": False})
        row["passed"] += int(counts.get(run.id, 0))
        row["total"] += run.total
        row["running"] = row["running"] or _live(run)
    return out


def _whose(name: str) -> str:
    return f"the {name}’s" if not name.endswith("s") else f"the {name}’"


def nudge(session, rows: list[dict]) -> dict | None:
    """Save as vN's offer to run the changed agents' tests (R6), or None."""
    by_agent: dict[str, dict] = {}
    for row in rows:
        node_id = row.get("node_id")
        if node_id and row.get("agent"):
            entry = by_agent.setdefault(node_id, {"name": row["agent"], "fields": []})
            if row.get("field"):
                entry["fields"].append(str(row["field"]).lower())
    if not by_agent:
        return None
    ids = []
    for node_id in by_agent:
        try:
            ids.append(uuid.UUID(node_id))
        except ValueError:
            continue
    counts = {
        str(n): int(c)
        for n, c in session.execute(
            select(AgentTest.node_id, func.count())
            .where(AgentTest.node_id.in_(ids))
            .group_by(AgentTest.node_id)
        ).all()
    }
    agents = [
        {"node_id": n, "name": by_agent[n]["name"], "count": counts[n]}
        for n in by_agent
        if counts.get(n)
    ]
    if not agents:
        return None
    count = sum(a["count"] for a in agents)
    tests = f"{count} test" + ("" if count == 1 else "s")
    if len(agents) == 1:
        agent = agents[0]
        fields = list(dict.fromkeys(by_agent[agent["node_id"]]["fields"]))
        what = f"the {agent['name']}"
        if fields:
            joined = (
                fields[0] if len(fields) == 1 else ", ".join(fields[:-1]) + " and " + fields[-1]
            )
            what = f"{_whose(agent['name'])} {joined}"
        sub = f"You changed {what}. The {agent['name']} has {tests}."
        option = f"Save and run {_whose(agent['name'])} {tests}"
    else:
        names = [f"the {a['name']}" for a in agents]
        joined = ", ".join(names[:-1]) + " and " + names[-1]
        sub = f"You changed {joined}. They have {tests}."
        option = f"Save and run their {tests}"
    est = None
    for a in agents:
        node = session.get(AgentNode, uuid.UUID(a["node_id"]))
        one = estimate(session, node, a["count"]) if node is not None else None
        if one is None:
            est = None
            break
        est = {
            "cost_usd": round((est or {}).get("cost_usd", 0) + one["cost_usd"], 2),
            "minutes": (est or {}).get("minutes", 0) + one["minutes"],
        }
    return {"count": count, "agents": agents, "sub": sub, "option": option, "estimate": est}
