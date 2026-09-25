"""Per-account reusable Tools + Skills LIBRARY store + resolver-facing fetch (M-tools C7.C).

The account library that lets a user define an MCP server (a "tool") or a skill source ONCE and
REFERENCE it from any node — by id, stored INSIDE the node's existing ``tool_config``/``skills`` (NO
new node column). This module owns:

* the owner-scoped CRUD the ``/api/tool-library`` + ``/api/skill-library`` endpoints call, and
* the resolver-facing FETCH the two resolvers (:mod:`node_tools`, :mod:`node_skills`) call to
  expand a node's referenced ids into fresh content at run time.

A reference is LIVE, never a snapshot: the node stores only the id; :func:`resolve_owner_tool` /
:func:`resolve_owner_skill_source` read the CURRENT content each run, so editing an item in its
shelf propagates to every referencing node's next run. A ref that no longer exists (or is not
the owner's) returns ``None`` — the caller SKIPS it + records a warning; the run continues.

Revamp (B-TOOLKIT): deleting an item also strips its refs from the owner's library-team agents, a
tool rename carries each agent's on/off switch to the new name, and a name clash raises
:class:`ToolNameTaken` / :class:`SkillNameTaken` instead of an unhandled unique-key error. The
node-side JSONB edits live in :mod:`tool_usage` (imported function-locally — it imports this
module).

Openhands-free + litellm-free at import (only ``uuid`` + sqlalchemy + the app's own modules), so
``node_tools`` / ``node_skills`` (and thus ``team_run``) import it without breaching the boundary.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from tvashtr.db import session_scope
from tvashtr.models import Run, SkillLibraryItem, ToolLibraryItem


class ToolNameTaken(Exception):
    """The owner already has a library tool with this name (``uq_tool_library_owner_name``)."""

    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.name = name


class SkillNameTaken(Exception):
    """The owner already has a library skill with this name (``uq_skill_library_owner_name``)."""

    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.name = name


def _as_uuid(value: object) -> uuid.UUID | None:
    """Best-effort parse of a library-item id (a JSON string on a node, or an API path param) into a
    ``UUID`` — ``None`` on anything unparseable, so a garbage/absent ref resolves to a skip."""
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def owner_for_run(run_id: str) -> uuid.UUID | None:
    """The run's owner (``select(Run.owner_id).where(Run.id == run_id)``), or ``None`` when the
    run/owner is absent or ``run_id`` is unparseable. Shared by both resolvers so neither duplicates
    the lookup; resolved lazily (only when a node actually references a library item)."""
    rid = _as_uuid(run_id)
    if rid is None:
        return None
    with session_scope() as session:
        return session.execute(select(Run.owner_id).where(Run.id == rid)).scalar_one_or_none()


# ---- tool_library: one account's reusable MCP servers


def list_owner_tools(owner_id: uuid.UUID) -> list[dict]:
    """The owner's library tools as ``{id, name, server_config, created_at, updated_at}`` dicts,
    oldest first. UNLIKE a secret, a library item's content IS returned (it is editable, not a
    credential)."""
    with session_scope() as session:
        rows = (
            session.execute(
                select(ToolLibraryItem)
                .where(ToolLibraryItem.owner_id == owner_id)
                .order_by(ToolLibraryItem.created_at, ToolLibraryItem.name)
            )
            .scalars()
            .all()
        )
        return [
            {
                "id": r.id,
                "name": r.name,
                "server_config": r.server_config,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            }
            for r in rows
        ]


def create_owner_tool(
    owner_id: uuid.UUID, name: str, server_config: dict, *, on_conflict: str = "replace"
) -> uuid.UUID:
    """Create the owner's ``name`` library tool. With ``on_conflict="replace"`` (the default) an
    existing tool of that name has its config REPLACED (upsert on ``(owner_id, name)`` — mirrors
    :func:`set_owner_mcp_secret`); with ``"error"`` it raises :class:`ToolNameTaken` instead (the
    create-only ``POST /api/tool-library``). Returns the row id."""
    with session_scope() as session:
        existing = session.execute(
            select(ToolLibraryItem).where(
                ToolLibraryItem.owner_id == owner_id, ToolLibraryItem.name == name
            )
        ).scalar_one_or_none()
        if existing is not None:
            if on_conflict == "error":
                raise ToolNameTaken(name)
            existing.server_config = server_config
            session.flush()
            return existing.id
        item = ToolLibraryItem(owner_id=owner_id, name=name, server_config=server_config)
        session.add(item)
        try:
            session.flush()
        except IntegrityError:
            raise ToolNameTaken(name) from None  # a concurrent create won the unique key
        return item.id


def update_owner_tool(owner_id: uuid.UUID, item_id: object, name: str, server_config: dict) -> bool:
    """Update the owner's library tool BY id (name + config). Owner-scoped: ``False`` if the id is
    unparseable / not a row / not the owner's (the endpoint 404s), ``True`` on success. Renaming
    onto another tool's name raises :class:`ToolNameTaken`; a rename also moves each referencing
    agent's ``tvashtr.servers[<old>]`` on/off switch to the new name (the switch is keyed by
    name)."""
    rid = _as_uuid(item_id)
    if rid is None:
        return False
    with session_scope() as session:
        row = session.execute(
            select(ToolLibraryItem).where(
                ToolLibraryItem.id == rid, ToolLibraryItem.owner_id == owner_id
            )
        ).scalar_one_or_none()
        if row is None:
            return False
        if name != row.name:
            clash = session.execute(
                select(ToolLibraryItem.id).where(
                    ToolLibraryItem.owner_id == owner_id,
                    ToolLibraryItem.name == name,
                    ToolLibraryItem.id != rid,
                )
            ).first()
            if clash is not None:
                raise ToolNameTaken(name)
            from tvashtr.control_plane import tool_usage

            tool_usage.carry_tool_switch(session, owner_id, row.id, row.name, name)
        row.name = name
        row.server_config = server_config
        try:
            session.flush()
        except IntegrityError:
            raise ToolNameTaken(name) from None
        return True


def delete_owner_tool(owner_id: uuid.UUID, item_id: object) -> int:
    """Remove the owner's library tool by id (idempotent + owner-scoped — an absent/foreign id is a
    no-op) AND, in the same transaction, strip its ref + on/off switch from every one of the
    owner's library-team agents so none keeps a dangling id. Returns how many agents were using
    it."""
    rid = _as_uuid(item_id)
    if rid is None:
        return 0
    with session_scope() as session:
        row = session.execute(
            select(ToolLibraryItem).where(
                ToolLibraryItem.id == rid, ToolLibraryItem.owner_id == owner_id
            )
        ).scalar_one_or_none()
        if row is None:
            return 0
        from tvashtr.control_plane import tool_usage

        removed = tool_usage.strip_tool_refs(session, owner_id, row.id, row.name)
        session.delete(row)
        return removed


def resolve_owner_tool(owner_id: uuid.UUID, item_id: object) -> tuple[str, dict] | None:
    """The referenced tool's ``(name, server_config)`` fetched FRESH (LIVE), or ``None``
    when the id is absent / unparseable / not the owner's — the resolver then SKIPS + warns."""
    rid = _as_uuid(item_id)
    if rid is None:
        return None
    with session_scope() as session:
        row = session.execute(
            select(ToolLibraryItem).where(
                ToolLibraryItem.id == rid, ToolLibraryItem.owner_id == owner_id
            )
        ).scalar_one_or_none()
    if row is None:
        return None
    return row.name, row.server_config


# ---- skill_library: one account's reusable skill sources


def list_owner_skills(owner_id: uuid.UUID) -> list[dict]:
    """The owner's library skills as ``{id, name, source, created_at, updated_at}`` dicts, oldest
    first."""
    with session_scope() as session:
        rows = (
            session.execute(
                select(SkillLibraryItem)
                .where(SkillLibraryItem.owner_id == owner_id)
                .order_by(SkillLibraryItem.created_at, SkillLibraryItem.name)
            )
            .scalars()
            .all()
        )
        return [
            {
                "id": r.id,
                "name": r.name,
                "source": r.source,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            }
            for r in rows
        ]


def create_owner_skill(
    owner_id: uuid.UUID, name: str, source: dict, *, on_conflict: str = "replace"
) -> uuid.UUID:
    """Create the owner's ``name`` library skill. ``on_conflict="replace"`` (the default) REPLACES
    an existing skill's source (upsert on ``(owner_id, name)``); ``"error"`` raises
    :class:`SkillNameTaken` (the create-only ``POST /api/skill-library``)."""
    with session_scope() as session:
        existing = session.execute(
            select(SkillLibraryItem).where(
                SkillLibraryItem.owner_id == owner_id, SkillLibraryItem.name == name
            )
        ).scalar_one_or_none()
        if existing is not None:
            if on_conflict == "error":
                raise SkillNameTaken(name)
            existing.source = source
            session.flush()
            return existing.id
        item = SkillLibraryItem(owner_id=owner_id, name=name, source=source)
        session.add(item)
        try:
            session.flush()
        except IntegrityError:
            raise SkillNameTaken(name) from None
        return item.id


def update_owner_skill(owner_id: uuid.UUID, item_id: object, name: str, source: dict) -> bool:
    """Update the owner's library skill BY id (name + source). Owner-scoped — see
    :func:`update_owner_tool`. Renaming onto another skill's name raises :class:`SkillNameTaken`
    (it used to 500 on the unique key)."""
    rid = _as_uuid(item_id)
    if rid is None:
        return False
    with session_scope() as session:
        row = session.execute(
            select(SkillLibraryItem).where(
                SkillLibraryItem.id == rid, SkillLibraryItem.owner_id == owner_id
            )
        ).scalar_one_or_none()
        if row is None:
            return False
        if name != row.name:
            clash = session.execute(
                select(SkillLibraryItem.id).where(
                    SkillLibraryItem.owner_id == owner_id,
                    SkillLibraryItem.name == name,
                    SkillLibraryItem.id != rid,
                )
            ).first()
            if clash is not None:
                raise SkillNameTaken(name)
        row.name = name
        row.source = source
        try:
            session.flush()
        except IntegrityError:
            raise SkillNameTaken(name) from None
        return True


def delete_owner_skill(owner_id: uuid.UUID, item_id: object) -> int:
    """Remove the owner's library skill by id (idempotent + owner-scoped) AND, in the same
    transaction, strip its ``{"type":"library","id":…}`` refs from the owner's library-team agents
    (no "(removed from library)" leftovers). Returns how many agents referenced it."""
    rid = _as_uuid(item_id)
    if rid is None:
        return 0
    with session_scope() as session:
        row = session.execute(
            select(SkillLibraryItem).where(
                SkillLibraryItem.id == rid, SkillLibraryItem.owner_id == owner_id
            )
        ).scalar_one_or_none()
        if row is None:
            return 0
        from tvashtr.control_plane import tool_usage

        removed = tool_usage.strip_skill_refs(session, owner_id, row.id)
        session.delete(row)
        return removed


def resolve_owner_skill_source(owner_id: uuid.UUID, item_id: object) -> dict | None:
    """The referenced skill's ``source`` object fetched FRESH (the LIVE reference), or ``None`` when
    absent / unparseable / not the owner's — the resolver then SKIPS + warns."""
    rid = _as_uuid(item_id)
    if rid is None:
        return None
    with session_scope() as session:
        row = session.execute(
            select(SkillLibraryItem).where(
                SkillLibraryItem.id == rid, SkillLibraryItem.owner_id == owner_id
            )
        ).scalar_one_or_none()
    if row is None:
        return None
    return row.source
