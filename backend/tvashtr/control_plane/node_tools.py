"""Per-node MCP tools resolution (M-tools C7.A) — owned by the C7.A Tools milestone.

The SEAM the executor calls to turn a node's inline ``tool_config`` (the raw ``{"mcpServers": {…}}``
object stored on ``AgentNode.tool_config``) into the ``mcp_config`` dict handed to
``Agent(mcp_config=…)``. Isolating it here keeps ``control_plane/team_run.py`` out of
C7.A's way — this milestone fills in ONLY this module (the call site is unchanged).

Behavior:
  * ``None``/empty ``tool_config`` -> ``{}`` (byte-for-byte inert — no MCP tools built).
  * A per-server ``tvashtr.servers.<name>.enabled: false`` toggle DROPS that server (default = on; a
    pasted config with no ``tvashtr`` block = all-on). That Tvashtr-only metadata block is
    STRIPPED from the returned dict (the SDK's ``Agent(mcp_config=…)`` validates only
    ``{"mcpServers": {…}}``).
  * ``${NAME}`` refs in a server's ``env``/``headers`` values are resolved from the run owner's
    encrypted ``mcp_secrets`` and substituted in place. A server with ANY unresolved ref is DROPPED
    and a resolution warning is recorded (the run CONTINUES).

Openhands-free + litellm-free at import (it returns a plain dict). The resolved plaintext values in
the returned dict are the design — they travel into the docker sandbox exactly like the LLM key (the
SDK's ``RemoteConversation`` create path serializes the agent with ``expose_secrets=True``, keeping
``mcp_config`` PLAINTEXT rather than redacting); the cipher never goes near the sandbox.
"""

import copy
import re
import uuid

from sqlalchemy import select

from tvashtr.control_plane.mcp_secrets import resolve_owner_mcp_secret
from tvashtr.control_plane.resolution_warnings import record_resolution_warning
from tvashtr.db import session_scope
from tvashtr.models import Run

# ``${NAME}`` — an env-var-style reference (letters/digits/underscore, not starting with a digit).
_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def _secret_refs(server: dict) -> set[str]:
    """Every ``${NAME}`` referenced in a server's ``env``/``headers`` values (a value may be
    exactly ``${NAME}`` or embed it, e.g. ``Bearer ${GH_TOKEN}``)."""
    names: set[str] = set()
    for block in ("env", "headers"):
        values = server.get(block)
        if isinstance(values, dict):
            for v in values.values():
                if isinstance(v, str):
                    names.update(_REF.findall(v))
    return names


def _owner_for_run(run_id: str) -> uuid.UUID | None:
    """The run owner (mirrors ``team_run._owner_api_key``'s lookup). ``None`` if the run/owner is
    absent — resolved LAZILY, only when a server actually references a ``${NAME}`` secret, so a
    no-secret config never touches the DB (and stays inert for a synthetic run_id)."""
    try:
        rid = uuid.UUID(run_id)
    except (ValueError, AttributeError, TypeError):
        return None
    with session_scope() as session:
        return session.execute(select(Run.owner_id).where(Run.id == rid)).scalar_one_or_none()


def _substitute(server: dict, values: dict[str, str]) -> dict:
    """A copy of ``server`` with every ``${NAME}`` in its ``env``/``headers`` values replaced by the
    resolved plaintext (all refs are guaranteed present in ``values`` before this is called)."""
    out = copy.deepcopy(server)
    for block in ("env", "headers"):
        block_values = out.get(block)
        if isinstance(block_values, dict):
            for key, val in list(block_values.items()):
                if isinstance(val, str):
                    block_values[key] = _REF.sub(lambda m: values[m.group(1)], val)
    return out


def build_mcp_config(tool_config: dict | None, run_id: str) -> dict:
    """Resolve a node's inline MCP config into the dict passed to ``Agent(mcp_config=…)`` — see the
    module docstring for the full contract. Signature is FROZEN (do NOT widen it — that keeps this
    milestone out of ``team_run.py``)."""
    if not tool_config:
        return {}  # inert: the adapter builds no MCP tools from an empty dict
    config = copy.deepcopy(tool_config)
    servers = config.get("mcpServers")
    if not isinstance(servers, dict):
        return {"mcpServers": {}}
    enabled_meta = ((config.get("tvashtr") or {}).get("servers")) or {}

    owner_id: uuid.UUID | None = None
    owner_looked_up = False
    resolved: dict = {}
    for name, server in servers.items():
        # Allow-list: an absent entry or ``enabled: true`` is INCLUDED; ``false`` DROPS it.
        if enabled_meta.get(name, {}).get("enabled", True) is False:
            continue
        if not isinstance(server, dict):
            resolved[name] = server
            continue
        refs = _secret_refs(server)
        if not refs:
            resolved[name] = server  # no ``${NAME}`` -> keep as-is (the owner is never needed)
            continue
        if not owner_looked_up:
            owner_id = _owner_for_run(run_id)
            owner_looked_up = True
        values = {n: (resolve_owner_mcp_secret(owner_id, n) if owner_id else None) for n in refs}
        missing = sorted(n for n, v in values.items() if v is None)
        if missing:
            record_resolution_warning(run_id, "tool", name, f"missing secret {', '.join(missing)}")
            continue  # SKIP the server; the run continues without it
        resolved[name] = _substitute(server, values)  # type: ignore[arg-type]
    # Return ONLY ``{"mcpServers": {…}}`` — the Tvashtr ``tvashtr`` metadata block is stripped.
    return {"mcpServers": resolved}
