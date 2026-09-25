"""Toolkit logic for the revamp (B-TOOLKIT): tool/skill/secret items with status and usage, name
rules, create-only writes, duplicate/import, the nav summary and the GitHub App status.

The HTTP layer (``routes/toolkit.py`` and the tool/skill/secret endpoints in ``routers.py``) stays
thin: every rule lives here and a violation raises :class:`ToolkitError`, which carries the HTTP
status and the user-facing ``detail`` the route turns into an ``HTTPException``.

Openhands-free at import (sqlalchemy + the app's own modules only).
"""

from __future__ import annotations

import copy
import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tvashtr.control_plane import mcp_secrets, node_library, tool_usage
from tvashtr.control_plane.node_library import _as_uuid
from tvashtr.control_plane.node_tools import _secret_refs
from tvashtr.db import session_scope
from tvashtr.models import McpSecret, NodeMemory, SkillLibraryItem, ToolLibraryItem

TOOL_NOT_FOUND = "tool not found in your library"
SKILL_NOT_FOUND = "skill not found in your library"


class ToolkitError(Exception):
    """A rule violation with the HTTP status + ``detail`` (a user-facing string, or a dict for the
    multi-item endpoints) the route returns verbatim."""

    def __init__(self, status_code: int, detail: str | dict) -> None:
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


# ---- tool status (secrets + connection shape) ----------------------------------------------------


def server_config_error(server_config: object) -> str | None:
    """Why a server config can't connect, or ``None`` when it is well-formed: exactly one of a
    non-empty ``command`` string or an http(s) ``url``; ``args`` a list of strings; ``env`` and
    ``headers`` objects."""
    if not isinstance(server_config, dict):
        return "Add a command or a URL."
    command = server_config.get("command")
    url = server_config.get("url")
    has_command = isinstance(command, str) and bool(command.strip())
    has_url = isinstance(url, str) and bool(url.strip())
    if has_command and has_url:
        return "Use a command or a URL, not both."
    if not has_command and not has_url:
        return "Add a command or a URL."
    if has_url and not url.strip().lower().startswith(("http://", "https://")):
        return "Use an http:// or https:// URL."
    args = server_config.get("args")
    if args is not None and (
        not isinstance(args, list) or not all(isinstance(a, str) for a in args)
    ):
        return "Arguments must be a list of strings."
    for block, label in (("env", "Environment"), ("headers", "Headers")):
        value = server_config.get(block)
        if value is not None and not isinstance(value, dict):
            return f"{label} must be an object of names and values."
    return None


def secret_refs(server_config: object) -> list[str]:
    """Every ``${NAME}`` a server resolves at run time (only ``env``/``headers`` values — the same
    rule as ``node_tools``), sorted."""
    return sorted(_secret_refs(server_config)) if isinstance(server_config, dict) else []


def tool_status(server_config: object, secret_names: set[str]) -> dict:
    """``{secret_refs, missing_secrets, status}`` for one tool: ``needs_attention`` when a
    referenced secret has no stored value or the config can't connect (no command or URL)."""
    refs = secret_refs(server_config)
    missing = [n for n in refs if n not in secret_names]
    ok = not missing and server_config_error(server_config) is None
    return {
        "secret_refs": refs,
        "missing_secrets": missing,
        "status": "ready" if ok else "needs_attention",
    }


def owner_secret_names(session: Session, owner_id: uuid.UUID) -> set[str]:
    return set(
        session.execute(select(McpSecret.name).where(McpSecret.owner_id == owner_id)).scalars()
    )


def missing_secrets(tools: list[ToolLibraryItem], secret_names: set[str]) -> dict[str, list[dict]]:
    """``{NAME: [{id, name}…]}`` — every ``${NAME}`` referenced by a library tool that has no
    stored value, with the tools that reference it (tool name order)."""
    missing: dict[str, list[dict]] = {}
    for tool in sorted(tools, key=lambda t: t.name):
        for ref in secret_refs(tool.server_config):
            if ref not in secret_names:
                missing.setdefault(ref, []).append({"id": str(tool.id), "name": tool.name})
    return dict(sorted(missing.items()))


# ---- lookups -------------------------------------------------------------------------------------


def get_owner_tool_row(session: Session, owner_id: uuid.UUID, tool_id: object) -> ToolLibraryItem:
    """The owner's tool row, or a 404 :class:`ToolkitError` (unparseable / absent / foreign)."""
    rid = _as_uuid(tool_id)
    row = (
        session.execute(
            select(ToolLibraryItem).where(
                ToolLibraryItem.id == rid, ToolLibraryItem.owner_id == owner_id
            )
        ).scalar_one_or_none()
        if rid is not None
        else None
    )
    if row is None:
        raise ToolkitError(404, TOOL_NOT_FOUND)
    return row


def get_owner_skill_row(
    session: Session, owner_id: uuid.UUID, skill_id: object
) -> SkillLibraryItem:
    """The owner's skill row, or a 404 :class:`ToolkitError`."""
    rid = _as_uuid(skill_id)
    row = (
        session.execute(
            select(SkillLibraryItem).where(
                SkillLibraryItem.id == rid, SkillLibraryItem.owner_id == owner_id
            )
        ).scalar_one_or_none()
        if rid is not None
        else None
    )
    if row is None:
        raise ToolkitError(404, SKILL_NOT_FOUND)
    return row


# ---- tools ---------------------------------------------------------------------------------------

TOOL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
TOOL_NAME_RULE = "Use lowercase letters, numbers, - and _, like my-server."
TOOL_IMPORT_CONFLICTS = ("error", "replace", "rename")


def tool_name_taken(name: str) -> str:
    return f"You already have a tool named {name}."


def check_tool_name(name: str) -> str:
    """The trimmed name, or a 422 :class:`ToolkitError` when it breaks the rule (agents see this
    name as the MCP server key)."""
    name = (name or "").strip()
    if not name:
        raise ToolkitError(422, "A tool name is required.")
    if not TOOL_NAME_RE.match(name):
        raise ToolkitError(422, TOOL_NAME_RULE)
    return name


def check_server_config(server_config: object) -> dict:
    """The config, or a 422 :class:`ToolkitError` with the reason it can't connect."""
    reason = server_config_error(server_config)
    if reason is not None:
        raise ToolkitError(422, reason)
    return server_config  # type: ignore[return-value]


def tool_item(row: ToolLibraryItem, secret_names: set[str], users: list[dict]) -> dict:
    """One tool as every tool endpoint returns it (the legacy ``{id, name, server_config,
    created_at}`` plus status and usage)."""
    agent_count, team_count = tool_usage.usage_counts(users)
    return {
        "id": str(row.id),
        "name": row.name,
        "server_config": row.server_config,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
        **tool_status(row.server_config, secret_names),
        "used_by": {"agent_count": agent_count, "team_count": team_count},
    }


def _owner_tools(session: Session, owner_id: uuid.UUID) -> list[ToolLibraryItem]:
    return list(
        session.execute(
            select(ToolLibraryItem)
            .where(ToolLibraryItem.owner_id == owner_id)
            .order_by(ToolLibraryItem.created_at, ToolLibraryItem.name)
        ).scalars()
    )


def list_tools(owner_id: uuid.UUID) -> list[dict]:
    """The owner's tools, oldest first (the legacy order; the UI sorts by name)."""
    with session_scope() as session:
        names = owner_secret_names(session, owner_id)
        usage = tool_usage.tool_usage(session, owner_id)
        return [tool_item(t, names, usage.get(t.id, [])) for t in _owner_tools(session, owner_id)]


def get_tool(owner_id: uuid.UUID, tool_id: object, *, with_agents: bool = False) -> dict:
    """One tool (404 when not the owner's). ``with_agents`` adds ``used_by_agents`` — the rows
    behind ``used_by`` (``GET /api/tool-library/{id}``)."""
    with session_scope() as session:
        row = get_owner_tool_row(session, owner_id, tool_id)
        users = tool_usage.tool_usage(session, owner_id).get(row.id, [])
        item = tool_item(row, owner_secret_names(session, owner_id), users)
        if with_agents:
            item["used_by_agents"] = users
        return item


def create_tool(owner_id: uuid.UUID, name: str, server_config: object) -> dict:
    """Create-only ``POST /api/tool-library``: 422 on the name rule or a config that can't connect,
    409 when the name is taken. Returns the full item."""
    name = check_tool_name(name)
    config = check_server_config(server_config)
    try:
        tool_id = node_library.create_owner_tool(owner_id, name, config, on_conflict="error")
    except node_library.ToolNameTaken:
        raise ToolkitError(409, tool_name_taken(name)) from None
    return get_tool(owner_id, tool_id)


def update_tool(
    owner_id: uuid.UUID, tool_id: object, name: str | None, server_config: object | None
) -> dict:
    """``PATCH /api/tool-library/{id}`` with a partial body. A new name follows the create rules
    (an unchanged legacy name is allowed); a clash is 409; a rename carries each agent's on/off
    switch. Returns the full item (``used_by.agent_count`` feeds "N agents use the new
    settings")."""
    with session_scope() as session:
        row = get_owner_tool_row(session, owner_id, tool_id)
        current_name, current_config, rid = row.name, row.server_config, row.id
    new_name = current_name
    if name is not None and name.strip() != current_name:
        new_name = check_tool_name(name)
    new_config = current_config if server_config is None else check_server_config(server_config)
    try:
        if not node_library.update_owner_tool(owner_id, rid, new_name, new_config):
            raise ToolkitError(404, TOOL_NOT_FOUND)
    except node_library.ToolNameTaken:
        raise ToolkitError(409, tool_name_taken(new_name)) from None
    return get_tool(owner_id, rid)


def delete_tool(owner_id: uuid.UUID, tool_id: object) -> dict:
    """Delete a tool and strip it from every agent (idempotent). ``{removed_from_agents}``."""
    return {"removed_from_agents": node_library.delete_owner_tool(owner_id, tool_id)}


def free_name(base: str, taken: set[str], suffix: str = "copy") -> str:
    """The first of ``<base>-<suffix>``, ``<base>-<suffix>-2``, … not in ``taken``."""
    candidate = f"{base}-{suffix}"
    n = 2
    while candidate in taken:
        candidate = f"{base}-{suffix}-{n}"
        n += 1
    return candidate


def duplicate_tool(owner_id: uuid.UUID, tool_id: object) -> dict:
    """``POST /api/tool-library/{id}/duplicate``: a copy named ``<name>-copy`` (then ``-copy-2``…)
    with the same config and no agents (refs are not copied)."""
    with session_scope() as session:
        row = get_owner_tool_row(session, owner_id, tool_id)
        taken = {t.name for t in _owner_tools(session, owner_id)}
        copy_row = ToolLibraryItem(
            owner_id=owner_id,
            name=free_name(row.name, taken),
            server_config=copy.deepcopy(row.server_config),
        )
        session.add(copy_row)
        session.flush()
        new_id = copy_row.id
    return get_tool(owner_id, new_id)


def _plural_names(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def import_tools(owner_id: uuid.UUID, servers: object, on_conflict: str) -> dict:
    """``POST /api/tool-library/import`` — add N servers from a pasted mcp.json in ONE transaction.
    Every server passes the name rule and the connection check first (422 names the server). A
    name the account already has is a conflict: ``error`` writes nothing and 409s, ``replace``
    overwrites that tool's config (its agents keep it), ``rename`` adds it as ``<name>-2``…"""
    if on_conflict not in TOOL_IMPORT_CONFLICTS:
        raise ToolkitError(422, "on_conflict must be error, replace or rename.")
    if not isinstance(servers, dict) or not servers:
        raise ToolkitError(422, "Paste at least one server.")
    cleaned: list[tuple[str, dict]] = []
    for raw_name, config in servers.items():
        name = str(raw_name).strip()
        if not TOOL_NAME_RE.match(name):
            raise ToolkitError(
                422, {"code": "invalid_name", "server": raw_name, "message": TOOL_NAME_RULE}
            )
        reason = server_config_error(config)
        if reason is not None:
            raise ToolkitError(
                422, {"code": "invalid_server", "server": raw_name, "message": reason}
            )
        cleaned.append((name, copy.deepcopy(config)))
    with session_scope() as session:
        existing = {t.name: t for t in _owner_tools(session, owner_id)}
        conflicts = [name for name, _ in cleaned if name in existing]
        if conflicts and on_conflict == "error":
            noun = "a tool named" if len(conflicts) == 1 else "tools named"
            raise ToolkitError(
                409,
                {
                    "code": "name_taken",
                    "message": f"You already have {noun} {_plural_names(conflicts)}.",
                    "conflicts": conflicts,
                },
            )
        taken = set(existing)
        written: list[ToolLibraryItem] = []
        for name, config in cleaned:
            if name in existing and on_conflict == "replace":
                row = existing[name]
                row.server_config = config
            else:
                final = name
                if name in taken:
                    final = f"{name}-2"
                    n = 3
                    while final in taken:
                        final = f"{name}-{n}"
                        n += 1
                row = ToolLibraryItem(owner_id=owner_id, name=final, server_config=config)
                session.add(row)
                taken.add(final)
            written.append(row)
        session.flush()
        names = owner_secret_names(session, owner_id)
        usage = tool_usage.tool_usage(session, owner_id)
        added = [tool_item(r, names, usage.get(r.id, [])) for r in written]
    return {"added": added, "conflicts": conflicts}


def set_tool_agents(owner_id: uuid.UUID, tool_id: object, node_ids: object) -> dict:
    """``PUT /api/tool-library/{id}/agents``: turn the tool on for exactly ``node_ids`` across the
    owner's teams (404 for a tool or agent that isn't the owner's)."""
    if not isinstance(node_ids, list):
        raise ToolkitError(422, "node_ids must be a list.")
    with session_scope() as session:
        row = get_owner_tool_row(session, owner_id, tool_id)
        try:
            return tool_usage.set_tool_agents(session, owner_id, row, node_ids)
        except LookupError:
            raise ToolkitError(404, "Agent not found.") from None


# ---- skills --------------------------------------------------------------------------------------

SKILL_NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SKILL_NAME_RULE = "Use lowercase letters, numbers and single hyphens, like house-style."
SKILL_SOURCE_TYPES = ("inline", "repo", "project_rules")
SKILL_MODES = ("always", "trigger", "agent")
SKILL_CONFLICTS = ("error", "replace")
_FULL_SHA = re.compile(r"^[0-9a-f]{40}$")


def skill_name_taken(name: str) -> str:
    return f"You already have a skill called {name}."


def check_skill_name(name: str) -> str:
    """The trimmed name, or a 422: kebab-case, at most 64 characters (the SKILL.md rule)."""
    name = (name or "").strip()
    if not name:
        raise ToolkitError(422, "A skill name is required.")
    if len(name) > 64 or not SKILL_NAME_RE.match(name):
        raise ToolkitError(422, SKILL_NAME_RULE)
    return name


def trigger_words(value: object) -> list[str]:
    """Trigger words from a list or a comma-separated string, trimmed, empties dropped."""
    if isinstance(value, str):
        items = value.split(",")
    elif isinstance(value, list):
        items = value
    else:
        items = []
    return [str(t).strip() for t in items if str(t).strip()]


def _check_mode(out: dict) -> None:
    """Validate (and normalise) an optional ``mode`` + ``triggers`` pair in place."""
    mode = out.get("mode")
    if mode is None:
        out.pop("mode", None)
    elif mode not in SKILL_MODES:
        raise ToolkitError(422, "Pick how the skill loads: always, trigger or agent.")
    if "triggers" in out or mode == "trigger":
        out["triggers"] = trigger_words(out.get("triggers"))
    if mode == "trigger" and not out["triggers"]:
        raise ToolkitError(422, "Add at least one trigger word.")


def check_skill_source(source: object, row_name: str) -> dict:
    """A normalised copy of a library skill source, or a 422 :class:`ToolkitError`.

    * inline — non-empty ``content``; ``name`` defaults to the row name; ``mode`` defaults to
      ``always``; a ``trigger`` mode needs at least one trigger word.
    * repo — a GitHub repo URL (stored as ``https://github.com/<o>/<r>``); ``ref`` defaults to
      ``main``; optional comma-separated ``filter``, ``mode``/``triggers`` and a full-SHA
      ``resolved_sha``.
    * project_rules — as is. A ``library`` source (nesting) is rejected."""
    stype = source.get("type") if isinstance(source, dict) else None
    if stype not in SKILL_SOURCE_TYPES:
        raise ToolkitError(422, "A skill source must be inline, repo, or project_rules.")
    out = copy.deepcopy(source)
    if stype == "inline":
        content = out.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ToolkitError(422, "Add the SKILL.md content.")
        if not isinstance(out.get("name"), str) or not out["name"].strip():
            out["name"] = row_name
        out["mode"] = out.get("mode") or "always"
        _check_mode(out)
    elif stype == "repo":
        from tvashtr.control_plane.skill_repo import parse_github_repo, repo_url

        parsed = parse_github_repo(out.get("url"))
        if parsed is None:
            raise ToolkitError(422, "Use a GitHub repo URL, like https://github.com/org/skills.")
        out["url"] = repo_url(*parsed)
        ref = out.get("ref")
        out["ref"] = ref.strip() if isinstance(ref, str) and ref.strip() else "main"
        filt = out.get("filter")
        if isinstance(filt, list):
            filt = ",".join(str(f) for f in filt)
        if isinstance(filt, str) and filt.strip():
            out["filter"] = ", ".join(p.strip() for p in filt.split(",") if p.strip())
        else:
            out.pop("filter", None)
        sha = out.get("resolved_sha")
        if sha is not None and not (isinstance(sha, str) and _FULL_SHA.match(sha)):
            raise ToolkitError(422, "resolved_sha must be a full 40-character commit SHA.")
        _check_mode(out)
    return out


def skill_item(row: SkillLibraryItem, users: list[dict]) -> dict:
    """One skill as every skill endpoint returns it (legacy ``{id, name, source, created_at}`` plus
    ``updated_at`` and ``usage``)."""
    agents, teams = tool_usage.usage_counts(users)
    return {
        "id": str(row.id),
        "name": row.name,
        "source": row.source,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
        "usage": {"agents": agents, "teams": teams},
    }


def _owner_skills(session: Session, owner_id: uuid.UUID) -> list[SkillLibraryItem]:
    return list(
        session.execute(
            select(SkillLibraryItem)
            .where(SkillLibraryItem.owner_id == owner_id)
            .order_by(SkillLibraryItem.created_at, SkillLibraryItem.name)
        ).scalars()
    )


def list_skills(owner_id: uuid.UUID) -> list[dict]:
    """The owner's skills, oldest first (the legacy order; the UI sorts by name)."""
    with session_scope() as session:
        usage = tool_usage.skill_usage(session, owner_id)
        return [skill_item(s, usage.get(s.id, [])) for s in _owner_skills(session, owner_id)]


def get_skill(owner_id: uuid.UUID, skill_id: object, *, with_agents: bool = False) -> dict:
    """One skill (404 when not the owner's); ``with_agents`` adds ``used_by`` (the rows behind
    ``usage`` — "<Role> · <Team>" badges and the delete-impact sentence)."""
    with session_scope() as session:
        row = get_owner_skill_row(session, owner_id, skill_id)
        users = tool_usage.skill_usage(session, owner_id).get(row.id, [])
        item = skill_item(row, users)
        if with_agents:
            item["used_by"] = users
        return item


def create_skill(owner_id: uuid.UUID, name: str, source: object, on_conflict: str) -> dict:
    """``POST /api/skill-library``: create-only by default (409 on a taken name);
    ``on_conflict=replace`` keeps the old upsert for the preset path. Returns the full item."""
    if on_conflict not in SKILL_CONFLICTS:
        raise ToolkitError(422, "on_conflict must be error or replace.")
    name = check_skill_name(name)
    clean = check_skill_source(source, name)
    try:
        skill_id = node_library.create_owner_skill(owner_id, name, clean, on_conflict=on_conflict)
    except node_library.SkillNameTaken:
        raise ToolkitError(409, skill_name_taken(name)) from None
    return get_skill(owner_id, skill_id)


def update_skill(
    owner_id: uuid.UUID, skill_id: object, name: str | None, source: object | None
) -> dict:
    """``PATCH /api/skill-library/{id}`` with a partial body: a new name follows the rule (an
    unchanged legacy name is allowed), a clash is 409, a source is validated like POST. A rename
    without a new source keeps an inline source's ``name`` in step when it matched the row."""
    with session_scope() as session:
        row = get_owner_skill_row(session, owner_id, skill_id)
        current_name, current_source, rid = row.name, row.source, row.id
    new_name = current_name
    if name is not None and name.strip() != current_name:
        new_name = check_skill_name(name)
    if source is not None:
        new_source = check_skill_source(source, new_name)
    else:
        new_source = copy.deepcopy(current_source)
        if (
            new_name != current_name
            and isinstance(new_source, dict)
            and new_source.get("type") == "inline"
            and new_source.get("name") == current_name
        ):
            new_source["name"] = new_name
    try:
        if not node_library.update_owner_skill(owner_id, rid, new_name, new_source):
            raise ToolkitError(404, SKILL_NOT_FOUND)
    except node_library.SkillNameTaken:
        raise ToolkitError(409, skill_name_taken(new_name)) from None
    return get_skill(owner_id, rid)


def delete_skill(owner_id: uuid.UUID, skill_id: object) -> dict:
    """Delete a skill and strip it from every agent (idempotent). ``{removed_from_agents}``."""
    return {"removed_from_agents": node_library.delete_owner_skill(owner_id, skill_id)}


def duplicate_skill(owner_id: uuid.UUID, skill_id: object) -> dict:
    """``POST /api/skill-library/{id}/duplicate``: a copy named ``<name>-copy`` (``-copy-2``…),
    no agents. An inline source named after the row is renamed with it (the resolver de-dups by
    name, so a copy must not collide with its original on one agent)."""
    with session_scope() as session:
        row = get_owner_skill_row(session, owner_id, skill_id)
        taken = {s.name for s in _owner_skills(session, owner_id)}
        new_name = free_name(row.name, taken)
        new_source = copy.deepcopy(row.source)
        if (
            isinstance(new_source, dict)
            and new_source.get("type") == "inline"
            and new_source.get("name") == row.name
        ):
            new_source["name"] = new_name
        copy_row = SkillLibraryItem(owner_id=owner_id, name=new_name, source=new_source)
        session.add(copy_row)
        session.flush()
        new_id = copy_row.id
    return get_skill(owner_id, new_id)


def skill_agents(owner_id: uuid.UUID, skill_id: object) -> dict:
    """``GET /api/skill-library/{id}/agents`` — the ``GET /api/agents?skill_id=`` payload."""
    return list_agents(owner_id, skill_id=str(skill_id))


def set_skill_agents(owner_id: uuid.UUID, skill_id: object, node_ids: object) -> dict:
    """``PUT /api/skill-library/{id}/agents``: exactly ``node_ids`` reference the skill afterwards
    (404 for a skill or agent that isn't the owner's)."""
    if not isinstance(node_ids, list):
        raise ToolkitError(422, "node_ids must be a list.")
    with session_scope() as session:
        row = get_owner_skill_row(session, owner_id, skill_id)
        try:
            return tool_usage.set_skill_agents(session, owner_id, row, node_ids)
        except LookupError:
            raise ToolkitError(404, "Agent not found.") from None


# ---- secrets -------------------------------------------------------------------------------------

SECRET_NAME_RE = re.compile(r"^[A-Z_][A-Z0-9_]{0,127}$")
_SECRET_EXAMPLE = "NOTION_TOKEN"


def suggest_secret_name(raw: str) -> str:
    """The input upper-cased with each run of other characters turned into ``_`` ("notion-token"
    → NOTION_TOKEN), or the example name when that still isn't valid."""
    upper = (raw or "").strip().upper()
    out = []
    for ch in upper:
        ok = ch.isascii() and (ch.isalnum() or ch == "_")
        if ok:
            out.append(ch)
        elif not out or out[-1] != "_":
            out.append("_")
    suggestion = "".join(out).strip("_")[:128]
    return suggestion if SECRET_NAME_RE.match(suggestion) else _SECRET_EXAMPLE


def check_secret_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise ToolkitError(422, "A secret name is required.")
    if not SECRET_NAME_RE.match(name):
        raise ToolkitError(
            422, f"Use capital letters, numbers and _, like {suggest_secret_name(name)}."
        )
    return name


def _check_secret_value(value: str) -> str:
    value = (value or "").strip()
    if not value:
        raise ToolkitError(422, "A secret value is required.")
    return value


def _secret_out(row: dict) -> dict:
    return {
        "name": row["name"],
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


def list_secrets(owner_id: uuid.UUID) -> dict:
    """``GET /api/secrets``: stored secrets (never values) with the library tools that use each,
    plus ``missing`` — names tools reference that have no stored value (a deleted-but-still-used
    secret shows up here)."""
    with session_scope() as session:
        tools = list(
            session.execute(
                select(ToolLibraryItem).where(ToolLibraryItem.owner_id == owner_id)
            ).scalars()
        )
    rows = mcp_secrets.list_owner_mcp_secrets(owner_id)
    stored = {r["name"] for r in rows}
    users: dict[str, list[dict]] = {}
    for tool in sorted(tools, key=lambda t: t.name):
        for ref in secret_refs(tool.server_config):
            users.setdefault(ref, []).append({"id": str(tool.id), "name": tool.name})
    return {
        "secrets": [{**_secret_out(r), "used_by_tools": users.get(r["name"], [])} for r in rows],
        "missing": [
            {"name": n, "used_by_tools": t} for n, t in missing_secrets(tools, stored).items()
        ],
    }


def create_secret(owner_id: uuid.UUID, name: str, value: str) -> dict:
    """Create-only ``POST /api/secrets``: 422 on the name rule / an empty value, 409 when the name
    exists. Returns ``{name, created_at, updated_at}`` — never the value."""
    name = check_secret_name(name)
    value = _check_secret_value(value)
    try:
        return _secret_out(mcp_secrets.create_owner_mcp_secret(owner_id, name, value))
    except mcp_secrets.SecretExists:
        raise ToolkitError(
            409, f"{name} already exists. Use Replace value on it instead."
        ) from None


def replace_secret(owner_id: uuid.UUID, name: str, value: str) -> dict:
    """``PUT /api/secrets/{name}``: replace an existing value (404 when absent). Legacy names that
    break today's rule can still be replaced."""
    value = _check_secret_value(value)
    row = mcp_secrets.replace_owner_mcp_secret(owner_id, name, value)
    if row is None:
        raise ToolkitError(404, f"No secret named {name}.")
    return _secret_out(row)


# ---- GET /api/agents -----------------------------------------------------------------------------


def list_agents(
    owner_id: uuid.UUID, tool_id: str | None = None, skill_id: str | None = None
) -> dict:
    """``{teams:[{team_id, team_name, agents:[…]}]}`` — see :func:`tool_usage.list_agents`."""
    if tool_id and skill_id:
        raise ToolkitError(422, "Pass tool_id or skill_id, not both.")
    with session_scope() as session:
        tool = get_owner_tool_row(session, owner_id, tool_id) if tool_id else None
        skill = get_owner_skill_row(session, owner_id, skill_id) if skill_id else None
        return {"teams": tool_usage.list_agents(session, owner_id, tool=tool, skill=skill)}


# ---- GET /api/github/status ----------------------------------------------------------------------


def count_installation_repositories(installation_id: int) -> int:
    """How many repos an installation can access — one ``per_page=1`` call reading GitHub's
    ``total_count`` instead of listing every repo just for a badge."""
    from tvashtr.control_plane import github_app

    token = github_app.get_installation_token(installation_id)
    result = github_app._http(
        "GET", f"{github_app._GITHUB_API}/installation/repositories?per_page=1", token=token
    )
    total = result.get("total_count") if isinstance(result, dict) else None
    return int(total) if isinstance(total, int) else 0


# ---- GET /api/toolkit/summary --------------------------------------------------------------------


def memory_counts(session: Session, owner_id: uuid.UUID) -> dict:
    """``{inbox, active, archive}`` — the owner's memories by status (Archive = superseded +
    discarded)."""
    by_status = dict(
        session.execute(
            select(NodeMemory.status, func.count())
            .where(NodeMemory.owner_id == owner_id)
            .group_by(NodeMemory.status)
        ).all()
    )
    return {
        "inbox": int(by_status.get("pending_review", 0)),
        "active": int(by_status.get("active", 0)),
        "archive": int(by_status.get("superseded", 0)) + int(by_status.get("rejected", 0)),
    }


def summary(owner_id: uuid.UUID) -> dict:
    """The Toolkit nav badges in one read (``GET /api/toolkit/summary``)."""
    with session_scope() as session:
        tools = list(
            session.execute(
                select(ToolLibraryItem).where(ToolLibraryItem.owner_id == owner_id)
            ).scalars()
        )
        names = owner_secret_names(session, owner_id)
        attention = sum(
            1 for t in tools if tool_status(t.server_config, names)["status"] != "ready"
        )
        skills = session.execute(
            select(func.count())
            .select_from(SkillLibraryItem)
            .where(SkillLibraryItem.owner_id == owner_id)
        ).scalar_one()
        return {
            "tools": len(tools),
            "tools_needing_attention": attention,
            "skills": int(skills),
            "memory": memory_counts(session, owner_id),
            "secrets_missing": len(missing_secrets(tools, names)),
        }
