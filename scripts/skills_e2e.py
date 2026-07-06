#!/usr/bin/env python
"""M-tools C7.B LIVE gate (`make skills-e2e`) — an inline `always` skill shapes a REAL worker.

The end-to-end proof that a node's inline skill reaches an engine-backed WORKER through the
`AgentContext` path and actually shapes its behavior — the whole C7.B `build_skills` → adapter
`AgentContext(skills=…)` seam, exercised live on the DOCKER sandbox with the proven NIM model:

  1. Author ONE inline source with `mode: "always"` whose content is a DISTINCTIVE, unmistakable
     rule: "every file you write MUST end with the exact marker line <MARKER>".
  2. Resolve it with the REAL resolver — `build_skills([...], workspace, run_id)` — the same call
     the Control Plane's `agent_run_step` makes. An `always` skill becomes a `Skill(trigger=None,
     is_agentskills_format=False)`, which the SDK renders always-active into the system prompt.
  3. Run a REAL agent (NIM llama-3.3-70b) through the DOCKER adapter on a NEUTRAL task that never
     mentions the marker: "create <file> with a one-line greeting".
  4. Pull the workspace back and assert the produced file carries the marker. Because the task never
     mentioned it, the marker can ONLY come from the skill — so its presence proves the inline skill
     reached the agent (via `AgentContext`) and changed the output.

Needs `NVIDIA_BUILD_API_KEY` + Docker + the agent-server image. Skips cleanly (exit 0) with a clear
message when the key is absent, so it never wedges CI. NOT in `make test`. Operator-run.

Run:  make skills-e2e
"""

import os
import traceback
from pathlib import Path
from uuid import uuid4

# A high-entropy marker no task would produce by chance — its presence is the whole proof.
SKILL_MARKER = "TVASHTR_SKILL_MARKER_9F3A7C"
SKILL_CONTENT = (
    "TVASHTR SKILL RULE (mandatory, highest priority): whenever you create or write ANY file, the "
    f"very LAST line of that file MUST be exactly this marker, on its own line:\n{SKILL_MARKER}\n"
    "Do this for every file without exception, even if the user's request does not mention it."
)
TARGET_FILE = "notes.txt"


def main() -> int:
    key = os.environ.get("NVIDIA_BUILD_API_KEY") or os.environ.get("NVIDIA_NIM_API_KEY")
    model = os.environ.get("TVASHTR_AGENT_MODEL", "nvidia_nim/meta/llama-3.3-70b-instruct")
    if not key:
        print(
            "[skills-e2e] NVIDIA_BUILD_API_KEY not set — skipping the live agent run.\n"
            "             This is the LIVE gate; set the key + Docker to exercise it. (Not a "
            "failure — the offline resolver suite in tests/test_node_skills.py is the proof.)"
        )
        return 0

    # Lazy imports so the no-key skip never pays the heavy openhands import.
    from tvashtr.control_plane.node_skills import build_skills
    from tvashtr.engines.base import AgentTask
    from tvashtr.engines.openhands_adapter import make_local_workspace
    from tvashtr.engines.openhands_docker_adapter import OpenHandsDockerAdapter

    run_id = f"skills-e2e-{uuid4().hex[:12]}"
    workspace = make_local_workspace(run_id)

    # (2) Resolve the inline `always` skill with the REAL C7.B resolver (the AgentContext path).
    sources = [
        {"type": "inline", "name": "file-marker", "content": SKILL_CONTENT, "mode": "always"}
    ]
    skills = build_skills(sources, workspace, run_id)
    if not skills:
        print("[skills-e2e] FAIL: build_skills resolved the inline source to nothing.")
        return 1
    print(f"[skills-e2e] run_id     = {run_id}")
    print(f"[skills-e2e] model      = {model}  (DOCKER sandbox)")
    print(f"[skills-e2e] workspace  = {workspace}")
    print(
        f"[skills-e2e] resolved   = {len(skills)} skill(s): "
        f"{[(type(s).__name__, s.name) for s in skills]}"
    )
    print(f"[skills-e2e] marker     = {SKILL_MARKER}")

    # (3) NEUTRAL task — it never mentions the marker, so any marker in the output comes ONLY from
    #     the skill riding in via AgentContext.
    instruction = (
        f"Create a file named {TARGET_FILE} containing a short, one-line friendly greeting."
    )
    task = AgentTask(
        instruction=instruction,
        workspace_dir=workspace,
        model=model,
        llm_api_key=key,
        skills=skills,
    )

    print(
        "[skills-e2e] running the REAL agent through the docker sandbox (first start may be slow)…"
    )
    try:
        result = OpenHandsDockerAdapter().run(task)
    except Exception:
        print(
            "\n[skills-e2e] the live docker+NIM run RAISED — treat as an INFRA blocker "
            "(docker/agent-server/NIM), NOT a skill-wiring failure:"
        )
        traceback.print_exc()
        return 2  # distinct code: infra/external, not a wiring bug

    # (4) The docker adapter pulls the deliverable back into the host workspace.
    produced = Path(workspace) / TARGET_FILE
    content = produced.read_text(encoding="utf-8") if produced.exists() else ""
    marker_present = SKILL_MARKER in content

    print(f"\n[skills-e2e] adapter status      = {result.status}")
    print(f"[skills-e2e] files_changed        = {result.files_changed}")
    print(f"[skills-e2e] produced {TARGET_FILE}:\n---\n{content}\n---")
    print(f"[skills-e2e] SKILL MARKER present = {marker_present}")

    ok = marker_present
    verdict = "reached the worker and shaped its output" if ok else "did NOT reach the worker"
    print("=" * 72)
    print(
        f"[skills-e2e] RESULT: {'PASS' if ok else 'FAIL'} — the inline `always` skill {verdict} "
        f"through the docker AgentContext path."
    )
    print("=" * 72)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
