#!/usr/bin/env python
"""Opt-in *live* OpenHands agent smoke (P0.3) — mirrors the gateway smoke pattern.

Only if ``OPENROUTER_API_KEY`` is set, run the OpenHands adapter on a trivial task
in a fresh LOCAL-UNSANDBOXED workspace, persist its events to ``run_events``, and
print: the resolved status, the captured EngineEvents (count + kinds),
``files_changed``, and the **actual contents of the produced file** (proof the
agent really acted). Skip cleanly with a clear message if no key is present, so
CI never depends on a paid endpoint or a live agent.

Run via ``make agent-smoke``.
"""

import os
from pathlib import Path
from uuid import uuid4

TARGET_FILE = "hello.txt"
TARGET_CONTENT = "Hello from Tvashtr"

# The gateway's cheap default_model (llama-3.1-8b) is fine for *direct* text
# completions but underpowered for reliable agentic tool-use / exact instruction
# following. Agentic runs therefore select a stronger instruction-follower via
# the contract's per-task model override (AgentTask.model) — still through the
# single OPENROUTER_API_KEY source (just a different OpenRouter slug, not a second
# config path). Override with TVASHTR_AGENT_MODEL.
AGENT_MODEL = os.environ.get("TVASHTR_AGENT_MODEL", "openrouter/openai/gpt-4o-mini")


def main() -> int:
    if not os.environ.get("OPENROUTER_API_KEY"):
        print(
            "[agent-smoke] OPENROUTER_API_KEY not set — skipping live agent run.\n"
            "             Set it in .env to exercise a real OpenHands run. (Not a failure.)"
        )
        return 0

    # Import lazily so the no-key skip never pays the heavy openhands import.
    from tvashtr.engines.base import AgentTask
    from tvashtr.engines.openhands_adapter import OpenHandsAdapter, make_local_workspace
    from tvashtr.engines.run_event_sink import make_run_event_sink

    run_id = f"agent-smoke-{uuid4().hex[:12]}"
    workspace = make_local_workspace(run_id)
    instruction = f"Create a file named {TARGET_FILE} containing exactly: {TARGET_CONTENT}"

    print(f"[agent-smoke] run_id    = {run_id}")
    print(f"[agent-smoke] model     = {AGENT_MODEL}")
    print(f"[agent-smoke] workspace = {workspace}  (local-unsandboxed)")
    print(f"[agent-smoke] task      = {instruction}")
    print("[agent-smoke] running OpenHands agent (first run may be slow)…\n")

    adapter = OpenHandsAdapter()
    task = AgentTask(instruction=instruction, workspace_dir=workspace, model=AGENT_MODEL)
    # The sink persists each EngineEvent to run_events as it streams.
    result = adapter.run(task, on_event=make_run_event_sink(run_id))

    kinds: dict[str, int] = {}
    for event in result.events:
        kinds[event.kind] = kinds.get(event.kind, 0) + 1

    print(f"[agent-smoke] status        = {result.status}")
    print(f"[agent-smoke] events        = {len(result.events)}  kinds={kinds}")
    print(f"[agent-smoke] files_changed = {result.files_changed}")
    print(f"[agent-smoke] summary       = {result.summary!r}")
    if result.error:
        print(f"[agent-smoke] error         = {result.error}")

    produced = Path(workspace) / TARGET_FILE
    print(f"\n[agent-smoke] produced file = {produced}")
    if not produced.exists():
        print("[agent-smoke] exists=False — the agent did not produce the file")
        return 1

    contents = produced.read_text()
    matches = contents.strip() == TARGET_CONTENT
    print(f"[agent-smoke] exists=True contents={contents!r}")
    print(f"[agent-smoke] contents match required {TARGET_CONTENT!r}: {matches}")
    return 0 if (result.status == "completed" and matches) else 1


if __name__ == "__main__":
    raise SystemExit(main())
