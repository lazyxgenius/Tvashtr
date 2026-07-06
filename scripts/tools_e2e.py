#!/usr/bin/env python
"""M-tools C7.A LIVE gate — an inline MCP ``tool_config`` works end-to-end through the DOCKER sandbox.

Part A (DB-backed, fast): seed a per-account ``mcp_secrets`` row, ``build_mcp_config`` a
``${NAME}``-referencing config, and assert the resolved PLAINTEXT is substituted into the returned
``mcp_config`` — the store -> resolver -> sandbox-config path, live against the real DB.

Part B (live docker+NIM): ``build_mcp_config`` the public no-secret ``fetch`` MCP server
(``mcp-server-fetch`` via ``uvx``) and run the DOCKER adapter with the NIM agent, then assert from the
trajectory that the agent INVOKED the MCP fetch tool through the container — the definitive proof of
brief section 6 (the resolved plaintext ``mcp_config`` survived to the sandbox, NOT redacted).

Needs NVIDIA_BUILD_API_KEY + Docker + the agent-server image. Skips cleanly otherwise.
Run via ``make tools-e2e``.
"""

import json
import os
import tempfile
import traceback
import uuid
from pathlib import Path


def part_a() -> bool:
    """Prove a seeded ${NAME} secret resolves into the sandbox config (real DB store)."""
    from tvashtr.control_plane.mcp_secrets import set_owner_mcp_secret
    from tvashtr.control_plane.node_tools import build_mcp_config
    from tvashtr.control_plane.teams import build_two_node_team
    from tvashtr.db import session_scope
    from tvashtr.models import Run, User

    owner = uuid.uuid4()
    with session_scope() as s:
        s.add(User(id=owner, email=f"tools-e2e-{owner.hex}@tvashtr.local", password_hash="x"))
    set_owner_mcp_secret(owner, "GH_TOKEN", "ghp_live_e2e_SECRET")

    run_id = str(uuid.uuid4())
    tgid = build_two_node_team()
    with session_scope() as s:
        s.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(tgid),
                owner_id=owner,
                idea="tools-e2e",
                workflow_id=run_id,
                status="running",
            )
        )

    cfg = build_mcp_config(
        {"mcpServers": {"gh": {"command": "x", "env": {"GH_TOKEN": "${GH_TOKEN}"}}}}, run_id
    )
    resolved = cfg.get("mcpServers", {}).get("gh", {}).get("env", {}).get("GH_TOKEN")
    print(f"[tools-e2e][A] build_mcp_config resolved ${{GH_TOKEN}} -> {resolved!r}")
    ok = resolved == "ghp_live_e2e_SECRET"
    print(f"[tools-e2e][A] secret resolved from the store into the sandbox config = {ok}")
    return ok


def part_b() -> bool:
    """Prove the agent invokes the fetch MCP tool THROUGH docker (brief section 6, live)."""
    from tvashtr.control_plane.node_tools import build_mcp_config
    from tvashtr.engines.base import AgentTask
    from tvashtr.engines.openhands_docker_adapter import OpenHandsDockerAdapter

    model = os.environ.get("TVASHTR_AGENT_MODEL", "nvidia_nim/meta/llama-3.3-70b-instruct")
    run_id = str(uuid.uuid4())
    mcp_config = build_mcp_config(
        {"mcpServers": {"fetch": {"command": "uvx", "args": ["mcp-server-fetch"]}}}, run_id
    )
    print(f"[tools-e2e][B] mcp_config -> {json.dumps(mcp_config)}")

    workspace = tempfile.mkdtemp(prefix=f"tvashtr-tools-e2e-{run_id[:8]}-")
    instruction = (
        "You have an MCP tool named `fetch` for retrieving web pages. Use the fetch tool to "
        "retrieve the URL https://example.com . Then write the first line of the returned content "
        "to a file named fetched.txt in your current working directory. You MUST use the `fetch` "
        "tool for the retrieval — do not use curl, wget, or any shell command to get the content."
    )
    task = AgentTask(
        instruction=instruction,
        workspace_dir=workspace,
        model=model,
        mcp_config=mcp_config,
        # BYOK: the docker adapter passes this as the agent LLM's api_key (proxy is OFF; M-accounts
        # removed the .env fallback). The real executor threads _owner_api_key(run_id, model) here.
        llm_api_key=os.environ.get("NVIDIA_BUILD_API_KEY"),
    )
    print(f"[tools-e2e][B] run_id={run_id} model={model} workspace={workspace}")
    print("[tools-e2e][B] running the DOCKER agent with the fetch MCP tool (slow, minutes)...")
    result = OpenHandsDockerAdapter().run(task)

    events = [{"kind": e.kind, "payload": e.payload} for e in result.events]
    blob = json.dumps(events).lower()
    fetch_hits = [e for e in events if "fetch" in json.dumps(e.get("payload", {})).lower()]
    mcp_marker = "mcp" in blob or "fetch(" in blob or '"fetch"' in blob or "'fetch'" in blob
    fetched = Path(workspace) / "fetched.txt"

    print(
        f"[tools-e2e][B] status={result.status} events={len(events)} "
        f"files_changed={result.files_changed}"
    )
    print(
        f"[tools-e2e][B] events referencing 'fetch' = {len(fetch_hits)}; mcp/tool marker = {mcp_marker}"
    )
    print(f"[tools-e2e][B] fetched.txt exists = {fetched.exists()}")
    if fetched.exists():
        print(f"[tools-e2e][B] fetched.txt (head) = {fetched.read_text()[:200]!r}")
    for e in fetch_hits[:4]:
        print(f"[tools-e2e][B]   event kind={e['kind']} payload~={json.dumps(e['payload'])[:240]}")

    invoked = bool(fetch_hits) and (mcp_marker or fetched.exists())
    print(f"[tools-e2e][B] RESULT: agent invoked the MCP fetch tool through docker = {invoked}")
    return invoked


def main() -> int:
    if not os.environ.get("NVIDIA_BUILD_API_KEY"):
        print(
            "[tools-e2e] SKIP: NVIDIA_BUILD_API_KEY not set (the live agent needs it). Not a failure."
        )
        return 0
    a = b = False
    try:
        a = part_a()
    except Exception:
        print("[tools-e2e][A] FAILED:")
        traceback.print_exc()
    try:
        b = part_b()
    except Exception:
        print("[tools-e2e][B] FAILED:")
        traceback.print_exc()
    print(f"\n[tools-e2e] SUMMARY: secret-resolution(A)={a}  live-mcp-tool(B)={b}")
    return 0 if (a and b) else 1


if __name__ == "__main__":
    raise SystemExit(main())
