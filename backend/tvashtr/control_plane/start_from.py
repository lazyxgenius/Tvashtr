"""M10 (ruling R9) — Start a new run from this one.

A finished run on a GitHub repo starts the next run. What comes along is the person's choice of
four kinds, read from the run's own rows: the final spec (the newest version of its spec document),
their decisions (gates a PERSON resolved — never an automatic approval), the confirmed memories
(``node_memories`` from the run, ``status 'active'``) and each agent's newest work brief. Never the
agents' conversations (run events, transcripts, tool output). The new run goes through
``POST /api/runs``'s own path (``routers.launch_run``) with a snapshot of what came along
(``runs.carry``), which the walk hands to every agent's compiled context.

GitHub I/O (the repo's default branch, whether the pull request was merged) never runs inside a
database session. Words are made here (contract: ``docs/superpowers/plans/api/start-from-run.md``).
Openhands-free.
"""

import json
import uuid
from datetime import UTC, datetime

from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from pydantic import SecretStr
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane import activity, github_app, github_targets, resume, run_views, versions
from tvashtr.control_plane.credentials import decrypt_secret
from tvashtr.control_plane.guardrails import mask_secrets
from tvashtr.control_plane.run_failure import node_label
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    DocumentVersion,
    Edge,
    GithubInstallation,
    HumanTask,
    NodeMemory,
    ProviderCredential,
    Run,
    RunEvent,
    TeamGraph,
)

SUMMARY_CAP = 600
_AUTO = "auto-approved"  # ``gates.wait_at_gate``'s note on an automatic approval
_MASK = "••••"
# ponytail: a known value shorter than this is left to the shape patterns — replacing every
# occurrence of a short string would garble the log. Lower it if a real secret that short appears.
_MIN_SECRET = 8


def _owned(session, run_id: str, owner_id: uuid.UUID) -> Run:
    from tvashtr.routers import _require_owned_run  # the router mounts after this module

    return _require_owned_run(session, run_id, owner_id)


# ---------------------------------------------------------------------------------- what comes


def reason(session, run: Run) -> str | None:
    """Why ``run`` can't start the next one; ``None`` when it can (R9)."""
    if run.status != "completed":
        return "Only a run that finished can start the next one"
    if not run.github_repo:
        return "Only a run on a GitHub repo can start the next one"
    if run.pair_id is not None:
        return "A compare run can’t start the next one"
    team = session.get(TeamGraph, run.library_team_id) if run.library_team_id else None
    if team is None or not team.is_library or team.owner_id != run.owner_id:
        return "The team this run used is gone"
    return None


def _decision_title(task: HumanTask) -> str:
    """ "Spec approved" — what the gate asked about, and what the person decided."""
    what = activity._GATE_OBJECT.get(task.kind, "this step").removeprefix("the ")
    return f"{what[:1].upper()}{what[1:]} {task.resolution}"


def _brief(inv: AgentInvocation) -> str | None:
    if inv.outcome in ("approved", "changes_requested"):
        reasons = activity._reasons(inv.outcome_detail)
        lead = "Approved" if inv.outcome == "approved" else "Asked for changes"
        return lead + (": " + "; ".join(reasons) if reasons else "")
    return inv.outcome_detail


def _summaries(session, run: Run) -> list[dict]:
    """Each agent's newest work brief, in the order the agents first ran."""
    rows = session.execute(
        select(AgentInvocation, AgentNode)
        .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
        .where(
            AgentInvocation.run_id == run.workflow_id,
            AgentInvocation.status == "done",
            AgentNode.kind.in_(("agent", "completion")),
        )
        .order_by(AgentInvocation.started_at, AgentInvocation.id)
    ).all()
    newest: dict = {}  # node id → (node, its newest step); keys keep first-run order
    for inv, node in rows:
        newest[node.id] = (node, inv)
    out = []
    for node, inv in newest.values():
        text = _brief(inv)
        if text and text.strip():
            out.append(
                {
                    "agent": node_label(node.role_name, node.kind, node.config),
                    "text": activity._cap(mask_secrets(text), SUMMARY_CAP),
                }
            )
    return out


def gather(session, run: Run) -> dict:
    """Everything that can come along, from the run's rows: ``{spec, decisions, memories,
    pending_memories, summaries}`` (``spec`` with its text, memories with their force)."""
    spec = None
    if run.pm_document_id is not None:
        newest = session.execute(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == run.pm_document_id)
            .order_by(DocumentVersion.version_no.desc())
            .limit(1)
        ).scalar_one_or_none()
        if newest is not None:
            spec = {"version": newest.version_no, "text": newest.content}
    tasks = session.execute(
        select(HumanTask)
        .where(
            HumanTask.run_id == run.workflow_id,
            HumanTask.resolution.in_(("approved", "rejected")),
        )
        .order_by(HumanTask.resolved_at, HumanTask.id)
    ).scalars()
    decisions = [
        {"title": _decision_title(t), "text": (t.resolution_note or "").strip() or None}
        for t in tasks
        if t.resolution_note != _AUTO
    ]
    learned = session.execute(
        select(NodeMemory.id, NodeMemory.content, NodeMemory.polarity, NodeMemory.status)
        .where(
            NodeMemory.owner_id == run.owner_id,
            NodeMemory.source_run_id == run.workflow_id,
            NodeMemory.status.in_(("active", "pending_review")),
        )
        .order_by(NodeMemory.created_at, NodeMemory.id)
    ).all()
    return {
        "spec": spec,
        "decisions": decisions,
        "memories": [
            {"id": str(m.id), "content": m.content, "polarity": m.polarity}
            for m in learned
            if m.status == "active"
        ],
        "pending_memories": sum(m.status == "pending_review" for m in learned),
        "summaries": _summaries(session, run),
    }


def _pr(run: Run) -> dict | None:
    number = run_views.pr_number(run.pr_url)
    if number is None or not run.ship_branch:
        return None
    return {"number": number, "branch": run.ship_branch}


def github_facts(owner_id: uuid.UUID, github_repo: str, pr: dict | None) -> tuple[str, bool]:
    """``(the repo's default branch, whether the pull request was merged)`` through the owner's
    installation. A repo GitHub can't show reads as ``"main"``; a merge it can't say is not one."""
    try:
        match = github_targets.owner_repo(owner_id, github_repo)
    except github_app.GithubAppError:
        match = None
    if match is None:
        return "main", False
    default = match[1].get("default_branch") or "main"
    if pr is None:
        return default, False
    try:
        return default, github_app.pull_request_merged(match[0], github_repo, pr["number"])
    except github_app.GithubAppError:
        return default, False


def _options(pr: dict | None, merged: bool, default: str) -> list[dict]:
    offered = pr is not None and not merged
    head = [{"value": "pr", "label": f"{pr['branch']} (pull request #{pr['number']})"}]
    return (head if offered else []) + [{"value": "main", "label": default}]


def dialog(owner_id: uuid.UUID, run_id: str) -> dict:
    """``GET /api/runs/{id}/next``: what can come along, where it can start, the team version."""
    with session_scope() as session:
        run = _owned(session, run_id, owner_id)
        out = {
            "available": False,
            "reason": reason(session, run),
            "run": {"id": str(run.id), "number": resume.number(session, run), "idea": run.idea},
            "spec": None,
            "decisions": [],
            "memories": [],
            "pending_memories": 0,
            "summaries": [],
            "pr": None,
            "start_from": [],
            "default_start": None,
            "team": None,
            "entry_agent": None,
        }
        if out["reason"] is not None:
            return out
        found = gather(session, run)
        team = session.get(TeamGraph, run.library_team_id)
        top, changes = versions.pending(session, team, owner_id)
        # R3: a run starts on the current version, or on the next one when there are changes.
        out["team"] = {"id": str(team.id), "version": top.number + (1 if changes else 0)}
        # The agent that updates the starting spec: the team's entry agent, as the team is now.
        entry = _entry(
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == team.id)).scalars(),
            session.execute(select(Edge).where(Edge.team_graph_id == team.id)).scalars().all(),
        )
        if entry is not None:
            out["entry_agent"] = node_label(entry.role_name, entry.kind, entry.config)
        github_repo, pr = run.github_repo, _pr(run)
    default, merged = github_facts(owner_id, github_repo, pr)
    out.update(
        available=True,
        spec={"version": found["spec"]["version"]} if found["spec"] else None,
        decisions=found["decisions"],
        memories=[{"id": m["id"], "content": m["content"]} for m in found["memories"]],
        pending_memories=found["pending_memories"],
        summaries=found["summaries"],
        pr={**pr, "merged": merged} if pr else None,
        start_from=_options(pr, merged, default),
        default_start="pr" if pr and not merged else "main",
    )
    return out


def start(owner_id: uuid.UUID, run_id: str, *, task: str, carry: dict, start_from: str) -> dict:
    """``POST /api/runs/{id}/next``: the next run, through ``POST /api/runs``'s own path, with the
    snapshot of what the person chose to bring along (an unticked kind is ``null`` / ``[]``)."""
    from tvashtr.routers import CreateRunRequest, launch_run  # the router mounts after this module

    task = task.strip()
    if not task:
        raise HTTPException(status_code=422, detail="Write the next task first")
    with session_scope() as session:
        run = _owned(session, run_id, owner_id)
        problem = reason(session, run)
        if problem is not None:
            raise HTTPException(status_code=422, detail=problem)
        found = gather(session, run)
        source = {"run_id": str(run.id), "number": resume.number(session, run)}
        old_id, github_repo, team_id, pr = run.id, run.github_repo, run.library_team_id, _pr(run)
    default, merged = github_facts(owner_id, github_repo, pr)
    on_pr = start_from == "pr"
    if on_pr and pr is None:
        raise HTTPException(status_code=422, detail="This run has no pull request to start from")
    if on_pr and merged:
        raise HTTPException(
            status_code=422, detail=f"The pull request was merged — start from {default}"
        )
    snapshot = {
        "from": source,
        "spec": found["spec"] if carry.get("spec") else None,
        **{k: found[k] if carry.get(k) else [] for k in ("decisions", "memories", "summaries")},
        "start_from": {
            "kind": start_from,
            "branch": pr["branch"] if on_pr else default,
            "pr_number": pr["number"] if on_pr else None,
        },
    }
    body = CreateRunRequest(
        idea=task,
        team_graph_id=str(team_id),
        github_repo=github_repo,
        base_ref=pr["branch"] if on_pr else None,  # None: the repo's default branch
    )
    launched = launch_run(body, owner_id, started_from_run_id=old_id, carry=snapshot)
    with session_scope() as session:
        new = session.get(Run, uuid.UUID(launched["run_id"]))
        return {"run_id": launched["run_id"], "number": resume.number(session, new)}


# ---------------------------------------------------------------------------------- after


def _started_from(run: Run) -> bool:
    return getattr(run, "started_from_run_id", None) is not None and bool(
        getattr(run, "carry", None)
    )


def came_along(owner_id: uuid.UUID, run_id: str) -> dict:
    """``GET /api/runs/{id}/carry``: the run's snapshot as the dialog shows it (404 for a run that
    didn't start from another)."""
    with session_scope() as session:
        run = _owned(session, run_id, owner_id)
        if not _started_from(run):
            raise HTTPException(status_code=404, detail="this run didn't start from another")
        carry = run.carry
    spec = carry.get("spec")
    return {
        "from": carry.get("from"),
        "spec": {"version": spec.get("version")} if spec else None,
        "decisions": [{"title": d["title"], "text": d.get("text")} for d in carry["decisions"]],
        "memories": [{"id": m["id"], "content": m["content"]} for m in carry["memories"]],
        "summaries": [{"agent": s["agent"], "text": s["text"]} for s in carry["summaries"]],
    }


def _entry(nodes: list, edges: list):
    """The graph's entry node — the root, as ``team_run.load_graph_step`` picks it."""
    targets = {str(e.target_node_id) for e in edges}
    return min(
        (n for n in nodes if str(n.id) not in targets), key=lambda n: str(n.id), default=None
    )


def spec_card(session, run: Run, nodes: list, edges: list) -> dict[str, str]:
    """``{entry node id: "From spec v3 of run #12"}`` — what the run view's card for the entry
    agent reads until its first step has activity of its own (an event) and while the run has no
    spec of its own; ``{}`` otherwise."""
    spec = (run.carry or {}).get("spec") if _started_from(run) else None
    entry = _entry(nodes, edges) if spec and run.pm_document_id is None else None
    if entry is None:
        return {}
    its_steps = select(AgentInvocation.id).where(
        AgentInvocation.run_id == run.workflow_id, AgentInvocation.node_id == entry.id
    )
    spoke = session.execute(
        select(RunEvent.id)
        .where(RunEvent.run_id == run.workflow_id, RunEvent.invocation_id.in_(its_steps))
        .limit(1)
    ).first()
    if spoke is not None:
        return {}
    ref = resume.run_ref((run.carry.get("from") or {}).get("number"))
    version = spec.get("version")
    return {
        str(entry.id): f"From spec v{version} of {ref}" if version else f"From the spec of {ref}"
    }


# ---------------------------------------------------------------------------------- the log


def _known_secrets(session, owner_id: uuid.UUID) -> list[str]:
    """Every secret value this server knows that a run of ``owner_id`` could have printed: the
    owner's stored provider keys, the GitHub installation tokens held for them, the server's own
    secret settings. Longest first, so a value containing another is masked whole."""
    values: list[str] = []
    for encrypted in session.execute(
        select(ProviderCredential.secret_encrypted).where(ProviderCredential.owner_id == owner_id)
    ).scalars():
        try:
            values.append(decrypt_secret(encrypted))
        except InvalidToken:
            continue
    installations = session.execute(
        select(GithubInstallation.installation_id).where(GithubInstallation.owner_id == owner_id)
    ).scalars()
    values += github_app.cached_installation_tokens(list(installations))
    settings = get_settings()
    for name in type(settings).model_fields:
        value = getattr(settings, name)
        if isinstance(value, SecretStr):
            values.append(value.get_secret_value())
    return sorted({v for v in values if len(v) >= _MIN_SECRET}, key=len, reverse=True)


def _masker(session, owner_id: uuid.UUID):
    known = _known_secrets(session, owner_id)

    def mask(text: str) -> str:
        for value in known:
            text = text.replace(value, _MASK)
        return mask_secrets(text)

    return mask


def _detail(line: dict) -> list[str]:
    """What a log line shows under it: the command and its output tail, the error, the notes."""
    refs = line["refs"]
    if line["kind"] in ("command", "tests") and refs.get("command"):
        return [f"$ {refs['command']}", *(refs.get("output_tail") or [])]
    if line["kind"] == "error" and refs.get("message"):
        return [refs["message"]]
    if line["kind"] == "verdict" and isinstance(refs.get("reasons"), list):
        return list(refs["reasons"])
    if line["kind"] == "read" and len(refs.get("files") or []) > 1:
        return list(refs["files"])
    return []


def log(owner_id: uuid.UUID, run_id: str, fmt: str) -> tuple[str, str]:
    """``GET /api/runs/{id}/log``: ``(content, filename)`` — every Activity line in order, as
    readable text or JSON lines, every secret masked. Nothing reads it back."""
    with session_scope() as session:
        run = _owned(session, run_id, owner_id)
        mask = _masker(session, run.owner_id)
        lines = activity.run_activity(session, run, resume_info=False, mask=mask)["lines"]
        number = resume.number(session, run)
        team = session.get(TeamGraph, run.library_team_id) if run.library_team_id else None
        header = [
            f"run #{number}" if number else "run",
            *([team.name] if team is not None else []),
            " ".join(run.idea.split()),
            *([f"team setup v{run.team_version_number}"] if run.team_version_number else []),
        ]
    stem = f"run-{number}" if number else f"run-{run_id[:8]}"
    rows = [
        {
            "at": ln["at"],
            "agent": mask(ln["label"]),
            "round": ln["iteration"],
            "kind": ln["kind"],
            "text": mask(ln["text"]),
            "detail": mask("\n".join(_detail(ln))) or None,
        }
        for ln in lines
    ]
    if fmt == "jsonl":
        body = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
        return body, f"{stem}.jsonl"
    width = max((len(r["agent"]) for r in rows), default=3)
    out = [mask(" · ".join(header))]
    for r in rows:
        clock = datetime.fromisoformat(r["at"]).astimezone(UTC).strftime("%H:%M:%S")
        out.append(f"{clock}  {r['agent']:<{width}}  {r['text']}")
        out += [" " * (12 + width) + d for d in (r["detail"] or "").splitlines()]
    return "\n".join(out) + "\n", f"{stem}.txt"
