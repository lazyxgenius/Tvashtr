"""The uniform graph executor: one durable DBOS workflow walks the authored team
graph node-by-node until it reaches a terminal node (P1.5b).

``run_team`` is started with ``DBOS.workflow_id == run_id == str(runs.id)`` (the
endpoint uses ``SetWorkflowID``), so every side-effecting write keys its
idempotency on ``run_id``. The nodes/edges are read from the team-graph rows (the
team is *authored*, not hardcoded) and :func:`run_graph` WALKS them: it starts at
the graph's source node and, after each node, follows :func:`next_node` to the next
— until a ``terminal`` node ends the run (ship-and-finalize, or stop). There are
**no special-cased PM/PRD/budget/ship/finalize phases**: the PM, the PRD gate, the
review-escalation, and ship/finalize are all just nodes the walk visits
(``completion`` / ``agent`` / ``gate`` / ``terminal``). The same code runs the
2-node team (PM -> prd_gate -> Engineer -> ship) and the 3-node review-loop team
(adding the Engineer<->Reviewer cycle + the cap's escalation gate). **Budget is the
one cross-cutting policy, not a node:** :func:`apply_budget_hook` runs after every
spend-bearing node (a between-steps cap check that opens a ``budget_approval``
blocker on a breach), plus an 80%-of-cap ``low_nudge`` producer.

Crash-durability (Decision 1, per-iteration): each Engineer iteration is its own
coarse ``engineer_run_step`` — no checkpointing inside OpenHands' loop. The walk
replays cleanly because DBOS keys every step's recorded output by
``(workflow_id, call-order function_id)``: on resume completed steps replay their
recorded outputs in call order, so the data-dependent walk re-issues the identical
step sequence. Every routing decision reads a recorded step output (a gate
resolution, a reviewer verdict, an engineer status, a budget verdict), and the
workflow-local bookkeeping (``current`` / ``iters_by_node`` / ``workspace`` /
``prd_text`` / ``reviewer_feedback`` / ``pm_document_id``) is recomputed
deterministically from those — so the walk is identical across a crash. The ship is
dedup'd by the ``ship-{run_id}`` git tag, so it happens exactly once. (The P1.5a
mid-loop crash proof + the cap tests are the regression that keeps the rewritten
walk honest.)

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
from tvashtr.control_plane.budget_nudge import maybe_emit_budget_nudge_step
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
    (``id``/``role_name``/``kind``/``model``/``config``, ids as ``str``) + every edge
    (``source``/``target`` as ``str``, ``edge_type``, ``conditions``), plus the
    **start node** — the unique node that is not the ``target`` of any edge (the graph
    root, where the walk begins; in both hardcoded teams that is the PM).

    Generic, not role-hardcoded: the start derives from the topology (no incoming
    edge), so the 2-node and 3-node teams — and the Supervisor's future graphs — all
    resolve with the same code."""
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
        {
            "id": str(n.id),
            "role_name": n.role_name,
            "kind": n.kind,
            "model": n.model,
            "config": n.config,
        }
        for n in nodes
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
    # The start node is the unique node with no incoming edge (the root). sorted()[0]
    # is deterministic; the hardcoded builders always produce exactly one such node.
    target_ids = {e["target"] for e in edges_out}
    roots = sorted(n["id"] for n in nodes_out if n["id"] not in target_ids)
    return {
        "nodes": nodes_out,
        "edges": edges_out,
        "start_node_id": roots[0] if roots else None,
    }


def next_node(edges: list[dict], source_id: str, outcome: str | None) -> str | None:
    """Pure routing: among ``edges`` leaving ``source_id``, follow the matching one.

    ``escalation`` edges are EXCLUDED from both searches — they are reached only via
    the cap helper (:func:`escalation_target`), never by normal outcome routing. Of
    the remaining out-edges: if ``outcome`` is not None and some edge's ``conditions``
    has ``{"when": outcome}`` (a subset match — the loop-back edge also carries a
    ``loop_limit`` key, so we match the ``when`` field, not the whole dict), return
    that edge's target; else the unconditional edge's target (``conditions is None``);
    else ``None`` (no matching out-edge here).

    Importable + unit-tested. ``edges`` are the ``load_graph_step`` dicts
    (``source``/``target``/``edge_type``/``conditions``)."""
    out_edges = [e for e in edges if e["source"] == source_id and e["edge_type"] != "escalation"]
    if outcome is not None:
        for edge in out_edges:
            conditions = edge["conditions"]
            if conditions is not None and conditions.get("when") == outcome:
                return edge["target"]
    for edge in out_edges:
        if edge["conditions"] is None:
            return edge["target"]
    return None


def escalation_target(edges: list[dict], source_id: str) -> str | None:
    """The ``target`` of the unique ``edge_type == "escalation"`` edge out of
    ``source_id`` (the cap-exhaustion route out of an agent node), else ``None``.
    Pure + importable."""
    for edge in edges:
        if edge["source"] == source_id and edge["edge_type"] == "escalation":
            return edge["target"]
    return None


def loop_limit_for(edges: list[dict], node_id: str, default: int) -> int:
    """The ``loop_limit`` carried by the loop-back edge whose ``target == node_id``
    (the cap on how many times the walk re-enters that agent node), else ``default``
    (the Settings fallback when no loop-back carries one — e.g. the 2-node team).
    Pure + importable."""
    for edge in edges:
        conditions = edge["conditions"]
        if edge["target"] == node_id and conditions is not None and "loop_limit" in conditions:
            return conditions["loop_limit"]
    return default


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


def apply_budget_hook(run_id: str, *, node_id: str, iteration: int) -> bool:
    """Budget as cross-cutting POLICY (P1.5b) — the between-spend-steps hook the walk
    applies after every spend-bearing node, replacing P1.5a's two hand-placed
    ``enforce_budget`` checkpoints (strictly safer: it fires after EVERY spend, not at
    two fixed points, and subsumes them). Call from a **workflow body** — it issues
    ``wait_at_gate`` (a ``DBOS.recv``), which must run in workflow context, not nested
    in a step.

    On a breach it opens a high-priority ``budget_approval`` drawer blocker keyed to
    THIS node + iteration (so repeated checks never collide on ``(run_id, topic)``) and
    waits. Returns ``True`` if the human **rejected** (the caller finalizes
    ``over_budget`` and stops); ``False`` to continue — under budget, or the human
    approved (recording the override via ``mark_budget_overridden_step`` so the rest of
    the run is not re-gated). On the non-reject paths it also runs the 80%-of-cap
    ``low_nudge`` producer (a no-op unless spend is within [80%, cap])."""
    check = budget_check_step(run_id)
    if check["over"]:
        spent, cap = check["spent"], check["cap"]
        gate = wait_at_gate(
            run_id,
            topic=f"budget:{run_id}:{node_id}:{iteration}",
            kind="budget_approval",
            priority="high_blocker",
            blocking=True,
            title=f"Over budget: ${spent:.4f} of ${cap:.4f} — approve to continue, reject to stop",
            description=(
                "The run is over its budget cap. Approve to continue (the rest of the "
                "run will not be re-gated), or reject to stop without shipping."
            ),
        )
        if gate["resolution"] == "rejected":
            DBOS.logger.info(
                f"run_team over_budget rejected at node {node_id} iter {iteration} run_id={run_id}"
            )
            return True
        mark_budget_overridden_step(run_id)
    # After the over-check (whether under budget or approved-over): the informational
    # 80%-of-cap nudge (its own no-op guards handle no-cap / under-80% / already-over).
    maybe_emit_budget_nudge_step(run_id)
    return False


def _finalize_over_budget(run_id: str, document_id: str | None) -> dict:
    """Finalize a run that breached its budget and was stopped (a human rejected the
    breach, or the proxy cut the agent off mid-call): mark ``over_budget``, no ship.
    Returns ``run_graph``'s result dict."""
    final = finalize_run_step(run_id, status="over_budget")
    DBOS.logger.info(f"run_team over_budget run_id={run_id}")
    return {
        "run_id": run_id,
        "status": "over_budget",
        "document_id": document_id,
        "cost_total": final["cost_total_usd"],
    }


def run_graph(run_id: str, graph: dict, idea: str) -> dict:
    """The uniform graph walk (P1.5b) — replaces P1.5a's ``run_review_loop`` AND
    ``run_team``'s fixed pre/post phases. Walk from ``graph["start_node_id"]`` following
    :func:`next_node` until a ``terminal`` node ends the run (or an engine error /
    over_budget / escalation-reject short-circuits to a finalize). Dispatch per node ``kind``:
    ``completion`` (the start node is the PM/author; any other completion is the Reviewer),
    ``agent`` (the Engineer, with the loop cap), ``gate`` (pause for a human, route on
    approve/reject), ``terminal`` (ship+finalize ``completed``, or stop+finalize ``rejected``).

    A **workflow-body helper** (NOT a ``@DBOS.step``) — like the old ``run_review_loop`` it
    issues ``wait_at_gate`` (a ``DBOS.recv``) and calls steps, which must run in workflow
    context. Returns the fully-finalized result dict ``run_team`` hands back, in every case.

    Crash-resume determinism: every routing decision reads a recorded step output (a gate
    resolution / a reviewer verdict / an engineer status / a budget verdict); the
    workflow-local state (``current`` / ``iters_by_node`` / ``workspace`` / ``prd_text`` /
    ``reviewer_feedback`` / ``pm_document_id``) is recomputed deterministically from those, so
    the walk replays identically on resume."""
    nodes_by_id = {n["id"]: n for n in graph["nodes"]}
    edges = graph["edges"]
    start_id = graph["start_node_id"]
    current: str | None = start_id
    iters_by_node: dict[str, int] = {}
    workspace: str | None = None  # lazily created at the first agent node
    prd_text: str = ""
    reviewer_feedback: str | None = None
    pm_document_id: str | None = None

    while current is not None:
        node = nodes_by_id[current]
        kind = node["kind"]

        if kind == "completion":
            n = iters_by_node.get(current, 0) + 1
            iters_by_node[current] = n
            open_invocation_step(run_id, current, n)
            if current == start_id:
                # The PM/author. Structural dispatch by start-node identity (NOT a role_name
                # check); a richer ``completion_kind`` discriminator is the P1.8 Supervisor
                # generalization.
                pm = pm_step(run_id, idea, node["model"])
                prd_text = pm["prd_text"]
                pm_document_id = pm["document_id"]
                close_invocation_step(run_id, current, n, "done", "prd_written")
                outcome: str | None = None
            else:
                # The Reviewer (workspace is set — an agent always ran before any reviewer).
                verdict = reviewer_decide_step(run_id, node["model"], n, prd_text, workspace)
                close_invocation_step(run_id, current, n, "done", verdict["outcome"])
                reviewer_feedback = verdict["reasons"]
                outcome = verdict["outcome"]
            if apply_budget_hook(run_id, node_id=current, iteration=n):
                return _finalize_over_budget(run_id, pm_document_id)
            current = next_node(edges, current, outcome)

        elif kind == "agent":
            n = iters_by_node.get(current, 0) + 1
            iters_by_node[current] = n
            limit = loop_limit_for(edges, current, get_settings().max_review_iterations)
            if n > limit:
                # Cap-guard (enforced termination, same semantics as 5a's ``if n > max_iters``):
                # do NOT run an over-limit agent iteration — route to the escalation gate node,
                # which pauses + routes (ship-as-is / stop). No invocation row for the capped n.
                current = escalation_target(edges, current)
                continue
            if workspace is None:
                # Set up the workspace ONCE, at the first agent node — the Engineer reworks the
                # prior round's files in place across iterations (DBOS step-replay won't recreate
                # it on resume).
                workspace = engineer_setup_step(run_id)
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
                # cut-off conversation carried (best-effort, idempotent), then stop.
                if engineer["total_tokens"] or engineer["cost_usd"]:
                    persist_agent_cost_step(run_id, node["model"], engineer, n)
                close_invocation_step(run_id, current, n, "stopped", "over_budget")
                return _finalize_over_budget(run_id, pm_document_id)
            if engineer["status"] != "completed":
                close_invocation_step(run_id, current, n, "failed", None)
                mark_run_failed_step(run_id)
                DBOS.logger.error(f"run_team failed run_id={run_id}: {engineer.get('error')}")
                return {
                    "run_id": run_id,
                    "status": "failed",
                    "document_id": pm_document_id,
                    "error": engineer.get("error"),
                }

            persist_agent_cost_step(run_id, node["model"], engineer, n)
            close_invocation_step(run_id, current, n, "done", "built")
            if apply_budget_hook(run_id, node_id=current, iteration=n):
                return _finalize_over_budget(run_id, pm_document_id)
            current = next_node(edges, current, outcome=None)

        elif kind == "gate":
            # A human-approval checkpoint node: pause on the durable recv, then route on the
            # resolution (the node-id-scoped topic keeps concurrent gates collision-free).
            open_invocation_step(run_id, current, 1)
            cfg = node["config"] or {}
            gate = wait_at_gate(
                run_id,
                topic=f"gate:{run_id}:{current}",
                kind=cfg.get("gate_kind", "gate_approval"),
                priority="high_blocker",
                blocking=True,
                title=cfg["title"],
                description=cfg["description"],
            )
            close_invocation_step(run_id, current, 1, "done", gate["resolution"])
            current = next_node(edges, current, gate["resolution"])

        elif kind == "terminal":
            # The walk's endpoint: ship-and-finalize ``completed``, or stop-and-finalize
            # ``rejected``. Either way the run is finalized here and the walk ends.
            open_invocation_step(run_id, current, 1)
            cfg = node["config"] or {}
            if cfg.get("terminal_kind") == "ship":
                ship = ship_step(run_id, workspace)
                final = finalize_run_step(run_id, status="completed")
                close_invocation_step(run_id, current, 1, "done", "shipped")
                DBOS.logger.info(
                    f"run_team done run_id={run_id} ship_sha={ship['sha']} tag={ship['tag']}"
                )
                return {
                    "run_id": run_id,
                    "status": "completed",
                    "document_id": pm_document_id,
                    "ship_sha": ship["sha"],
                    "ship_tag": ship["tag"],
                    "cost_total": final["cost_total_usd"],
                }
            final = finalize_run_step(run_id, status="rejected")
            close_invocation_step(run_id, current, 1, "done", "stopped")
            DBOS.logger.info(f"run_team stopped at terminal run_id={run_id}")
            return {
                "run_id": run_id,
                "status": "rejected",
                "document_id": pm_document_id,
                "cost_total": final["cost_total_usd"],
            }

        else:
            # Defensive: an unknown node kind ends the walk safely as a clear failure (never
            # loop forever). Unreachable with the hardcoded builders.
            mark_run_failed_step(run_id)
            DBOS.logger.error(f"run_team unknown node kind {kind!r} at {current} run_id={run_id}")
            return {
                "run_id": run_id,
                "status": "failed",
                "document_id": pm_document_id,
                "error": f"unknown node kind {kind!r}",
            }

    # Defensive: the walk fell off the end without reaching a terminal (a malformed graph —
    # an outcome that matched no out-edge). Don't silently "succeed"; finalize failed.
    mark_run_failed_step(run_id)
    DBOS.logger.error(f"run_team walked off the end with no terminal node run_id={run_id}")
    return {
        "run_id": run_id,
        "status": "failed",
        "document_id": pm_document_id,
        "error": "walk ended with no terminal node",
    }


@DBOS.workflow()
def run_team(idea: str) -> dict:
    """The durable run: load the authored team graph, then walk it. No special-cased
    PM/PRD/budget/ship/finalize phases and no outcome-routing — :func:`run_graph` visits
    every node uniformly (PM, gates, Engineer/Reviewer, the between-spend budget hook, the
    terminal) and returns the fully-finalized result dict."""
    run_id = DBOS.workflow_id
    DBOS.logger.info(f"run_team start run_id={run_id} idea={idea!r}")
    graph = load_graph_step(run_id)
    return run_graph(run_id, graph, idea)
