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
``reviewer_feedback`` / ``pm_document_id``) is recomputed deterministically from
those, and the live PRD is re-read at each agent node via the recorded
``read_latest_prd_step`` (its version is checkpointed, so the resume reads the
same one) — so the walk is identical across a crash. The ship is
dedup'd by the ``ship-{run_id}`` git tag, so it happens exactly once. (The P1.5a
mid-loop crash proof + the cap tests are the regression that keeps the rewritten
walk honest.)

``openhands.*`` is imported only lazily inside the steps that need it, so this
module (and app startup) never loads it.
"""

import json
import logging
import os
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
from tvashtr.documents.service import create_document_with_initial_version, get_latest_version
from tvashtr.engines.base import AgentTask
from tvashtr.engines.registry import resolve_adapter
from tvashtr.engines.run_event_sink import make_run_event_sink
from tvashtr.gateway import CompletionRequest, complete
from tvashtr.metering import record_agent_cost, record_cost, running_cost
from tvashtr.models import AgentNode, Edge, EngineerRunAttempt, Run

logger = logging.getLogger("tvashtr.control_plane.team_run")


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
def read_latest_prd_step(run_id: str) -> str:
    """Re-source the LIVE PRD at an agent-node entry (P1.7a live-document steering): read the
    run's ``pm_document_id``, then the LATEST ``DocumentVersion``'s content. A human edit (a new
    version via ``POST /api/documents/{id}/versions``) therefore reaches the Engineer/Reviewer on
    their NEXT read — the document, not the PM's once-captured snapshot, is the source of truth
    (J3). Replaces the dead ``prd_text`` snapshot the walk used to thread.

    It MUST be a recorded ``@DBOS.step``: its returned content is checkpointed on first execution
    and replayed VERBATIM on a crash-resume, so the resumed walk reads the SAME PRD version the
    original execution saw — even if the human edited the PRD again after the crash. (A bare,
    non-step read would re-query the live table on replay and could pick up a newer edit -> a
    non-deterministic resume. That is the whole reason this is a step, not a plain function.)

    The PM always writes v1 before any agent node, so this resolves. A missing ``pm_document_id``
    or a document with no versions is an unexpected invariant violation -> raise a clear error
    (never silently build the agent instruction from an empty PRD)."""
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        document_id = run.pm_document_id
    if document_id is None:
        raise RuntimeError(f"read_latest_prd_step: run {run_id} has no pm_document_id")
    latest = get_latest_version(document_id)
    if latest is None:
        raise RuntimeError(f"read_latest_prd_step: document {document_id} has no versions")
    return latest.content


# P1.5c: keep review/test byproducts out of the shipped commit. ``idempotent_ship`` does
# ``git add -A``, so anything matching this workspace ``.gitignore`` is excluded from the ship:
# the Reviewer's ``REVIEW_VERDICT.json`` sidecar (also harvested+removed) and any stray
# ``__pycache__``/``*.pyc`` (the Reviewer runs tests with ``python -B`` so it writes none, but
# this is the belt-and-suspenders for any byproduct either agent leaves behind).
_WORKSPACE_GITIGNORE = "__pycache__/\n*.pyc\nREVIEW_VERDICT.json\n"


def _write_workspace_gitignore(workspace: str) -> None:
    """Write a ``.gitignore`` so review/test byproducts never reach the shipped commit
    (``idempotent_ship`` does ``git add -A``). Pure (stdlib), unit-testable."""
    (Path(workspace) / ".gitignore").write_text(_WORKSPACE_GITIGNORE, encoding="utf-8")


@DBOS.step()
def engineer_setup_step(run_id: str) -> str:
    """Create a fresh local workspace, git-init it (repo-local identity), and write the
    workspace ``.gitignore`` (P1.5c) — all once, at the first agent node (DBOS step-replay
    won't re-run it on resume)."""
    from tvashtr.engines.openhands_adapter import make_local_workspace  # lazy (openhands)

    workspace = make_local_workspace(run_id)
    init_workspace_repo(workspace)
    _write_workspace_gitignore(workspace)
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


@DBOS.step()
def persist_reviewer_cost_step(
    run_id: str, reviewer_model: str, usage: dict, iteration: int
) -> None:
    """Write one CostRecord for THIS Reviewer iteration, idempotent on the per-iteration key
    ``{run_id}:reviewer-agent-cost:{iteration}`` (P1.5c). Deliberately a DISTINCT namespace from
    the Engineer's ``{run_id}:agent-cost:{iteration}`` so the Engineer's key stays byte-for-byte
    and the ``…:agent-cost:%`` checkers (skeleton-crash / loop-run) keep counting only Engineer
    spend. Only called on a real (non-zero-usage) review — the forced/offline path writes no row."""
    record_agent_cost(
        workflow_id=run_id,
        idempotency_key=f"{run_id}:reviewer-agent-cost:{iteration}",
        model=reviewer_model,
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
        total_tokens=usage["total_tokens"],
        cost_usd=usage["cost_usd"],
    )


# Forced-revisions harness flag — read FIRST inside the recorded reviewer step (like
# gate_auto_resolution_step reads TVASHTR_AUTO_APPROVE_GATES) so a crash-resume replays the
# same verdicts regardless of the restarted process's environment. Never set in production. It
# MUST short-circuit BEFORE any adapter is resolved — that is what keeps loop-run/loop-crash/
# skeleton-* (and the offline workflow tests) LLM-free and ``team_run`` openhands-free at import.
_FORCE_REVISIONS_ENV = "TVASHTR_FORCE_REVISIONS"
# Defensive bound on the reasons string carried back to the Engineer (and stored), so one
# round's verdict file can't balloon the next instruction.
_REVIEW_MAX_REASONS = 2000


def _build_review_instruction(prd_text: str, idea: str) -> str:
    """Build the agent-Reviewer's instruction (pure; unit-tested). Tells the Reviewer agent, in
    order, to inspect the engineer's build in its working dir, RUN THE TESTS with exactly
    ``python -B -m unittest``, decide ``approved`` ONLY IF the tests pass AND the build fulfills
    the original idea + the PRD (else ``changes_requested``), and write the verdict to the bare
    file ``REVIEW_VERDICT.json`` — reviewing, not editing."""
    return (
        "You are the Reviewer on a software team. The engineer's build is in your current "
        "working directory. Review it — do NOT improve it.\n\n"
        "Do these steps in order:\n"
        "1. Inspect the files in your current working directory (the engineer's build).\n"
        "2. Run the test suite with EXACTLY this command (the -B is required — do not write "
        "bytecode):\n"
        "       python -B -m unittest\n"
        "3. Decide the verdict:\n"
        '   - "approved" ONLY IF the tests pass AND the deliverable fulfills the ORIGINAL '
        "IDEA and the PRD below.\n"
        '   - "changes_requested" otherwise (any test fails, a required behavior or file from '
        "the idea/PRD is missing, or it otherwise falls short).\n"
        "4. Write a file named EXACTLY REVIEW_VERDICT.json in your current working directory "
        "(the bare filename), containing EXACTLY this JSON and nothing else:\n"
        '       {"verdict": "approved" | "changes_requested", "reasons": "<1-3 short, '
        'specific, actionable sentences>"}\n\n'
        "STRICT RULES:\n"
        "- You are REVIEWING, not editing. Do NOT modify, create, or delete ANY file except "
        "REVIEW_VERDICT.json.\n"
        '- Base "approved" on the tests actually passing and the spec actually being met — do '
        "not approve on assumption.\n\n"
        f"--- ORIGINAL IDEA ---\n{idea}\n\n--- PRD ---\n{prd_text}"
    )


def _harvest_verdict(workspace: str) -> dict:
    """Read ``{workspace}/REVIEW_VERDICT.json``, parse defensively into ``{"outcome":
    "approved"|"changes_requested", "reasons": str|None}``, and REMOVE the file so it never
    ships and never seeds the next iteration. Pure (stdlib) + unit-tested.

    Safe-default toward MORE review: a missing / malformed / unrecognized verdict ⇒
    ``changes_requested`` (never a silent ``approved``); the escalation cap is the stop, so
    this can't spin. In docker mode ``_pull_workspace`` carried the file home; in local mode
    the Reviewer wrote it straight into ``workspace``."""
    path = Path(workspace) / "REVIEW_VERDICT.json"
    if not path.exists():
        logger.info("reviewer verdict: no REVIEW_VERDICT.json -> changes_requested (safe default)")
        return {
            "outcome": "changes_requested",
            "reasons": "(no REVIEW_VERDICT.json produced — defaulting to changes_requested)",
        }
    raw_text = ""
    try:
        raw_text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        pass
    # Always remove the file (best-effort) so it neither ships nor seeds the next iteration.
    try:
        path.unlink()
    except OSError:
        pass

    safe_default = {
        "outcome": "changes_requested",
        "reasons": "(unparseable REVIEW_VERDICT.json — defaulting to changes_requested)",
    }
    try:
        raw = json.loads(raw_text)
    except (json.JSONDecodeError, ValueError):
        # Lightweight text fallback for a non-JSON reply.
        low = raw_text.lower()
        if "approved" in low and "changes" not in low:
            result = {"outcome": "approved", "reasons": None}
        else:
            snippet = raw_text.strip()[:_REVIEW_MAX_REASONS]
            result = {"outcome": "changes_requested", "reasons": snippet or safe_default["reasons"]}
    else:
        if not isinstance(raw, dict):
            # Valid JSON but not an object (e.g. a bare number or the bare string "approved").
            # Crucially a bare "approved" must NOT approve — fail toward more review, clearly.
            result = {
                "outcome": "changes_requested",
                "reasons": "(REVIEW_VERDICT.json was not a JSON object — changes_requested)",
            }
        else:
            verdict = str(raw.get("verdict", "")).strip().lower().replace(" ", "_")
            if verdict == "approved":
                result = {"outcome": "approved", "reasons": None}
            elif verdict == "changes_requested":
                reasons_raw = raw.get("reasons")
                reasons = (
                    str(reasons_raw)[:_REVIEW_MAX_REASONS] if reasons_raw else "(no reasons given)"
                )
                result = {"outcome": "changes_requested", "reasons": reasons}
            else:
                result = dict(safe_default)
    logger.info("reviewer verdict harvested: outcome=%s", result["outcome"])
    return result


@DBOS.step()
def reviewer_agent_run_step(
    run_id: str,
    reviewer_model: str,
    iteration: int,
    prd_text: str,
    idea: str,
    workspace: str,
    vkey: str | None,
) -> dict:
    """The agent-Reviewer (replaces the old completion ``reviewer_decide_step``): runs in the
    sandbox behind the unchanged ``EngineAdapter`` (like the Engineer), tests the build, judges
    it against the idea + PRD, and emits its verdict as the ``REVIEW_VERDICT.json`` sidecar this
    step harvests. Recorded, so a crash-resume replays the SAME verdict (the loop's control flow
    depends on it). Returns ``{"status", "outcome", "reasons", "error"?, **usage}``.

    * **Forced harness** (``TVASHTR_FORCE_REVISIONS=N``, read FIRST): return ``changes_requested``
      while ``iteration <= N`` else ``approved`` — NO adapter resolution, NO agent run, NO cost
      (this keeps loop-run/loop-crash/the offline tests LLM-free, and is why ``team_run`` stays
      openhands-free at import).
    * **Real mode** (no env): build the review instruction, run the agent in the SAME workspace
      the Engineer used (so it sees the build — docker seeding pushes it into the container),
      then harvest the verdict. A non-``completed`` run hands its terminal status up unchanged
      (symmetric with the Engineer)."""
    forced = os.environ.get(_FORCE_REVISIONS_ENV, "").strip()
    if forced:
        try:
            forced_n = int(forced)
        except ValueError:
            forced_n = 0
        changes = iteration <= forced_n
        return {
            "status": "completed",
            "outcome": "changes_requested" if changes else "approved",
            "reasons": f"<forced revision: round {iteration} of {forced_n}>" if changes else None,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
        }

    task = AgentTask(
        instruction=_build_review_instruction(prd_text, idea),
        workspace_dir=workspace,
        model=reviewer_model,
        llm_api_key=vkey,
    )
    # Same engine selection the Engineer uses (the adapter is engine-neutral — it just runs the
    # AgentTask's instruction in its workspace; "reviewer" vs "engineer" is not its concern).
    engine_name = (
        "openhands-docker" if get_settings().agent_sandbox_mode == "docker" else "openhands"
    )
    adapter = resolve_adapter(engine_name)  # lazy openhands import happens here
    result = adapter.run(task, on_event=make_run_event_sink(run_id))
    usage = {
        "prompt_tokens": result.prompt_tokens,
        "completion_tokens": result.completion_tokens,
        "total_tokens": result.total_tokens,
        "cost_usd": result.cost_usd,
    }
    if result.status != "completed":
        # Hand the terminal status up; the workflow body finalizes (symmetric with the Engineer).
        return {
            "status": result.status,
            "outcome": None,
            "reasons": None,
            "error": result.error,
            **usage,
        }
    verdict = _harvest_verdict(workspace)
    return {
        "status": "completed",
        "outcome": verdict["outcome"],
        "reasons": verdict["reasons"],
        **usage,
    }


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
    workflow-local state (``current`` / ``iters_by_node`` / ``workspace`` /
    ``reviewer_feedback`` / ``pm_document_id``) is recomputed deterministically from those, and
    the live PRD is re-read at each agent node via the recorded ``read_latest_prd_step`` (P1.7a),
    so the walk replays identically on resume."""
    nodes_by_id = {n["id"]: n for n in graph["nodes"]}
    edges = graph["edges"]
    start_id = graph["start_node_id"]
    current: str | None = start_id
    iters_by_node: dict[str, int] = {}
    workspace: str | None = None  # lazily created at the first agent node
    reviewer_feedback: str | None = None
    pm_document_id: str | None = None

    while current is not None:
        node = nodes_by_id[current]
        kind = node["kind"]

        if kind == "completion":
            # The only completion node is the start node (the PM/author). The Reviewer is now an
            # agent (P1.5c), so a non-start completion shouldn't occur with the hardcoded builders.
            n = iters_by_node.get(current, 0) + 1
            iters_by_node[current] = n
            open_invocation_step(run_id, current, n)
            if current == start_id:
                # The PM/author. Structural dispatch by start-node identity (NOT a role_name
                # check); a richer ``completion_kind`` discriminator is the P1.8 Supervisor
                # generalization.
                pm = pm_step(run_id, idea, node["model"])
                pm_document_id = pm["document_id"]
                close_invocation_step(run_id, current, n, "done", "prd_written")
                if apply_budget_hook(run_id, node_id=current, iteration=n):
                    return _finalize_over_budget(run_id, pm_document_id)
                current = next_node(edges, current, outcome=None)
            else:
                # Defensive: a non-start completion node is unexpected (the PM is the only one).
                # Fail clearly rather than route on a stale outcome — never silently loop/ship.
                close_invocation_step(run_id, current, n, "failed", None)
                mark_run_failed_step(run_id)
                DBOS.logger.error(
                    f"run_team unexpected non-start completion node {current} run_id={run_id}"
                )
                return {
                    "run_id": run_id,
                    "status": "failed",
                    "document_id": pm_document_id,
                    "error": f"unexpected non-start completion node {current} (PM is the only one)",
                }

        elif kind == "agent":
            n = iters_by_node.get(current, 0) + 1
            iters_by_node[current] = n
            # Cap-guard, GATED on having an escalation edge: only the Engineer has an
            # ``edge_type="escalation"`` out-edge, so only the Engineer participates in the loop
            # cap. The Reviewer (no escalation edge) and the 2-node Engineer (likewise) skip it —
            # behavior-preserving for the Engineer in both teams (the 2-node Engineer's ``n`` was
            # never ``> limit`` anyway). Same enforced-termination semantics as 5a's
            # ``if n > max_iters``: do NOT run an over-limit iteration — route to the escalation
            # gate (no invocation row for the capped n).
            esc = escalation_target(edges, current)
            if esc is not None:
                limit = loop_limit_for(edges, current, get_settings().max_review_iterations)
                if n > limit:
                    current = esc
                    continue
            if workspace is None:
                # Set up the workspace ONCE, at the first agent node — the Engineer reworks the
                # prior round's files in place across iterations (DBOS step-replay won't recreate
                # it on resume). The Reviewer reuses this SAME workspace, so it sees the build.
                workspace = engineer_setup_step(run_id)
            open_invocation_step(run_id, current, n)
            # Per-iteration virtual key: each mint reflects the THEN-current remaining budget,
            # so the proxy enforces the run cap across the whole loop (P1.4b composes).
            vkey = mint_vkey_step(run_id)
            # P1.7a: re-source the PRD LIVE at every agent-node entry (every iteration) via a
            # recorded step, so a human edit to the PRD propagates to the Engineer/Reviewer on
            # THIS read (the document, not the PM's once-captured snapshot, is the source of
            # truth). The ``idea`` stays the immutable anchor — still threaded as a snapshot;
            # only the PRD becomes live.
            live_prd = read_latest_prd_step(run_id)
            # Dispatch on the node's ``agent_kind`` (``"engineer"`` / ``"reviewer"`` / ``None`` ->
            # engineer). The two agents share the workspace/open/mint scaffold but differ in the
            # run-step, the cost key, and the success handling — kept as two explicit paths
            # (correctness + readability over DRY; the Engineer path's logic is unchanged).
            agent_kind = (node.get("config") or {}).get("agent_kind")
            if agent_kind == "reviewer":
                verdict = reviewer_agent_run_step(
                    run_id, node["model"], n, live_prd, idea, workspace, vkey
                )
                delete_vkey_step(run_id, vkey)

                if verdict["status"] == "over_budget":
                    # Proxy cut the agent off mid-call. Record partial spend (best-effort), stop.
                    if verdict["total_tokens"] or verdict["cost_usd"]:
                        persist_reviewer_cost_step(run_id, node["model"], verdict, n)
                    close_invocation_step(run_id, current, n, "stopped", "over_budget")
                    return _finalize_over_budget(run_id, pm_document_id)
                if verdict["status"] != "completed":
                    close_invocation_step(run_id, current, n, "failed", None)
                    mark_run_failed_step(run_id)
                    DBOS.logger.error(
                        f"run_team reviewer failed run_id={run_id}: {verdict.get('error')}"
                    )
                    return {
                        "run_id": run_id,
                        "status": "failed",
                        "document_id": pm_document_id,
                        "error": verdict.get("error"),
                    }

                # completed: meter the reviewer ONLY if it actually spent (forced mode is 0 -> no
                # cost row, so the ``:agent-cost:%`` counts stay engineer-only), then route on the
                # verdict (its ``changes_requested`` follows the loop-back; ``approved`` -> ship).
                if verdict["total_tokens"] or verdict["cost_usd"]:
                    persist_reviewer_cost_step(run_id, node["model"], verdict, n)
                close_invocation_step(
                    run_id,
                    current,
                    n,
                    "done",
                    verdict["outcome"],
                    outcome_detail=verdict["reasons"],
                )
                reviewer_feedback = verdict["reasons"]
                if apply_budget_hook(run_id, node_id=current, iteration=n):
                    return _finalize_over_budget(run_id, pm_document_id)
                current = next_node(edges, current, verdict["outcome"])
            else:
                # The Engineer path — logic unchanged from P1.5b.
                engineer = engineer_run_step(
                    run_id, live_prd, workspace, node["model"], vkey, n, reviewer_feedback
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
