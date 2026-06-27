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

Crash-durability (Decision 1, per-iteration): each agent iteration is its own
coarse ``agent_run_step`` — no checkpointing inside OpenHands' loop. The walk
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
from tvashtr.control_plane.worktree import add_worktree, build_repo_grounding
from tvashtr.db import session_scope
from tvashtr.documents.service import (
    add_version,
    create_document_with_initial_version,
    get_latest_version,
)
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
        # M-brownfield: surface the run's brownfield target off the SAME Run row (no extra query).
        # ``repo_path is None`` ⇒ greenfield (the legacy path); non-NULL ⇒ brownfield.
        repo_path = run.repo_path
        base_ref = run.base_ref
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
            # P1.8a: the node's behavior instruction. ``run_graph`` runs this GENERICALLY (the
            # completion/agent path appends the idea/PRD/revision context), retiring fixed-function
            # role dispatch. NULL for gate/terminal nodes (no LLM).
            "prompt": n.prompt,
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
        # M-brownfield: the run's brownfield target (both NULL for a greenfield run). Recorded in
        # this step's output so the walk reads the SAME value deterministically on resume.
        "repo_path": repo_path,
        "base_ref": base_ref,
    }


def next_node(edges: list[dict], source_id: str, outcome: str | None) -> str | None:
    """Pure routing: among ``edges`` leaving ``source_id``, follow the matching one.

    ``escalation`` edges are EXCLUDED from both searches — they are reached only via
    the cap helper (:func:`escalation_target`), never by normal outcome routing. Of
    the remaining out-edges: if ``outcome`` is not None and some edge's ``conditions``
    has ``{"when": outcome}`` (a subset match — the loop-back edge also carries a
    ``loop_limit`` key, so we match the ``when`` field, not the whole dict), return
    that edge's target; else the CATCH-ALL out-edge's target — an edge with no routing
    label, i.e. ``conditions is None`` OR a conditions dict with no ``"when"`` key
    (P1.8a: the reviewer loop-back is now ``{"loop_limit": N}`` with no ``"when"``, so a
    missing / garbled / unmatched verdict falls through to it and the loop still cycles);
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
        conditions = edge["conditions"]
        if conditions is None or "when" not in conditions:
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


def node_emits_outcome(edges: list[dict], node_id: str) -> bool:
    """True iff some non-escalation out-edge of ``node_id`` carries a conditional ``"when"`` —
    i.e. the user wired this node to BRANCH the walk on a routing label (a "reviewer-style" node
    that produces a verdict). A node with only an unconditional / catch-all out-edge (an
    "engineer-style" worker) returns False.

    This is the role-agnostic discriminator (P1.8a) that REPLACES the
    ``config.agent_kind == "reviewer"`` dispatch: a node's role in the loop is a fact about the
    authored topology, not a hardcoded capability flag. With the current builders the Reviewer
    (a ``{when: approved}`` out-edge) → True, while the Engineer (only ``→ reviewer``
    unconditional + the ``→ escalation_gate`` escalation edge) and the 2-node Engineer → False.
    Pure + importable (no DBOS, no DB) so it stays unit-testable."""
    return any(
        e["source"] == node_id
        and e["edge_type"] != "escalation"
        and e["conditions"] is not None
        and "when" in e["conditions"]
        for e in edges
    )


@DBOS.step()
def pm_step(run_id: str, idea: str, pm_model: str, pm_prompt: str) -> dict:
    """PM node: a direct, metered gateway completion -> a versioned PRD document.

    P1.8a: the static behavior is the node's ``pm_prompt`` (seeded by the builder, moved off this
    step); the executor appends the run's idea. Everything else is unchanged — this still writes
    the versioned PRD document and sets ``Run.pm_document_id`` (the start-node-writes-the-PRD
    convention stays structural, dispatched by ``current == start_id``, not by role)."""
    prompt = pm_prompt + f"\n\nFeature request:\n{idea}"
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


@DBOS.step()
def thinker_refine_step(
    run_id: str,
    idea: str,
    model: str,
    prompt: str,
    node_id: str,
    iteration: int,
    current_spec: str,
    spec_document_id: str,
) -> dict:
    """A LATER thinker node (P1.8c): a metered gateway completion that REFINES the run's single
    shared spec document and appends a new version.

    The pivot's last fixed-function residue was that a completion node was valid ONLY as the start
    node (the PM). This is the additive twin of :func:`pm_step` for any thinker AFTER the root: it
    reads the current spec (passed in from the recorded :func:`read_latest_prd_step`, so the input
    is deterministic on resume), runs the node's ``prompt`` over ``idea`` + ``current_spec``, and
    appends the produced full spec as the next ``DocumentVersion`` of the SAME document
    (``spec_document_id == Run.pm_document_id``). So a thinker is now composable ANYWHERE.

    Same call shape + return shape as ``pm_step``. Idempotent on the per-node-per-iteration keys
    (``…:thinker-llm:{node_id}:{iteration}`` for the cost row, ``…:spec:{node_id}:{iteration}`` for
    the version), so a crash-resume re-reads the same recorded spec and re-appends the same version
    exactly once. ``pm_step`` stays byte-identical (its ``pm-llm`` / ``pm-prd-v1`` keys unchanged),
    so the single-thinker templates and their checkers are untouched."""
    prompt_full = (
        prompt
        + f"\n\nFeature request:\n{idea}"
        + (
            "\n\n--- CURRENT SPEC (this is the spec so far — produce the COMPLETE updated spec, "
            f"preserving everything still needed) ---\n{current_spec}"
        )
    )
    request = CompletionRequest(
        model=model,
        messages=[{"role": "user", "content": prompt_full}],
        temperature=0.3,
        max_tokens=400,
    )
    result = complete(request)
    record_cost(
        result, workflow_id=run_id, idempotency_key=f"{run_id}:thinker-llm:{node_id}:{iteration}"
    )
    add_version(
        uuid.UUID(spec_document_id),
        result.text,
        created_by="agent:thinker",
        idempotency_key=f"{run_id}:spec:{node_id}:{iteration}",
    )
    return {"document_id": spec_document_id, "prd_text": result.text}


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
    """Set up the workspace ONCE, at the first agent node (DBOS step-replay won't re-run it on
    resume). Two additive branches gated on the Run's ``repo_path`` (read here off the immutable,
    create-time Run row — so the GREENFIELD call site stays byte-for-byte unchanged and the read
    replays deterministically: the whole recorded step is skipped on resume, its workspace output
    replayed):

    * **Greenfield** (``repo_path is None`` — EXACTLY as before): a fresh empty local workspace,
      git-init'd with repo-local identity, plus the workspace ``.gitignore`` (P1.5c).
    * **Brownfield** (M-brownfield Slice 1): an isolated ``git worktree`` of the user's real repo on
      branch ``tvashtr/<run_id>`` cut from ``base_ref`` (the user's working tree is never touched;
      the branch lands in the user's repo via the shared object store). The branch is recorded on
      the Run as ``ship_branch``. No workspace ``.gitignore`` is written (the real repo has its
      own, and ``idempotent_ship``'s ``git add -A`` honors it — D2/D3)."""
    from tvashtr.engines.openhands_adapter import make_local_workspace  # lazy (openhands)

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        repo_path = run.repo_path
        base_ref = run.base_ref

    workspace = make_local_workspace(run_id)
    if repo_path is not None:
        branch = add_worktree(repo_path, workspace, run_id, base_ref)
        with session_scope() as session:
            session.execute(
                update(Run).where(Run.id == uuid.UUID(run_id)).values(ship_branch=branch)
            )
        return workspace
    init_workspace_repo(workspace)
    _write_workspace_gitignore(workspace)
    return workspace


@DBOS.step()
def brownfield_grounding_step(run_id: str, workspace: str, repo_basename: str) -> str:
    """Compute the D6 repo-grounding block for a brownfield run, ONCE, right after the worktree is
    set up. A recorded ``@DBOS.step`` so the block is checkpointed and replayed VERBATIM on resume
    (deterministic instruction across a crash). Greenfield never calls it. The pure builder
    (``worktree.build_repo_grounding``) keeps it openhands-free + unit-tested."""
    return build_repo_grounding(workspace, repo_basename)


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
def persist_agent_cost_step(
    run_id: str, node_id: str, model: str | None, usage: dict, iteration: int
) -> None:
    """Write one CostRecord for THIS agent-node iteration (P1.8a — merges the old engineer +
    reviewer cost steps into one). Idempotent on the per-node-per-iteration key
    ``{run_id}:agent-cost:{node_id}:{iteration}``. The ``{node_id}`` prevents the
    Engineer-iter-1 / Reviewer-iter-1 collision a single ``{run_id}:agent-cost:{iteration}`` key
    would cause once a real (non-forced) Reviewer ALSO meters; the ``LIKE '{run_id}:agent-cost:%'``
    prefix checkers keep passing (a longer key still matches the prefix), and the forced Reviewer
    writes zero usage → no row, so the ``agent-cost:%`` counts stay Engineer-only (skeleton 1,
    loop-run-forced 2, loop-crash-forced 3 — unchanged)."""
    record_agent_cost(
        workflow_id=run_id,
        idempotency_key=f"{run_id}:agent-cost:{node_id}:{iteration}",
        model=model,
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
        total_tokens=usage["total_tokens"],
        cost_usd=usage["cost_usd"],
    )


# Forced-revisions harness flag — read FIRST inside the recorded agent step (like
# gate_auto_resolution_step reads TVASHTR_AUTO_APPROVE_GATES) so a crash-resume replays the
# same verdicts regardless of the restarted process's environment. Never set in production. It
# MUST short-circuit BEFORE any adapter is resolved — that is what keeps loop-run/loop-crash/
# skeleton-* (and the offline workflow tests) LLM-free and ``team_run`` openhands-free at import.
_FORCE_REVISIONS_ENV = "TVASHTR_FORCE_REVISIONS"
# Defensive bound on the reasons string carried back to the Engineer (and stored), so one
# round's verdict file can't balloon the next instruction.
_REVIEW_MAX_REASONS = 2000


def _forced_review_outcome(iteration: int) -> dict | None:
    """The forced-revisions harness, factored out of the agent step as a pure + importable helper
    (P1.8a) so it stays directly unit-testable and the offline workflow tests can drive the loop
    through the SAME logic the live smokes use. Returns the forced verdict dict when
    ``TVASHTR_FORCE_REVISIONS=N`` is set — ``changes_requested`` while ``iteration <= N`` else
    ``approved``, with **zero usage** — else ``None`` (run the real adapter). The caller only
    consults this for an outcome-emitting node, so a worker never short-circuits. Behavior is
    byte-for-byte the pre-P1.8a inline harness; only its location changed."""
    forced = os.environ.get(_FORCE_REVISIONS_ENV, "").strip()
    if not forced:
        return None
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


# ---- Per-node work-brief (Option A) — the deterministic, NO-LLM "what I did last run" line ----
# Generalizes the reviewer-only ``outcome_detail`` to every thinker/worker node: each writes a short
# human-readable brief at close. Pure + unit-tested; no spec-text extraction, no extra LLM call (a
# worker's ``files_changed`` is already computed by the adapter). The EMITTING worker (the Reviewer)
# is untouched — its ``outcome_detail`` stays the verdict reasons (see the agent close site).

# How many changed-file names a worker's brief lists before eliding the remainder.
_WORK_BRIEF_FILE_CAP = 5


def _thinker_brief(is_first: bool, version: int) -> str:
    """The 'last run' brief for a thinker (``completion``) node. The first/root thinker drafts the
    shared spec from the idea; a later thinker refined it — the spec's version equals the thinker's
    contribution order (an honest, deterministic line; no spec-text extraction)."""
    if is_first:
        return "Drafted the spec from the idea."
    return f"Refined the spec (version {version})."


def _worker_brief(files_changed: list[str]) -> str:
    """The 'last run' brief for a NON-emitting worker (``agent``) node — built from the files it
    changed (capped at the first ``_WORK_BRIEF_FILE_CAP``, then ``+N more``). An emitting worker
    (the Reviewer) does NOT use this; its ``outcome_detail`` stays the verdict reasons."""
    if not files_changed:
        return "Ran but changed no files."
    k = len(files_changed)
    listed = ", ".join(files_changed[:_WORK_BRIEF_FILE_CAP])
    if k > _WORK_BRIEF_FILE_CAP:
        listed += f", +{k - _WORK_BRIEF_FILE_CAP} more"
    return f"Built the feature — changed {k} file(s): {listed}"


@DBOS.step()
def agent_run_step(
    run_id: str,
    node_prompt: str,
    model: str | None,
    iteration: int,
    idea: str,
    prd_text: str,
    workspace: str,
    vkey: str | None,
    reviewer_feedback: str | None,
    emits_outcome: bool,
    grounding: str | None = None,
) -> dict:
    """The ONE generic agent step (P1.8a) — replaces the role-specific ``engineer_run_step`` AND
    ``reviewer_agent_run_step``. Runs the node's ``node_prompt`` (its behavior, seeded by the
    builder) against the sandboxed adapter behind the unchanged ``EngineAdapter``/``AgentTask``
    contract, with the idea + live PRD (+ a revision block on a rework round) appended UNIFORMLY.

    ``emits_outcome`` (from :func:`node_emits_outcome` — a fact about the authored topology, NOT a
    role flag) decides the only two role-agnostic differences:

    * **Forced harness FIRST** (preserved exactly, via :func:`_forced_review_outcome`): when
      ``TVASHTR_FORCE_REVISIONS`` is set AND ``emits_outcome`` → return the forced verdict with
      **zero usage, no adapter resolved, no attempt row**. This keeps loop-run/loop-crash/
      skeleton-* (and the offline tests) LLM-free and ``team_run`` openhands-free at import. A
      non-branching worker (``emits_outcome`` False — the Engineer) never short-circuits, so it
      always runs the real adapter, exactly as before.
    * **Verdict harvest at the end**: if ``emits_outcome`` → ``_harvest_verdict(workspace)`` →
      ``(outcome, reasons)``; else ``(None, None)`` (a worker neither harvests nor writes a
      sidecar; its close label stays ``"built"``).

    ``vkey`` (P1.4b) rides into the agent's LLM as its api_key; the returned ``status`` may be
    ``"over_budget"`` (the proxy cut the agent off mid-call), passed through unchanged. Returns
    ``{"status", "outcome", "reasons", "files_changed", "error"?, **usage}`` — ``files_changed``
    (the adapter's already-computed change set) is threaded up for the per-node work-brief
    (Option A); a worker's NON-emitting close composes its brief from it."""
    if emits_outcome:
        forced = _forced_review_outcome(iteration)
        if forced is not None:
            return forced

    # Attempt log — written ONLY when the real adapter runs (after the forced short-circuit), so
    # the forced Reviewer adds no row and the crash demo's engineer_run_attempts trigger stays
    # Engineer-only. Intentionally NOT idempotent: one row per execution, distinct pid on a
    # crash-then-resume (the observable proof the agent step re-executed).
    with session_scope() as session:
        session.add(EngineerRunAttempt(run_id=run_id, pid=os.getpid()))

    # The idea + live PRD are appended to EVERY agent node uniformly; the node's ``prompt`` carries
    # the role-specific behavior/mechanics (moved off this step into the builder, P1.8a). On a
    # rework round (``iteration > 1`` with feedback) the Reviewer's requested changes + a
    # revise-in-place directive follow, so the worker reworks the prior round's files (already in
    # ``workspace``) rather than starting over. iteration==1 carries no revision block. (The
    # Engineer now also sees the idea — a benign superset of before; the deliverable is unchanged.)
    context = f"\n\n--- ORIGINAL IDEA ---\n{idea}\n\n--- PRD ---\n{prd_text}"
    if iteration > 1 and reviewer_feedback:
        context += (
            f"\n\n--- REVISION REQUESTED (round {iteration}) ---\n"
            "The Reviewer reviewed your previous attempt and requested these changes:\n"
            f"{reviewer_feedback}\n"
            "Your prior work is in your current working directory — revise it IN PLACE to "
            "address this feedback. Do not start over and do not delete unrelated files."
        )
    # M-brownfield (D6): for a brownfield run, the repo-grounding block is appended AFTER the
    # idea+PRD(+revision), the same uniform-append shape. ``grounding`` is non-None ONLY for a
    # brownfield run (computed once via ``brownfield_grounding_step``), so it doubles as the
    # brownfield discriminator for the adapter's workspace-sync mode below. Greenfield → None →
    # nothing appended and ``workspace_mode="greenfield"`` → the adapter's byte-for-byte prior path.
    if grounding:
        context += f"\n\n{grounding}"
    instruction = node_prompt + context

    task = AgentTask(
        instruction=instruction,
        workspace_dir=workspace,
        model=model,
        llm_api_key=vkey,
        workspace_mode="brownfield" if grounding is not None else "greenfield",
    )
    # Select local vs Docker-sandboxed engine from the configured sandbox mode (P1.3a). The
    # EngineAdapter contract + AgentRunResult shape are identical across modes; the adapter is
    # role-neutral — it just runs the AgentTask's instruction in its workspace.
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
        # Hand the terminal status up; the workflow body finalizes.
        return {
            "status": result.status,
            "outcome": None,
            "reasons": None,
            "files_changed": result.files_changed,
            "error": result.error,
            **usage,
        }
    if emits_outcome:
        verdict = _harvest_verdict(workspace)
        label, reasons = verdict["outcome"], verdict["reasons"]
    else:
        # A non-branching worker neither harvests nor produces a sidecar.
        label, reasons = None, None
    return {
        "status": "completed",
        "outcome": label,
        "reasons": reasons,
        "files_changed": result.files_changed,
        **usage,
    }


@DBOS.step()
def ship_step(run_id: str, workspace: str) -> dict:
    """Idempotently ship the agent's work; record the sha/tag on the run. ``idempotent_ship`` is
    mount-agnostic — for a brownfield run ``workspace`` is the worktree whose HEAD IS
    ``tvashtr/<run_id>``, so the commit + tag land on that real branch in the user's repo (D2). The
    run's ``ship_branch`` (set at worktree setup; NULL for greenfield) is surfaced in the returned
    dict so the run result/banner can show the produced branch."""
    ship = idempotent_ship(workspace, run_id)
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        ship_branch = run.ship_branch
        session.execute(
            update(Run)
            .where(Run.id == uuid.UUID(run_id))
            .values(ship_commit_sha=ship["sha"], ship_tag=ship["tag"])
        )
    ship["ship_branch"] = ship_branch
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
    ``completion`` (a "thinker" — the FIRST writes the shared spec from the idea via ``pm_step``;
    a LATER one refines it via ``thinker_refine_step``; composable anywhere, P1.8c),
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
    # M-brownfield: ``repo_path is None`` ⇒ greenfield (everything below is the legacy path,
    # untouched); non-NULL ⇒ brownfield (an isolated worktree of the user's real repo + an appended
    # repo-grounding block). ``grounding`` is computed ONCE at the first agent node (recorded →
    # deterministic on resume) and threaded into each agent call; greenfield keeps it None.
    # ``base_ref`` is read by engineer_setup_step off the Run row, so it is unused here.
    repo_path: str | None = graph.get("repo_path")
    brownfield = repo_path is not None
    repo_basename = os.path.basename(repo_path.rstrip("/")) if brownfield else ""
    grounding: str | None = None

    while current is not None:
        node = nodes_by_id[current]
        kind = node["kind"]

        if kind == "completion":
            # P1.8c: a "thinker" node — composable ANYWHERE, not start-node-only. It writes/refines
            # the run's single shared spec document. The FIRST thinker (no spec yet) creates it from
            # the idea; a LATER thinker reads the current spec and appends a refined version. This
            # retires the pivot's last fixed-function residue (the old non-start-completion fail).
            # Dispatch on whether the spec exists yet (``pm_document_id``) — recomputed
            # deterministically from recorded step outputs as the walk replays, so it is crash-safe.
            n = iters_by_node.get(current, 0) + 1
            iters_by_node[current] = n
            open_invocation_step(run_id, current, n)
            # Capture first-vs-later BEFORE ``pm_document_id`` is reassigned below — it drives both
            # the dispatch AND the per-node work-brief written at close (Option A).
            is_first_thinker = pm_document_id is None
            if is_first_thinker:
                # The FIRST thinker (the root): create the spec doc from the idea. Byte-identical to
                # the old PM path — same ``pm_step``, same ``pm-llm`` / ``pm-prd-v1`` keys, so the
                # single-thinker templates + their checkers are untouched.
                result = pm_step(run_id, idea, node["model"], node["prompt"])
            else:
                # A LATER thinker: read the current spec (recorded -> deterministic on resume),
                # refine it, append a new version. A thinker is now composable ANYWHERE.
                current_spec = read_latest_prd_step(run_id)
                result = thinker_refine_step(
                    run_id,
                    idea,
                    node["model"],
                    node["prompt"],
                    current,
                    n,
                    current_spec,
                    pm_document_id,
                )
            pm_document_id = result["document_id"]
            close_invocation_step(
                run_id,
                current,
                n,
                "done",
                "prd_written",
                outcome_detail=_thinker_brief(is_first_thinker, n),
            )
            if apply_budget_hook(run_id, node_id=current, iteration=n):
                return _finalize_over_budget(run_id, pm_document_id)
            current = next_node(edges, current, outcome=None)

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
                # Set up the workspace ONCE, at the first agent node — a worker reworks the prior
                # round's files in place across iterations (DBOS step-replay won't recreate it on
                # resume). A reviewer-style node reuses this SAME workspace, so it sees the build.
                # Brownfield: a worktree of the real repo; greenfield: the empty local workspace.
                # (engineer_setup_step reads the Run's repo_path itself, so this call site is
                # byte-for-byte the prior greenfield call — the existing suite exercises it intact.)
                workspace = engineer_setup_step(run_id)
                if brownfield:
                    # D6: compute the repo-grounding block ONCE off the freshly-set-up worktree
                    # (before the agent edits it), recorded → replayed verbatim on resume.
                    grounding = brownfield_grounding_step(run_id, workspace, repo_basename)
            open_invocation_step(run_id, current, n)
            # Per-iteration virtual key: each mint reflects the THEN-current remaining budget,
            # so the proxy enforces the run cap across the whole loop (P1.4b composes).
            vkey = mint_vkey_step(run_id)
            # P1.7a: re-source the PRD LIVE at every agent-node entry (every iteration) via a
            # recorded step, so a human edit to the PRD propagates to the agent on THIS read (the
            # document, not the PM's once-captured snapshot, is the source of truth). The ``idea``
            # stays the immutable anchor — still threaded as a snapshot; only the PRD becomes live.
            live_prd = read_latest_prd_step(run_id)
            # P1.8a: ONE generic agent path — no ``config.agent_kind`` dispatch. Whether this node
            # branches the walk on a routing label is a fact about the AUTHORED TOPOLOGY
            # (:func:`node_emits_outcome` — does it have a conditional out-edge?), not a hardcoded
            # role. ``agent_run_step`` runs ``node["prompt"]`` generically; it harvests a verdict
            # iff ``emits`` (else outcome is None → the close label stays ``"built"``).
            emits = node_emits_outcome(edges, current)
            # M-brownfield: thread the repo-grounding block into the brownfield agent call.
            # Greenfield (``grounding is None``) omits the kwarg entirely, so this is byte-for-byte
            # the prior greenfield call — the existing offline suite drives that path UNCHANGED.
            result = agent_run_step(
                run_id,
                node["prompt"],
                node["model"],
                n,
                idea,
                live_prd,
                workspace,
                vkey,
                reviewer_feedback,
                emits,
                **({"grounding": grounding} if grounding is not None else {}),
            )
            delete_vkey_step(run_id, vkey)

            if result["status"] == "over_budget":
                # The proxy cut the agent off mid-call. Record whatever partial spend the cut-off
                # conversation carried (best-effort, idempotent on the per-node key), then stop.
                if result["total_tokens"] or result["cost_usd"]:
                    persist_agent_cost_step(run_id, current, node["model"], result, n)
                close_invocation_step(run_id, current, n, "stopped", "over_budget")
                return _finalize_over_budget(run_id, pm_document_id)
            if result["status"] != "completed":
                close_invocation_step(run_id, current, n, "failed", None)
                mark_run_failed_step(run_id)
                DBOS.logger.error(
                    f"run_team agent node failed run_id={run_id}: {result.get('error')}"
                )
                return {
                    "run_id": run_id,
                    "status": "failed",
                    "document_id": pm_document_id,
                    "error": result.get("error"),
                }

            # Meter ONLY if the node actually spent — a forced/zero-usage reviewer writes no row,
            # so the ``:agent-cost:%`` counts stay engineer-only. The per-node key
            # (``…:agent-cost:{node_id}:{iteration}``) keeps the engineer's and a real reviewer's
            # iter-1 rows from colliding while preserving the prefix the checkers count.
            if result["total_tokens"] or result["cost_usd"]:
                persist_agent_cost_step(run_id, current, node["model"], result, n)
            label = result["outcome"]  # None for a non-branching (engineer-style) node
            # Per-node work-brief (Option A): an EMITTING worker (the Reviewer) keeps its verdict
            # reasons as ``outcome_detail`` (byte-stable — §14.1 ReviewerView + §14.3 A/B read it);
            # a NON-emitting worker (the Engineer) gets a deterministic files-changed brief instead
            # of NULL. ``emits`` is the same authored-topology fact handed to ``agent_run_step``.
            detail = result["reasons"] if emits else _worker_brief(result.get("files_changed", []))
            close_invocation_step(
                run_id, current, n, "done", label or "built", outcome_detail=detail
            )
            # Thread the verdict's reasons into the next agent's revision context (None for a
            # worker → the next round carries no revision block).
            reviewer_feedback = result["reasons"]
            if apply_budget_hook(run_id, node_id=current, iteration=n):
                return _finalize_over_budget(run_id, pm_document_id)
            current = next_node(edges, current, label)

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
                    # M-brownfield: the real branch the change landed on (None for greenfield).
                    "ship_branch": ship.get("ship_branch"),
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
