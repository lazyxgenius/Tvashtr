"""SQLAlchemy ORM models for Tvashtr application tables (owned by Alembic).

DBOS manages its own system tables in a separate ``dbos`` schema; everything
here lives in ``public`` and is created by Alembic migrations.
"""

import uuid
from datetime import datetime
from decimal import Decimal

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
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


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
    __table_args__ = (UniqueConstraint("run_id", "seq", name="uq_run_events_run_seq"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    run_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
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
    __table_args__ = (UniqueConstraint("email", name="uq_users_email"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


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
