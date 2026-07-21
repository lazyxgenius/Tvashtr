"""SQLAlchemy ORM models for Tvashtr application tables (owned by Alembic).

DBOS manages its own system tables in a separate ``dbos`` schema; everything
here lives in ``public`` and is created by Alembic migrations.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    Uuid,
    false,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _edits_allowed_default_from_kind(context) -> bool:
    """M-unify U1 (migration ``0024``): the ORM insert-time default for
    ``agent_nodes.edits_allowed``
    — it MAPS ``kind`` (a worker ``agent`` is edits-ON; every other kind is edits-OFF), so any
    ``AgentNode(...)`` that omits ``edits_allowed`` derives it from the node's own kind rather than
    a
    blanket DB default (the column carries NO server default by design — see the migration). An
    EXPLICIT ``edits_allowed=`` on the construction always overrides this. Context-sensitive
    default:
    SQLAlchemy passes the pending row's parameters, so ``kind`` (always set on every insert) is
    available here."""
    return context.get_current_parameters().get("kind") == "agent"


class SpikeHelloEvent(Base):
    """One row per durable step execution in the hello_durable spike."""

    __tablename__ = "spike_hello_events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    workflow_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    step_name: Mapped[str] = mapped_column(Text, nullable=False)
    pid: Mapped[int] = mapped_column(Integer, nullable=False)
    executed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class CostRecord(Base):
    """One metered LLM call. Written via the metering helper, idempotent on
    ``idempotency_key`` so an at-least-once DBOS step re-run never double-counts.

    Token counts are always meaningful; ``cost_usd`` may legitimately be 0 on a
    free tier or when pricing for a model is unknown.
    """

    __tablename__ = "cost_records"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_cost_records_idempotency_key"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # Nullable: not every gateway call happens inside a workflow.
    workflow_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    # M-ledger C5 (migration ``0020``): the ``agent_invocations.id`` this spend belongs to — the
    # durable link that attaches each cost row to the exact node-execution that incurred it (the
    # ``/graph`` + ``/trajectory`` ledger LEFT-JOINs cost on this). Nullable + indexed; NULL for a
    # gateway call outside an invocation and every pre-0020 row. The default-``None`` write keeps
    # any non-executor caller safe.
    invocation_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    idempotency_key: Mapped[str] = mapped_column(Text, nullable=False)
    model_requested: Mapped[str] = mapped_column(Text, nullable=False)
    model_used: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Document(Base):
    """A first-class work product: an ordered chain of immutable versions."""

    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    doc_type: Mapped[str] = mapped_column(Text, nullable=False)
    # M-docs (migration ``0028``): the run this document belongs to (FK ``runs.id``,
    # ``ondelete=CASCADE`` — documents now cascade-delete with their run, closing the registered
    # orphaned-documents leak). Nullable: legacy pre-0028 documents + the ``doc_writer`` proof
    # workflow have no run (a NULL FK never cascades). Every document the executor writes — the
    # entry's default "spec" and any node's ``config["writes_to"]`` document — sets it.
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # M-docs (migration ``0028``): the document's run-scoped NAME — the second half of the
    # ``(run_id, name)`` key the executor find-or-creates on. The default document is ``"spec"``
    # (``Run.pm_document_id`` points at it); a node's ``config["writes_to"]`` authors another
    # (e.g. ``"design"``). Nullable: legacy / non-run documents have none.
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    versions: Mapped[list["DocumentVersion"]] = relationship(
        back_populates="document",
        order_by="DocumentVersion.version_no",
        cascade="all, delete-orphan",
    )


class DocumentVersion(Base):
    """One immutable snapshot of a document's content.

    ``idempotency_key`` is unique so an at-least-once step re-run returns the
    existing version rather than appending a duplicate; ``(document_id,
    version_no)`` is unique so the chain is a well-ordered sequence.
    """

    __tablename__ = "document_versions"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_document_versions_idempotency_key"),
        UniqueConstraint("document_id", "version_no", name="uq_document_versions_doc_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str] = mapped_column(Text, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    document: Mapped["Document"] = relationship(back_populates="versions")


class RunEvent(Base):
    """One normalized event from an engine run (P0.3).

    ``run_id`` is a P0.3-local identifier; the real ``Run`` entity arrives in
    P0.4. ``kind`` is the engine-neutral value (action/observation/message/error)
    and ``payload`` the normalized JSON the adapter produced. Unique
    ``(run_id, seq)`` makes re-emitting an event a no-op — the same at-least-once-
    safe convention as the metering and document-version writes.
    """

    __tablename__ = "run_events"
    __table_args__ = (
        UniqueConstraint("run_id", "invocation_id", "seq", name="uq_run_events_run_invocation_seq"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    run_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    # M-ledger C5 (migration ``0020``): the ``agent_invocations.id`` this event belongs to — the
    # durable per-node-execution join key. The event sink keys idempotency on ``(run_id,
    # invocation_id, seq)``, not ``(run_id, seq)``: each engine ``run()`` restarts ``seq`` at 0.
    # A later round's ``seq=0`` would collide with round 1's row and be dropped. Nullable +
    # indexed; NULL on every pre-0020 legacy row (Postgres treats NULLs as distinct, so the unique
    # constraint accepts them).
    invocation_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class TeamGraph(Base):
    """A team of agent nodes wired by edges (P0.4). Minimal, forward-compatible
    subset — JSONB configs and the rest arrive when the canvas needs them."""

    __tablename__ = "team_graphs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # First-class library-team identity (P1.8b team library, migration ``0013``). ``True`` rows are
    # the user's managed shelf of authored teams — the team list is ``WHERE is_library``. The
    # builders + ``clone_team_graph`` never set it, so it defaults ``False`` → run-snapshot clones,
    # A/B graphs, and smoke graphs are automatically non-library and can NEVER pollute the list.
    is_library: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )
    # M-accounts Slice B (migration ``0017``): the account that owns this team. Set on user-authored
    # LIBRARY teams (``is_library`` rows the dashboard lists per-owner); LEFT NULL on the ephemeral
    # run-snapshot clones / A-B graphs / smoke graphs (they hang off ``runs.owner_id`` and are never
    # listed). Nullable at the DB level so the additive migration applies to existing rows + the
    # pre-seed window; the application sets it on every library-team create path.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AgentNode(Base):
    """One node in a team graph. ``kind`` discriminates a direct-LLM
    ``completion`` node (PM/Reviewer) from an ``agent`` node backed by an
    ``engine``, a human-approval ``gate``, and a walk-ending ``terminal``
    (ship/stop). Gate + terminal nodes carry no ``model``/``engine`` (NULL) and a
    ``config`` jsonb (gate: ``gate_kind``/``title``/``description``; terminal:
    ``terminal_kind``) — P1.5b's uniform graph walk (migration ``0009``)."""

    __tablename__ = "agent_nodes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_graph_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team_graphs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role_name: Mapped[str] = mapped_column(Text, nullable=False)
    # "completion" | "agent" | "gate" | "terminal" (P1.5b grew the vocabulary).
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    # The node's behavior instruction (P1.8a, migration ``0012``): the static role text the
    # executor runs GENERICALLY (the executor appends the idea/PRD/revision context at run time).
    # Set for completion/agent nodes by the builders; NULL for gate/terminal nodes (no LLM) and on
    # any pre-0012 row. This RETIRES fixed-function role dispatch — ``run_graph`` runs
    # ``node.prompt`` instead of branching on ``role_name``/``config.agent_kind``.
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    # NULL for gate/terminal nodes (no LLM/engine); set for completion/agent nodes (P1.5b).
    model: Mapped[str | None] = mapped_column(Text, nullable=True)
    engine: Mapped[str | None] = mapped_column(Text, nullable=True)  # "openhands" | NULL
    position: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # Node-kind metadata (P1.5b): gate -> {gate_kind, title, description};
    # terminal -> {terminal_kind: "ship"|"stop"}; NULL for completion/agent nodes.
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Back-reference to the ORIGIN authored node this node was cloned from (M2, migration ``0014``).
    # A run executes against a clone-on-launch snapshot (``clone_team_graph``); this links each
    # clone node to the authored node it came from, so the authoring graph endpoint can read "what
    # did THIS authored node do last run" (correct even for duplicate-named nodes). A PLAIN Uuid
    # value, deliberately NOT a ``ForeignKey``: authored nodes are deletable/re-addable (P1.8d
    # topology editing), so an FK's cascade/SET-NULL coupling between the immutable snapshot and the
    # mutable authored graph is unwanted — a dangling value simply matches nothing. NULL on every
    # authored/builder node (not clones); set by ``clone_team_graph`` on each clone node.
    cloned_from_node_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    # Per-node inline tools + skills (M-tools C7.0, migration ``0021``). Both additive + nullable,
    # mirroring the ``config`` JSONB style. ``tool_config`` is the raw MCP config object
    # ``{"mcpServers": {…}}`` (NULL ⇒ no inline tools); ``skills`` is a JSON array of inline
    # skill-source objects (NULL ⇒ no skills). NULL on every node today (no UI sets them yet),
    # so the executor + adapters run byte-for-byte as before — the seam is inert until populated.
    tool_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    skills: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # M-unify U1 (migration ``0024``): the ONE capability distinction after the executor
    # unification.
    # ``True`` ⇒ a worker whose file changes are pulled to the shippable worktree; ``False`` ⇒
    # report-only (runs the full agent loop but pulls EXACTLY ``REPORT.md`` +
    # ``REVIEW_VERDICT.json``
    # — no workspace mutation leaves the sandbox). NOT NULL with NO server default: the insert-time
    # default MAPS ``kind`` (:func:`_edits_allowed_default_from_kind`) so a node's capability tracks
    # how it was authored; an explicit value (the API PATCH, ``clone_team_graph``) always wins.
    # ``kind`` stays but is now vestigial for dispatch (a later slice drops it).
    edits_allowed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=_edits_allowed_default_from_kind
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Edge(Base):
    """A directed edge between two agent nodes (e.g. PM -> Engineer work edge)."""

    __tablename__ = "edges"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_graph_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team_graphs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_nodes.id", ondelete="CASCADE"), nullable=False
    )
    target_node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_nodes.id", ondelete="CASCADE"), nullable=False
    )
    edge_type: Mapped[str] = mapped_column(Text, nullable=False)
    # Outgoing-edge routing condition (P1.5a). NULL = unconditional. A conditional
    # edge carries ``{"when": <outcome-label>}`` matched against the source node's
    # emitted outcome by the pure ``next_node`` router — this is what makes the
    # Reviewer->Engineer loop-back edge (``{"when": "changes_requested"}``) fire only
    # on that verdict, while an unconditional edge always follows.
    conditions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Run(Base):
    """One execution of a team graph against an idea. ``workflow_id`` equals
    ``str(id)`` — the DBOS workflow is started with that explicit id so
    ``DBOS.workflow_id`` is the deterministic key for all the run's writes.

    ``status`` is free Text (no enum migration). The documented vocabulary is:
    ``pending`` / ``running`` (in flight) ; ``awaiting_human`` (paused at a
    blocking gate, P1.1a) ; the terminals ``completed`` (shipped), ``failed``
    (engine error), ``rejected`` (a human rejected a gate — no ship),
    ``cancelled`` (kill switch — ``DBOS.cancel_workflow`` + this status; NOT
    resurrected by recovery), and ``over_budget`` (a human rejected a budget
    breach at a cap — no ship, P1.2)."""

    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_graph_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team_graphs.id"), nullable=False, index=True
    )
    # M-accounts Slice B (migration ``0017``): the account that owns this run. Set by ``create_run``
    # for EVERY run-creating path (UI = the current user; live scripts + offline fixtures = the
    # seeded operator) — there is no owner-less run by construction. Nullable at the DB level only
    # so the additive migration applies to a DB with pre-existing rows + a pre-seed window; the
    # executor HARD-ERRORS if it ever loads a run with ``owner_id`` NULL (never a silent ``.env``
    # fallback). Per-owner key resolution reads this to resolve THIS owner's key. DB-level NOT NULL
    # is a later hardening once all rows are backfilled.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    idea: Mapped[str] = mapped_column(Text, nullable=False)
    workflow_id: Mapped[str] = mapped_column(Text, nullable=False)
    # pending|running|awaiting_human|completed|failed|rejected|cancelled|over_budget
    status: Mapped[str] = mapped_column(Text, nullable=False)
    pm_document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id"), nullable=True
    )
    ship_commit_sha: Mapped[str | None] = mapped_column(Text, nullable=True)
    ship_tag: Mapped[str | None] = mapped_column(Text, nullable=True)
    # M-brownfield Slice 1 (migration ``0015``): the brownfield run-mode target. ``repo_path``
    # NULL ⇒ greenfield (the legacy ephemeral workspace, untouched); non-NULL ⇒ the run worked on
    # an isolated ``git worktree`` of the user's real repo. ``base_ref`` is the branch/commit the
    # worktree was cut from; ``ship_branch`` is the real branch ``tvashtr/<run_id>`` the change
    # landed on (recorded at worktree setup, surfaced on the run payload). All NULL for greenfield.
    repo_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    ship_branch: Mapped[str | None] = mapped_column(Text, nullable=True)
    # M-brownfield scoped-mount Slice 1 (migration ``0018``): an OPTIONAL sub-path that scopes a
    # BROWNFIELD run's agent CONTEXT MAP + FOCUS to one package of the repo (NOT the git mount) — so
    # the proven agent path can land a change in a large monorepo without overflowing on the
    # whole-repo structure outline. NULL ⇒ whole repo (byte-for-byte today's grounding). Non-NULL on
    # a brownfield run ⇒ the grounding outline folds from ``git ls-files <subpath>`` + a worker
    # directive, while the worktree / ship branch / root manifest line stay repo-ROOT. A greenfield
    # run (no ``repo_path``) ignores it (stored NULL).
    subpath: Mapped[str | None] = mapped_column(Text, nullable=True)
    # M-h1b (migration ``0030``): the HOSTED-GitHub run target + the opened PR url. ``github_repo``
    # is the ``owner/name`` a hosted run targets; NULL ⇒ NOT a hosted-GitHub run (every local
    # brownfield run, every greenfield run, every existing row). A durable clone step reads it and
    # SETS ``repo_path`` before ``load_graph_step`` — so a hosted run then looks like a local
    # brownfield run to the executor (the walk is never forked). ``pr_url`` is the opened PR html
    # url, set on the Ship terminal (NULL until it exists / on a non-hosted run).
    github_repo: Mapped[str | None] = mapped_column(Text, nullable=True)
    pr_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_total_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    # Per-run dollar cap (P1.2). NULL = no cap (enforcement is opt-in). The live
    # running total is a query (``metering.running_cost``), NOT a stored field —
    # ``cost_total_usd`` above stays finalize-only.
    budget_cap_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    # Set True when a human approves a budget breach ("approve = continue to
    # completion") so the rest of the run is not re-gated.
    budget_overridden: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )
    # Team A/B attributability pairing (P1.5c §14.2). ``pair_id`` ties the two runs of one
    # A/B comparison together (two runs with the same ``pair_id`` are the A/B); ``pair_label``
    # is the config side ("A"/"B"). Both NULL for an ordinary standalone run. Indexed so the
    # §14.3 comparison view can fetch a pair by ``pair_id``. The pairing is the only durable
    # state the A/B instrument adds — there is no separate pair entity in v1.
    pair_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    pair_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class EngineerRunAttempt(Base):
    """One row per *execution* of ``engineer_run_step`` (intentionally NOT
    idempotent): a crash-then-resume yields two rows with different ``pid``s —
    observable proof the coarse agent step re-ran in the restarted process
    (mirrors how the crash-demo records pids in ``spike_hello_events``)."""

    __tablename__ = "engineer_run_attempts"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    run_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    pid: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AgentInvocation(Base):
    """Per-node-execution **live state** (P1.5a): one row per ``(run, node, iteration)``
    as the executor walks the graph. ``status`` ∈ ``running|done|failed|stopped``;
    ``outcome`` is the emitted label (``built`` / a reviewer verdict / ``over_budget``),
    NULL until the node exits. ``iteration`` is the 1-based count of THIS node's
    executions in the run (PM always 1; Engineer/Reviewer increment per loop round).

    Idempotent on ``(run_id, node_id, iteration)`` — insert-on-enter, update-on-exit —
    so a crash-resume *updates* the existing row, never appends. This is the canvas's
    per-node status source (the backend now owns per-node truth). Deliberately distinct
    from :class:`EngineerRunAttempt`, which stays NON-idempotent (it exists to prove
    re-execution via distinct pids — a different job).
    """

    __tablename__ = "agent_invocations"
    __table_args__ = (
        UniqueConstraint(
            "run_id", "node_id", "iteration", name="uq_agent_invocations_run_node_iter"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    run_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    # ``index=True`` (M2, migration ``0014``): the authoring "last run" read joins
    # ``agent_invocations.node_id`` -> ``agent_nodes.id``; this FK column was unindexed before.
    node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    iteration: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)  # running|done|failed|stopped
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free-text detail behind the ``outcome`` label (P1.5c §14.3-prep, migration ``0011``).
    # NULL until/unless a close-site supplies it; only the Reviewer's successful-verdict
    # close populates it today, with ``verdict["reasons"]``. The §14.3 comparison view reads
    # this to tell the "what the review caught" story.
    outcome_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    # M-ctx1 (C2/C4, migration ``0019``): the per-worker-invocation context manifest —
    # ``{parts: [{name, tokens}], total_tokens, budget, handle_used}`` — recording the compiled
    # instruction's typed parts + their token sizes, the input-token budget the node was checked
    # against, and whether the spec was offloaded to ``SPEC.md`` (the C4 doc-handle). Written at a
    # WORKER (``agent``) node's close only; NULL for thinker/gate/terminal nodes and every pre-0019
    # row. Additive + nullable — observability for the C2 input-token budget.
    context_manifest: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class HumanTask(Base):
    """A Tasks-for-Human item created when a workflow pauses at a gate (P1.1a).

    A blocking ``gate_approval`` task pauses a run on a ``DBOS.recv(topic)`` until
    a human resolves it (approve/reject). ``run_id`` is the run's ``workflow_id``
    (== ``str(runs.id)``); it is plain Text + an index, the same convention as
    ``run_events``/``engineer_run_attempts`` (no FK).

    Unique ``(run_id, topic)`` makes gate-open idempotent: a crash-then-resume
    re-running ``open_gate_step`` returns the existing row instead of inserting a
    duplicate. The workflow's ``close_gate_step`` is the **single writer** of the
    resolution — the resolve API only signals via ``DBOS.send``.
    """

    __tablename__ = "human_tasks"
    __table_args__ = (UniqueConstraint("run_id", "topic", name="uq_human_tasks_run_topic"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    run_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(Text, nullable=False)  # e.g. "gate_approval"
    priority: Mapped[str] = mapped_column(Text, nullable=False)  # "high_blocker"|"low_nudge"
    blocking: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # The recv topic this task gates (nullable for a future non-gate nudge).
    topic: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)  # "pending"|"resolved"
    # "approved"|"rejected" (human at the gate) | "cancelled" (run cancelled under it)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class User(Base):
    """A registered account — minimal email/password identity (M-accounts Slice A, migration
    ``0016``). ``email`` is stored NORMALIZED (lower-cased + trimmed) and is unique on the stored
    value; ``password_hash`` is a bcrypt hash (see :mod:`tvashtr.auth`). This slice is identity +
    login enforcement ONLY — ownership columns (``runs``/``teams``/``provider_credentials``
    ``owner_id``) and per-user model-key resolution are LATER slices; nothing here changes how a
    run resolves its model key today."""

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        UniqueConstraint("github_user_id", name="uq_users_github_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # M-memory S4: the per-owner review-before-persist toggle (migration 0027). OFF (the default) is
    # the pre-S4 write behaviour exactly. ON routes every otherwise-``active`` memory write (the
    # run-END distilled facts AND the agent-remember captures) to ``pending_review`` instead, and
    # DEFERS any supersession until the human promotes the fact — nothing reaches ``active`` without
    # an explicit promote. Read owner-scoped at run-end distillation + in the agent-remember path.
    memory_review_mode: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )
    # M-h1a (HOSTED mode, migration 0029): the GitHub identity link for an account authenticated
    # via the GitHub App. ``github_user_id`` is GitHub's STABLE numeric user id — the find-or-link
    # key, UNIQUE so one Tvashtr account per GitHub user; nullable + Postgres-distinct-NULLs
    # so every email/password account leaves it NULL (no collision). ``github_login`` is the
    # display handle. Both NULL on every self-hosted account — the password path is unchanged, and a
    # GitHub account carries a placeholder ``password_hash`` (it can never password-login).
    github_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    github_login: Mapped[str | None] = mapped_column(Text, nullable=True)


class ProviderCredential(Base):
    """One account's BYOK provider key, encrypted at rest (M-accounts Slice B, migration ``0017``).

    ``provider`` is the canonical leading-slug segment of a model id (e.g. ``openrouter`` from
    ``openrouter/openai/gpt-4o-mini``; ``nvidia_nim`` from ``nvidia_nim/meta/llama-…``) — the SAME
    mapping the resolver + the gateway's litellm provider detection use, so one key serves both the
    completion (gateway) and agent (adapter) paths. ``secret_encrypted`` is the Fernet
    ciphertext (ASCII) of the plaintext key — decrypted only at run time (see
    :mod:`tvashtr.control_plane.credentials`); the plaintext is NEVER stored or returned by any
    endpoint. ``key_last4`` is the display-only tail (``provider · •••• last4``). Unique
    ``(owner_id, provider)`` — one key per provider per account; add is an upsert/replace. The
    operator's ``.env`` keys are imported once into THEIR rows by the seed (Slice B), after which
    nothing reads ``.env`` provider keys at run time."""

    __tablename__ = "provider_credentials"
    __table_args__ = (
        UniqueConstraint("owner_id", "provider", name="uq_provider_credentials_owner_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    key_last4: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class GithubInstallation(Base):
    """One GitHub App installation linked to an account (M-h1a, migration ``0029``).

    A row records that ``owner_id`` (a Tvashtr account) installed the GitHub App as
    ``installation_id`` (GitHub's globally-unique numeric installation id). It holds NO secret:
    installation ACCESS tokens are minted on demand from the app JWT and cached in-process only
    (see :mod:`tvashtr.control_plane.github_app`), NEVER persisted — the only stored GitHub datum is
    this non-secret numeric id. ``installation_id`` is UNIQUE (one owner per installation). This is
    the owner-scoping anchor for ``GET /api/github/repos``: that query ANDs
    ``owner_id == <current user>`` so account A can never see account B's installations or repos.
    Mirrors the owner-scoped shape of :class:`ProviderCredential`, minus the secret column."""

    __tablename__ = "github_installations"
    __table_args__ = (
        UniqueConstraint("installation_id", name="uq_github_installations_installation_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    installation_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class McpSecret(Base):
    """One account's MCP ``${NAME}`` secret, encrypted at rest (M-tools C7.A, migration ``0022``).

    Mirrors :class:`ProviderCredential`: ``secret_encrypted`` is the Fernet ciphertext of the
    plaintext value — decrypted only at run time (see :mod:`tvashtr.control_plane.mcp_secrets`); the
    plaintext is NEVER stored or returned by any endpoint. A node's ``tool_config`` holds only
    a ``${NAME}`` reference; this table holds the value it points at. Unique ``(owner_id, name)`` —
    one value per name per account; add is an upsert/replace."""

    __tablename__ = "mcp_secrets"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_mcp_secrets_owner_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class RunWarning(Base):
    """A run-scoped resolution warning (M-tools C7.A, migration ``0022``): a tool/skill source that
    FAILED to resolve at run time (missing secret, unreachable repo, MCP connect fail) and was
    SKIPPED (the run continued). Surfaced in the run inspector via
    ``GET /api/runs/{run_id}/graph``'s ``resolution_warnings`` array. ``source_kind`` is
    ``"tool"`` | ``"skill"``; the recorder de-dupes on (run_id, source_kind, name, reason)."""

    __tablename__ = "run_warnings"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_kind: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RunArtifact(Base):
    """A GREENFIELD run's shipped diff, snapshotted DURABLY at ship time (M-wsgc S1, migration
    ``0031``). One row per run (``run_id`` is UNIQUE), written by ``team_run.ship_step`` right after
    ``idempotent_ship``, while the workspace still exists.

    ``files`` holds the whole ``run_diff.compute_run_diff`` result dict —
    ``{run_id, base_ref, ship_branch, files, total}`` — so the run view's "Changes" tab can be
    served from the database VERBATIM once the workspace directory is gone. That is the point:
    before this table a greenfield workspace could never be reclaimed, because the directory *was*
    the deliverable (``idempotent_ship`` commits + tags inside its own git repo and there is no
    remote, and ``run_diff._greenfield_files`` read the tab out of it). PERSIST-THEN-REAP replaces
    "spared forever" with "spared until its artifact is persisted": the existence of this row is
    exactly what licenses :func:`~tvashtr.control_plane.workspace_reaper._spared_run_ids` to let the
    directory go.

    So the row is the LOAD-BEARING half of a hard invariant — *a greenfield workspace is never
    reaped before its diff is durably saved here*. Two consequences follow, and both are relied on:

    * **Only greenfield runs ever get a row.** A brownfield/hosted run's deliverable is the
      ``tvashtr/<run_id>`` branch in the user's real repo, which this table has nothing to do with;
      its workspace was always a disposable checkout. The writer gates strictly on
      ``runs.repo_path IS NULL``.
    * **Absence is the SAFE state.** A run that never shipped, or whose snapshot could not be
      written, simply has no row — and is therefore still spared, exactly as before this table
      existed. Nothing degrades toward destroying an un-persisted deliverable."""

    __tablename__ = "run_artifacts"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    files: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ToolLibraryItem(Base):
    """One account's reusable MCP server (M-tools C7.C, migration ``0023``).

    A library **Tool** is ONE MCP server: ``name`` (the ``mcpServers`` key) + ``server_config``
    (the value under that key — ``{command,args,env}`` stdio or ``{url,headers,type}`` http/sse). A
    node REFERENCES it by id via a list at ``tool_config.tvashtr.library``; the resolver
    (:mod:`tvashtr.control_plane.node_library`) fetches the content FRESH at run time and merges it
    with the node's inline ``mcpServers`` (inline WINS on a name collision). Unique ``(owner_id,
    name)`` — one server per name per account; add = upsert/replace. Mirrors :class:`McpSecret` /
    :class:`ProviderCredential`, but its content IS returned by the endpoints (it is editable, not a
    credential)."""

    __tablename__ = "tool_library"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_tool_library_owner_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    server_config: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class SkillLibraryItem(Base):
    """One account's reusable skill (M-tools C7.C, migration ``0023``).

    A library **Skill** is ONE named skill source: ``name`` (display label) + ``source`` (one C7.B
    source object — inline/repo/project_rules). A node
    REFERENCES it via a ``{"type":"library","id":…}`` element in its ``skills`` list; the resolver
    fetches the source FRESH at run time, resolves it ONE level, and de-dups the final
    skill list by name (first-in-list wins). Unique ``(owner_id, name)``. Mirrors
    :class:`ToolLibraryItem`."""

    __tablename__ = "skill_library"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_skill_library_owner_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class NodeMemory(Base):
    """One owner-scoped agentic-memory fact (M-memory S1, migration ``0025``) — the persistent,
    cross-run recall the later slices distil into (S2) and inject from (S3). The THIRD legibility
    layer: the shared spec + the per-node work-brief are human-facing; this is the node's own
    AGENT-facing memory.

    **Tier** is DERIVED from which scoping columns are set (see
    :func:`tvashtr.control_plane.memory.memory_tier`), NOT stored:

    * ``repo_key`` SET, ``node_id`` NULL  → **repo** (shared across every node on that repo — the
      proven default).
    * ``repo_key`` SET, ``node_id`` SET   → **node** (only that authored origin node — the Tvashtr
      differentiator).
    * ``repo_key`` NULL, ``node_id`` NULL → **account** (cross-repo prefs for the owner).
    * ``repo_key`` NULL, ``node_id`` SET  → **invalid** (rejected at the API).

    ``repo_key`` is the repo identity — today the run's ``repo_path`` string (single-operator).
    ``node_id`` is a PLAIN uuid (NOT a FK) — the authored origin node's identity (via
    ``agent_nodes.cloned_from_node_id``), because authored nodes are deletable/re-addable, so a
    dangling value must simply match nothing (mirrors why ``cloned_from_node_id`` is a plain uuid).

    Bi-temporal / provenance columns are the substrate S2/S4 write (supersede-not-delete): S1 only
    ever writes ``status='active'``, ``invalid_at=NULL``, ``superseded_by=NULL``,
    ``confirmation_count=1`` and populates ``embedding`` on create. ``embedding`` is NULLABLE so a
    row can exist pre-embed / on an embed failure, but the S1 create path always fills it."""

    __tablename__ = "node_memories"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # NULL => account tier. The repo identity (today = the run's ``repo_path``).
    repo_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    # PLAIN uuid, NOT a FK — the authored origin node; a dangling value matches nothing.
    node_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # The fact's directive FORCE (M-memory S1b, migration 0026) — one of: require (MUST) /
    # prefer (SHOULD) / allow (MAY) / context (neutral fact, no directive — the DEFAULT) /
    # avoid (SHOULD NOT) / forbid (MUST NOT). A CHECK constraint restricts the DB to these 6.
    polarity: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'context'"), default="context"
    )
    # 1536 = text-embedding-3-small's dimension; the dimension is PINNED here + in migration 0025.
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    valid_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # NULL => currently valid; set => superseded/retired (S2/S4 write it; S1 leaves NULL).
    invalid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The row that replaced this one (S2 writes it). PLAIN uuid, self-referential, no FK.
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    # A trust/ranking signal (S2 bumps it on a re-confirmation).
    confirmation_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1"), default=1
    )
    # Provenance — NULL for a manual add; S2 sets these to the distilling run/invocation.
    source_run_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_invocation_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # A pinned fact is "hot" — always injected later (S3), never filtered by top-K retrieval.
    pinned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )
    # 'active' / 'superseded' / 'pending_review'. S1 writes only 'active'; S4 uses 'pending_review'.
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'active'"), default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
