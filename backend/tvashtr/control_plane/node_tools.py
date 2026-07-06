"""Per-node MCP tools resolution (M-tools) — owned by the C7.A Tools milestone.

This is the SEAM the executor calls to turn a node's inline ``tool_config`` (the raw
``{"mcpServers": {…}}`` object stored on ``AgentNode.tool_config``) into the ``mcp_config`` dict
handed to ``Agent(mcp_config=…)`` in the adapters. Isolating it here keeps
``control_plane/team_run.py`` out of C7.A's way — that milestone fills in ONLY this module.

It returns a plain dict, so it stays ``openhands``-free (like ``team_run`` at import). The
parameters the follow-on needs (``run_id`` — the owner key for ``${NAME}`` secret refs) are already
in the signature so C7.A never has to touch the call site.
"""


def build_mcp_config(tool_config: dict | None, run_id: str) -> dict:
    """Resolve a node's inline MCP config into the dict passed to ``Agent(mcp_config=…)``.

    SCAFFOLD STUB (M-tools C7.0): a pass-through copy — a NULL/empty ``tool_config`` yields ``{}``
    (the adapter creates no MCP tools from an empty dict, so the node is byte-for-byte inert). C7.A
    resolves ``${NAME}`` secret references against the run owner's stored MCP secrets (owner via
    ``run_id``); until then the raw config flows through unchanged.
    """
    return dict(tool_config or {})
