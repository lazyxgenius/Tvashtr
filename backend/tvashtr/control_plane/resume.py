"""M3 (ruling R8) — Resume from here.

A failed, stopped or stalled run picks up from one of its agent steps as a NEW run: the old run's
team snapshot copied (never the team as it is now), its repo / base / scope / budget, and everything
before the chosen step carried — never run again, never billed again, shown "Carried over". The
chosen step and everything after it run again; round numbers continue. The workspace is rebuilt from
the checkpoint of the step before (``run_checkpoints``), never from the old sandbox.

The new run's SEED checkpoint (``invocation_id`` NULL) holds everything it starts from, already in
its own node ids: the walk's state (``start_node_id``, ``iters_by_node``, ``reviewer_feedback``,
``pm_document_id``) and the carried steps as rows (``carried``), so its Activity, graph and Home
chips read them without rebuilding the old run — and a resume of a resumed run chains.

Words are made here (contract: ``docs/superpowers/plans/api/resume.md``). Openhands-free.
"""

import uuid
from datetime import datetime

from sqlalchemy import func, select

from tvashtr.control_plane import activity, run_views
from tvashtr.control_plane.checkpoints import CheckpointError
from tvashtr.control_plane.live_state import invocation_live
from tvashtr.control_plane.node_history import _cost_by_invocation, _run_number
from tvashtr.control_plane.run_failure import node_label
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    Document,
    DocumentVersion,
    Run,
    RunCheckpoint,
)

RESUMABLE_STATUSES = ("failed", "cancelled")
_IN_FLIGHT = ("pending", "running", "awaiting_human")
_AGENT_KINDS = ("agent", "completion")
_ROW_KINDS = ("agent", "completion", "gate", "domain_query")


class ResumeRefused(Exception):
    """The run or the step can't be resumed (the route answers 409 with the message)."""


# ---------------------------------------------------------------------------------- numbering


def number(session, run: Run) -> int | None:
    """``12`` in "run #12" — the run's place among its library team's runs (None without one)."""
    return _run_number(session, run)


def next_number(session, run: Run) -> int | None:
    if run.library_team_id is None:
        return None
    return (
        session.execute(
            select(func.count(Run.id)).where(
                Run.library_team_id == run.library_team_id, Run.owner_id == run.owner_id
            )
        ).scalar_one()
        + 1
    )


def picked_up():
    """A resumed run that has picked its run up: still in flight, or it opened a step of its own.
    One that ended before its first step (stopped, a failed clone) leaves the run resumable."""
    from sqlalchemy import exists, or_

    return or_(
        Run.status.in_(_IN_FLIGHT),
        exists(select(AgentInvocation.id).where(AgentInvocation.run_id == Run.workflow_id)),
    )


def run_ref(number_: int | None) -> str:
    return f"run #{number_}" if number_ else "an earlier run"


# ---------------------------------------------------------------------------------- the rows


def seed_of(session, run: Run) -> RunCheckpoint | None:
    if run.resumed_from_run_id is None:
        return None
    return session.execute(
        select(RunCheckpoint).where(
            RunCheckpoint.run_id == run.id, RunCheckpoint.invocation_id.is_(None)
        )
    ).scalar_one_or_none()


def _lower_first(text: str) -> str:
    return text[:1].lower() + text[1:] if text else text


def _summary(kind: str, lines: list[dict], inv: AgentInvocation) -> dict:
    """One step in a few words, from its Activity lines (the run view's own words)."""
    by_kind: dict[str, list[dict]] = {}
    for ln in lines:
        by_kind.setdefault(ln["kind"], []).append(ln)
    files = list(
        dict.fromkeys(
            ln["refs"]["file"]
            for ln in by_kind.get("edited", [])
            if ln["refs"].get("file") and not _own_file(ln["refs"]["file"])
        )
    )
    out = {"files": files, "fixes": None, "verdict": None, "doc": None}
    if kind == "gate":
        done = (by_kind.get("gate_approved") or by_kind.get("gate_rejected") or [None])[-1]
        out["text"] = done["text"] if done else "Waited for you"
        out["verdict"] = "approved" if by_kind.get("gate_approved") else None
        out["decided_at"] = done["at"] if done else None
        return out
    if inv.status == "failed":
        error = (by_kind.get("error") or [None])[-1]
        out["text"] = error["text"] if error else "Failed"
        return out
    if by_kind.get("wrote_doc"):
        doc = by_kind["wrote_doc"][-1]
        out["text"] = doc["text"]
        out["doc"] = {"name": doc["refs"]["name"], "version": doc["refs"]["version"]}
        return out
    verdict = (by_kind.get("verdict") or [None])[-1]
    if verdict is not None:
        out["verdict"] = verdict["refs"]["verdict"]
        out["fixes"] = max(len(verdict["refs"].get("reasons") or []), 1)
        out["text"] = verdict["text"].split(":", 1)[0]
        return out
    if files:
        text = f"Edited {len(files)} file" + ("" if len(files) == 1 else "s")
        tests = (by_kind.get("tests") or [None])[-1]
        if tests is not None:
            text += " · tests passed" if not tests["refs"].get("failed") else " · tests failed"
        out["text"] = text
        return out
    out["text"] = "Answered" if kind == "domain_query" else "Finished its step"
    return out


_BRIEF = "Built the feature — changed "
# Tvashtr's own working files (a step's REPORT.md is carried as its document, not as "changes").
_OWN = ("REPORT.md", "REVIEW_VERDICT.json", "SPEC.md", "TVASHTR_REMEMBER.jsonl")


def _own_file(path: str) -> bool:
    return path.rsplit("/", 1)[-1] in _OWN


def _brief_files(detail: str | None) -> list[str]:
    """The files a worker's close brief lists (``team_run._worker_brief``), without "+N more"."""
    if not detail or not detail.startswith(_BRIEF) or ": " not in detail:
        return []
    listed = detail.split(": ", 1)[1].split(", ")
    return [f for f in listed if f and not f.startswith("+") and not _own_file(f)]


def step_rows(session, run: Run, lines: list[dict] | None = None) -> list[dict]:
    """The run's steps in the order they ran: its carried ones (a resumed run), then its own agent
    steps, Query domain rounds and gates — each with its words, cost, time and outcome."""
    nodes = {
        str(n.id): n
        for n in session.execute(
            select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id)
        ).scalars()
    }
    seed = seed_of(session, run)
    rows: list[dict] = [dict(r) for r in (seed.state.get("carried", []) if seed else [])]
    invs = (
        session.execute(
            select(AgentInvocation)
            .where(AgentInvocation.run_id == run.workflow_id)
            .order_by(AgentInvocation.id)
        )
        .scalars()
        .all()
    )
    invs = [i for i in invs if str(i.node_id) in nodes and nodes[str(i.node_id)].kind in _ROW_KINDS]
    if not invs:
        return rows
    if lines is None:  # the run view passes the lines it has just built
        lines = activity.run_activity(session, run, resume_info=False)["lines"]
    by_step: dict[tuple, list[dict]] = {}
    for ln in lines:
        if ln.get("from_run") is None:
            by_step.setdefault((ln["node_id"], ln["iteration"]), []).append(ln)
    costs = _cost_by_invocation(session, run.workflow_id, [i.id for i in invs])
    for inv in invs:
        node = nodes[str(inv.node_id)]
        label = node_label(node.role_name, node.kind, node.config)
        summary = _summary(node.kind, by_step.get((str(inv.node_id), inv.iteration), []), inv)
        if not summary["files"] and inv.status == "done":
            # No edit events (a Desktop job's patch, an agent that wrote files with a command):
            # the step's own brief names what it changed.
            files = _brief_files(inv.outcome_detail)
            if files:
                summary["files"] = files
                if summary["text"] == "Finished its step":
                    summary["text"] = f"Edited {len(files)} file" + ("" if len(files) == 1 else "s")
        cost = costs.get(inv.id, ({"cost_usd": 0.0}, None))[0]["cost_usd"]
        ended = inv.ended_at or inv.started_at
        rows.append(
            {
                "invocation_id": inv.id,
                "node_id": str(inv.node_id),
                "origin_node_id": str(node.cloned_from_node_id)
                if node.cloned_from_node_id
                else None,
                "label": label,
                "kind": "gate"
                if node.kind == "gate"
                else ("domain_query" if node.kind == "domain_query" else "agent"),
                "iteration": inv.iteration,
                "status": inv.status,
                "at": inv.started_at.isoformat(),
                "duration_s": max(0, int((ended - inv.started_at).total_seconds())),
                "cost_usd": None if node.kind == "gate" else round(float(cost), 2),
                "from_run": None,
                **summary,
            }
        )
    return rows


def _loops(edges: list[dict], node_id: str) -> int | None:
    """The loop limit on a back-edge touching the node, else None (it never loops)."""
    return next(
        (
            e["conditions"]["loop_limit"]
            for e in edges
            if isinstance(e.get("conditions"), dict)
            and "loop_limit" in e["conditions"]
            and node_id in (e["source"], e["target"])
        ),
        None,
    )


def _title(row: dict, edges: list[dict]) -> str:
    if row["kind"] == "agent" and (_loops(edges, row["node_id"]) or row["iteration"] > 1):
        return f"{row['label']} · round {row['iteration']}"
    return row["label"]


# ---------------------------------------------------------------------------------- the points


def _suggested(run: Run, rows: list[dict], stalled_inv: int | None) -> int | None:
    if stalled_inv is not None:
        return stalled_inv
    own = [r for r in rows if r.get("invocation_id") is not None and r["kind"] == "agent"]
    failed = [r for r in own if r["status"] in ("failed", "running", "stopped")]
    return failed[-1]["invocation_id"] if failed else None


def _stalled_step(session, run: Run) -> int | None:
    """The run's Stalled step while it is still running (R1), else None."""
    if run.status != "running":
        return None
    running = (
        session.execute(
            select(AgentInvocation).where(
                AgentInvocation.run_id == run.workflow_id, AgentInvocation.status == "running"
            )
        )
        .scalars()
        .all()
    )
    live = invocation_live(session, running)
    for inv in running:
        info = live.get(inv.id)
        if info and info.get("live_state") == "stalled":
            return inv.id
    return None


def _checkpoints(session, run: Run) -> dict[int | None, RunCheckpoint]:
    return {
        cp.invocation_id: cp
        for cp in session.execute(
            select(RunCheckpoint).where(RunCheckpoint.run_id == run.id)
        ).scalars()
    }


def _predecessor(rows: list[dict], k: int, cps: dict) -> tuple[bool, RunCheckpoint | None]:
    """``(resumable, checkpoint)`` for the step at ``rows[k]``: the checkpoint of the last step
    before it that has one (a Query domain round counts), or the run's seed; none at all is a fresh
    start, allowed only when no agent step ran before it."""
    for row in reversed(rows[:k]):
        inv = row.get("invocation_id")
        if inv is None:
            continue  # a carried row: the seed stands for all of them
        if inv in cps:
            cp = cps[inv]
            return (not cp.too_large), cp
        if row["kind"] == "agent":
            return False, None  # it ran but left no checkpoint (before M3, or a failed capture)
    if None in cps:
        seed = cps[None]
        return (not seed.too_large), seed
    return (not any(r["kind"] == "agent" for r in rows[:k])), None


def _runs_again(session, run: Run, rows: list[dict], k: int, edges: list[dict]) -> list[str]:
    """The chosen step, then the steps after it along the way to Ship (as an approval routes)."""
    from tvashtr.control_plane.team_run import next_node, node_emits_outcome

    nodes = {
        str(n.id): n
        for n in session.execute(
            select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id)
        ).scalars()
    }
    rounds: dict[str, int] = {}
    for r in rows[:k]:
        rounds[r["node_id"]] = max(rounds.get(r["node_id"], 0), r["iteration"])
    chosen = rows[k]
    out = [_title(chosen, edges)]
    seen = {chosen["node_id"]}
    prev = chosen["node_id"]
    cur = next_node(edges, prev, "approved" if node_emits_outcome(edges, prev) else None)
    while cur is not None and cur not in seen:
        seen.add(cur)
        node = nodes.get(cur)
        if node is None:
            break
        label = node_label(node.role_name, node.kind, node.config)
        cfg = node.config if isinstance(node.config, dict) else {}
        if node.kind == "terminal":
            if cfg.get("terminal_kind") == "ship":
                gate = node_emits_outcome(edges, prev)
                prev_label = node_label(nodes[prev].role_name, nodes[prev].kind, nodes[prev].config)
                out.append(f"Ship, if the {prev_label.lower()} approves" if gate else "Ship")
            break
        if node.kind == "gate":
            out.append(f"{label}, when you approve")
        else:
            n = rounds.get(cur, 0) + 1
            limit = _loops(edges, cur)
            text = f"{label} · round {n}" if (limit or n > 1) else label
            if node_emits_outcome(edges, cur) and limit and n < limit:
                text += f", and round {n + 1} if it asks for more"
            out.append(text)
        prev = cur
        cur = next_node(edges, cur, "approved" if node_emits_outcome(edges, cur) else None)
    return out


def _kept(session, run: Run, rows: list[dict], k: int) -> list[dict]:
    started = datetime.fromisoformat(rows[k]["at"])
    kept: list[dict] = []
    for name, version in _documents_before(session, run, started):
        kept.append({"text": f"{(name or 'spec').capitalize()} v{version}", "at": None})
    for r in rows[:k]:
        if r["kind"] == "gate":
            if r.get("verdict") == "approved":
                kept.append({"text": "Your approval", "at": r.get("decided_at") or r["at"]})
            continue
        who = f"{r['label']} round {r['iteration']}"
        if r.get("verdict") == "changes_requested":
            fixes = r.get("fixes") or 1
            kept.append(
                {
                    "text": f"{who}: the {fixes} fix{'es' if fixes != 1 else ''} it asked for",
                    "at": None,
                }
            )
        elif r.get("verdict") == "approved":
            kept.append({"text": f"{who}: its approval", "at": None})
        elif r.get("files"):
            files = r["files"]
            what = " and ".join(files) if len(files) <= 2 else f"{len(files)} files"
            kept.append({"text": f"{who}: changes to {what}", "at": None})
    return kept


def _documents_before(session, run: Run, before: datetime) -> list[tuple[str | None, int]]:
    """``(name, latest version)`` of each of the run's documents as they stood at ``before``."""
    rows = session.execute(
        select(Document.name, func.max(DocumentVersion.version_no))
        .join(DocumentVersion, DocumentVersion.document_id == Document.id)
        .where(Document.run_id == run.id, DocumentVersion.created_at < before)
        .group_by(Document.id, Document.name)
        .order_by(func.min(DocumentVersion.created_at))
    ).all()
    return [(name, version) for name, version in rows]


def points(session, run: Run, lines: list[dict] | None = None, *, confirm: bool = True) -> dict:
    """The ``GET /api/runs/{id}/resume`` reply (owner already checked). ``lines``: the run's whole
    Activity when the caller has it; ``confirm`` False skips each point's confirm data but the
    step label (Needs you's button needs no more)."""
    num = number(session, run)
    out = {
        "run_id": str(run.id),
        "number": num,
        "next_number": next_number(session, run),
        "available": False,
        "reason": None,
        "stops_run": False,
        "points": [],
    }
    child = (
        session.execute(
            select(Run)
            .where(Run.resumed_from_run_id == run.id, picked_up())
            .order_by(Run.created_at.desc())
        )
        .scalars()
        .first()
    )
    if child is not None:
        out["reason"] = f"Picked up again as {run_ref(number(session, child))}"
        return out
    stalled = _stalled_step(session, run)
    if run.local_snapshot_id is not None:
        out["reason"] = "Resume isn't available for a run on a folder yet"
        return out
    if run.status not in RESUMABLE_STATUSES and stalled is None:
        out["reason"] = "The run is still going" if run.status in _IN_FLIGHT else "The run finished"
        return out
    edges = run_views._graph_edges(session, {run.team_graph_id}).get(run.team_graph_id, [])
    rows = step_rows(session, run, lines)
    cps = _checkpoints(session, run)
    suggested = _suggested(run, rows, stalled)
    for k, row in enumerate(rows):
        own = row.get("invocation_id") is not None
        resumable, _cp = (
            _predecessor(rows, k, cps) if own and row["kind"] == "agent" else (False, None)
        )
        point = {
            "invocation_id": row.get("invocation_id"),
            "node_id": row["node_id"],
            "origin_node_id": row.get("origin_node_id"),
            "label": row["label"],
            "kind": "gate" if row["kind"] == "gate" else "agent",
            "iteration": row["iteration"],
            "title": _title(row, edges),
            "text": row["text"],
            "at": row["at"],
            "cost_usd": row.get("cost_usd"),
            "state": "suggested" if own and row["invocation_id"] == suggested else "kept",
            "resumable": resumable,
            "from_run": row.get("from_run"),
        }
        if resumable and not confirm:
            point["confirm"] = {"step_label": _title(row, edges).replace(" · round ", ", round ")}
        elif resumable:
            again = _runs_again(session, run, rows, k, edges)
            step_label = again[0].replace(" · round ", ", round ")
            before = [r for r in rows[:k] if r["kind"] != "gate"]
            point["confirm"] = {
                "title": f"Resume from {step_label}?",
                "step_label": step_label,
                "kept": _kept(session, run, rows, k),
                "runs_again": again,
                "skips_cost_usd": round(sum(r.get("cost_usd") or 0 for r in before), 2),
                "skips_s": sum(r.get("duration_s") or 0 for r in before),
            }
        out["points"].append(point)
    if run.status == "running":
        out["stops_run"] = True
    out["available"] = any(p["resumable"] for p in out["points"])
    if not out["available"]:
        out["reason"] = "No step of this run can be picked up again"
    return out


def resume_hint(session, run: Run) -> dict | None:
    """``{"invocation_id", "label"}`` of the suggested point when Resume is offered (Needs you's
    button), else None — without the run's Activity (no step words are needed)."""
    return resume_hint_from(points(session, run, lines=[], confirm=False))


def resume_hint_from(reply: dict) -> dict | None:
    if not reply["available"]:
        return None
    chosen = next(
        (p for p in reply["points"] if p["state"] == "suggested" and p["resumable"]), None
    )
    chosen = chosen or next((p for p in reversed(reply["points"]) if p["resumable"]), None)
    if chosen is None:
        return None
    return {"invocation_id": chosen["invocation_id"], "label": chosen["confirm"]["step_label"]}


# ---------------------------------------------------------------------------------- creating


def create(
    session, run: Run, invocation_id: int, *, owner_id: uuid.UUID, desktop_routed: list[str] | None
) -> Run:
    """Insert the resumed run (status ``running``) in ``session``: the old snapshot copied, the
    documents as they stood when the chosen step started, the seed checkpoint. The caller starts its
    workflow after the commit. Raises :class:`ResumeRefused` when that step can't be resumed."""
    from tvashtr.control_plane.teams import copy_run_graph

    reply = points(session, run)
    k, point = next(
        ((i, p) for i, p in enumerate(reply["points"]) if p["invocation_id"] == invocation_id),
        (None, None),
    )
    if point is None or not point["resumable"]:
        raise ResumeRefused("That step can't be picked up again")
    rows = step_rows(session, run)
    _resumable, cp = _predecessor(rows, k, _checkpoints(session, run))
    chosen = session.get(AgentInvocation, invocation_id)
    new_id = uuid.uuid4()
    graph_id, id_map = copy_run_graph(session, run.team_graph_id)
    hosted = run.github_repo is not None
    new = Run(
        id=new_id,
        team_graph_id=graph_id,
        owner_id=owner_id,
        idea=run.idea,
        workflow_id=str(new_id),
        status="running",
        budget_cap_usd=run.budget_cap_usd,
        # A hosted run clones afresh into its own folder; a local repo is the same repo.
        repo_path=None if hosted or run.local_snapshot_id else run.repo_path,
        base_ref=run.base_ref,
        github_repo=run.github_repo,
        subpath=run.subpath,
        desktop_target=bool(run.desktop_target),
        desktop_subscriptions=desktop_routed if run.desktop_target else None,
        library_team_id=run.library_team_id,
        resumed_from_run_id=run.id,
        resumed_from_step=invocation_id,
        # M5: the old run's snapshot, so the old run's version (R8: not the current team).
        team_version_number=run.team_version_number,
    )
    session.add(new)
    session.flush()
    # The documents as they stood when the chosen step started (a gate edit, a Query domain
    # section included), under new ids in the new run.
    doc_map: dict[uuid.UUID, uuid.UUID] = {}
    docs = session.execute(select(Document).where(Document.run_id == run.id)).scalars().all()
    for doc in docs:
        # As they stood when the chosen step started (a gate edit, a Query domain section), plus
        # your own edits since (made while it stalled) — never the agents' words from the step that
        # runs again. Numbered afresh, in order.
        versions = [
            v
            for v in sorted(doc.versions, key=lambda v: (v.created_at, v.version_no))
            if v.created_at < chosen.started_at or v.created_by == "human"
        ]
        if not versions:
            continue
        copy = Document(title=doc.title, doc_type=doc.doc_type, run_id=new_id, name=doc.name)
        session.add(copy)
        session.flush()
        doc_map[doc.id] = copy.id
        for no, v in enumerate(versions, start=1):
            session.add(
                DocumentVersion(
                    document_id=copy.id,
                    version_no=no,
                    content=v.content,
                    created_by=v.created_by,
                    note=v.note,
                    author_node_id=v.author_node_id,
                    idempotency_key=f"{new_id}:carried:{v.id}",
                    created_at=v.created_at,
                )
            )
    pm_doc = doc_map.get(run.pm_document_id) if run.pm_document_id else None
    new.pm_document_id = pm_doc  # read_latest_prd_* read the spec through the run row
    state = dict(cp.state) if cp is not None else {}
    num = number(session, run)

    def remap(node_id: str) -> str:
        return str(id_map[uuid.UUID(node_id)])

    carried = []
    for r in rows[:k]:
        carried.append(
            {
                **r,
                "source_invocation_id": r.get("source_invocation_id") or r.get("invocation_id"),
                "invocation_id": None,
                "node_id": remap(r["node_id"]),
                "from_run": r.get("from_run") or {"run_id": str(run.id), "number": num},
            }
        )
    seed_state = {
        "start_node_id": remap(str(chosen.node_id)),
        "iters_by_node": {remap(n): c for n, c in (state.get("iters_by_node") or {}).items()},
        "reviewer_feedback": state.get("reviewer_feedback"),
        "pm_document_id": str(pm_doc) if pm_doc else None,
        "carried": carried,
        "from_run": {
            "run_id": str(run.id),
            "number": num,
            "step_label": point["confirm"]["step_label"],
        },
    }
    session.add(
        RunCheckpoint(
            run_id=new_id,
            invocation_id=None,
            node_id=id_map[chosen.node_id],
            iteration=chosen.iteration,
            base_sha=cp.base_sha if cp is not None else "",
            diff=cp.diff if cp is not None else b"",
            too_large=False,
            state=seed_state,
        )
    )
    session.flush()
    return new


# ---------------------------------------------------------------------------------- reading


def carried(session, run: Run) -> tuple[list[dict], dict | None, str | None]:
    """A resumed run's carried step rows (in its own node ids), the run it was resumed from
    (``{run_id, number, step_label}``) and the node it started at; else ``([], None, None)``."""
    seed = seed_of(session, run)
    if seed is None:
        return [], None, None
    state = seed.state
    return list(state.get("carried", [])), state.get("from_run"), state.get("start_node_id")


def waiting_text(rows: list[dict]) -> str:
    """A carried node that runs again: "Round 1 notes carried over" (a reviewer's verdict) or
    "Round 1 carried over"."""
    last = rows[-1]
    notes = "notes " if last.get("verdict") else ""
    return f"Round {last['iteration']} {notes}carried over"


def card_text(rows: list[dict], runs_again: bool) -> str:
    return waiting_text(rows) if runs_again else carried_text(rows)


def carried_text(rows: list[dict]) -> str:
    """A carried node's words on its card ("From run #12" / "Approved in run #12")."""
    last = rows[-1]
    ref = run_ref((last.get("from_run") or {}).get("number"))
    if last["kind"] == "gate" and last.get("verdict") == "approved":
        return f"Approved in {ref}"
    return f"From {ref}"


def carried_by_node(rows: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for row in rows:
        out.setdefault(row["node_id"], []).append(row)
    return out


def carried_activity(rows: list[dict]) -> str:
    """The Now bar's line for a node whose work is all carried: "From run #12 · spec v2"."""
    text = carried_text(rows)
    doc = next((r["doc"] for r in reversed(rows) if r.get("doc")), None)
    return f"{text} · {doc['name'] or 'spec'} v{doc['version']}" if doc else text


def safe_text(reply: dict) -> str | None:
    """What the Failed / Stalled callout says is safe: "your approved spec (v2) and the Engineer’s
    round 1 changes are saved" — from the suggested point's Kept list."""
    point = next((p for p in reply["points"] if p["state"] == "suggested" and p["resumable"]), None)
    if point is None:
        return None
    kept = [k["text"] for k in point["confirm"]["kept"]]
    parts: list[str] = []
    spec = next((t for t in kept if t.lower().startswith("spec v")), None)
    approved = "Your approval" in kept
    if spec:
        version = spec.split(" v", 1)[1]
        parts.append(f"your approved spec (v{version})" if approved else f"the spec (v{version})")
    elif approved:
        parts.append("your approval")
    changes = [t for t in kept if ": changes to " in t]
    if changes:
        who, _ = changes[-1].split(": changes to ", 1)
        label, round_ = who.rsplit(" round ", 1)
        parts.append(f"the {label}’s round {round_} changes")
    if not parts:
        return None
    joined = " and ".join(parts) if len(parts) <= 2 else ", ".join(parts[:-1]) + " and " + parts[-1]
    return joined + (" is saved" if len(parts) == 1 else " are saved")


# ---------------------------------------------------------------------------------- the walk


def seed_state(run_id: str) -> dict:
    """What a resumed run's walk starts from (``load_resume_step``): ids and the walk state only —
    never the diff, which ``checkpoints.restore`` reads itself."""
    from tvashtr.db import session_scope

    with session_scope() as session:
        run = session.get(Run, uuid.UUID(run_id))
        seed = seed_of(session, run) if run is not None else None
        if seed is None:
            raise CheckpointError(f"run {run_id} has no carried state to resume from")
        s = seed.state
        return {
            "start_node_id": s["start_node_id"],
            "iters_by_node": dict(s.get("iters_by_node") or {}),
            "reviewer_feedback": s.get("reviewer_feedback"),
            "pm_document_id": s.get("pm_document_id"),
        }
