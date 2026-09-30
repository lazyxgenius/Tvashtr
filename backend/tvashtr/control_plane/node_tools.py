"""Per-node MCP tools resolution (M-tools C7.A) — owned by the C7.A Tools milestone.

The SEAM the executor calls to turn a node's inline ``tool_config`` (the raw ``{"mcpServers": {…}}``
object stored on ``AgentNode.tool_config``) into the ``mcp_config`` dict handed to
``Agent(mcp_config=…)``. Isolating it here keeps ``control_plane/team_run.py`` out of
C7.A's way — this milestone fills in ONLY this module (the call site is unchanged).

Behavior:
  * ``None``/empty ``tool_config`` -> ``{}`` (byte-for-byte inert — no MCP tools built).
  * ids at ``tvashtr.library`` (C7.C) are expanded from the owner's ``tool_library`` into a base
    servers dict (a LIVE lookup, fresh each run); the node's inline ``mcpServers`` overlay it,
    INLINE WINNING on a name collision. A dangling library ref is SKIPPED + a warning is recorded.
  * A per-server ``tvashtr.servers.<name>.enabled: false`` toggle DROPS that server (default = on; a
    pasted config with no ``tvashtr`` block = all-on). That Tvashtr-only metadata block is
    STRIPPED from the returned dict (the SDK's ``Agent(mcp_config=…)`` validates only
    ``{"mcpServers": {…}}``).
  * ``${NAME}`` refs in a server's ``env``/``headers`` values are resolved from the run owner's
    encrypted ``mcp_secrets`` and substituted in place. A server with ANY unresolved ref is DROPPED
    and a resolution warning is recorded (the run CONTINUES).
  * Each grant at ``tvashtr.connectors`` becomes one server that points at Tvashtr's own proxy
    (``/mcp/connectors``) and carries a run token. The provider's sign-in never enters this dict.
    A connector that can't be used is left out, with a warning and a ``connector_skipped`` event.

Openhands-free + litellm-free at import (it returns a plain dict). The resolved plaintext values in
the returned dict are the design — they travel into the docker sandbox exactly like the LLM key (the
SDK's ``RemoteConversation`` create path serializes the agent with ``expose_secrets=True``, keeping
``mcp_config`` PLAINTEXT rather than redacting); the cipher never goes near the sandbox.
"""

import copy
import re
import uuid
from urllib.parse import urlparse, urlunparse

from sqlalchemy import select

from tvashtr.auth import SESSION_COOKIE_NAME, make_session_cookie_value
from tvashtr.config import get_settings
from tvashtr.control_plane import connector_oauth, connector_proxy, connectors
from tvashtr.control_plane.mcp_secrets import resolve_owner_mcp_secret
from tvashtr.control_plane.node_library import resolve_owner_tool
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


def _agent_base_url() -> str:
    """The control plane's base address as the OpenHands agent process reaches it (in docker mode
    a localhost base is rewritten to the docker host). No trailing slash."""
    settings = get_settings()
    base = (settings.public_base_url or "http://127.0.0.1:8000").rstrip("/")
    parsed = urlparse(base)
    host = parsed.hostname or "127.0.0.1"
    if settings.agent_sandbox_mode == "docker" and host in ("127.0.0.1", "localhost"):
        host = settings.litellm_proxy_host_docker
        netloc = host
        if parsed.port:
            netloc = f"{host}:{parsed.port}"
        elif parsed.scheme == "http":
            netloc = f"{host}:8000"
        parsed = parsed._replace(netloc=netloc)
        base = urlunparse(parsed).rstrip("/")
    return base


def domains_mcp_url() -> str:
    """Control-plane Domains MCP URL reachable from the OpenHands agent process."""
    return f"{_agent_base_url()}/mcp/domains"


def connectors_mcp_url() -> str:
    """The Connectors proxy's address for an agent. It ends at ``/mcp/connectors``, with no
    trailing slash: that exact path has its own route (``mount_connectors_mcp``)."""
    return f"{_agent_base_url()}/mcp/connectors"


# The header naming the domains an agent may search (``tvashtr.domains`` as a list of ids, DM-96);
# absent = every domain (the legacy ``true`` switch). The Domains MCP enforces it.
DOMAINS_HEADER = "X-Tvashtr-Domains"


def _domains_opt_in(tvashtr_meta: dict) -> bool:
    flag = tvashtr_meta.get("domains")
    if flag is True:
        return True
    if isinstance(flag, dict) and flag.get("enabled", True) is not False and flag:
        return True
    return isinstance(flag, list) and bool(flag)


def _connector_servers(
    grants: list, run_id: str, node_id: str | None, owner: uuid.UUID, taken: set[str]
) -> dict:
    """The proxy servers for a node's connector grants (``[{"id", "access"?}]``), in grant order.
    ``taken`` are the server names the node already uses: a connection whose slug is one of them
    is named ``conn-<slug>``. A grant that can't be used is skipped with its warning and
    ``connector_skipped`` event (``connector_proxy.record_skip``); the run goes on without it."""
    servers: dict = {}
    seen: set[uuid.UUID] = set()
    for grant in grants:
        try:
            with session_scope() as session:
                row = connectors.get_owned(
                    session, owner, grant.get("id") if isinstance(grant, dict) else None
                )
        except connectors.ConnectorError:
            row = None  # gone, another account's, or not an id at all
        if row is None or row.status == "pending":
            connector_proxy.record_skip(
                run_id, node_id, None, "a connector", connector_proxy.DISCONNECTED
            )
            continue
        if row.id in seen:
            continue
        seen.add(row.id)
        if row.status != "connected":
            connector_proxy.sign_in_expired(run_id, node_id, row)
            continue
        if row.auth_kind == "oauth":
            # Check (or refresh) the provider token now, so a dead sign-in is a warning on this
            # round and not a row of tool errors. The token itself stays on the server.
            try:
                connector_oauth.ensure_access_token(row.id)
            except connector_oauth.SignInRefused:
                connector_proxy.sign_in_expired(run_id, node_id, row)
                continue
            except connector_oauth.Unreachable:
                connector_proxy.record_skip(
                    run_id, node_id, row.id, row.name, connector_proxy.UNREACHABLE
                )
                continue
        token = connector_proxy.sign_run_token(run_id, node_id, row.id, grant.get("access"))
        servers[f"conn-{row.slug}" if row.slug in taken else row.slug] = {
            "url": connectors_mcp_url(),
            "headers": {"Authorization": f"Bearer {token}"},
        }
    return servers


def build_mcp_config(tool_config: dict | None, run_id: str, *, node_id: str | None = None) -> dict:
    """Resolve a node's MCP config into the dict passed to ``Agent(mcp_config=…)`` — see the module
    docstring for the full contract. ``node_id`` (optional; ``agent_run_step`` passes it) is the
    agent a connector's run token names, and the round its skips are recorded on. Without
    ``tvashtr.connectors`` the output is byte-for-byte what it was before Connectors.

    C7.C: BEFORE the per-server resolution, any ids at ``tool_config.tvashtr.library`` are expanded
    into a base servers dict from the owner's ``tool_library`` (a LIVE lookup, fresh each run;
    a dangling ref is SKIPPED + warned). The node's inline ``mcpServers`` are then overlaid ON TOP —
    INLINE WINS on a name collision (local > shared, matching Claude Code's MCP precedence). Then
    the existing logic runs UNCHANGED over the merged dict (allow-list, ``${NAME}`` secrets)."""
    if not tool_config:
        return {}  # inert: the adapter builds no MCP tools from an empty dict
    config = copy.deepcopy(tool_config)
    inline_servers = config.get("mcpServers")
    if not isinstance(inline_servers, dict):
        inline_servers = {}
    tvashtr_meta = config.get("tvashtr") or {}
    enabled_meta = tvashtr_meta.get("servers") or {}
    library_ids = tvashtr_meta.get("library") or []

    owner_id: uuid.UUID | None = None
    owner_looked_up = False

    def _owner() -> uuid.UUID | None:
        # Resolve the run owner LAZILY + ONCE, shared by the library expansion + secret substitution
        # (a no-ref / no-secret config never touches the DB; inert for a synthetic run_id).
        nonlocal owner_id, owner_looked_up
        if not owner_looked_up:
            owner_id = _owner_for_run(run_id)
            owner_looked_up = True
        return owner_id

    # C7.C: expand LIVE library references into a base servers dict (fetched fresh each run).
    library_servers: dict = {}
    if isinstance(library_ids, list):
        for lib_id in library_ids:
            owner = _owner()
            resolved_ref = resolve_owner_tool(owner, lib_id) if owner else None
            if resolved_ref is None:
                # Deleted / not the owner's / unparseable -> SKIP + warn (the run continues).
                record_resolution_warning(
                    run_id, "tool", f"library:{lib_id}", "referenced library tool not found"
                )
                continue
            ref_name, ref_config = resolved_ref
            library_servers[ref_name] = ref_config

    # Inline overrides a library server of the same NAME (the node's own pasted server wins).
    servers = {**library_servers, **inline_servers}

    resolved: dict = {}
    for name, server in servers.items():
        # Allow-list: an absent entry or ``enabled: true`` is INCLUDED; ``false`` DROPS it — applies
        # to the resulting server NAME whether it came from a library ref or inline.
        if enabled_meta.get(name, {}).get("enabled", True) is False:
            continue
        if not isinstance(server, dict):
            resolved[name] = server
            continue
        refs = _secret_refs(server)
        if not refs:
            resolved[name] = server  # no ``${NAME}`` -> keep as-is (the owner is never needed)
            continue
        owner = _owner()
        values = {n: (resolve_owner_mcp_secret(owner, n) if owner else None) for n in refs}
        missing = sorted(n for n, v in values.items() if v is None)
        if missing:
            record_resolution_warning(run_id, "tool", name, f"missing secret {', '.join(missing)}")
            continue  # SKIP the server; the run continues without it
        resolved[name] = _substitute(server, values)  # type: ignore[arg-type]
    meta = tvashtr_meta if isinstance(tvashtr_meta, dict) else {}
    # Connectors: one proxy server per grant, after the node's own servers and before Domains.
    grants = meta.get("connectors")
    if isinstance(grants, list) and grants:
        owner = _owner()
        if owner is not None:
            taken = set(servers) | {"tvashtr-domains"}
            resolved.update(_connector_servers(grants, run_id, node_id, owner, taken))
    # Phase 4b: inject Domains MCP when opted in (inline wins if already present).
    if _domains_opt_in(meta):
        owner = _owner()
        if owner is not None and "tvashtr-domains" not in resolved:
            cookie_val = make_session_cookie_value(str(owner))
            headers = {"Cookie": f"{SESSION_COOKIE_NAME}={cookie_val}"}
            if isinstance(meta.get("domains"), list):
                headers[DOMAINS_HEADER] = ",".join(str(d) for d in meta["domains"])
            resolved["tvashtr-domains"] = {"url": domains_mcp_url(), "headers": headers}

    # Return ONLY ``{"mcpServers": {…}}`` — the ``tvashtr`` block (incl. ``library``) is stripped.
    return {"mcpServers": resolved}
