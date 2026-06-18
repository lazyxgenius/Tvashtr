"""The generic graph executor: PM phase -> cyclic build/review sub-walk -> ship,
all in one durable DBOS workflow (P1.5a).

``run_team`` is started with ``DBOS.workflow_id == run_id == str(runs.id)`` (the
endpoint uses ``SetWorkflowID``), so every side-effecting write keys its
idempotency on ``run_id``. The nodes/edges are read from the team-graph rows (the
team is *authored*, not hardcoded), and the executor WALKS them: after the fixed
PM phase + PRD gate + pre-engineer budget checkpoint, :func:`run_review_loop`
follows edge conditions around the Engineer<->Reviewer cycle until a node emits an
outcome that matches no out-edge (-> ship) or the loop cap raises an escalation.
The same code runs both the 2-node team (Engineer has no out-edge -> ship after
one build) and the 3-node review-loop team. The PM phase + gates + budget
checkpoints + ship stay fixed pre/post phases (folding into the uniform walk is
5b, when gates become graph entities).

Crash-durability (Decision 1, now per-iteration): each Engineer iteration is its
own coarse ``engineer_run_step`` — no checkpointing inside OpenHands' loop. The
``while`` loop replays cleanly because DBOS keys every step's recorded output by
``(workflow_id, call-order function_id)``: on resume completed steps replay their
recorded outputs in call order, so the data-dependent loop re-issues the identical
step sequence (its control flow is driven by recorded outputs — the reviewer
verdict + the forced-harness decision are BOTH recorded inside
``reviewer_decide_step``). The ship is dedup'd by the ``ship-{run_id}`` git tag, so
it happens exactly once. (The mid-loop crash proof is the 3rd P1.5a prompt.)

``openhands.*`` is imported only lazily inside the steps that need it, so this
module (and app startup) never loads it.
"""

import os
import re
import uuid
from pathlib import Path

from dbos import DBOS
from sqlalchemy import select, update

from tvashtr.config import get_settings
from tvashtr.control_plane.budget import budget_check_step, mark_budget_overridden_step
from tvashtr.control_plane.gates import wait_at_gate
from tvashtr.control_plane.invocations import close_invocation_step, open_invocation_step
from tvashtr.control_plane.litellm_admin import delete_virtual_key, mint_virtual_key
from tvashtr.control_plane.shipping import idempotent_ship, init_workspace_repo
from tvashtr.db import session_scope
from tvashtr.documents.service import create_document_with_initial_version
from tvashtr.engines.base import AgentTask
from tvashtr.engines.registry import resolve_adapter
from tvashtr.engines.run_event_sink import make_run_event_sink
from tvashtr.gateway import CompletionRequest, complete
from tvashtr.metering import record_agent_cost, record_cost, running_cost
from tvashtr.models import AgentNode, Edge, EngineerRunAttempt, Run


@DBOS.step()
def load_graph_step(run_id: str) -> dict:
    """Load the run's team graph as a picklable dict the executor walks: every node
    (``id``/``role_name``/``kind``/``model``, ids as ``str``) + every edge
    (``source``/``target`` as ``str``, ``edge_type``, ``conditions``), plus the PM
    node id and the **subgraph entry** — the agent node the PM's ``work`` edge
    targets, where the cyclic build/review sub-walk begins.

    Generic, not role-hardcoded: the PM is the source of the single ``work`` edge
    and the entry is its target, so the 2-node and 3-node teams both resolve with
    the same code (the Supervisor's future graphs will too)."""
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id))
            .scalars()
            .all()
        )
        edges = (
            session.execute(select(Edge).where(Edge.team_graph_id == run.team_graph_id))
            .scalars()
            .all()
        )

    nodes_out = [
        {"id": str(n.id), "role_name": n.role_name, "kind": n.kind, "model": n.model} for n in nodes
    ]
    edges_out = [
        {
            "source": str(e.source_node_id),
            "target": str(e.target_node_id),
            "edge_type": e.edge_type,
            "conditions": e.conditions,
        }
        for e in edges
    ]
    work_edge = next(e for e in edges_out if e["edge_type"] == "work")
    return {
        "nodes": nodes_out,
        "edges": edges_out,
        "pm_node_id": work_edge["source"],
        "entry_node_id": work_edge["target"],
    }


def next_node(edges: list[dict], source_id: str, outcome: str | None) -> str | None:
    """Pure routing: among ``edges`` leaving ``source_id``, follow the matching one.

    If ``outcome`` is not None and some edge's ``conditions == {"when": outcome}``,
    return that edge's target; else return the unconditional edge's target
    (``conditions is None``); else ``None`` (the sub-walk ends here -> ship).

    Importable + unit-tested. ``edges`` are the ``load_graph_step`` dicts
    (``source``/``target``/``conditions``)."""
    out_edges = [e for e in edges if e["source"] == source_id]
    if outcome is not None:
        for edge in out_edges:
            if edge["conditions"] == {"when": outcome}:
                return edge["target"]
    for edge in out_edges:
        if edge["conditions"] is None:
            return edge["target"]
    return None


@DBOS.step()
def pm_step(run_id: str, idea: str, pm_model: str) -> dict:
    """PM node: a direct, metered gateway completion -> a versioned PRD document."""
    prompt = (
        "You are the PM on a software team. Write a concise mini-PRD (3-5 sentences) "
        "for the feature request below. You MUST restate, verbatim, the exact file path "
        "and the exact required file contents (each clearly labelled on its own line), "
        "plus one sentence of context for the engineer.\n\n"
        f"Feature request:\n{idea}"
    )
    request = CompletionRequest(
        model=pm_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=400,
    )
    result = complete(request)
    record_cost(result, workflow_id=run_id, idempotency_key=f"{run_id}:pm-llm")

    document = create_document_with_initial_version(
        title="Mini-PRD",
        doc_type="prd",
        content=result.text,
        created_by="agent:pm",
        idempotency_key=f"{run_id}:pm-prd-v1",
    )
    with session_scope() as session:
        session.execute(
            update(Run).where(Run.id == uuid.UUID(run_id)).values(pm_document_id=document.id)
        )
    return {"document_id": str(document.id), "prd_text": result.text}


@DBOS.step()
def engineer_setup_step(run_id: str) -> str:
    """Create a fresh local workspace and git-init it (repo-local identity)."""
    from tvashtr.engines.openhands_adapter import make_local_workspace  # lazy (openhands)

    workspace = make_local_workspace(run_id)
    init_workspace_repo(workspace)
    return workspace


# P1.4b: per-run virtual-key lifecycle constants.
# TTL on the minted key — the crash-robust floor (no teardown step can be skipped by a crash;
# orphan keys self-clean). 30m comfortably outlives a single engineer run.
_VKEY_TTL = "30m"
# A tiny positive floor for the key's max_budget so a run that passed the pre-engineer gate
# (spent <= cap, so remaining >= 0) always mints a USABLE key the agent can at least start with
# — never a zero/negative budget that would reject call #1 before the run even begins.
_VKEY_MIN_BUDGET_USD = 1e-6


@DBOS.step()
def mint_vkey_step(run_id: str) -> str | None:
    """Mint a per-run LiteLLM virtual key whose ``max_budget`` is the run's REMAINING budget,
    so the proxy cuts the agent off **mid-call** at the cap (P1.4b). Returns the key value, or
    ``None`` when the proxy is off (then the agent uses ``OPENROUTER_API_KEY`` exactly as today).

    Budget = ``cap − running_cost(run_id)`` at mint time (after the PM has run, so the PM's
    spend is already counted) — one per-run cap enforced from two angles (this proxy cutoff
    mid-step + P1.2's between-steps gate), no double-count. Two uncapped-key guards: a run a
    human already approved over budget (``budget_overridden``), or one with no cap
    (``budget_cap_usd is None``), mints with **no** ``max_budget``.

    Idempotency is provided by DBOS step-output checkpointing — a completed step replays its
    recorded key on resume (no re-mint). The narrow in-step crash window (key minted on the
    proxy but the output not yet recorded → a resume re-mints, orphaning the first key)
    self-cleans via the key TTL — the same accepted class as the ship commit/tag window."""
    settings = get_settings()
    if not settings.litellm_proxy_enabled:
        return None
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        cap = run.budget_cap_usd
        overridden = run.budget_overridden
    if overridden or cap is None:
        max_budget: float | None = None  # uncapped key (human-approved breach, or no cap)
    else:
        remaining = float(cap) - float(running_cost(run_id))
        max_budget = max(remaining, _VKEY_MIN_BUDGET_USD)
    result = mint_virtual_key(max_budget=max_budget, duration=_VKEY_TTL)
    key = result.get("key")
    if not key:
        # Fail CLOSED: a mint that returned no usable key would otherwise fall back to the
        # master key in ``agent_llm_routing`` -> an UNCAPPED run. For a budget-enforcement
        # step, refuse rather than run unbudgeted. (Not reachable against the pinned proxy —
        # a 200 from /key/generate always carries "key" — this is defense-in-depth.)
        raise RuntimeError("proxy /key/generate returned no 'key'; refusing to run unbudgeted")
    return key


@DBOS.step()
def delete_vkey_step(run_id: str, key: str | None) -> None:
    """Best-effort immediate invalidation of the per-run key right after the agent runs. A
    no-op when ``key is None`` (proxy off). Never raises — the key's TTL backstops a skipped
    or failed delete, so this adds no correctness dependency (P1.4b Q5)."""
    if key is None:
        return
    delete_virtual_key(key)


@DBOS.step()
def engineer_run_step(
    run_id: str,
    prd_text: str,
    workspace: str,
    eng_model: str,
    vkey: str | None,
    iteration: int,
    reviewer_feedback: str | None,
) -> dict:
    """The ONE coarse step wrapping the agent run. No commit / no cost write here.

    ``vkey`` (P1.4b) is the per-run virtual key (or None when the proxy is off); it rides into
    the agent's LLM as its api_key via ``AgentTask.llm_api_key``. The returned ``status`` may
    now be ``"over_budget"`` (the proxy cut the agent off mid-call) — passed through unchanged.

    ``iteration``/``reviewer_feedback`` (P1.5a): on a revision round (``iteration > 1`` with
    feedback) the Reviewer's requested changes are appended to the instruction with a
    revise-in-place directive — the prior round's work is already in ``workspace`` (set up once
    before the loop, so the Engineer reworks incrementally). The ``AgentTask`` contract is
    UNCHANGED: the iteration/feedback ride INSIDE the instruction string, not as new fields."""
    # Attempt log — intentionally NOT idempotent: one row per execution. A
    # crash-then-resume re-runs this whole step, yielding a second row with a
    # different pid (the observable proof the agent step re-executed).
    with session_scope() as session:
        session.add(EngineerRunAttempt(run_id=run_id, pid=os.getpid()))

    # Happy-path correctness instruction (DQ3): a relative path keeps the deliverable
    # in the working dir so it ships. The security justification is dropped — in
    # docker mode the container, not the prompt, is the boundary; in local mode this
    # is plain "land it where the ship can find it" (containment is P1.3's job, not
    # the prompt's).
    instruction = (
        "Read the following PRD and create exactly the file it specifies, with exactly "
        "the specified contents. Write the deliverable into your current working "
        "directory using a RELATIVE path (the bare filename, e.g. 'greeting.txt') so it "
        "can be shipped; if the PRD shows a leading '/' or './', treat it as relative to "
        "your working directory. Do not add any extra files and do not modify anything "
        "else.\n\n--- PRD ---\n"
        f"{prd_text}"
    )
    # P1.5a revision round: carry the Reviewer's feedback + a revise-in-place directive
    # so the Engineer reworks the prior round's files (already in the workspace) rather
    # than starting over. iteration==1 (the first build) is byte-for-byte the old path.
    if iteration > 1 and reviewer_feedback:
        instruction += (
            f"\n\n--- REVISION REQUESTED (round {iteration}) ---\n"
            "The Reviewer reviewed your previous attempt and requested these changes:\n"
            f"{reviewer_feedback}\n"
            "Your prior work is in your current working directory — revise it IN PLACE to "
            "address this feedback. Do not start over and do not delete unrelated files."
        )
    task = AgentTask(
        instruction=instruction, workspace_dir=workspace, model=eng_model, llm_api_key=vkey
    )
    # Select local vs Docker-sandboxed engine from the configured sandbox mode
    # (P1.3a, DQ4). Default "local" keeps the proven path; "docker" routes through
    # the containerized adapter. The EngineAdapter contract + AgentRunResult shape
    # are identical across modes; reap-before-start lives inside the docker adapter.
    engine_name = (
        "openhands-docker" if get_settings().agent_sandbox_mode == "docker" else "openhands"
    )
    adapter = resolve_adapter(engine_name)  # lazy openhands import happens here
    result = adapter.run(task, on_event=make_run_event_sink(run_id))
    return {
        "status": result.status,
        "files_changed": result.files_changed,
        "error": result.error,
        "prompt_tokens": result.prompt_tokens,
        "completion_tokens": result.completion_tokens,
        "total_tokens": result.total_tokens,
        "cost_usd": result.cost_usd,
    }


@DBOS.step()
def persist_agent_cost_step(run_id: str, eng_model: str, usage: dict, iteration: int) -> None:
    """Write one CostRecord for THIS Engineer iteration, idempotent on the per-iteration
    key ``{run_id}:agent-cost:{iteration}``. The Engineer now runs up to
    ``max_review_iterations`` times, so the key MUST carry the iteration — a once-per-run
    key would collide across rounds and under-count the spend. (The 2-node path runs the
    Engineer once -> a single ``{run_id}:agent-cost:1`` row.)"""
    record_agent_cost(
        workflow_id=run_id,
        idempotency_key=f"{run_id}:agent-cost:{iteration}",
        model=eng_model,
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
        total_tokens=usage["total_tokens"],
        cost_usd=usage["cost_usd"],
    )


# P1.5a Reviewer constants.
# Cap the deliverable text passed into a single Reviewer completion (real mode only): the
# loop's current deliverables are small, and a hard char budget keeps the review a cheap
# one-shot. Multi-file repos the reviewer must *explore* are the agent-reviewer upgrade
# (§15), not this prompt.
_REVIEW_MAX_CHARS = 12000
# Forced-revisions harness flag — read inside the recorded reviewer step (like
# gate_auto_resolution_step reads TVASHTR_AUTO_APPROVE_GATES) so a crash-resume replays the
# same verdicts regardless of the restarted process's environment. Never set in production.
_FORCE_REVISIONS_ENV = "TVASHTR_FORCE_REVISIONS"


def _read_workspace_deliverable(workspace: str) -> str:
    """Read the non-hidden files under ``workspace`` into one labelled string for the
    Reviewer (stdlib only; skips ``.git`` and any hidden file/dir; total capped at
    ``_REVIEW_MAX_CHARS``). ``workspace`` is the local path string from
    ``make_local_workspace`` (5a runs the loop in local mode)."""
    root = Path(workspace)
    parts: list[str] = []
    budget = _REVIEW_MAX_CHARS
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(segment.startswith(".") for segment in rel.parts):
            continue  # skip .git/ and any hidden file/dir
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        chunk = f"\n--- {rel} ---\n{text}"
        parts.append(chunk[:budget])
        budget -= len(chunk)
        if budget <= 0:
            break
    return "".join(parts).strip() or "(the workspace contains no readable deliverable files)"


def _parse_verdict(text: str) -> dict:
    """Parse the Reviewer's reply into ``{"outcome", "reasons"}`` defensively: an
    unambiguous ``changes_requested`` verdict -> that (carrying the reply as the reasons the
    Engineer gets next round); anything else (incl. an unparseable reply) defaults to
    ``approved`` — the loop cap is the safety net, so a malformed reply ships rather than
    spinning. Real-mode review *quality* is P1.5c's concern; this just needs to be correct +
    parseable."""
    match = re.search(r"verdict\s*:?\s*(approved|changes[ _]requested)", text, re.IGNORECASE)
    if match:
        verdict = match.group(1).lower().replace(" ", "_")
    elif re.search(r"changes[ _]requested", text, re.IGNORECASE):
        verdict = "changes_requested"
    else:
        verdict = "approved"
    if verdict == "changes_requested":
        return {"outcome": "changes_requested", "reasons": text.strip()[:_REVIEW_MAX_CHARS]}
    return {"outcome": "approved", "reasons": None}


@DBOS.step()
def reviewer_decide_step(
    run_id: str, reviewer_model: str, iteration: int, prd_text: str, workspace: str
) -> dict:
    """The Reviewer — a recorded completion step that judges the Engineer's deliverable
    against the PRD and emits ``{"outcome": "approved"|"changes_requested", "reasons":
    str|None}``. Recorded, so a crash-resume replays the SAME verdict (the loop's control
    flow depends on it). Two modes:

    * **Forced harness** (``TVASHTR_FORCE_REVISIONS=N``, read inside this step): return
      ``changes_requested`` while the reviewer iteration ``n <= N``, else ``approved`` — NO
      LLM call, NO cost. This is how 5a proves the cycle genuinely runs deterministically (a
      real Reviewer would approve the trivial deliverable round 1 -> a vacuous proof).
    * **Real mode** (no env): read the deliverable from the workspace, ask the Reviewer to
      judge it against the PRD and reply with a parseable ``VERDICT:`` line, meter the call
      (key ``{run_id}:reviewer-llm:{iteration}``), parse defensively. Real review quality is
      P1.5c's concern, not this prompt's — just correct + parseable."""
    forced = os.environ.get(_FORCE_REVISIONS_ENV, "").strip()
    if forced:
        try:
            forced_n = int(forced)
        except ValueError:
            forced_n = 0
        if iteration <= forced_n:
            return {
                "outcome": "changes_requested",
                "reasons": f"<forced revision: round {iteration} of {forced_n}>",
            }
        return {"outcome": "approved", "reasons": None}

    deliverable = _read_workspace_deliverable(workspace)
    prompt = (
        "You are the Reviewer on a software team. Judge the engineer's deliverable below "
        "against the PRD. Reply with EXACTLY one line — 'VERDICT: approved' if the "
        "deliverable satisfies the PRD, or 'VERDICT: changes_requested' if it does not — "
        "then 1-3 short sentences of specific, actionable reasons the engineer can act on.\n\n"
        f"--- PRD ---\n{prd_text}\n\n--- DELIVERABLE ---\n{deliverable}"
    )
    request = CompletionRequest(
        model=reviewer_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        max_tokens=400,
    )
    result = complete(request)
    record_cost(result, workflow_id=run_id, idempotency_key=f"{run_id}:reviewer-llm:{iteration}")
    return _parse_verdict(result.text)


@DBOS.step()
def ship_step(run_id: str, workspace: str) -> dict:
    """Idempotently ship the agent's work; record the sha/tag on the run."""
    ship = idempotent_ship(workspace, run_id)
    with session_scope() as session:
        session.execute(
            update(Run)
            .where(Run.id == uuid.UUID(run_id))
            .values(ship_commit_sha=ship["sha"], ship_tag=ship["tag"])
        )
    return ship


@DBOS.step()
def finalize_run_step(run_id: str, status: str = "completed") -> dict:
    """Mark the run terminal and total its cost rows (idempotent aggregate).

    ``status`` defaults to ``completed``; the workflow passes ``rejected`` (human
    rejected the PRD gate) or ``over_budget`` (human rejected a budget breach).
    The terminal total reuses the shared ``running_cost`` query — the same one
    ``budget_check_step`` reads in flight."""
    total = running_cost(run_id)
    with session_scope() as session:
        session.execute(
            update(Run)
            .where(Run.id == uuid.UUID(run_id))
            .values(status=status, cost_total_usd=total)
        )
    return {"cost_total_usd": float(total)}


@DBOS.step()
def mark_run_failed_step(run_id: str) -> None:
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == uuid.UUID(run_id)).values(status="failed"))


def enforce_budget(run_id: str, *, checkpoint: str, description: str) -> bool:
    """Reactive, between-steps budget enforcement (DP-C). Check accumulated prior
    spend and gate the *next* step; on a breach, open a high-priority blocker and
    wait. Call from a **workflow body** — it issues ``wait_at_gate`` (a
    ``DBOS.recv``), which must run in workflow context, not nested in a step.

    Returns ``True`` if the human **rejected** the breach (the caller must finalize
    the run ``over_budget`` and stop) and ``False`` to continue — either under
    budget, or the human approved (which records the override via
    ``mark_budget_overridden_step`` so the rest of the run is not re-gated:
    "approve = continue to completion").
    """
    check = budget_check_step(run_id)
    if not check["over"]:
        return False

    spent, cap = check["spent"], check["cap"]
    title = f"Over budget: ${spent:.4f} of ${cap:.4f} — approve to continue, reject to stop"
    gate = wait_at_gate(
        run_id,
        topic=f"budget:{run_id}:{checkpoint}",
        kind="budget_approval",
        priority="high_blocker",
        blocking=True,
        title=title,
        description=description,
    )
    if gate["resolution"] == "rejected":
        DBOS.logger.info(f"run_team over_budget rejected at {checkpoint} run_id={run_id}")
        return True
    mark_budget_overridden_step(run_id)
    return False


def run_review_loop(run_id: str, graph: dict, workspace: str, prd_text: str) -> dict:
    """Walk the cyclic build/review subgraph from the entry (agent) node, following edge
    conditions until a node emits an outcome that matches no out-edge (-> ``approved``, ship)
    or the per-node loop cap raises a review-escalation blocker (D4 enforced termination).

    A **workflow-body helper** (NOT a ``@DBOS.step``) — like ``enforce_budget`` it issues
    ``wait_at_gate`` (a ``DBOS.recv``) and calls steps, which must run in workflow context.
    Returns ``{"outcome": ...}``: one of ``approved`` / ``over_budget`` / ``failed`` (also
    carries ``error``) / ``escalation_rejected``.

    Crash-resume determinism: every branch reads a recorded step output (the reviewer
    verdict, the engineer status, the escalation resolution), so on resume the loop replays
    the identical walk; ``iters_by_node`` / ``current`` / ``reviewer_feedback`` are pure
    workflow-local state recomputed from those recorded outputs."""
    max_iters = get_settings().max_review_iterations
    nodes_by_id = {n["id"]: n for n in graph["nodes"]}
    edges = graph["edges"]
    current = graph["entry_node_id"]
    iters_by_node: dict[str, int] = {}
    reviewer_feedback: str | None = None

    while current is not None:
        node = nodes_by_id[current]
        n = iters_by_node.get(current, 0) + 1
        iters_by_node[current] = n

        if node["kind"] == "agent":
            if n > max_iters:
                # Loop-cap guard BEFORE an over-limit Engineer iteration (enforced
                # termination): raise a high-priority blocker instead of looping again.
                escalation = wait_at_gate(
                    run_id,
                    topic=f"gate:{run_id}:review-escalation",
                    kind="review_escalation",
                    priority="high_blocker",
                    blocking=True,
                    title=(
                        f"Couldn't satisfy the spec in {max_iters} review rounds — "
                        "ship the last build as-is, or stop"
                    ),
                    description=(
                        "The Engineer and Reviewer did not converge within the "
                        f"{max_iters}-round cap. Approve to ship the last completed build "
                        "as-is, or reject to stop the run without shipping."
                    ),
                )
                if escalation["resolution"] == "rejected":
                    return {"outcome": "escalation_rejected"}
                return {"outcome": "approved"}  # ship the last good build as-is

            open_invocation_step(run_id, current, n)
            # Per-iteration virtual key: each mint reflects the THEN-current remaining budget,
            # so the proxy enforces the run cap across the whole loop (P1.4b composes).
            vkey = mint_vkey_step(run_id)
            engineer = engineer_run_step(
                run_id, prd_text, workspace, node["model"], vkey, n, reviewer_feedback
            )
            delete_vkey_step(run_id, vkey)

            if engineer["status"] == "over_budget":
                # The proxy cut the agent off mid-call. Record whatever partial spend the
                # cut-off conversation carried (best-effort, idempotent), then stop the walk.
                if engineer["total_tokens"] or engineer["cost_usd"]:
                    persist_agent_cost_step(run_id, node["model"], engineer, n)
                close_invocation_step(run_id, current, n, "stopped", "over_budget")
                return {"outcome": "over_budget"}
            if engineer["status"] != "completed":
                close_invocation_step(run_id, current, n, "failed", None)
                return {"outcome": "failed", "error": engineer.get("error")}

            persist_agent_cost_step(run_id, node["model"], engineer, n)
            close_invocation_step(run_id, current, n, "done", "built")
            # Unconditional out-edge -> the Reviewer (or None for the 2-node team -> ship).
            current = next_node(edges, current, outcome=None)

        elif node["kind"] == "completion":
            # The Reviewer (the PM ran in the fixed PM phase, not inside this walk).
            open_invocation_step(run_id, current, n)
            verdict = reviewer_decide_step(run_id, node["model"], n, prd_text, workspace)
            close_invocation_step(run_id, current, n, "done", verdict["outcome"])
            reviewer_feedback = verdict["reasons"]
            current = next_node(edges, current, outcome=verdict["outcome"])
            if current is None:
                return {"outcome": "approved"}  # "approved" matches no loop-back edge -> ship

        else:
            return {"outcome": "approved"}  # defensive: an unknown kind ends the walk

    return {"outcome": "approved"}


@DBOS.workflow()
def run_team(idea: str) -> dict:
    run_id = DBOS.workflow_id
    DBOS.logger.info(f"run_team start run_id={run_id} idea={idea!r}")

    graph = load_graph_step(run_id)
    nodes_by_id = {n["id"]: n for n in graph["nodes"]}
    pm_node_id = graph["pm_node_id"]
    pm_model = nodes_by_id[pm_node_id]["model"]

    # ---- PM phase (unchanged behavior; now wrapped in a per-node invocation) ----
    open_invocation_step(run_id, pm_node_id, 1)
    pm = pm_step(run_id, idea, pm_model)
    close_invocation_step(run_id, pm_node_id, 1, "done", "prd_written")

    # HitL gate (P1.1a): pause for human PRD approval before the Engineer builds.
    # Inlined at a fixed position here; first-class graph-placed gates are P1.5b.
    gate = wait_at_gate(
        run_id,
        topic=f"gate:{run_id}:prd-approval",
        kind="gate_approval",
        priority="high_blocker",
        blocking=True,
        title="Approve the PRD before the Engineer builds",
        description=(
            f"The PM wrote PRD document {pm['document_id']}. Approve to let the "
            "Engineer build and ship it; reject to stop the run without shipping."
        ),
    )
    if gate["resolution"] == "rejected":
        final = finalize_run_step(run_id, status="rejected")
        DBOS.logger.info(f"run_team rejected at PRD gate run_id={run_id}")
        return {
            "run_id": run_id,
            "status": "rejected",
            "document_id": pm["document_id"],
            "cost_total": final["cost_total_usd"],
        }

    # Budget checkpoint 1 (DP-C): before the Engineer runs. Reactive on the PM's
    # accumulated spend; a breach pauses as a high-priority blocker.
    if enforce_budget(
        run_id,
        checkpoint="pre-engineer",
        description=(
            "The run is over budget before the Engineer runs. Approve to continue "
            "(the rest of the run will not be re-gated), or reject to stop without "
            "building."
        ),
    ):
        final = finalize_run_step(run_id, status="over_budget")
        DBOS.logger.info(f"run_team over_budget (pre-engineer) run_id={run_id}")
        return {
            "run_id": run_id,
            "status": "over_budget",
            "document_id": pm["document_id"],
            "cost_total": final["cost_total_usd"],
        }

    # Set up the workspace ONCE before the loop — the Engineer reworks the prior round's
    # files in place across iterations (incremental rework is the loop's value). DBOS
    # step-replay means it is not re-created on resume.
    workspace = engineer_setup_step(run_id)

    # ---- the generic cyclic build/review sub-walk (the executor leap) ----
    loop = run_review_loop(run_id, graph, workspace, pm["prd_text"])
    if loop["outcome"] == "over_budget":
        # The partial agent cost (if any) was already recorded inside the loop; just finalize.
        final = finalize_run_step(run_id, status="over_budget")
        DBOS.logger.info(f"run_team over_budget (proxy mid-loop cutoff) run_id={run_id}")
        return {
            "run_id": run_id,
            "status": "over_budget",
            "document_id": pm["document_id"],
            "cost_total": final["cost_total_usd"],
        }
    if loop["outcome"] == "failed":
        mark_run_failed_step(run_id)
        DBOS.logger.error(f"run_team failed run_id={run_id}: {loop.get('error')}")
        return {"run_id": run_id, "status": "failed", "error": loop.get("error")}
    if loop["outcome"] == "escalation_rejected":
        final = finalize_run_step(run_id, status="rejected")
        DBOS.logger.info(f"run_team review-escalation rejected run_id={run_id}")
        return {
            "run_id": run_id,
            "status": "rejected",
            "document_id": pm["document_id"],
            "cost_total": final["cost_total_usd"],
        }
    # outcome == "approved" (a happy approve, or an escalation-approve = ship the last build).

    # Budget checkpoint 2 (DP-C): after the agent's spend is recorded, before
    # shipping. The agent's own LLM loop bills inside one step and can't be
    # interrupted mid-flight (that's P1.4's proxy), so we catch its spend here.
    if enforce_budget(
        run_id,
        checkpoint="pre-ship",
        description=(
            "The agent's run exceeded the budget. Approve to ship the completed "
            "work, or reject to stop without shipping."
        ),
    ):
        final = finalize_run_step(run_id, status="over_budget")
        DBOS.logger.info(f"run_team over_budget (pre-ship) run_id={run_id}")
        return {
            "run_id": run_id,
            "status": "over_budget",
            "document_id": pm["document_id"],
            "cost_total": final["cost_total_usd"],
        }

    ship = ship_step(run_id, workspace)
    final = finalize_run_step(run_id)

    DBOS.logger.info(f"run_team done run_id={run_id} ship_sha={ship['sha']} tag={ship['tag']}")
    return {
        "run_id": run_id,
        "status": "completed",
        "document_id": pm["document_id"],
        "ship_sha": ship["sha"],
        "ship_tag": ship["tag"],
        "cost_total": final["cost_total_usd"],
    }
