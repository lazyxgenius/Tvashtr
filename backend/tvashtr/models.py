"""SQLAlchemy ORM models for Tvashtr application tables (owned by Alembic).

DBOS manages its own system tables in a separate ``dbos`` schema; everything
here lives in ``public`` and is created by Alembic migrations.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    Uuid,
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AgentNode(Base):
    """One node in a team graph. ``kind`` discriminates a direct-LLM
    ``completion`` node (PM) from an ``agent`` node backed by an ``engine``."""

    __tablename__ = "agent_nodes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_graph_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team_graphs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role_name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)  # "completion" | "agent"
    model: Mapped[str] = mapped_column(Text, nullable=False)
    engine: Mapped[str | None] = mapped_column(Text, nullable=True)  # "openhands" | NULL
    position: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Run(Base):
    """One execution of a team graph against an idea. ``workflow_id`` equals
    ``str(id)`` — the DBOS workflow is started with that explicit id so
    ``DBOS.workflow_id`` is the deterministic key for all the run's writes."""

    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_graph_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team_graphs.id"), nullable=False, index=True
    )
    idea: Mapped[str] = mapped_column(Text, nullable=False)
    workflow_id: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)  # pending|running|completed|failed
    pm_document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id"), nullable=True
    )
    ship_commit_sha: Mapped[str | None] = mapped_column(Text, nullable=True)
    ship_tag: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_total_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
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
