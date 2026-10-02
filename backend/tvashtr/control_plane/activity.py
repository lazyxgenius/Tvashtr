"""The run view's Activity (M2): every agent's steps in plain words, run-wide.

``GET /api/runs/{id}/activity`` (contract: ``docs/superpowers/plans/api/activity.md``) — the ONE
place the run view's words come from. :func:`build` is pure: rows in (the run, its graph, its
invocations, events, human tasks and document versions), the reply out. :func:`run_activity` reads
the rows for one run.

Never model reasoning: an action's ``thought`` and an agent's own words are never read — a closing
message is "Finished its step". Engine payloads arrive in two shapes: OpenHands' ``str(Action)`` /
``str(Observation)`` (pydantic ``field='value'``, capped at 2000 characters by the adapter) and the
Desktop runner's JSON tool input with a plain-text result. Tool names are matched lower-cased.

Openhands-free, like the rest of ``control_plane``.
"""

import ast
import difflib
import hashlib
import json
import re
import shlex
import uuid
from collections import OrderedDict
from datetime import UTC, datetime

from sqlalchemy import literal_column, or_, select
from sqlalchemy.dialects.postgresql import JSONB

from tvashtr.control_plane import live_state, run_views
from tvashtr.control_plane.connector_proxy import EVENT_KINDS as CONNECTOR_EVENT_KINDS
from tvashtr.control_plane.guardrails import mask_secrets
from tvashtr.control_plane.run_failure import describe_run_failure, humanise, node_label
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    Document,
    DocumentVersion,
    HumanTask,
    Run,
    RunEvent,
)

_READ_TOOLS = {"read", "read_file", "view", "notebookread"}
_EDIT_TOOLS = {
    "edit",
    "write",
    "multiedit",
    "notebookedit",
    "create",
    "edit_file",
    "write_file",
    "search_replace",
    "str_replace",
}
_SEARCH_TOOLS = {"grep", "glob", "search", "find", "grep_search", "file_search", "codebase_search"}
_EDITOR_TOOLS = {"file_editor", "str_replace_editor"}
_SEARCH_COMMANDS = {"grep", "rg", "ag", "find", "egrep", "fgrep"}
_STEP_KINDS = ("agent", "completion", "domain_query")
_OUTPUT_TAIL = 12
_TEXT_CAP = 160

_RETRY_LEAD = {
    "busy": "Model busy (too many requests)",
    "timeout": "No answer from the model",
    "unavailable": "Model unavailable",
}
# What a gate asks the person to approve, by its gate kind.
_GATE_OBJECT = {
    "prd_approval": "the spec",
    "ship_approval": "the ship",
    "review_escalation": "shipping the last build",
    "budget_approval": "going over the budget",
}
_RESOLVED = {"approved": ("gate_approved", "ok"), "rejected": ("gate_rejected", "danger")}

# A quoted value, Python-repr or JSON style; an unclosed one runs to the end (a capped payload).
_FIELD = re.compile(r"""(?:^|[\s(,{])"?(\w+)"?\s*[=:]\s*(['"])((?:\\.|(?!\2).)*)(?:\2|$)""", re.S)
_EXIT = re.compile(r"\bexit[_ ]code[=:]?\s*(-?\d+)", re.I)
_COUNT = re.compile(r"\b(\d+) (passed|failed|errors?)\b")
# The sandbox's own root in front of a file path: a local workspace, a Desktop job, a container.
_ROOT = re.compile(
    r"^(?:.*/\.tvashtr_workspaces/[^/]+|.*/runner-jobs/[^/]+/ws"
    r"|/workspace(?:/project)?(?:/[0-9a-f]{8}-[0-9a-f-]{27})?)/"
)


# ---------------------------------------------------------------------------------- parsing


def _unescape(text: str) -> str:
    return re.sub(
        r"\\(.)", lambda m: {"n": "\n", "t": "\t", "r": "\r"}.get(m[1], m[1]), text, flags=re.S
    )


def _args(action: str) -> dict:
    """A tool call's arguments: JSON (the Desktop runner) or ``str(Action)`` (OpenHands)."""
    if action.startswith("{"):
        try:
            parsed = json.loads(action)
            if isinstance(parsed, dict):
                return parsed
        except ValueError:
            pass  # capped: fall through to the field scan
    out: dict = {}
    for match in _FIELD.finditer(action):
        out.setdefault(match[1], _unescape(match[3]))
    return out


def _output(observation: str) -> tuple[str, int | None]:
    """A terminal result's own text and exit code (``None`` when it doesn't say)."""
    if observation.startswith("content=["):
        text = _args(observation).get("text", "")
        exit_match = re.search(r"\bexit_code=(-?\d+)", observation)
    else:
        text, exit_match = observation, _EXIT.search(observation)
    return text, int(exit_match[1]) if exit_match else None


def _tail(text: str) -> list[str]:
    return [ln.rstrip() for ln in text.splitlines() if ln.strip()][-_OUTPUT_TAIL:]


def parse_test_summary(output: str) -> tuple[int, int] | None:
    """``(passed, failed)`` from a test runner's summary line (pytest, jest, vitest), read from the
    end; errors count as failed. ``None`` when no line has one."""
    for line in reversed(output.splitlines()):
        counts = _COUNT.findall(line)
        if counts:
            passed = sum(int(n) for n, word in counts if word == "passed")
            return passed, sum(int(n) for n, word in counts if word != "passed")
    return None


def _cap(text: str, n: int = _TEXT_CAP) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _first_line(text: str) -> str:
    return next((ln.strip() for ln in (text or "").splitlines() if ln.strip()), "")


def _path(raw: str) -> str:
    return _ROOT.sub("", raw.strip())


def _lower_first(text: str) -> str:
    return text[0].lower() + text[1:] if len(text) > 1 and text[1].islower() else text


def _edit_counts(args: dict) -> tuple[int | None, int | None]:
    pairs = [(e.get("old_string"), e.get("new_string")) for e in args.get("edits") or []]
    old = args.get("old_str", args.get("old_string"))
    new = args.get("new_str", args.get("new_string"))
    if old is not None or new is not None:
        pairs.append((old, new))
    if not pairs:
        content = args.get("file_text", args.get("content"))
        return (len(content.splitlines()), 0) if isinstance(content, str) else (None, None)
    added = removed = 0
    for old, new in pairs:
        diff = difflib.unified_diff(
            str(old or "").splitlines(), str(new or "").splitlines(), lineterm="", n=0
        )
        for line in diff:
            if line.startswith("+") and not line.startswith("+++"):
                added += 1
            elif line.startswith("-") and not line.startswith("---"):
                removed += 1
    return added, removed


def _search_query(command: str) -> str | None:
    """The pattern of a ``grep``/``rg``/``find`` command line, else ``None``."""
    try:
        words = shlex.split(command)
    except ValueError:
        return None
    if not words or words[0] not in _SEARCH_COMMANDS:
        return None
    if words[0] == "find":
        for flag, value in zip(words, words[1:], strict=False):
            if flag in ("-name", "-iname", "-path"):
                return value
        return words[1] if len(words) > 1 else None
    rest = iter(words[1:])
    for word in rest:
        if word in ("-e", "--regexp"):
            return next(rest, None)
        if word in ("-A", "-B", "-C", "-m"):  # a flag that takes a value: skip the value
            next(rest, None)
        elif not word.startswith("-"):
            return word
    return None


def _read_text(files: list[str]) -> str:
    if len(files) == 1:
        return f"Read {files[0]}"
    # Folders are named only when every file is inside one of them.
    if not all("/" in f for f in files):
        return f"Read {len(files)} files"
    dirs = list(dict.fromkeys(f.split("/", 1)[0] + "/" for f in files))
    if len(dirs) > 3:
        dirs = [*dirs[:2], f"{len(dirs) - 2} more folders"]
    where = dirs[0] if len(dirs) == 1 else ", ".join(dirs[:-1]) + " and " + dirs[-1]
    return f"Read {len(files)} files in {where}"


def _reasons(detail: str | None) -> list[str]:
    """A verdict's reasons as a list: a JSON/Python list, else one per non-empty line."""
    text = (detail or "").strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            parsed = ast.literal_eval(text)  # a JSON or Python list (``str(reasons)``)
            if isinstance(parsed, list):
                return [str(r).strip() for r in parsed if str(r).strip()]
        except (ValueError, SyntaxError):
            pass
    lines = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", ln).strip() for ln in text.splitlines()]
    return [ln for ln in lines if ln]


def _duration(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m {seconds % 60}s"
    return f"{seconds // 3600}h {seconds % 3600 // 60}m"


def _parse(kind: str, tool: str, raw: str) -> dict:
    """What one engine event's text says: the costly part of a line (regex, shlex, difflib).
    Pure, so :func:`_facts` memoises it. ``{}`` = nothing a line is made from. Commands, output
    and errors are masked (``mask_secrets``) before anything is cut."""
    if kind == "observation":
        text, exit_code = _output(raw)
        text = mask_secrets(text)
        return {"exit_code": exit_code, "tail": _tail(text), "summary": parse_test_summary(text)}
    if kind == "error":
        text = mask_secrets(raw)
        return {"message": _cap(_first_line(text)), "tail": _tail(text)}
    args = _args(raw)
    file = _path(str(args.get("path") or args.get("file_path") or args.get("target_file") or ""))
    if tool in _READ_TOOLS or (tool in _EDITOR_TOOLS and args.get("command") == "view"):
        return {"kind": "read", "file": file} if file else {}
    if tool in live_state.TERMINAL_TOOLS:
        command = _cap(_first_line(mask_secrets(str(args.get("command") or ""))))
        return {"kind": "command", "command": command, "query": _search_query(command)}
    if tool in _EDIT_TOOLS or tool in _EDITOR_TOOLS:
        added, removed = _edit_counts(args)
        return {"kind": "edited", "file": file, "added": added, "removed": removed}
    if tool in _SEARCH_TOOLS:
        query = mask_secrets(str(args.get("pattern") or args.get("query") or "")).strip()
        return {"kind": "searched", "query": query}
    return {}


# ponytail: one in-process memo of parsed events, FIFO-bounded (a few MB at the bound); every
# 2 s poll re-reads the run's events, and a parse never changes for the same text. Move to a
# per-run cache of finished lines if runs grow far past ~10k events.
_MEMO_MAX = 20_000
_memo: OrderedDict = OrderedDict()
_TEXT_FIELD = {"action": "action", "observation": "observation", "error": "error"}


def _facts(ev, tool: str) -> dict:
    """:func:`_parse` of one event, memoised by its id and a digest of the text parsed."""
    raw = str((ev.payload or {}).get(_TEXT_FIELD[ev.kind]) or "")
    key = (ev.id, ev.kind, tool, hashlib.blake2b(raw.encode(), digest_size=16).digest())
    facts = _memo.get(key)
    if facts is None:
        facts = _memo[key] = _parse(ev.kind, tool, raw)
        if len(_memo) > _MEMO_MAX:
            _memo.popitem(last=False)
    return facts


# ---------------------------------------------------------------------------------- lines


class _Lines:
    """The lines being built. ``final`` False = the line may still change (a running command, a
    read group that can still grow): the cursor never passes it, so a poll sends it again."""

    def __init__(self, labels: dict[str, str]):
        self.labels = labels
        self.rows: list[dict] = []

    def add(
        self,
        line_id,
        at,
        node_id,
        iteration,
        kind,
        text,
        tone="neutral",
        refs=None,
        final=True,
        from_run=None,
    ):
        row = {
            "id": line_id,
            "at": at,
            "node_id": node_id,
            "label": self.labels.get(node_id, "Run") if node_id else "Run",
            "iteration": iteration,
            "kind": kind,
            "text": text,
            "tone": tone,
            "refs": refs if refs is not None else {},
            # M3: a carried step's line names the run it ran in ({run_id, number}); else None.
            "from_run": from_run,
            "_final": final,
        }
        self.rows.append(row)
        return row


def _retry_text(p: dict) -> str:
    lead = _RETRY_LEAD.get(p.get("reason"), _RETRY_LEAD["busy"])
    wait = float(p.get("wait_s") or 0)
    return f"{lead}. Trying again in {wait:g} s · {p.get('attempt')} of {p.get('of')}"


def _event_lines(out: _Lines, inv, node_id: str, events: list, open_step: bool) -> None:
    """One invocation's events, in order, as lines. ``open_step``: the step (and run) still run."""
    n = inv.iteration
    pending: list[dict] = []  # terminal lines waiting for their result, oldest first
    reading: dict | None = None  # the read group being collected

    for ev in events:
        p = ev.payload or {}
        tool = str(p.get("tool_name") or "").lower()
        line_id, at = f"ev:{ev.id}", ev.created_at
        if ev.kind == "observation" and tool in live_state.TERMINAL_TOOLS and pending:
            line = pending.pop(0)
            if line["kind"] == "searched":
                continue
            facts = _facts(ev, tool)
            refs = line["refs"]
            refs.update(running=False, exit_code=facts["exit_code"], output_tail=facts["tail"])
            if facts["summary"] is not None:
                passed, failed = facts["summary"]
                line["kind"], line["refs"] = "tests", {**refs, "passed": passed, "failed": failed}
                line["text"] = (
                    f"Ran the tests: all {passed} passed"
                    if not failed
                    else "Ran the tests: "
                    + ", ".join(
                        part
                        for part in (f"{failed} failed", f"{passed} passed" if passed else "")
                        if part
                    )
                )
                line["tone"] = "warn" if failed else "ok"
            else:
                line["text"] = f"Ran {refs['command']}"
                line["tone"] = "warn" if facts["exit_code"] not in (None, 0) else "neutral"
            line["_final"] = True
            continue
        if ev.kind == "error" and pending:
            line = pending.pop(0)  # the call ended in an error instead of a result
            if line["kind"] == "command":
                line["refs"].update(running=False, output_tail=_facts(ev, tool)["tail"])
                line.update(text=f"Ran {line['refs']['command']}", tone="danger", _final=True)
                continue
        if ev.kind not in ("action", "message", "error", *live_state.HOST_EVENT_KINDS):
            continue

        facts = _facts(ev, tool) if ev.kind in ("action", "error") else {}
        if facts.get("kind") == "read":
            if reading is None:
                reading = out.add(line_id, at, node_id, n, "read", "", refs={"files": []})
            if facts["file"] not in reading["refs"]["files"]:
                reading["refs"]["files"].append(facts["file"])
            reading["text"] = _read_text(reading["refs"]["files"])
            continue

        before = len(out.rows)
        if facts.get("kind") == "command":
            command, query = facts["command"], facts["query"]
            if query is not None:
                pending.append(
                    out.add(
                        line_id,
                        at,
                        node_id,
                        n,
                        "searched",
                        f"Searched for {_cap(query, 80)}",
                        refs={"query": query},
                    )
                )
            else:
                refs = {
                    "command": command,
                    "running": open_step,
                    "started_at": at.isoformat(),
                    "exit_code": None,
                    "output_tail": [],
                }
                verb = "Running" if open_step else "Ran"
                pending.append(
                    out.add(
                        line_id,
                        at,
                        node_id,
                        n,
                        "command",
                        f"{verb} {command}",
                        refs=refs,
                        final=not open_step,
                    )
                )
        elif facts.get("kind") == "edited":
            file = facts["file"]
            out.add(
                line_id,
                at,
                node_id,
                n,
                "edited",
                f"Edited {file}" if file else "Edited a file",
                refs={"file": file or None, "added": facts["added"], "removed": facts["removed"]},
            )
        elif facts.get("kind") == "searched":
            out.add(
                line_id,
                at,
                node_id,
                n,
                "searched",
                f"Searched for {_cap(facts['query'], 80)}",
                refs={"query": facts["query"]},
            )
        elif (ev.kind == "action" and tool == "finish") or (
            ev.kind == "message"
            and (
                p.get("source") == "agent"
                or (p.get("source") == "claude" and str(p.get("text", "")).startswith("Finished:"))
            )
        ):
            out.add(line_id, at, node_id, n, "message", "Finished its step")
        elif ev.kind == "error":
            message = facts["message"] or "an error"
            out.add(
                line_id,
                at,
                node_id,
                n,
                "error",
                f"Hit an error: {message}",
                "danger",
                {"message": message},
            )
        elif ev.kind == "retry":
            refs = {k: p.get(k) for k in ("attempt", "of", "wait_s", "next_at", "reason")}
            line = out.add(line_id, at, node_id, n, "retry", _retry_text(p), "warn", refs)
            line["_backup"] = p.get("backup_model")  # what the pinned callout switches to
        elif ev.kind == "backup_model":
            out.add(
                line_id,
                at,
                node_id,
                n,
                "backup",
                f"Switched to the backup model, {p.get('to_model')}",
                "warn",
                {"from_model": p.get("from_model"), "to_model": p.get("to_model")},
            )
        elif ev.kind == "stalled":
            minutes = round(int(p.get("after_s") or 0) / 60)
            out.add(
                line_id,
                at,
                node_id,
                n,
                "stalled",
                f"Stopped responding: no update for {minutes} minutes",
                "danger",
                {"after_s": p.get("after_s")},
            )
        if len(out.rows) > before:
            reading = None  # another line ends the read group
    if reading is not None and open_step:
        reading["_final"] = False  # the group can still grow


def _doc_node(version, by_clone: dict, by_origin: dict, run_id: str) -> tuple[str | None, int]:
    """The (clone) node that wrote a version and its round, from the executor's idempotency key
    (``…:<node>:<round>``), else the version's authored node."""
    parts = (version.idempotency_key or "").split(":")
    if parts[0] == run_id and len(parts) >= 4 and parts[-2] in by_clone and parts[-1].isdigit():
        return parts[-2], int(parts[-1])
    nid = by_origin.get(str(version.author_node_id)) if version.author_node_id else None
    return nid, 1 if nid else None


def build(
    run,
    nodes: list,
    edges: list[dict],
    invocations: list,
    events: list,
    tasks: list,
    versions: list,
    *,
    live_by_inv: dict[int, dict],
    spent_usd: float,
    after: str | None = None,
    now: datetime | None = None,
    carried: list[dict] | None = None,
    resumed_from: dict | None = None,
    start_node: str | None = None,
    number: int | None = None,
) -> dict:
    """The Activity reply for one run (see the contract). ``events`` in ``(created_at, id)`` order;
    ``versions`` are ``(DocumentVersion, document name)`` pairs. M3: a resumed run's ``carried``
    step rows (``resume.carried``) come first, one line each, then the Resumed line."""
    from tvashtr.control_plane import resume  # lazy: resume imports this module

    carried = carried or []
    now = now or datetime.now(UTC)
    run_id = str(run.id)
    ended = run.status in run_views.TERMINAL_STATUSES
    nodes = sorted(
        nodes, key=lambda nd: (nd.position.get("x", 0), nd.position.get("y", 0), str(nd.id))
    )
    by_id = {str(nd.id): nd for nd in nodes}
    labels = {nid: node_label(nd.role_name, nd.kind, nd.config) for nid, nd in by_id.items()}
    by_origin = {
        str(nd.cloned_from_node_id): nid for nid, nd in by_id.items() if nd.cloned_from_node_id
    }
    invs = sorted(invocations, key=lambda i: (i.started_at, i.id))
    events_by_inv: dict = {}
    for ev in events:
        events_by_inv.setdefault(ev.invocation_id, []).append(ev)
    out = _Lines(labels)

    # The run starts. A resumed run starts with the steps it carries, then "Resumed from …".
    target = run_views.run_target(run)
    if resumed_from is None:
        start = "Started" + (f" on {target['label']}" if target["label"] else "")
        start += f", branch {run.base_ref}" if target["label"] and run.base_ref else ""
        out.add(
            "run:start",
            run.created_at,
            None,
            None,
            "started",
            start,
            refs={"repo": target["label"], "branch": run.base_ref},
        )
    else:
        for k, row in enumerate(carried):
            text = row["text"]
            if row["kind"] == "agent" and (
                row["iteration"] > 1 or resume._loops(edges, row["node_id"])
            ):
                text = f"Round {row['iteration']} · {text[:1].lower()}{text[1:]}"
            out.add(
                f"c:{k}",
                datetime.fromisoformat(row["at"]),
                row["node_id"] if row["node_id"] in by_id else None,
                row["iteration"],
                "carried",
                text,
                from_run={
                    "run_id": row["from_run"]["run_id"],
                    "number": row["from_run"]["number"],
                },
            )
        out.add(
            "run:resumed",
            run.created_at,
            None,
            None,
            "resumed",
            f"Resumed from {resume.run_ref(resumed_from.get('number'))}"
            f" at {resumed_from.get('step_label')}",
            refs={"run_id": resumed_from.get("run_id")},
        )

    # Each step: its start, its events, its close.
    last_verdict = None
    for inv in invs:
        nid = str(inv.node_id)
        node = by_id.get(nid)
        kind = node.kind if node is not None else None
        if kind in _STEP_KINDS:
            text = "Started"
            if inv.iteration > 1:
                text = f"Started round {inv.iteration}"
                if last_verdict is not None and last_verdict.outcome == "changes_requested":
                    text += " with the reviewer's notes"
            out.add(f"inv:{inv.id}:start", inv.started_at, nid, inv.iteration, "started", text)
        open_step = inv.status == "running" and not ended
        _event_lines(out, inv, nid, events_by_inv.get(inv.id, []), open_step)
        end_at = inv.ended_at or inv.started_at
        if inv.status == "failed" and inv.outcome != "stalled":  # a stall has its own line
            message = mask_secrets(_lower_first(humanise(None, inv.outcome_detail)["message"]))
            out.add(
                f"inv:{inv.id}:end",
                end_at,
                nid,
                inv.iteration,
                "error",
                f"Failed: {message}",
                "danger",
                {"message": message},
            )
        elif kind in _STEP_KINDS and inv.outcome in ("approved", "changes_requested"):
            reasons = _reasons(inv.outcome_detail)
            if inv.outcome == "approved":
                text, tone = "Approved" + (f": {'; '.join(reasons)}" if reasons else ""), "ok"
            else:
                count = max(len(reasons), 1)
                fixes = "fix" if count == 1 else "fixes"
                text = f"Asked for {count} {fixes}" + (f": {'; '.join(reasons)}" if reasons else "")
                tone = "warn"
            out.add(
                f"inv:{inv.id}:end",
                end_at,
                nid,
                inv.iteration,
                "verdict",
                _cap(text, 240),
                tone,
                {"verdict": inv.outcome, "reasons": reasons},
            )
            last_verdict = inv
        elif inv.status != "running" and kind in _STEP_KINDS:
            last_verdict = inv

    # Gates: opened, then approved or rejected.
    open_task = None
    for task in sorted(tasks, key=lambda t: (t.created_at, t.id)):
        topic_kind, nid = run_views._topic_node(task.topic)
        if not task.blocking or topic_kind is None:
            continue
        nid = nid if nid in by_id else None
        iteration = int(task.topic.split(":")[3]) if topic_kind == "budget" else 1
        what = _GATE_OBJECT.get(task.kind, "this step")
        refs = {"task_id": task.id, "title": task.title}
        out.add(
            f"task:{task.id}:open",
            task.created_at,
            nid,
            iteration,
            "gate_waiting",
            f"Waiting for you to approve {what}",
            "warn",
            dict(refs),
        )
        if task.status == "pending":
            open_task = (task, nid)
        elif task.resolution in _RESOLVED and task.resolved_at is not None:
            kind, tone = _RESOLVED[task.resolution]
            verb = "approved" if task.resolution == "approved" else "rejected"
            out.add(
                f"task:{task.id}:done",
                task.resolved_at,
                nid,
                iteration,
                kind,
                f"You {verb} {what}",
                tone,
                dict(refs),
            )

    # Documents the steps (or you) wrote.
    for version, name in versions:
        human = version.created_by == "human"
        nid, iteration = (None, None) if human else _doc_node(version, by_id, by_origin, run_id)
        doc = name or "spec"
        text = f"{'You edited' if human else 'Wrote'} the {doc} (v{version.version_no})"
        out.add(
            f"doc:{version.document_id}:v{version.version_no}",
            version.created_at,
            nid,
            iteration,
            "wrote_doc",
            text,
            refs={
                "document_id": str(version.document_id),
                "version": version.version_no,
                "name": doc,
            },
        )

    # The end: the pull request, then done / failed / stopped. The run ended at its last step close
    # or event — ``updated_at`` moves on any later write. (A step left open counts from its start.)
    end_at = max(
        [i.ended_at or i.started_at for i in invs] + [ev.created_at for ev in events],
        default=run.updated_at,
    )
    elapsed_s = int((end_at - run.created_at).total_seconds())
    cost = round(float(spent_usd), 2)
    pr_number = run_views.pr_number(run.pr_url)
    if run.pr_url:
        ship = next(
            (
                i
                for i in reversed(invs)
                if by_id.get(str(i.node_id)) is not None
                and by_id[str(i.node_id)].kind == "terminal"
            ),
            None,
        )
        branch = f"Pushed branch {run.ship_branch} and opened" if run.ship_branch else "Opened"
        out.add(
            "run:pr",
            (ship.ended_at if ship and ship.ended_at else end_at),
            str(ship.node_id) if ship else None,
            1 if ship else None,
            "pr",
            f"{branch} pull request" + (f" #{pr_number}" if pr_number else ""),
            "ok",
            {"pr_url": run.pr_url, "pr_number": pr_number, "branch": run.ship_branch},
        )
    if ended:
        if run.status == "completed":
            text, tone = f"Done in {_duration(elapsed_s)} · ${cost:.2f}", "ok"
        elif run.status == "failed":
            text, tone = f"Failed after {_duration(elapsed_s)} · ${cost:.2f}", "danger"
        else:
            text, tone = "Stopped. Nothing shipped.", "neutral"
        out.add(
            "run:done",
            end_at,
            None,
            None,
            "done",
            text,
            tone,
            {"elapsed_s": elapsed_s, "cost_usd": cost},
        )

    lines = sorted(out.rows, key=lambda ln: ln["at"])  # stable: same-time lines keep their order

    # Who is doing what.
    latest: dict = {}
    for inv in invs:
        if str(inv.node_id) not in latest or inv.iteration >= latest[str(inv.node_id)].iteration:
            latest[str(inv.node_id)] = inv
    last_line = {ln["node_id"]: ln for ln in lines if ln["node_id"] and ln["kind"] != "carried"}
    carried_nodes = resume.carried_by_node(carried)
    will_run = _reachable(edges, start_node) if start_node else set()
    agents = []
    for nid, nd in by_id.items():
        inv = latest.get(nid)
        live = dict(live_state.node_live(nd.kind, inv, live_by_inv))
        if inv is not None and inv.status == "running" and ended:
            live["live_state"] = "failed" if run.status == "failed" else "stopped"
        if nd.kind == "gate" and open_task is not None and open_task[1] == nid:
            live.update(
                live_state="needs_you",
                activity="Waiting for you",
                last_event_at=open_task[0].created_at.isoformat(),
            )
        elif nd.kind == "gate" and inv is not None and inv.status != "running":
            decided = max(
                (
                    t
                    for t in tasks
                    if run_views._topic_node(t.topic) == ("gate", nid) and t.resolved_at is not None
                ),
                key=lambda t: (t.resolved_at, t.id),
                default=None,
            )
            if decided is not None and decided.resolution in _RESOLVED:
                # No clock here: the frontend shows last_event_at in the person's own time.
                live.update(
                    activity=f"You {decided.resolution}",
                    last_event_at=decided.resolved_at.isoformat(),
                )
        elif inv is not None and inv.status != "running" and nid in last_line:
            live.update(
                activity=last_line[nid]["text"], last_event_at=last_line[nid]["at"].isoformat()
            )
        if inv is None and nid in carried_nodes:
            rows = carried_nodes[nid]
            if nid in will_run:
                live.update(live_state="waiting", activity=resume.waiting_text(rows))
            else:
                live.update(
                    live_state="carried_over",
                    activity=resume.carried_activity(rows),
                    last_event_at=rows[-1]["at"],
                )
        cfg = nd.config if isinstance(nd.config, dict) else {}
        limit = next(
            (
                e["conditions"]["loop_limit"]
                for e in edges
                if isinstance(e.get("conditions"), dict)
                and "loop_limit" in e["conditions"]
                and nid in (e["source"], e["target"])
            ),
            None,
        )
        agents.append(
            {
                "node_id": nid,
                "origin_node_id": str(nd.cloned_from_node_id) if nd.cloned_from_node_id else None,
                "label": labels[nid],
                "kind": cfg.get("terminal_kind", "terminal") if nd.kind == "terminal" else nd.kind,
                "iteration": inv.iteration if inv is not None else 0,
                "rounds_limit": limit,
                **live,
                "model": nd.model,
            }
        )

    # The one thing needing action.
    pinned = None
    stalled = next((a for a in agents if a["live_state"] == "stalled"), None)
    retrying = next((a for a in agents if a["live_state"] == "retrying"), None)
    if open_task is not None:
        task, nid = open_task
        label = "Budget" if task.kind == "budget_approval" else labels.get(nid, "Approval")
        pinned = {
            "kind": "gate",
            "node_id": nid,
            "label": label,
            "title": f"The {label.lower()} gate is waiting for you",
            # The board's words for the spec gate (Live-NeedsYou); any other gate says its own.
            "body": (
                "Read the spec, then approve or reject it. The run is paused until you decide."
                if task.kind == "prd_approval"
                else task.description
            ),
            "task_id": task.id,
            "gate_kind": task.kind,
        }
    elif stalled is not None:
        pinned = {
            "kind": "stalled",
            "node_id": stalled["node_id"],
            "label": stalled["label"],
            "title": f"The {stalled['label']} may be stuck",
            "body": (
                f"No update for {_span(live_state.stalled_for(stalled, now))}."
                + (f" Its last step: {stalled['activity']}." if stalled.get("activity") else "")
                + " Nothing has shipped."
            ),
            "task_id": None,
        }
    elif retrying is not None:
        retry = next(
            (
                ln
                for ln in reversed(lines)
                if ln["kind"] == "retry" and ln["node_id"] == retrying["node_id"]
            ),
            None,
        )
        pinned = {
            "kind": "retrying",
            "node_id": retrying["node_id"],
            "label": retrying["label"],
            "title": f"The {retrying['label']}’s model is busy",
            "body": _retry_body(retrying["label"], retry),
            "task_id": None,
            "backup_model": retry["_backup"] if retry else None,
        }
    elif run.status == "failed":
        failed = [i for i in invs if i.status == "failed"]
        failure = describe_run_failure(
            status=run.status,
            failure_code=run.failure_code,
            failure_message=run.failure_message,
            failed_node_id=str(run.failed_node_id) if run.failed_node_id else None,
            desktop_target=bool(run.desktop_target),
            fallback_reason=failed[-1].outcome_detail if failed else None,
            fallback_node_id=str(failed[-1].node_id) if failed else None,
            node_info={nid: {"label": labels[nid], "origin_node_id": None} for nid in by_id},
        )
        nid = failure["node_id"]
        label = labels.get(nid) if nid else None
        pinned = {
            "kind": "failed",
            "node_id": nid,
            "label": label or "Run",
            "title": f"{label} failed" if label else "The run failed",
            "body": mask_secrets(failure["message"]).rstrip(".")
            + "."
            + ("" if run.pr_url else " Nothing was shipped."),
            "task_id": None,
        }
    elif run.status == "cancelled":
        # MA ruling R19: a stopped run offers Resume from the step it stopped at (the title gains
        # that step once ``run_activity`` knows it). It never joins Needs you: you stopped it.
        at = next((a for a in agents if a["live_state"] == "stopped"), None)
        pinned = {
            "kind": "stopped",
            "node_id": at["node_id"] if at else None,
            "label": at["label"] if at else "Run",
            "title": "You stopped this run",
            "body": "" if run.pr_url else "Nothing was shipped.",
            "task_id": None,
        }
    if pinned is not None:
        pinned.setdefault("backup_model", None)
        pinned.setdefault("gate_kind", None)
        pinned.setdefault(
            "resume", None
        )  # M3: filled by ``run_activity`` (failed / stalled / stopped)
        pinned.setdefault("safe", None)

    summary = None
    if run.status == "completed":
        tests_line = next((ln for ln in reversed(lines) if ln["kind"] == "tests"), None)
        summary = {
            "pr_url": run.pr_url,
            "pr_number": pr_number,
            "rounds": max((i.iteration for i in invs), default=0),
            "elapsed_s": elapsed_s,
            "cost_usd": cost,
            "branch": run.ship_branch,
            "base_ref": run.base_ref,
            # Only a green last test run counts ("41 tests passing").
            "tests_passed": tests_line["refs"]["passed"]
            if tests_line and tests_line["refs"]["failed"] == 0
            else None,
        }

    # The cursor: the last line before the first one that can still change.
    first_open = next((k for k, ln in enumerate(lines) if not ln["_final"]), len(lines))
    cursor = _key(lines[first_open - 1]) if first_open else ""
    start_at = 0
    if after:
        wanted = after.rsplit("|", 1)[-1]
        start_at = next((k + 1 for k, ln in enumerate(lines) if ln["id"] == wanted), 0)
    return {
        "run_id": run_id,
        "status": run.status,
        "live_state": live_state.run_live_state(run.status, (a["live_state"] for a in agents)),
        "cursor": cursor,
        "total": len(lines),
        "agents": agents,
        "lines": [_public(ln) for ln in lines[start_at:]],
        "pinned": pinned,
        "summary": summary,
        "number": number,
        "resumed_from": resumed_from,
        # Every line, whatever ``after`` is: ``run_activity`` hands them to Resume (popped there).
        "_all_lines": [_public(ln) for ln in lines],
    }


def _reachable(edges: list[dict], start: str) -> set[str]:
    """The nodes a resumed run will still run: its start node and what follows it (not across an
    escalation edge)."""
    seen = {start}
    todo = [start]
    while todo:
        cur = todo.pop()
        for e in edges:
            if (
                e["source"] == cur
                and e.get("edge_type") != "escalation"
                and e["target"] not in seen
            ):
                seen.add(e["target"])
                todo.append(e["target"])
    return seen


def _span(seconds: float) -> str:
    """ "6m 00s" / "45s" — the boards' running-time words."""
    s = max(0, round(seconds))
    return f"{s}s" if s < 60 else f"{s // 60}m {s % 60:02d}s"


def _retry_body(label: str, retry: dict | None) -> str:
    """The Retrying callout (Live-Retrying): when the next try is, and the backup it switches to."""
    if retry is None:
        return f"Tvashtr is retrying the {label}’s model."
    wait = round(float(retry.get("refs", {}).get("wait_s") or 0))
    text = f"Tvashtr tries again in {wait} seconds."
    backup = retry.get("_backup")
    if backup:
        text += (
            f" If it is still busy, the {label} switches to its backup model, {backup}, and"
            " carries on. You don’t need to do anything."
        )
    return text


def _key(line: dict) -> str:
    return f"{line['at'].isoformat()}|{line['id']}"


def _public(line: dict) -> dict:
    return {**{k: v for k, v in line.items() if k[0] != "_"}, "at": line["at"].isoformat()}


# ---------------------------------------------------------------------------------- the read


def run_activity(session, run: Run, after: str | None = None, *, resume_info: bool = True) -> dict:
    """Read one (already owner-checked) run's rows and :func:`build` its Activity. M3: a resumed
    run's carried steps come from its seed; a Failed / Stalled callout gains its Resume point
    (``resume_info`` False when :mod:`resume` itself reads the lines)."""
    from tvashtr.control_plane import resume  # lazy: resume imports this module

    run_id = run.workflow_id
    nodes = (
        session.execute(select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id))
        .scalars()
        .all()
    )
    edges = run_views._graph_edges(session, {run.team_graph_id}).get(run.team_graph_id, [])
    invocations = (
        session.execute(select(AgentInvocation).where(AgentInvocation.run_id == run_id))
        .scalars()
        .all()
    )
    # The payload without the action's ``thought`` (never read; up to 1000 characters a row).
    events = session.execute(
        select(
            RunEvent.id,
            RunEvent.invocation_id,
            RunEvent.kind,
            RunEvent.payload.op("-", return_type=JSONB)(literal_column("'thought'")).label(
                "payload"
            ),
            RunEvent.created_at,
        )
        .where(RunEvent.run_id == run_id, RunEvent.kind.notin_(CONNECTOR_EVENT_KINDS))
        .order_by(RunEvent.created_at, RunEvent.id)
    ).all()
    tasks = session.execute(select(HumanTask).where(HumanTask.run_id == run_id)).scalars().all()
    doc_filter = Document.run_id == run.id
    if run.pm_document_id is not None:
        doc_filter = or_(doc_filter, Document.id == run.pm_document_id)
    versions = session.execute(
        select(DocumentVersion, Document.name)
        .join(Document, Document.id == DocumentVersion.document_id)
        .where(doc_filter, DocumentVersion.idempotency_key.notlike(f"{run.id}:carried:%"))
        .order_by(DocumentVersion.created_at, DocumentVersion.version_no)
    ).all()
    kinds = {nd.id: nd.kind for nd in nodes}
    latest: dict[uuid.UUID, AgentInvocation] = {}
    for inv in invocations:
        if inv.node_id not in latest or inv.iteration > latest[inv.node_id].iteration:
            latest[inv.node_id] = inv
    live_by_inv = live_state.invocation_live(
        session, [i for nid, i in latest.items() if kinds.get(nid) in live_state.STEP_KINDS]
    )
    spent = run_views.spent_usd(run, run_views.live_costs(session, [run_id]))
    carried, resumed_from, start_node = resume.carried(session, run)
    reply = build(
        run,
        list(nodes),
        edges,
        list(invocations),
        list(events),
        list(tasks),
        [(v, name) for v, name in versions],
        live_by_inv=live_by_inv,
        spent_usd=spent,
        after=after,
        carried=carried,
        resumed_from=resumed_from,
        start_node=start_node,
        number=resume.number(session, run),
    )
    all_lines = reply.pop("_all_lines")
    pinned = reply["pinned"]
    if resume_info and pinned is not None and pinned["kind"] in ("failed", "stalled", "stopped"):
        points = resume.points(session, run, all_lines)
        pinned["resume"] = resume.resume_hint_from(points)
        pinned["safe"] = resume.safe_text(points) if pinned["resume"] else None
        # The title names the step only when Resume picks up the step it stopped at (the suggested
        # point); stopped at a gate or Ship, the hint is an earlier step and the title names none.
        hint = pinned["resume"]
        if (
            pinned["kind"] == "stopped"
            and hint
            and any(
                p["invocation_id"] == hint["invocation_id"] and p["state"] == "suggested"
                for p in points["points"]
            )
        ):
            pinned["title"] = f"You stopped this run at {hint['label']}"
    return reply
