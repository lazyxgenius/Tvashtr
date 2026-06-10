"""SQLAlchemy ORM models for Tvashtr application tables (owned by Alembic)."""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Identity, Integer, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


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
