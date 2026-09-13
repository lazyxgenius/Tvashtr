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
from dataclasses import replace
from pathlib import Path

from dbos import DBOS
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from tvashtr.config import get_settings
from tvashtr.control_plane import clone_reaper, github_app, workspace_reaper
from tvashtr.control_plane.budget import budget_check_step, mark_budget_overridden_step
from tvashtr.control_plane.budget_nudge import maybe_emit_budget_nudge_step
from tvashtr.control_plane.context_compiler import (
    REMEMBER_FILENAME,
    SPEC_HANDLE_FILENAME,
    compile_context,
    resolve_context_budget,
    resolve_fallback_model,
    resolve_output_schema,
    resolve_reads_from,
    resolve_remember_enabled,
    resolve_writes_to,
)
from tvashtr.control_plane.credentials import NoCredentialError, resolve_owner_api_key
from tvashtr.control_plane.gates import wait_at_gate
from tvashtr.control_plane.guardrails import (
    GUARDRAIL_GATE_KINDS,
    _schema_violation,  # REUSED (M-rails C9's shipped JSON-Schema-subset validator) — never a copy
    guardrail_gate_step,
)
from tvashtr.control_plane.invocations import close_invocation_step, open_invocation_step
from tvashtr.control_plane.litellm_admin import delete_virtual_key, mint_virtual_key
from tvashtr.control_plane.memory_retrieval import (
    embed_query_metered,
    memory_query,
    retrieve_for_node,
)
from tvashtr.control_plane.node_skills import build_skills
from tvashtr.control_plane.node_tools import build_mcp_config
from tvashtr.control_plane.resolution_warnings import record_resolution_warning
from tvashtr.control_plane.run_diff import compute_run_diff
from tvashtr.control_plane.shipping import idempotent_ship, init_workspace_repo
from tvashtr.control_plane.worktree import (
    add_worktree,
    build_repo_grounding,
    is_work_tree,
)
from tvashtr.db import session_scope
from tvashtr.documents.service import (
    add_version,
    create_document_with_initial_version,
    find_or_create_run_document,
    get_latest_version,
    latest_content_by_name,
)
from tvashtr.engines.base import AgentTask
from tvashtr.engines.registry import resolve_adapter
from tvashtr.engines.run_event_sink import make_run_event_sink
from tvashtr.engines.sandbox_cache import close_run_sandboxes, session_key_for
from tvashtr.metering import record_agent_cost, running_cost
from tvashtr.models import AgentNode, Edge, EngineerRunAttempt, GithubInstallation, Run, RunArtifact

logger = logging.getLogger("tvashtr.control_plane.team_run")


def _engine_for_sandbox_mode(sandbox_mode: str) -> str:
    """Map the configured sandbox posture to an engine NAME (never an adapter — resolving one
    imports the engine SDK, and this module stays ``openhands``-free at import).

    ``docker`` and ``local`` resolve to exactly the names they always did; M-h2a adds ``fly`` (a
    per-run Firecracker microVM). Total by construction: an unrecognized value still falls back to
    the local engine, byte-for-byte the prior behaviour."""
    return {"docker": "openhands-docker", "fly": "openhands-fly"}.get(sandbox_mode, "openhands")


def _owner_api_key(run_id: str, model: str) -> str:
    """Resolve the run owner's provider key for ``model`` (M-accounts Slice B — BYOK, NO ``.env``
    fallback). Read INSIDE the spend-bearing ``agent_run_step`` (M-unify U1: the ONE unified path)
    rather than threaded as a step parameter — so the many tests that
    monkeypatch those whole steps keep their existing signatures — and used transiently: the
    plaintext key is NEVER returned, so it is never persisted in a DBOS step-output checkpoint. The
    run is always owned (``create_run`` sets ``owner_id``; ``load_graph_step`` hard-asserts it), so
    ``owner_id`` is non-None here; ``resolve_owner_api_key`` raises ``NoCredentialError`` only if
    the owner lacks the provider key — unreachable past the launch pre-flight, a clean run-failure
    if it somehow occurs."""
    with session_scope() as session:
        owner_id = session.execute(
            select(Run.owner_id).where(Run.id == uuid.UUID(run_id))
        ).scalar_one()
    if owner_id is None:
        raise RuntimeError(
            f"run {run_id} has no owner_id — cannot resolve a per-owner provider key (no .env "
            "fallback). Every run must be owned by construction."
        )
    return resolve_owner_api_key(owner_id, model)


def _resolve_model_and_key(run_id: str, model: str, fallback_model: str | None) -> tuple[str, str]:
    """Resolve the node's model + the run owner's key for it, failing over ONCE to the node's
    ``config["fallback_model"]`` on a PRIMARY-provider HARD failure.

    This is the REACHABLE host-side seam on the agent path. The host resolves ``model -> provider ->
    owner key`` here, immediately before building the ``AgentTask`` — so a missing credential for
    the PRIMARY's provider (``NoCredentialError``: an auth-class hard failure, explicitly NOT a 429)
    is visible to the host and can be failed over cheaply, BEFORE any agent runs.

    **Scope limitation (deliberate, per the slice brief).** The agent's actual litellm call is made
    by the OpenHands SDK *inside* the sandbox — in ``docker``/``fly`` mode, inside the container —
    and its own 429/retry envelope comes from :func:`tvashtr.config.agent_llm_routing`
    (``num_retries``/``retry_max_wait``). A provider hard-failure that happens THERE cannot be
    failed over from the host without patching the in-container agent-server, which this slice
    deliberately does not do (the same in-container wall that scoped proactive pacing in
    Milestone B). The host-side completion path (``gateway.complete``) DOES get the full swap,
    including the 429 exclusion — see :func:`tvashtr.gateway.gateway.complete`.

    No ``fallback_model`` ⇒ the original error propagates exactly as today.
    """
    try:
        return model, _owner_api_key(run_id, model)
    except NoCredentialError:
        if not fallback_model:
            raise
        key = _owner_api_key(run_id, fallback_model)
        # Advisory, not fatal: the run continues on the fallback, and the swap is visible in the
        # run inspector rather than being a silent model substitution.
        record_resolution_warning(
            run_id,
            "fallback_model",
            fallback_model,
            f"no credential for {model!r}'s provider — failed over to the node's fallback model",
        )
        return fallback_model, key


def _output_schema_violation(output: str | None, schema: dict | None) -> str | None:
    """ADVISORY check of a completion node's ``output`` against its ``config["output_schema"]``.

    Returns a human reason naming the FIRST failing key path, or ``None`` when it validates (or when
    there is nothing to check). REUSES the JSON-Schema-subset validator M-rails C9 shipped in
    :mod:`tvashtr.control_plane.guardrails` (``_schema_violation``) — deliberately NOT a second
    validator, so the advisory node check and the ``output_schema_check`` guardrail gate can never
    disagree about what "valid" means.

    Output that is not JSON at all is itself a miss (reported as such), never an exception: v1 never
    fails a run on a schema result — the caller records a ``RunWarning`` and the walk continues.
    """
    if schema is None or output is None:
        return None
    try:
        parsed = json.loads(output)
    except ValueError:  # covers JSONDecodeError
        return "output is not valid JSON"
    violation = _schema_violation(parsed, schema, "")
    return None if violation is None else f"output fails schema at {violation}"


# M-h1b — a hosted-GitHub clone lands in a deterministic per-run dir (so a resume is idempotent),
# under the same gitignored convention as the workspace root. It becomes the run's ``repo_path``.
# M-clonegc: the path now lives in ``clone_reaper``, which owns the directory's whole lifecycle
# (create here, reclaim there). Delegating rather than re-deriving keeps ONE definition, so the
# reaper can never sweep a root the executor is not writing to.
def _hosted_clone_dir(run_id: str) -> str:
    return clone_reaper.clone_dir_for_run(run_id)


def _owner_installation_ids(owner_id) -> list[int]:
    """The GitHub App installation ids this run's owner controls (owner-scoped, exactly like
    ``/api/github/repos``) — the authz anchor for resolving which installation reaches the repo."""
    with session_scope() as session:
        return [
            row.installation_id
            for row in session.execute(
                select(GithubInstallation).where(GithubInstallation.owner_id == owner_id)
            ).scalars()
        ]


@DBOS.step()
def clone_github_repo_step(run_id: str) -> None:
    """M-h1b — the LOAD-BEARING clone. For a HOSTED-GitHub run (``github_repo`` set, ``repo_path``
    NULL) clone the repo into a per-run dir and SET ``repo_path`` to it — BEFORE ``load_graph_step``
    snapshots ``repo_path`` into the graph. Once set, the run looks byte-identically like a LOCAL
    BROWNFIELD run to the rest of the executor (``engineer_setup`` cuts its worktree from the clone;
    grounding / pull-paths / ship untouched — the walk is never forked). A local-brownfield /
    greenfield run (no ``github_repo``) is a clean no-op.

    Idempotent + crash-safe (mirrors ``add_worktree`` / ``init_workspace_repo``): a run whose
    ``repo_path`` is already set is a no-op, and the clone no-ops on an existing ``.git``, so a
    DBOS replay is safe. NOT in the endpoint: a clone is unbounded network I/O that must be
    durable and must not block ``POST /api/runs``. The 1h token is scrubbed off ``.git/config``
    in :func:`github_app.clone_repo` — never persisted."""
    _materialize_hosted_clone(run_id)


def _materialize_hosted_clone(run_id: str) -> None:
    """The clone step's BODY, gated on the DISK rather than on a database column.

    M-hostedfix — the defect this closes. The old gate was ``if not github_repo or repo_path:
    return``, i.e. "``runs.repo_path`` is set, so the clone exists". That is a claim about the
    DATABASE, and the clone is MACHINE-LOCAL disk. A workflow recovered onto a second Fly machine
    (prod runs two, no shared volume, one ``executor_id``) replays a ``repo_path`` pointing at a
    directory that machine never had, and every git command against it exits 128.

    Kept as a plain function, NOT a step, so :func:`ensure_run_workspace` can re-run it on a
    recovery — a ``@DBOS.step`` replays its recorded output and never re-enters its body, which is
    exactly why the original "idempotent + crash-safe" claim was unreachable."""
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        github_repo = run.github_repo
        repo_path = run.repo_path
        owner_id = run.owner_id
    if not github_repo:
        return  # not a hosted-GitHub run
    if repo_path and is_work_tree(repo_path):
        return  # the clone is genuinely HERE (idempotent resume) — never re-clone what we hold
    match = github_app.find_repo_in_installations(_owner_installation_ids(owner_id), github_repo)
    if match is None:
        raise RuntimeError(
            f"run {run_id}: github_repo {github_repo!r} is not in the owner's installations"
        )
    installation_id, _ = match
    dest = _hosted_clone_dir(run_id)
    github_app.clone_repo(installation_id, github_repo, dest)
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == uuid.UUID(run_id)).values(repo_path=dest))


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
        # M-accounts Slice B: every run is OWNED by construction (create_run sets owner_id on every
        # path — UI = the user, scripts/tests = the seeded operator). Hard-error if a run somehow
        # loads with a NULL owner — NEVER proceed to resolve keys (there is no .env fallback). This
        # assert is defense-in-depth: the application makes the NULL case unreachable.
        if run.owner_id is None:
            raise RuntimeError(
                f"run {run_id} has no owner_id — refusing to execute (no owner-less run)"
            )
        # M-brownfield: surface the run's brownfield target off the SAME Run row (no extra query).
        # ``repo_path is None`` ⇒ greenfield (the legacy path); non-NULL ⇒ brownfield. ``subpath``
        # (scoped-mount Slice 1) is the optional package the brownfield grounding + worker FOCUS
        # scope to (NULL ⇒ whole repo); read here so the walk threads ONE deterministic value.
        repo_path = run.repo_path
        base_ref = run.base_ref
        subpath = run.subpath
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
            # M-tools C7.0: inline tools + skills (NULL on every node today). ``run_graph``
            # threads them to the step fns ONLY when non-NULL, so the inert path is byte-for-byte
            # unchanged; at load they ride the picklable graph dict like prompt/model/config.
            "tool_config": n.tool_config,
            "skills": n.skills,
            # M-unify U1: the ONE capability distinction the unified walk dispatches on — a worker
            # (edits-on) pulls its file changes; a report-only node (edits-off) pulls only REPORT.md
            # + the verdict. Rides the picklable graph dict so the walk reads a replay-stable value.
            "edits_allowed": n.edits_allowed,
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
        # scoped-mount Slice 1: the optional sub-path scope (NULL ⇒ whole repo). Recorded alongside
        # so the grounding step + the worker FOCUS directive read ONE replay-stable value.
        "subpath": subpath,
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
def record_entry_spec_step(
    run_id: str,
    node_id: str,
    iteration: int,
    report: str,
    spec_document_id: str | None,
    name: str = "spec",
) -> str:
    """M-unify U1 (D2.3): version the ENTRY node's pulled ``REPORT.md`` into the run's shared spec
    document — the unified REPLACEMENT for the old ``pm_step`` text→doc AND ``thinker_refine_step``
    paths. Its input ``report`` is the entry ``agent_run_step``'s recorded return, so this step
    replays deterministically on a crash.

    First entry invocation (``spec_document_id is None``): create the ``Mini-PRD`` document + its v1
    from the report and set ``Run.pm_document_id`` — idempotent on the run's canonical
    ``{run_id}:pm-prd-v1`` key (byte-compatible with the old PM's key + the offline harness). A
    LATER
    entry invocation (a refine round): append the report as the next version — idempotent on
    ``{run_id}:spec:{node_id}:{iteration}`` (the old thinker-refine key shape). Returns the spec
    document id (created or existing)."""
    if spec_document_id is None:
        # M-docs: stamp the entry's document run-scoped (``run_id`` — closes the orphaned-documents
        # leak + makes it CASCADE-delete with the run) + NAMED (``name``, default "spec"; the
        # entry's ``config["writes_to"]`` overrides it). ``Run.pm_document_id`` still points at it.
        # Title/doc_type/idempotency_key are UNCHANGED, so the default "spec" doc is byte-stable.
        document = create_document_with_initial_version(
            title="Mini-PRD",
            doc_type="prd",
            content=report,
            created_by="agent:entry",
            idempotency_key=f"{run_id}:pm-prd-v1",
            run_id=uuid.UUID(run_id),
            name=name,
        )
        with session_scope() as session:
            session.execute(
                update(Run).where(Run.id == uuid.UUID(run_id)).values(pm_document_id=document.id)
            )
        return str(document.id)
    add_version(
        uuid.UUID(spec_document_id),
        report,
        created_by="agent:entry",
        idempotency_key=f"{run_id}:spec:{node_id}:{iteration}",
    )
    return spec_document_id


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
def read_named_documents_step(run_id: str, names: list[str]) -> list[dict]:
    """M-docs — the recorded READ step behind a node's ``config["reads_from"]``: resolve each
    requested document NAME to its latest content by ``(run_id, name)`` and return
    ``[{"name", "content"}]`` in the REQUESTED order. A name with no matching document (or one with
    no versions yet) is SKIPPED — a node may legitimately list a doc a peer has not produced yet. A
    recorded ``@DBOS.step`` like :func:`read_latest_prd_step`, so the resumed walk reads the SAME
    versions the original execution saw (deterministic crash-resume). Returns ``[]`` for an
    empty/all-missing list; the caller then omits the ``read_documents`` kwarg (byte-identical)."""
    rid = uuid.UUID(run_id)
    out: list[dict] = []
    for name in names:
        content = latest_content_by_name(rid, name)
        if content is not None:
            out.append({"name": name, "content": content})
    return out


@DBOS.step()
def write_named_document_step(
    run_id: str, node_id: str, iteration: int, report: str, name: str
) -> None:
    """M-docs — the recorded WRITE step behind a NON-entry node's ``config["writes_to"]``: version
    its pulled ``REPORT.md`` (its ``report``) into its OWN run-scoped document, find-or-created on
    ``(run_id, name)``. Idempotent on ``{run_id}:doc:{name}:{node_id}:{iteration}`` (a DBOS replay
    insert-or-returns, never a duplicate version or a second document for the name). Unlike the
    entry's :func:`record_entry_spec_step` it does NOT touch ``Run.pm_document_id`` — only the entry
    owns the run's primary spec pointer. The document is created ``title="Document: {name}"`` +
    ``doc_type=name`` so the run-view picker labels it legibly."""
    find_or_create_run_document(
        run_id=uuid.UUID(run_id),
        name=name,
        title=f"Document: {name}",
        doc_type=name,
        content=report,
        created_by=f"agent:{node_id}",
        idempotency_key=f"{run_id}:doc:{name}:{node_id}:{iteration}",
    )


@DBOS.step()
def retrieve_memory_step(run_id: str, node_id: str, iteration: int, query: str) -> list[dict]:
    """M-memory S3 — the recorded READ step: retrieve THIS node's remembered facts (hot + cold
    pgvector top-K, tier-scoped + ``active``-only) for injection into ``compile_context(memory=…)``.
    Mirrors :func:`read_latest_prd_step` / :func:`brownfield_grounding_step` — a recorded step
    whose result feeds the compiler, so it replays deterministically on a crash-resume.

    The scope is the run OWNER's active memories in the tiers that apply: account ∪ repo
    (``run.repo_path``) ∪ node (that repo + this node's AUTHORED id). The authored id = the exec
    node's ``cloned_from_node_id`` (the clone→origin back-reference), falling back to the node's OWN
    id when it is not a clone. A greenfield run (``repo_path`` NULL) ⇒ account tier only. The query
    embed uses the run owner's key (:func:`resolve_owner_api_key`), metered ON the run
    (``workflow_id=run_id``) — resolved LAZILY inside the closure so an empty in-scope set (no cold
    candidates) never resolves a key or hits the network (byte-identical to no-memory).

    **BEST-EFFORT** — ANY failure returns ``[]`` so a retrieval problem NEVER crashes or changes a
    run (:func:`retrieve_for_node` is itself best-effort; this guard also covers the owner/repo/
    authored-id resolution)."""
    try:
        with session_scope() as session:
            run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
            owner_id = run.owner_id
            repo_key = run.repo_path
            authored = session.execute(
                select(AgentNode.cloned_from_node_id).where(AgentNode.id == uuid.UUID(node_id))
            ).scalar_one_or_none()
        if owner_id is None:
            return []
        # The authored origin id (via cloned_from_node_id); fall back to the node's own id if it is
        # not a clone (``cloned_from_node_id`` NULL, or the node row is absent).
        authored_node_id = authored if authored is not None else uuid.UUID(node_id)
        model = get_settings().embedding_model
        idempotency_key = f"{run_id}:memory-embed:{node_id}:{iteration}"

        def _embed(text: str) -> list[float] | None:
            # Reached ONLY when there are cold candidates — so the owner-key resolution + the
            # on-run metering only happen when a real retrieval embed is needed.
            api_key = resolve_owner_api_key(owner_id, model)
            return embed_query_metered(
                text,
                api_key=api_key,
                model=model,
                run_id=run_id,
                idempotency_key=idempotency_key,
            )

        return retrieve_for_node(owner_id, repo_key, authored_node_id, query, embed_query=_embed)
    except Exception:  # noqa: BLE001 — best-effort: a retrieval failure never crashes a run
        logger.warning(
            "retrieve_memory_step best-effort empty run_id=%s node=%s",
            run_id,
            node_id,
            exc_info=True,
        )
        return []


# M-unify U1: the report-only deliverable file. An edits-off node's pull is scoped to EXACTLY this
# + the verdict sidecar; the ENTRY node's REPORT.md becomes the next spec version. Shared constant
# so
# the pull-scope helper, the entry versioning, and the ship-exclusion all agree on the one name.
REPORT_FILENAME = "REPORT.md"

# P1.5c: keep review/test byproducts out of the shipped commit. ``idempotent_ship`` does
# ``git add -A``, so anything matching this workspace ``.gitignore`` is excluded from the ship:
# the Reviewer's ``REVIEW_VERDICT.json`` sidecar (also harvested+removed) and any stray
# ``__pycache__``/``*.pyc`` (the Reviewer runs tests with ``python -B`` so it writes none, but
# this is the belt-and-suspenders for any byproduct either agent leaves behind).
# M-ctx1 (C4): ``SPEC.md`` — the large-spec doc-handle — joins the list so a GREENFIELD ship never
# picks it up (greenfield's ``os.walk`` container seed ignores ``.gitignore``, so the agent still
# reads it). Brownfield writes no workspace ``.gitignore`` (its git-aware seed WOULD skip an ignored
# file), so there the harvest-and-remove in ``agent_run_step`` is what keeps it out of the ship.
# M-unify U1: ``REPORT.md`` joins the list — the entry node's report becomes the durable spec doc,
# so
# it must never ALSO land in the shipped worktree (it persists in the shared workspace after its
# scoped pull keeps it; the reviewer/verdict sidecar is handled the same way).
# M-memory S4: ``TVASHTR_REMEMBER.jsonl`` (the agent-remember capture sidecar) joins too — the
# greenfield ship must never pick it up (belt beside ``shipping``'s pathspec exclude, which also
# covers brownfield, where no workspace ``.gitignore`` is written).
_WORKSPACE_GITIGNORE = (
    f"__pycache__/\n*.pyc\nREVIEW_VERDICT.json\n{REPORT_FILENAME}\n{SPEC_HANDLE_FILENAME}\n"
    f"{REMEMBER_FILENAME}\n"
)


def _resolve_pull_paths(*, edits_allowed: bool, emits_outcome: bool) -> tuple[str, ...] | None:
    """M-unify U1 (D2.2) — the end-of-run pull scope, the UNION OF RESTRICTIONS (each applicable
    rule
    narrows the set of paths allowed to leave the sandbox; the scope is their INTERSECTION — the
    most
    restrictive). ``None`` ⇒ the adapter pulls EVERYTHING (byte-identical to a worker today).

    * edits-ON + non-emitting (an ordinary worker) → ``None`` (unscoped; REPORT.md, if written,
    rides
      the full pull as an optional deliverable).
    * edits-ON + emitting (a reviewer) → ``("REVIEW_VERDICT.json",)`` — the Slice-4 verdict-only
    pull,
      BYTE-IDENTICAL (its clobber protection must not regress).
    * edits-OFF + non-emitting (the entry/thinker) → REPORT.md + verdict: its report is the
      deliverable, no other workspace mutation leaves.
    * edits-OFF + emitting (a report-only reviewer) → intersection → verdict-only (the Slice-4 rule
      survives INDEPENDENTLY of the toggle).
    """
    if edits_allowed and not emits_outcome:
        return None
    allowed: set[str] | None = None
    if not edits_allowed:
        allowed = {REPORT_FILENAME, "REVIEW_VERDICT.json"}
    if emits_outcome:
        verdict_only = {"REVIEW_VERDICT.json"}
        allowed = verdict_only if allowed is None else (allowed & verdict_only)
    return tuple(sorted(allowed))


# How many chars of a non-entry report-only node's REPORT.md are surfaced on its invocation detail
# (D2.4: pulled + surfaced, never versioned into the spec — that is the entry node's job alone).
_REPORT_SURFACE_CAP = 2000


def _report_brief(report: str | None) -> str:
    """The 'last run' detail for a NON-entry report-only (edits-off) node: surface its REPORT.md
    (capped) so the inspector/work-brief shows the deliverable — it is NOT versioned into the
    spec."""
    if not report:
        return "Ran report-only but wrote no REPORT.md."
    body = report.strip()[:_REPORT_SURFACE_CAP]
    return f"Report ({len(report)} chars):\n{body}"


def _write_spec_handle(workspace: str, content: str) -> None:
    """C4: write the offloaded spec to ``<workspace>/SPEC.md`` (the host workspace the executor
    owns)
    so a worker reads ``./SPEC.md`` instead of a large inline spec. Pure (stdlib), unit-testable."""
    (Path(workspace) / SPEC_HANDLE_FILENAME).write_text(content, encoding="utf-8")


def _remove_spec_handle(workspace: str) -> None:
    """C4: remove ``<workspace>/SPEC.md`` after the agent run so it NEVER reaches the shippable
    worktree (the terminal ship node comes later, after every agent iteration). Best-effort +
    idempotent — the same harvest-and-remove discipline as ``_harvest_verdict``'s sidecar unlink."""
    (Path(workspace) / SPEC_HANDLE_FILENAME).unlink(missing_ok=True)


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
    return _materialize_run_workspace(run_id)


def _materialize_run_workspace(run_id: str) -> str:
    """The setup step's BODY — idempotent, repair-capable, and verified against the DISK.

    Split out of :func:`engineer_setup_step` so :func:`ensure_run_workspace` can re-run it after a
    recovery. Every branch no-ops when the disk already holds what it would build."""
    from tvashtr.engines.openhands_adapter import make_local_workspace  # lazy (openhands)

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        repo_path = run.repo_path
        base_ref = run.base_ref
        github_repo = run.github_repo

    workspace = make_local_workspace(run_id)
    if repo_path is not None:
        if not is_work_tree(repo_path):
            # The repo the worktree is cut FROM is machine-local too, and on a recovery it is gone
            # alongside the workspace. A hosted run can rebuild it from GitHub; a run pointed at the
            # user's OWN folder cannot, and must say so instead of dying inside git plumbing.
            if not github_repo:
                raise RuntimeError(
                    f"run {run_id}: the brownfield repo {repo_path!r} is no longer a git "
                    "repository on this machine — a local-folder run cannot be resumed elsewhere"
                )
            _materialize_hosted_clone(run_id)
            with session_scope() as session:
                repo_path = (
                    session.execute(select(Run).where(Run.id == uuid.UUID(run_id)))
                    .scalar_one()
                    .repo_path
                )
        branch = add_worktree(repo_path, workspace, run_id, base_ref)
        with session_scope() as session:
            session.execute(
                update(Run).where(Run.id == uuid.UUID(run_id)).values(ship_branch=branch)
            )
        return workspace
    init_workspace_repo(workspace)
    _write_workspace_gitignore(workspace)
    return workspace


def ensure_run_workspace(run_id: str, workspace: str) -> None:
    """Re-establish the run's MACHINE-LOCAL workspace. Called from the workflow body on EVERY
    entry, and **deliberately NOT a ``@DBOS.step``**.

    M-hostedfix, the load-bearing half of the fix. ``engineer_setup_step`` is checkpointed: DBOS
    replays its recorded path and SKIPS its body, so after a recovery nothing has re-created the
    clone or the ``git worktree`` — and on prod that recovery lands on a second Fly machine whose
    disk never held either. The sandbox adapters then ``os.makedirs(host_dir, exist_ok=True)`` a
    bare directory into the worktree's place and the brownfield seed enumeration dies with
    ``git ls-files … exit status 128``.

    A step cannot fix this (replay skips bodies), and a NEW step here would shift every later
    ``function_id`` and break replay for in-flight workflows. A plain call adds no checkpoint, so
    it re-executes on every entry — which is the whole point. On the overwhelmingly common first
    entry it is one ``git rev-parse`` and returns."""
    if is_work_tree(workspace):
        return
    logger.warning(
        "run %s: workspace %s is not a git work tree (a recovery onto a machine without it) — "
        "re-materializing before the agent runs",
        run_id,
        workspace,
    )
    _materialize_run_workspace(run_id)


@DBOS.step()
def brownfield_grounding_step(
    run_id: str, workspace: str, repo_basename: str, subpath: str | None = None
) -> str:
    """Compute the D6 repo-grounding block for a brownfield run, ONCE, right after the worktree is
    set up. A recorded ``@DBOS.step`` so the block is checkpointed and replayed VERBATIM on resume
    (deterministic instruction across a crash). Greenfield never calls it. The pure builder
    (``worktree.build_repo_grounding``) keeps it openhands-free + unit-tested.

    scoped-mount Slice 1: ``subpath`` (the run's persisted scope, read off the recorded graph dict →
    replay-stable) roots the structure outline at one package; ``None`` ⇒ whole-repo grounding,
    byte-for-byte unchanged."""
    return build_repo_grounding(workspace, repo_basename, subpath=subpath)


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
    run_id: str,
    node_id: str,
    model: str | None,
    usage: dict,
    iteration: int,
    invocation_id: int,
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
        invocation_id=invocation_id,
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
    prd_text: str | None,
    workspace: str,
    vkey: str | None,
    reviewer_feedback: str | None,
    emits_outcome: bool,
    budget: int,
    invocation_id: int,
    grounding: str | None = None,
    subpath: str | None = None,
    tool_config: dict | None = None,
    skills: list | None = None,
    edits_allowed: bool = True,
    remember_enabled: bool = False,
    node_id: str | None = None,
    memory: list | None = None,
    read_documents: list | None = None,
    fallback_model: str | None = None,
) -> dict:
    """The ONE generic agent step (P1.8a) — replaces the role-specific ``engineer_run_step`` AND
    ``reviewer_agent_run_step``. M-unify U1: it is now the SINGLE path EVERY AgentNode executes
    through — a thinker (the entry/PM), a worker (the Engineer), a reviewer — no more direct
    completions. Runs the node's ``node_prompt`` (its behavior, seeded by the builder) against the
    sandboxed adapter behind the unchanged ``EngineAdapter``/``AgentTask`` contract, with the idea +
    live PRD (+ a revision block on a rework round) appended UNIFORMLY.

    M-unify U1 capability toggle: ``edits_allowed`` (the ONE distinction, default True = a worker).
    ``False`` ⇒ a report-only node — ``compile_context`` appends the capability note, the pull is
    scoped to REPORT.md + the verdict (:func:`_resolve_pull_paths`), so NONE of its file changes
    reach
    the host. Its ``REPORT.md`` (if written) is read post-pull and returned as ``report`` (``None``
    when absent) for the workflow body to version (entry) or surface (non-entry). ``prd_text`` is
    ``None`` for the ENTRY node's FIRST invocation (no spec yet — it CREATES it).

    M-ctx1 (C2/C4): the instruction is assembled by the pure
    :func:`context_compiler.compile_context` (the moved-out, unit-tested typed-parts assembly —
    byte-identical on the small path). Two additions ride on it, BEFORE any adapter runs:

    * **C2 input budget** — a compiled input exceeding ``budget`` (the resolved per-node ceiling)
      FAILS the node PRE-CALL: return status ``"over_context"`` (a non-``completed`` status the
      workflow body finalizes as ``failed``, exactly like an engine error — NOT a new routable
      outcome label, NOT a mid-agent context crash) with an ``error`` naming the fattest part + its
      token count, zero usage, no attempt row, no adapter. The manifest is still returned.
    * **C4 doc-handle** — when ``compile_context`` offloaded a large spec, write it to
      ``<workspace>/SPEC.md`` before the run (the agent reads ``./SPEC.md``) and remove it after
      (so it never ships).

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
    ``{"status", "outcome", "reasons", "files_changed", "context_manifest", "error"?, **usage}`` —
    ``files_changed`` (the adapter's already-computed change set, with ``SPEC.md`` filtered out) is
    threaded up for the per-node work-brief (Option A); a worker's NON-emitting close composes its
    brief from it."""
    if emits_outcome:
        forced = _forced_review_outcome(iteration)
        if forced is not None:
            return forced

    # M-ctx1 (C2/C4): assemble the instruction via the pure compiler (the moved-out typed-parts
    # assembly — byte-identical on the small path). It preserves the EXACT prior conditional logic:
    # idea + live PRD always; a revision block on a rework round (``iteration > 1`` + feedback); the
    # brownfield grounding (D6) when set; the worker-only ``WORKER_PROTOCOL`` + sub-path FOCUS (the
    # §15 worker-gating split — a reviewer gets orientation but NEVER implement-the-change steps).
    # Run BEFORE the attempt log + adapter so a pre-call budget breach costs no attempt row + no
    # agent run.
    compiled = compile_context(
        node_prompt=node_prompt,
        idea=idea,
        spec=prd_text,
        iteration=iteration,
        reviewer_feedback=reviewer_feedback,
        grounding=grounding,
        emits_outcome=emits_outcome,
        subpath=subpath,
        budget=budget,
        # M-unify U1 (D2.5): a report-only node gets the capability note; an edits-on worker gets NO
        # new part, so its compiled instruction stays byte-identical to main.
        edits_allowed=edits_allowed,
        # M-memory S3: the node's remembered facts. None/[] ⇒ NO memory part ⇒ the compiled
        # instruction + manifest stay byte-identical to a run with no memory (inert-when-empty).
        memory=memory,
        # M-memory: the agent-remember capture protocol — only for an edits-ON WORKER whose PER-NODE
        # config opted in (``config["memory_remember_enabled"]``, resolved by the caller via
        # ``resolve_remember_enabled`` and threaded in as ``remember_enabled``; default False ⇒
        # byte-identical to a node that never opted in). A reviewer / thinker (edits-off) never gets
        # it — the ``and edits_allowed`` gate holds. The control plane ingests the
        # TVASHTR_REMEMBER.jsonl sidecar at run-end.
        remember_enabled=remember_enabled and edits_allowed,
        # M-docs: the named read documents (config["reads_from"]) resolved + threaded by the
        # workflow body (read_named_documents_step). None ⇒ NO read-docs part ⇒ byte-identical; when
        # present the caller also passed spec=None so they REPLACE the default PRD part.
        read_documents=read_documents,
    )
    manifest = compiled.manifest()

    # C2 input budget: a compiled input over budget FAILS PRE-CALL — no attempt row, no adapter, no
    # mid-agent context crash. Surface it through the SAME ``status != "completed"`` return shape
    # the engine-error branch below uses (the workflow body finalizes it ``failed``); the
    # ``over_context`` status is DISTINCT from the proxy's ``over_budget`` so it routes to the
    # generic failure, not the budget path, and is NOT a routable edge/outcome label. The reason
    # NAMES the fattest part + its token count so the failure is self-explaining.
    if compiled.over_budget:
        fat = compiled.fattest
        reason = (
            f"context {compiled.total_tokens} tok exceeds budget {compiled.budget} — "
            f"the {fat.name!r} part is {fat.tokens} tok"
        )
        logger.warning("agent node over input budget run_id=%s: %s", run_id, reason)
        return {
            "status": "over_context",
            "outcome": None,
            "reasons": None,
            "files_changed": [],
            "error": reason,
            "context_manifest": manifest,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
        }

    # Attempt log — written ONLY when the real adapter runs (after the forced short-circuit AND the
    # pre-call budget check), so a forced Reviewer / a budget-breached node adds no row and the
    # crash demo's engineer_run_attempts trigger stays Engineer-only. Intentionally NOT idempotent:
    # one row per execution, distinct pid on a crash-then-resume (observable proof the step
    # re-executed).
    with session_scope() as session:
        session.add(EngineerRunAttempt(run_id=run_id, pid=os.getpid()))

    instruction = compiled.instruction
    # C4 doc-handle: when the spec was offloaded, write it to <workspace>/SPEC.md so the worker
    # reads ``./SPEC.md`` (the docker adapter's push carries the file into the container). Removed
    # after the run (below) so it NEVER ships — the greenfield ``.gitignore`` is the belt, this the
    # suspenders.
    if compiled.handle_used:
        _write_spec_handle(workspace, compiled.spec_doc)

    # M-accounts Slice B: the agent's api_key. Proxy-OFF (BYOK) ⇒ the run owner's per-owner key for
    # this node's model (resolved here, never returned/checkpointed). Proxy-ON ⇒ the minted per-run
    # virtual key (``vkey``) exactly as before (the proxy holds upstream keys; budget enforced
    # mid-call). Resolved AFTER the forced short-circuit so the offline forced harness never
    # resolves a key. ``model`` is set on every agent node by the builders; default-model guards.
    if get_settings().litellm_proxy_enabled:
        agent_api_key = vkey
    else:
        # Per-node capabilities (Session A): the host-side failover seam. ``_resolve_model_and_key``
        # returns the PRIMARY and its key normally, and swaps to the node's ``fallback_model`` when
        # the primary's provider credential is missing (a hard auth failure the host can see before
        # any agent runs). ``fallback_model=None`` ⇒ byte-identical to the previous single call.
        model, agent_api_key = _resolve_model_and_key(
            run_id, model or get_settings().default_model, fallback_model
        )

    task = AgentTask(
        instruction=instruction,
        workspace_dir=workspace,
        model=model,
        llm_api_key=agent_api_key,
        workspace_mode="brownfield" if grounding is not None else "greenfield",
        # M-unify U1 (D2.2) — the pull scope is the UNION OF RESTRICTIONS
        # (:func:`_resolve_pull_paths`):
        # edits-off ⇒ REPORT.md + verdict; an emitting node ⇒ verdict-only (the Slice-4 clobber
        # protection — a reviewer's container edits NEVER mutate the shippable host worktree —
        # survives
        # UNCHANGED and independently of the toggle); an edits-on worker ⇒ None (the full pull,
        # byte-identical to before). ``_harvest_verdict(workspace)`` still reads the sidecar the
        # scoped
        # pull carried home. The adapter learns a sync directive, not a role.
        pull_paths=_resolve_pull_paths(edits_allowed=edits_allowed, emits_outcome=emits_outcome),
        # M-tools C7.0: the node's inline tools + skills, resolved via the Control Plane's OWN seams
        # (node_tools / node_skills) so team_run never learns content and stays openhands-free.
        # Both are stubs today — build_mcp_config(None)->{} (the adapter builds NO MCP tools) and
        # build_skills(None)->[] (=> agent_context=None in the adapter), so a NULL-columns node is
        # byte-for-byte inert. ``workspace`` is this worker's own dir (the workspace_dir arg).
        mcp_config=build_mcp_config(tool_config, run_id),
        skills=build_skills(skills, workspace, run_id),
        # M-unify U2: the per-node sandbox-reuse key. The Control Plane passes only the KEY (never
        # a live handle) — the adapter reuses this node's warm container + continues its
        # Conversation across the node's own rounds. ``node_id`` None (older/test call sites that
        # don't thread it) ⇒ ``session_key`` None ⇒ NO reuse: byte-for-byte the
        # build-and-teardown-per-run path.
        session_key=session_key_for(run_id, node_id) if node_id is not None else None,
    )
    # Select local vs Docker-sandboxed engine from the configured sandbox mode (P1.3a). The
    # EngineAdapter contract + AgentRunResult shape are identical across modes; the adapter is
    # role-neutral — it just runs the AgentTask's instruction in its workspace.
    engine_name = _engine_for_sandbox_mode(get_settings().agent_sandbox_mode)
    adapter = resolve_adapter(engine_name)  # lazy openhands import happens here
    try:
        result = adapter.run(task, on_event=make_run_event_sink(run_id, invocation_id))
        # Per-node capabilities (Tvashtr-79 item 7): the MID-RUN arm of the SAME
        # ``fallback_model`` field. ``_resolve_model_and_key`` above covers only what the host can
        # see BEFORE the agent starts (a missing credential). The primary provider hard-failing
        # DURING the loop happens where the litellm call is actually made — in-container in
        # docker/fly mode — and used to crash the node. The adapter now classifies that wall
        # (``provider_failure``: auth / connection / provider-down / unknown-model, and explicitly
        # NEVER a 429 — the agent's own retry envelope owns those), so the host can re-run the step
        # ONCE on the node's fallback. No ``fallback_model`` ⇒ this branch is never entered and the
        # failure propagates through the ``!= "completed"`` return exactly as before.
        # ``fallback_model != model`` is not a paranoia guard: ``model`` was REBOUND above by the
        # pre-flight swap, so after that swap fires the node's fallback IS the slug that just ran.
        # Re-running the identical model + key it just hard-failed on buys nothing but a second
        # full agent run (and a misleading swap warning).
        if (
            result.status == "failed"
            and result.provider_failure
            and fallback_model
            and fallback_model != model
        ):
            try:
                if get_settings().litellm_proxy_enabled:
                    # Proxy-ON: the per-run virtual key is model-agnostic (the proxy holds the
                    # upstream keys), so only the slug changes — mirroring the resolution above.
                    failover_model, failover_key = fallback_model, vkey
                else:
                    # The fallback has no further fallback: at most ONE swap per invocation.
                    failover_model, failover_key = _resolve_model_and_key(
                        run_id, fallback_model, None
                    )
            except NoCredentialError:
                # An unresolvable fallback must never be WORSE than having none: the launch
                # pre-flight validates node MODELS only (``_missing_provider_credentials``), never
                # ``config["fallback_model"]``, so this is reachable by authoring alone. Keep the
                # original ``failed`` result — byte-identical to the no-fallback path — instead of
                # raising out of the step and crashing the run, and say why.
                record_resolution_warning(
                    run_id,
                    "fallback_model",
                    fallback_model,
                    f"primary {model!r} hard-failed mid-run but the fallback model's provider "
                    f"has no credential — failover skipped",
                )
            else:
                record_resolution_warning(
                    run_id,
                    "fallback_model",
                    failover_model,
                    f"primary {model!r} hard-failed mid-run — failed over to the node's "
                    f"fallback model",
                )
                result = adapter.run(
                    # Identical to the primary task but for the model + its key — and the
                    # sandbox-reuse key, which must MISS: a cache HIT skips LLM/Agent construction
                    # and continues the EXISTING Conversation, still bound to the PRIMARY model, so
                    # a failover carrying the primary's ``session_key`` would silently re-run on the
                    # very provider that just failed.
                    #
                    # A DISTINCT key under the SAME run — never a bare ``None``. ``None`` is the fly
                    # adapter's ``ephemeral`` trigger: it mints a synthetic run id and boots a whole
                    # new ``tv-run-<synthetic>`` app which, having no ``runs`` row, the 10-minute
                    # orphan sweep (``fly_reaper``) deletes out from under the failover mid-run.
                    # Keeping the real run id gets the MISS we want AND stays reaper-protected, and
                    # ``close_run_sandboxes(run_id)`` — which matches on the key's run-id prefix —
                    # still tears it down at run end. ``node_id`` None (older/test call sites) ⇒ the
                    # primary threaded no key either, so there is no reuse to dodge.
                    replace(
                        task,
                        model=failover_model,
                        llm_api_key=failover_key,
                        session_key=(
                            session_key_for(run_id, f"{node_id}-failover")
                            if node_id is not None
                            else None
                        ),
                    ),
                    # The retry restarts ``seq`` at 0 inside the SAME invocation; offset past the
                    # first attempt's events so they append rather than being swallowed as
                    # duplicates by the sink's idempotency probe.
                    on_event=make_run_event_sink(run_id, invocation_id, len(result.events)),
                )
    finally:
        # C4: SPEC.md (if written) must NEVER reach the shippable worktree — remove it right after
        # the run, whether it succeeded, failed, or raised (the ship node comes later, after every
        # agent iteration). Byte-for-byte a no-op when the handle didn't fire.
        if compiled.handle_used:
            _remove_spec_handle(workspace)
    usage = {
        "prompt_tokens": result.prompt_tokens,
        "completion_tokens": result.completion_tokens,
        "total_tokens": result.total_tokens,
        "cost_usd": result.cost_usd,
    }
    # C4: SPEC.md is executor scaffolding, not the agent's deliverable — never surface it as a
    # changed file (docker's brownfield pull enumerates every workspace file, so it would otherwise
    # appear here + in the work-brief). A no-op when the handle didn't fire (SPEC.md isn't present).
    files_changed = (
        [f for f in result.files_changed if f != SPEC_HANDLE_FILENAME]
        if compiled.handle_used
        else result.files_changed
    )
    if result.status != "completed":
        # Hand the terminal status up; the workflow body finalizes.
        return {
            "status": result.status,
            "outcome": None,
            "reasons": None,
            "files_changed": files_changed,
            "report": None,
            "error": result.error,
            "context_manifest": manifest,
            **usage,
        }
    # M-unify U1 (D2.1/D2.3): read the pulled REPORT.md (the report-only deliverable). Present for
    # an
    # edits-off node (in its scoped pull) or any node that chose to write one; None otherwise. This
    # read happens AFTER the adapter's end-of-run pull (local: ``_restore_except`` kept the scoped
    # paths incl. REPORT.md; docker: the selective pull carried it home), and its content is
    # checkpointed in THIS step's return → the entry's spec version replays deterministically.
    report_path = Path(workspace) / REPORT_FILENAME
    report = (
        report_path.read_text(encoding="utf-8", errors="replace") if report_path.exists() else None
    )
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
        "files_changed": files_changed,
        "report": report,
        "context_manifest": manifest,
        **usage,
    }


def _persist_greenfield_artifact(run_id: str) -> None:
    """M-wsgc S1 — snapshot a GREENFIELD run's shipped diff DURABLY into ``run_artifacts``.

    Called from :func:`ship_step` right after the ship, which is the one moment both halves are
    true: the commit exists, and the workspace directory still does. ``compute_run_diff`` therefore
    reads exactly what ``GET /api/runs/{id}/diff`` reads today, and the whole result dict is stored
    verbatim so the endpoint can hand it straight back once the directory is gone.

    That row is what LICENSES the workspace reaper to reclaim a greenfield workspace at all — before
    it, the directory was the only copy of the deliverable and had to be spared forever. So the
    ordering here is load-bearing and already correct: ``ship_step`` runs inside the workflow body,
    while ``_run_end_teardown`` (and its ``delete_run_workspace``) rides the ``finally`` far below.

    **Two deliberate refusals to write, both protecting the hard invariant** — *never reap a
    greenfield workspace before its diff is durable*. Absence of a row means "still spared", i.e.
    exactly the pre-milestone behaviour, so declining to write is always the safe answer:

    * An EMPTY snapshot is never stored. ``compute_run_diff`` is crash-proof by contract — a git
      failure, a wedged repo, an unresolvable ref all yield ``[]`` rather than raising. Persisting
      that would tell the reaper a deliverable had been captured when nothing was, and the directory
      would be destroyed. (A genuinely empty greenfield ship cannot reach here: ``idempotent_ship``
      raises "nothing to ship" first.)
    * A failed write is SWALLOWED, not raised. This is a snapshot for a read-only view; the run has
      already shipped successfully, and failing it here would turn a cosmetic problem into a lost
      run. Un-persisted simply means un-reapable."""
    try:
        snapshot = compute_run_diff(run_id=run_id, repo_path=None, base_ref=None, ship_branch=None)
        if not snapshot.get("files"):
            logger.warning(
                "ship_step: greenfield diff snapshot for run %s is empty — not persisting "
                "(its workspace stays spared)",
                run_id,
            )
            return
        with session_scope() as session:
            # UPSERT on the UNIQUE run_id: ``ship_step`` is a DBOS step, so a crash-resume re-runs
            # it, and a re-ship must re-persist the same snapshot rather than duplicate or 500.
            session.execute(
                pg_insert(RunArtifact)
                .values(run_id=uuid.UUID(run_id), files=snapshot)
                .on_conflict_do_update(index_elements=["run_id"], set_={"files": snapshot})
            )
    except Exception:  # noqa: BLE001 — a snapshot for a read-only view must never fail a shipped run
        logger.warning(
            "ship_step: failed to persist the greenfield diff snapshot run_id=%s "
            "(its workspace stays spared)",
            run_id,
            exc_info=True,
        )


@DBOS.step()
def ship_step(run_id: str, workspace: str) -> dict:
    """Idempotently ship the agent's work; record the sha/tag on the run. ``idempotent_ship`` is
    mount-agnostic — for a brownfield run ``workspace`` is the worktree whose HEAD IS
    ``tvashtr/<run_id>``, so the commit + tag land on that real branch in the user's repo (D2). The
    run's ``ship_branch`` (set at worktree setup; NULL for greenfield) is surfaced in the returned
    dict so the run result/banner can show the produced branch.

    M-wsgc S1: a GREENFIELD run (``repo_path IS NULL``) additionally gets its shipped diff
    snapshotted into ``run_artifacts`` here — see :func:`_persist_greenfield_artifact`. Gated
    strictly on ``repo_path``: a brownfield/hosted run's deliverable is the branch in the user's
    real repo, which can move after the run, so freezing a snapshot of it would only go stale. The
    snapshot is taken in its OWN session, after the sha/tag update has committed, so it can never
    roll that update back."""
    ship = idempotent_ship(workspace, run_id)
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        ship_branch = run.ship_branch
        is_greenfield = run.repo_path is None
        session.execute(
            update(Run)
            .where(Run.id == uuid.UUID(run_id))
            .values(ship_commit_sha=ship["sha"], ship_tag=ship["tag"])
        )
    ship["ship_branch"] = ship_branch
    if is_greenfield:
        _persist_greenfield_artifact(run_id)
    return ship


@DBOS.step()
def push_and_open_pr_step(run_id: str, repo_dir: str, branch: str | None) -> str | None:
    """M-h1b — the hosted Ship's delivery to GitHub. For a HOSTED-GitHub run (``github_repo`` set)
    push the ship ``branch`` from the clone/worktree and open a PR into the repo's ``base_ref``,
    IDEMPOTENTLY (list-open-first; a re-run reuses the PR). Records + returns ``runs.pr_url``. A
    local-brownfield / greenfield run (no ``github_repo``) is a no-op returning ``None`` — the local
    ship is unchanged.

    A FRESH installation token is minted here (the clone-time one may be expired on a long run). The
    caller finalizes ``completed`` ONLY AFTER this returns, so a push/PR failure fails the run
    VISIBLY — for a throwaway per-run clone, a commit that never reached GitHub shipped nothing, so
    this is NOT best-effort (unlike distill/ingest). Never a silent completed with no PR."""
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        github_repo = run.github_repo
        base_ref = run.base_ref
        owner_id = run.owner_id
        idea = run.idea
    if not github_repo:
        return None
    if not branch:
        raise RuntimeError(f"run {run_id}: hosted ship has no ship_branch to push")
    match = github_app.find_repo_in_installations(_owner_installation_ids(owner_id), github_repo)
    if match is None:
        raise RuntimeError(
            f"run {run_id}: github_repo {github_repo!r} is not in the owner's installations"
        )
    installation_id, _ = match
    github_app.push_branch(installation_id, github_repo, repo_dir, branch)
    title = f"Tvashtr: {idea}"[:72]
    body = f"Automated change by a Tvashtr agent team for run `{run_id}`.\n\nIdea:\n\n{idea}\n"
    pr_url = github_app.open_pull_request_idempotent(
        installation_id, github_repo, head=branch, base=base_ref or "main", title=title, body=body
    )
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == uuid.UUID(run_id)).values(pr_url=pr_url))
    return pr_url


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


@DBOS.step()
def distill_run_memory_step(run_id: str) -> None:
    """M-memory S2: distil durable memory from the finished run (the WRITE half of the memory loop).

    BEST-EFFORT — the run is ALREADY finalized when this runs, so a distillation failure must NEVER
    change the run's terminal status. All errors are caught + logged + swallowed here (even a plain
    call cannot break the workflow body). Lazy-imports ``memory_distill`` to keep the import
    surface minimal (``memory_distill`` is openhands-free, so no import-boundary concern)."""
    try:
        from tvashtr.control_plane.memory_distill import distill_run

        distill_run(run_id)
    except Exception:  # noqa: BLE001 — best-effort: a distill failure must not touch the finalized run
        logger.warning("run-end memory distillation failed run_id=%s", run_id, exc_info=True)


@DBOS.step()
def ingest_agent_remembers_step(run_id: str, workspace: str) -> None:
    """M-memory S4: ingest the run's DELIBERATE agent-remember captures from the still-on-disk
    workspace (``TVASHTR_REMEMBER.jsonl``) at run-END, routing each through Consolidate.
    Runs at the
    ship arm right after distillation, where ``workspace`` is guaranteed present (``ship_step`` just
    used it) — the local workspace dir is never deleted, and this executes before ``run_team``'s
    teardown.

    BEST-EFFORT — the run is ALREADY finalized when this runs,
    so an ingest failure must NEVER change
    the terminal status: all errors are caught + logged + swallowed here (mirrors
    :func:`distill_run_memory_step`). Lazy-imports ``memory_review`` (openhands-free) to keep the
    import surface minimal."""
    try:
        from tvashtr.control_plane.memory_review import ingest_run_remembers

        ingest_run_remembers(run_id, workspace)
    except Exception:  # noqa: BLE001 — best-effort: an ingest failure must not touch the finalized run
        logger.warning("run-end agent-remember ingest failed run_id=%s", run_id, exc_info=True)


@DBOS.step()
def close_run_sandboxes_step(run_id: str) -> None:
    """M-unify U2 run-end teardown: close + evict any process-cached sandboxes (warm docker
    containers + live Conversations) this run kept alive for per-node reuse. Engine-NEUTRAL — it
    delegates to :func:`sandbox_cache.close_run_sandboxes` (run_id in, nothing out; no engine
    internals leak) — and best-effort: the cache is a process-local OPTIMIZATION, so a
    skipped/failed teardown is harmless (backstopped by reap-before-start + the boot sweep), and a
    ``kill -9`` simply evaporates it. Called from :func:`run_team`'s ``try/finally`` around
    :func:`run_graph`, so it runs on EVERY terminal path of the walk — the scattered ``return``s AND
    the unhandled-exception path — so a warm container is never stranded on a clean run-end."""
    close_run_sandboxes(run_id)


@DBOS.step()
def suspend_fly_machine_step(run_id: str) -> bool:
    """M-h2b Piece 1: SUSPEND this run's Fly microVM before it parks at a human gate. Returns
    whether the suspend actually landed.

    A gate can hold a run for hours — park at 11pm, approve at 8am. Without this the run keeps a
    fully-billed VM alive for all nine of them. Fly *suspend* takes a Firecracker memory snapshot
    and drops the machine to STORAGE-ONLY billing; the next node's boot resumes it lazily.
    Deliberately
    **suspend, not stop**: a stopped machine is reset to its original state on restart, throwing the
    agent's whole conversation away, whereas a suspended one resumes from its snapshot.

    WHY A RECORDED ``@DBOS.step``, which is the subtle part: on a crash-replay DBOS returns this
    step's checkpointed output instead of re-executing it. So a resumed workflow does NOT re-suspend
    — which matters because the in-process handle it would have needed died with the old process.
    The durability story and the economics story stay independent of each other.

    Best-effort and **never raises**: the ``openhands``-free import discipline of this module is why
    the adapter import is function-scoped (``openhands_fly_adapter`` pulls in the agent SDK, and
    ``team_run`` must stay clean at module import), and a failure to suspend is only ever a cost, so
    it must never fail a run. Called ONLY under ``agent_sandbox_mode == "fly"`` — see the call
    sites, which is what keeps docker/local step sequences byte-identical to before."""
    try:
        from tvashtr.engines.openhands_fly_adapter import suspend_run_machine

        return suspend_run_machine(run_id)
    except Exception:  # noqa: BLE001 — an economy measure must never break a run
        DBOS.logger.warning(f"suspend_fly_machine_step failed run_id={run_id}")
        return False


def _run_end_teardown(run_id: str) -> None:
    """Close this run's process-cached sandboxes at run-end (M-unify U2). Prefer the checkpointed
    :func:`close_run_sandboxes_step`; if DBOS REFUSES it — a CANCELLED workflow raises
    ``DBOSWorkflowCancelledError``, a ``BaseException`` an ``except Exception`` CANNOT catch — fall
    back to the raw :func:`close_run_sandboxes` so a warm container is never stranded (its surviving
    cache entry would otherwise make reap-before-start keep SPARING it — only a restart's boot sweep
    clears it). NEVER raises: teardown must not mask the run's real terminal, which keeps unwinding
    out of the caller's ``finally``.

    M-clonegc: also reclaims this run's hosted-GitHub clone — a clean no-op for self-hosted /
    greenfield runs, which have no clone dir. Deliberately LAST and deliberately un-checkpointed: it
    is a plain filesystem delete, so unlike the sandbox teardown there is no DBOS step for a
    cancelled workflow to refuse, and running it after the sandbox close means a container that
    still holds the directory is gone first.

    M-wsgc: and this run's agent WORKSPACE, on the same terms and for the same reasons. It rides
    here rather than in its own hook because the ordering constraint is identical — the sandbox that
    may still hold the directory open must be closed first — and because both deletes are
    status-gated on a LIVE run, so a ``finally`` that fires mid-flight (a step raising while the row
    still reads ``running``, which DBOS may then RECOVER) spares both. Broader than the clone: every
    run has a workspace, so unlike the clone this is a no-op only for a run that never reached an
    agent step."""
    try:
        close_run_sandboxes_step(run_id)
    except BaseException:  # noqa: BLE001
        # DBOS raises DBOSWorkflowCancelledError (a BaseException) when a step runs in a cancelled
        # workflow — an ``except Exception`` would miss it and the container would leak. Do the raw
        # teardown instead; the ORIGINAL terminal still unwinds out of run_team's finally.
        try:
            close_run_sandboxes(run_id)
        except Exception:
            logger.warning("sandbox run-end teardown failed run_id=%s", run_id, exc_info=True)
    try:
        clone_reaper.delete_run_clone(run_id)
    except BaseException:  # noqa: BLE001 — belt-and-braces; delete_run_clone never raises itself
        logger.warning("clone run-end teardown failed run_id=%s", run_id, exc_info=True)
    try:
        workspace_reaper.delete_run_workspace(run_id)
    except BaseException:  # noqa: BLE001 — belt-and-braces; delete_run_workspace never raises
        logger.warning("workspace run-end teardown failed run_id=%s", run_id, exc_info=True)


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
        # M-h2b: park the hosted microVM (storage-only billing) before blocking on the human. The
        # condition lives HERE, not inside the step, so a docker/local run's recorded step sequence
        # is byte-identical to before this milestone — the step is simply absent from its walk.
        if get_settings().agent_sandbox_mode == "fly":
            suspend_fly_machine_step(run_id)
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
    over_budget / escalation-reject short-circuits to a finalize). M-unify U1 (D1 loop-always):
    ``completion`` + ``agent`` kinds now execute through the ONE unified agent path
    (:func:`agent_run_step`) — ``kind`` is vestigial for dispatch; the ONE capability distinction is
    ``edits_allowed``. An edits-OFF node (a thinker/PM) runs the full agent loop but pulls only
    REPORT.md + the verdict; the ENTRY node's REPORT.md becomes the next spec version. ``gate``
    (pause for a human, route on approve/reject) + ``terminal`` (ship+finalize ``completed``, or
    stop+finalize ``rejected``) stay DETERMINISTIC + unchanged.

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
    # scoped-mount Slice 1: the optional sub-path scope (None ⇒ whole repo; greenfield always None).
    # Read once from the recorded graph dict (replay-stable) and threaded into the grounding step +
    # the worker FOCUS directive — it scopes ONLY those two, never the worktree/mount/ship.
    subpath: str | None = graph.get("subpath")
    grounding: str | None = None

    while current is not None:
        node = nodes_by_id[current]
        kind = node["kind"]

        if kind in ("completion", "agent"):
            # M-unify U1 (D1 loop-always): the ``completion`` + ``agent`` kinds now execute through
            # the SAME agent path — ``kind`` is vestigial for dispatch. The ONE capability
            # distinction
            # is ``edits_allowed``: a thinker (the entry/PM) is an edits-OFF agent whose REPORT.md
            # becomes the spec; a worker (Engineer) is edits-ON; a reviewer is edits-ON + emitting.
            edits_allowed = node["edits_allowed"]
            # The ENTRY node (the graph root) OWNS the shared spec document: each completed
            # invocation
            # whose pull carries REPORT.md writes the NEXT spec version (D2.3) — replacing the old
            # pm_step text→doc + thinker_refine_step paths. ``current == start_id`` is recomputed
            # deterministically from recorded step outputs as the walk replays, so it is crash-safe.
            is_entry = current == start_id
            n = iters_by_node.get(current, 0) + 1
            iters_by_node[current] = n
            # Cap-guard, GATED on having an escalation edge: only a looping worker (the Engineer)
            # has
            # an ``edge_type="escalation"`` out-edge, so only it participates in the loop cap. A
            # thinker/reviewer (no escalation edge) skips it — behavior-preserving. Same
            # enforced-termination semantics as before: do NOT run an over-limit iteration.
            esc = escalation_target(edges, current)
            if esc is not None:
                limit = loop_limit_for(edges, current, get_settings().max_review_iterations)
                if n > limit:
                    current = esc
                    continue
            if workspace is None:
                # Set up the workspace ONCE, at the FIRST node the walk runs through the agent path
                # (now the entry/thinker, no longer the Engineer) — reused across the run so a
                # worker
                # reworks the prior round's files in place. Brownfield: a worktree of the real repo;
                # greenfield: the empty local workspace. (engineer_setup_step reads the Run's
                # repo_path itself, so the greenfield call site is byte-for-byte the prior one.)
                workspace = engineer_setup_step(run_id)
                # M-hostedfix: the line above is a CHECKPOINTED step — on a recovery it replays a
                # recorded PATH and never re-runs its body, so nothing has re-created the workspace
                # on this machine. Re-materialize here, outside the checkpoint, on every entry.
                ensure_run_workspace(run_id, workspace)
                if brownfield:
                    # D6: compute the repo-grounding block ONCE off the freshly-set-up worktree,
                    # recorded → replayed verbatim on resume (``subpath`` roots the outline; None ⇒
                    # whole-repo grounding, byte-for-byte unchanged).
                    grounding = brownfield_grounding_step(run_id, workspace, repo_basename, subpath)
            inv_id = open_invocation_step(run_id, current, n)
            # Per-iteration virtual key: each mint reflects the THEN-current remaining budget.
            vkey = mint_vkey_step(run_id)
            # Whether THIS is the entry's FIRST invocation (no spec yet ⇒ it CREATES the doc; a
            # later
            # entry invocation refines it). Captured BEFORE ``pm_document_id`` is reassigned below —
            # it drives the create-vs-refine dispatch AND the thinker brief at close.
            entry_was_first = is_entry and pm_document_id is None
            # M-docs: resolve this node's per-node document ROUTING off its config JSONB
            # (replay-stable off the recorded graph dict), mirroring the budget/remember resolvers
            # below. ``writes_to`` (OUTPUT doc name) is applied at the write hook after the run;
            # ``reads_from`` (INPUT doc names) drives the read here.
            writes_to = resolve_writes_to(node["config"])
            reads_from = resolve_reads_from(node["config"])
            # reads_from (INPUT): a node that declared which documents feed it reads those by
            # (run_id, name); they REPLACE the default spec/PRD part (so ``spec=None``). No
            # reads_from ⇒ P1.7a: re-source the PRD LIVE at every agent-node entry via a recorded
            # step — EXCEPT the entry's FIRST invocation, which has no spec yet (``pm_document_id is
            # None``): it CREATES the spec from its REPORT.md, so it runs with ``spec=None``.
            read_documents: list | None = None
            if reads_from:
                read_documents = read_named_documents_step(run_id, reads_from) or None
                spec = None
            else:
                spec = read_latest_prd_step(run_id) if pm_document_id is not None else None
            # Whether this node BRANCHES the walk on a routing label is a fact about the authored
            # topology (a conditional out-edge), not a role — it harvests a verdict iff ``emits``.
            emits = node_emits_outcome(edges, current)
            # M-ctx1 (C2): resolve THIS node's INPUT-token budget (setting default + optional
            # per-node override) — replay-stable off the recorded graph dict + settings.
            budget = resolve_context_budget(get_settings(), node["config"])
            # M-memory: resolve THIS node's PER-NODE agent-remember decision off its config JSONB
            # (default False; NO settings fallback — the retired global flag has zero effect). The
            # step ANDs it with edits_allowed (only an edits-on node can write the sidecar).
            # Replay-stable off the recorded graph dict.
            remember_enabled = resolve_remember_enabled(node["config"])
            # M-brownfield: thread grounding (+ sub-path) into a brownfield call; greenfield omits
            # BOTH ⇒ byte-for-byte the prior greenfield call (the existing offline suite drives it
            # UNCHANGED); whole-repo brownfield omits ``subpath`` ⇒ the prior brownfield call.
            brownfield_kwargs: dict = {}
            if grounding is not None:
                brownfield_kwargs["grounding"] = grounding
                if subpath:
                    brownfield_kwargs["subpath"] = subpath
            # M-tools C7.0: thread inline tools + skills ONLY when set (the inert path calls with
            # byte-identical args). Keys disjoint from brownfield_kwargs, so unpackings never
            # collide.
            tools_kwargs: dict = {}
            if node.get("tool_config") is not None:
                tools_kwargs["tool_config"] = node["tool_config"]
            if node.get("skills") is not None:
                tools_kwargs["skills"] = node["skills"]
            # M-memory S3: retrieve THIS node's remembered facts (best-effort, recorded step) and
            # thread them into the compiler — mirrors the grounding/PRD reads above. An empty
            # scope ⇒ [] ⇒ NO memory kwarg ⇒ the compiled instruction stays byte-identical to before
            # (the whole offline suite + every greenfield run with no seeded memory stay green). The
            # query is a compact task probe (idea + node prompt + PRD title), NOT the context.
            memory_kwargs: dict = {}
            remembered = retrieve_memory_step(
                run_id, current, n, memory_query(idea, node["prompt"], spec)
            )
            if remembered:
                memory_kwargs["memory"] = remembered
            # M-docs: thread the resolved reads_from documents ONLY when present — an empty/None
            # read set omits the kwarg ⇒ the agent_run_step call is byte-identical to today.
            docs_kwargs: dict = {}
            if read_documents:
                docs_kwargs["read_documents"] = read_documents
            # Per-node capabilities (Session A): the auto-failover slug, resolved off the SAME
            # JSONB (replay-stable off the recorded graph dict) and threaded ONLY when the node
            # authored one — an absent fallback omits the kwarg, so the call is byte-identical.
            capability_kwargs: dict = {}
            node_fallback_model = resolve_fallback_model(node["config"])
            if node_fallback_model:
                capability_kwargs["fallback_model"] = node_fallback_model
            result = agent_run_step(
                run_id,
                node["prompt"],
                node["model"],
                n,
                idea,
                spec,
                workspace,
                vkey,
                reviewer_feedback,
                emits,
                budget,
                inv_id,
                edits_allowed=edits_allowed,
                remember_enabled=remember_enabled,  # M-memory: per-node agent-remember opt-in
                node_id=current,  # M-unify U2: per-node sandbox-reuse key (run_id+node_id)
                **tools_kwargs,
                **brownfield_kwargs,
                **memory_kwargs,  # M-memory S3: the retrieved facts (absent ⇒ byte-identical call)
                **docs_kwargs,  # M-docs: the reads_from documents (absent ⇒ byte-identical call)
                **capability_kwargs,  # Session A: fallback_model (absent ⇒ byte-identical call)
            )
            delete_vkey_step(run_id, vkey)

            if result["status"] == "over_budget":
                # The proxy cut the agent off mid-call. Record whatever partial spend the cut-off
                # conversation carried (best-effort, idempotent on the per-node key), then stop.
                if result["total_tokens"] or result["cost_usd"]:
                    persist_agent_cost_step(run_id, current, node["model"], result, n, inv_id)
                close_invocation_step(
                    run_id,
                    current,
                    n,
                    "stopped",
                    "over_budget",
                    context_manifest=result.get("context_manifest"),
                )
                return _finalize_over_budget(run_id, pm_document_id)
            if result["status"] != "completed":
                # An ``over_context`` pre-call budget breach (or any engine error) lands here → the
                # run finalizes ``failed`` with the self-explaining reason. The manifest is
                # persisted
                # so the breach's part sizes are queryable off the invocation row.
                # M-fail change 4: persist the engine's ``error`` as the invocation's
                # ``outcome_detail`` so a failed node's REASON lives on the row the run inspector
                # reads — not only in the transient ``DBOS.logger.error`` line below (run 6fd2c911
                # stored no reason anywhere queryable).
                close_invocation_step(
                    run_id,
                    current,
                    n,
                    "failed",
                    None,
                    outcome_detail=result.get("error"),
                    context_manifest=result.get("context_manifest"),
                )
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

            # Meter ONLY if the node actually spent — a forced/zero-usage reviewer writes no row.
            # The per-node key (``…:agent-cost:{node_id}:{iteration}``) keeps distinct nodes' rows
            # from colliding while preserving the ``:agent-cost:%`` prefix the checkers count. NOTE
            # (M-unify U1): the ENTRY node now runs the real adapter too, so it writes its OWN
            # agent-cost row — the counts gain +1/run vs the old pm-llm-metered PM.
            if result["total_tokens"] or result["cost_usd"]:
                persist_agent_cost_step(run_id, current, node["model"], result, n, inv_id)

            # M-docs: route the node's OUTPUT to a document (its ``config["writes_to"]``).
            #  * an EMITTING node (verdict-only pull, Slice-4) + writes_to is a misconfig — it
            #    has no REPORT.md to version without WIDENING its pull scope, which would break the
            #    anti-clobber invariant — so record a RunWarning and write nothing.
            #  * the ENTRY node versions the shared spec (M-unify U1 D2.3; default name "spec", its
            #    writes_to overrides only the NAME) and OWNS ``Run.pm_document_id`` — the
            #    create-vs-refine dispatch + the fail-on-missing-REPORT.md path is byte-identical.
            #  * a NON-entry, NON-emitting node with a writes_to versions its REPORT.md into its OWN
            #    ``(run_id, name)`` doc (never touching pm_document_id); a missing REPORT.md is a
            #    RunWarning + skip (non-fatal — only the entry's spec is load-bearing enough).
            #  * NO writes_to on a non-entry node ⇒ NO document write (byte-identical to before).
            if emits and writes_to:
                record_resolution_warning(
                    run_id,
                    "document",
                    writes_to,
                    "an emitting node cannot author a document — its verdict-only pull carries no "
                    "REPORT.md; move writes_to onto a non-emitting node",
                )
            elif is_entry:
                report = result.get("report")
                if report is None:
                    # An entry invocation ending with no REPORT.md FAILS with a recorded reason (no
                    # silent empty spec version) — reusing node-failure semantics, no new routing,
                    # no
                    # crash of the workflow.
                    reason = "entry node produced no REPORT.md — no spec version written"
                    logger.warning(
                        "entry node missing REPORT.md run_id=%s node=%s iter=%s", run_id, current, n
                    )
                    close_invocation_step(
                        run_id,
                        current,
                        n,
                        "failed",
                        None,
                        outcome_detail=reason,
                        context_manifest=result.get("context_manifest"),
                    )
                    mark_run_failed_step(run_id)
                    DBOS.logger.error(f"run_team entry node produced no REPORT.md run_id={run_id}")
                    return {
                        "run_id": run_id,
                        "status": "failed",
                        "document_id": pm_document_id,
                        "error": reason,
                    }
                pm_document_id = record_entry_spec_step(
                    run_id, current, n, report, pm_document_id, name=writes_to or "spec"
                )
            elif writes_to:
                report = result.get("report")
                if report is None:
                    record_resolution_warning(
                        run_id,
                        "document",
                        writes_to,
                        "node produced no REPORT.md — nothing versioned into its writes_to doc",
                    )
                else:
                    write_named_document_step(run_id, current, n, report, writes_to)

            # Per-node capabilities (Session A) — the ADVISORY typed-output check. A COMPLETION
            # (thinker) node that authored ``config["output_schema"]`` has its output validated
            # against it, REUSING the M-rails C9 JSON-Schema-subset validator. A miss records a
            # ``RunWarning`` (surfaced in the run inspector's ``resolution_warnings``) and the walk
            # CONTINUES — v1 deliberately never fails a run on a schema result; a hard gate is the
            # separate ``output_schema_check`` GUARDRAIL node. No schema ⇒ no check ⇒ identical.
            output_schema = resolve_output_schema(node["config"])
            if output_schema is not None and kind == "completion":
                violation = _output_schema_violation(result.get("report"), output_schema)
                if violation is not None:
                    record_resolution_warning(run_id, "output_schema", node["role_name"], violation)

            # Close label + detail. Routing is UNCHANGED — a non-emitting node routes on ``None``
            # (the
            # catch-all), an emitting one on its verdict. The stored outcome/detail: the entry keeps
            # the thinker semantics (byte-stable ``prd_written`` + brief); an emitting reviewer
            # keeps
            # its verdict + reasons (byte-stable); a non-entry report-only node surfaces its report
            # (D2.4); an edits-on worker is byte-identical to before (``built`` + files-brief).
            route_label = result["outcome"]  # None for a non-emitting node → catch-all routing
            if is_entry:
                stored_outcome, detail = "prd_written", _thinker_brief(entry_was_first, n)
            elif emits:
                stored_outcome, detail = route_label or "built", result["reasons"]
            elif not edits_allowed:
                stored_outcome, detail = "reported", _report_brief(result.get("report"))
            else:
                stored_outcome = route_label or "built"
                detail = _worker_brief(result.get("files_changed", []))
            close_invocation_step(
                run_id,
                current,
                n,
                "done",
                stored_outcome,
                outcome_detail=detail,
                context_manifest=result.get("context_manifest"),
            )
            # Thread the verdict's reasons into the next agent's revision context (None for a
            # non-emitting node → the next round carries no revision block).
            reviewer_feedback = result["reasons"]
            if apply_budget_hook(run_id, node_id=current, iteration=n):
                return _finalize_over_budget(run_id, pm_document_id)
            current = next_node(edges, current, route_label)

        elif kind == "gate":
            # A checkpoint node with two dispositions on ``config.gate_kind``:
            #  * a GUARDRAIL kind (M-rails C8, e.g. ``secret_leak_scan``) runs a DETERMINISTIC
            #    content check against the run's workspace and auto-emits approved/rejected — NO
            #    human, NO ``wait_at_gate``. The verdict is a recorded step so it replays verbatim
            #    on crash-resume (no re-scan of a possibly-mutated tree).
            #  * any other / absent kind is the HUMAN-approval path (unchanged): pause on the
            #    durable recv, then route on the resolution.
            open_invocation_step(run_id, current, 1)
            cfg = node["config"] or {}
            if cfg.get("gate_kind") in GUARDRAIL_GATE_KINDS:
                verdict = guardrail_gate_step(run_id, current, cfg["gate_kind"], workspace, cfg)
                close_invocation_step(
                    run_id,
                    current,
                    1,
                    "done",
                    verdict["resolution"],
                    outcome_detail=verdict["reasons"],
                )
                current = next_node(edges, current, verdict["resolution"])
            else:
                # A human-approval checkpoint node: pause on the durable recv, then route on the
                # resolution (the node-id-scoped topic keeps concurrent gates collision-free).
                # M-h2b: suspend the hosted microVM first — this is THE gate a run sits at
                # overnight, so it is where suspend-on-gate earns its keep. Fly-mode only, checked
                # at the call site so docker/local step sequences never change.
                if get_settings().agent_sandbox_mode == "fly":
                    suspend_fly_machine_step(run_id)
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
                # M-h1b: for a HOSTED-GitHub run push the ship branch + open the PR BEFORE
                # finalizing completed — a per-run throwaway clone's commit that never reached
                # GitHub shipped nothing, so a failure here fails the run VISIBLY (naming the
                # reason), never a silent completed with no PR. A local/greenfield ship is a no-op.
                try:
                    pr_url = push_and_open_pr_step(run_id, workspace, ship.get("ship_branch"))
                except Exception as exc:  # noqa: BLE001 — surface the reason; do NOT report completed
                    reason = f"github delivery failed: {exc}"
                    mark_run_failed_step(run_id)
                    close_invocation_step(run_id, current, 1, "failed", reason)
                    DBOS.logger.error(f"run_team hosted ship failed run_id={run_id}: {reason}")
                    return {
                        "run_id": run_id,
                        "status": "failed",
                        "document_id": pm_document_id,
                        "error": reason,
                    }
                final = finalize_run_step(run_id, status="completed")
                # M-memory S2: distil durable memory from the run's own trail + outcome. Best-effort
                # — the run is already finalized ``completed`` above; the step swallows a failure
                # so distillation can never change that terminal status.
                distill_run_memory_step(run_id)
                # M-memory S4: ingest the run's deliberate agent-remember captures
                # (TVASHTR_REMEMBER.jsonl) — the workspace is still on disk here
                # (ship_step just used
                # it). Best-effort, same as distillation.
                ingest_agent_remembers_step(run_id, workspace)
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
                    # M-h1b: the opened PR url for a hosted run (None for local/greenfield).
                    "pr_url": pr_url,
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
    # M-unify U2: the SINGLE run-end teardown point. ``run_graph`` is called ONLY here, so this
    # ``try/finally`` fires the sandbox teardown on EVERY one of its terminal paths — the scattered
    # ``return``s (ship / stop / over_budget / failed) AND the unhandled-exception path (a step
    # raising propagates through here) — closing any warm docker containers this run kept for reuse.
    try:
        # M-h1b: for a HOSTED-GitHub run, clone the repo + set repo_path BEFORE load_graph_step
        # snapshots it, so the walk sees a brownfield repo_path. No-op for local/greenfield runs.
        clone_github_repo_step(run_id)
        graph = load_graph_step(run_id)
        return run_graph(run_id, graph, idea)
    finally:
        _run_end_teardown(run_id)
