#!/usr/bin/env python
"""Opt-in *live* OpenHands agent smoke (P0.3) — mirrors the gateway smoke pattern.

Only if the key for the CHOSEN agent model's provider is set, run the OpenHands adapter on a
trivial task in a fresh LOCAL-UNSANDBOXED workspace, persist its events to ``run_events``, and
print: the resolved status, the captured EngineEvents (count + kinds), ``files_changed``, and the
**actual contents of the produced file** (proof the agent really acted). Skip cleanly with a clear
message if that key is absent, so CI never depends on a paid endpoint or a live agent.

M-live fixed the gate. It used to ask one hardcoded question — is ``OPENROUTER_API_KEY`` set? —
regardless of which model ``TVASHTR_AGENT_MODEL`` names. M-accounts Slice B took provider keys out
of ``.env`` (they live encrypted in ``provider_credentials``) and the operator's OpenRouter credits
ran out, so that variable is simply gone: the target CLI-RULES §4.6 names as the pre-flight for any
live agent run had become a **silent no-op**, exiting 0 while proving nothing. It now resolves the
key the selected model's own provider needs, and threads it through ``AgentTask.llm_api_key`` —
which is what ``agent_llm_routing``'s proxy-OFF (BYOK) path requires, and what it refuses to run
without.

Run via ``make agent-smoke``.
"""

import os
from collections.abc import Mapping
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


def resolve_agent_key(model: str, environ: Mapping[str, str]) -> str | None:
    """The ``.env`` key for ``model``'s OWN provider, or ``None`` when it is absent.

    Pure (``environ`` is injected) so the gate is unit-testable without a live agent, which is the
    whole point: the previous gate could only be exercised by running one. Provider names come from
    ``seed.ENV_PROVIDER_MAP`` — the project's single declaration of which ``.env`` var carries which
    provider's key — so this can never drift from what ``make seed`` imports. A blank value counts
    as absent, and a provider with no mapping returns ``None`` rather than borrowing another
    provider's key: a wrong key produces a confusing auth failure deep inside OpenHands, whereas a
    clean skip says exactly what is missing.
    """
    from tvashtr.control_plane.credentials import provider_for_model
    from tvashtr.seed import ENV_PROVIDER_MAP

    provider = provider_for_model(model)
    for env_names, mapped in ENV_PROVIDER_MAP:
        if mapped != provider:
            continue
        for name in env_names:
            value = (environ.get(name) or "").strip()
            if value:
                return value
    return None


def main() -> int:
    api_key = resolve_agent_key(AGENT_MODEL, os.environ)
    if not api_key:
        print(
            f"[agent-smoke] no .env key for {AGENT_MODEL!r}'s provider — skipping live agent run.\n"
            "             Set that provider's key in .env to exercise a real OpenHands run. "
            "(Not a failure.)"
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
    # ``llm_api_key`` is what agent_llm_routing's proxy-OFF BYOK path consumes as its
    # ``api_key_override``; that path REFUSES a None rather than falling back to .env.
    task = AgentTask(
        instruction=instruction,
        workspace_dir=workspace,
        model=AGENT_MODEL,
        llm_api_key=api_key,
    )
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
