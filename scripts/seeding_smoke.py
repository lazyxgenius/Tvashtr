#!/usr/bin/env python
"""Opt-in *live* docker-mode loop-seeding smoke (P1.5c) — NO LLM spend, ~free.

Proves the host->container PUSH (``_push_workspace``) that gives the cyclic loop its
rework continuity on the docker substrate, BEFORE the token-spending
``make loop-run-docker``. Brings up the agent-server container via the EXACT same
``DockerWorkspace`` construction the adapter uses, then:
  (0) probes ``file_upload``'s real return shape (the offline tests only mock it);
  (1) pushes a host workspace (flat + nested file) via ``_push_workspace`` and asserts
      the files landed IN the container (``execute_command`` cat) — the seed works;
  (2) simulates iteration 2: revises the SEEDED file in-container, then ``_pull_workspace``
      back to a fresh host dir, asserting the revision-of-seeded-content survived — the
      full host->container->revise->host cycle the loop needs (non-vacuous: impossible
      unless the seed landed).
Reaps before/after; asserts no orphan. Needs Docker + the agent-server image; needs NO
OPENROUTER_API_KEY. A throwaway diagnostic — safe to delete.

Run:  cd backend && uv run python ../scripts/seeding_smoke.py
"""

import tempfile
import traceback
from pathlib import Path

_PROBE_ATTRS = ("success", "error", "exit_code", "returncode", "stdout", "stderr", "output")


def describe(label, obj) -> None:
    print(f"  {label}: type={type(obj).__name__}")
    for attr in _PROBE_ATTRS:
        if hasattr(obj, attr):
            sval = repr(getattr(obj, attr))
            print(f"      .{attr} = {sval[:300]}")


def main() -> int:
    from openhands.workspace import DockerWorkspace

    from tvashtr.config import get_settings
    from tvashtr.engines.docker_runtime import enumerate_push_files, reap_agent_containers
    from tvashtr.engines.openhands_docker_adapter import (
        _detect_platform,
        _pull_workspace,
        _push_workspace,
    )

    settings = get_settings()
    platform_str = settings.agent_server_platform or _detect_platform()

    print("[seeding-smoke] P1.5c docker loop-seeding smoke — NO LLM spend")
    print(f"[seeding-smoke] image    = {settings.agent_server_image}")
    print(f"[seeding-smoke] platform = {platform_str}")

    print("\n[seeding-smoke] reap-before-start…")
    print(f"[seeding-smoke] reaped = {reap_agent_containers()}")

    # A host workspace standing in for 'iteration 1's pulled deliverable': a flat file
    # and a nested file, plus a .git dir + a hidden file that MUST be skipped (mirrors
    # the real git-init'd host).
    host_in = tempfile.mkdtemp(prefix="tvashtr-seed-in-")
    Path(host_in, "greeting.txt").write_text("round-1 greeting\n")
    Path(host_in, "src").mkdir()
    Path(host_in, "src", "app.py").write_text("print('round 1')\n")
    Path(host_in, ".git").mkdir()
    Path(host_in, ".git", "config").write_text("[core]\n")
    Path(host_in, ".secret").write_text("nope\n")
    expect = enumerate_push_files(host_in)
    print(f"[seeding-smoke] host workspace = {host_in}")
    print(
        f"[seeding-smoke] enumerate_push_files = {expect}  (expect ['greeting.txt', 'src/app.py'])"
    )

    host_out = tempfile.mkdtemp(prefix="tvashtr-seed-out-")
    ok = False
    try:
        with DockerWorkspace(
            server_image=settings.agent_server_image,
            host_port=settings.agent_server_host_port,
            platform=platform_str,
            extra_ports=False,
        ) as ws:
            wd = ws.working_dir
            print(f"\n[seeding-smoke] container up; working_dir = {wd!r}")

            # (0) Probe file_upload's real return shape on a throwaway file.
            probe_src = Path(host_in, "greeting.txt")
            print("\n[seeding-smoke] (0) probe file_upload return shape:")
            r0 = ws.file_upload(str(probe_src), f"{wd.rstrip('/')}/_probe.txt")
            describe("file_upload result", r0)

            # (1) Push via the REAL adapter function, assert the files landed in-container.
            print("\n[seeding-smoke] (1) _push_workspace(host_in) then verify in-container:")
            pushed = _push_workspace(ws, host_in)
            print(f"      pushed = {pushed}")
            cat = ws.execute_command(
                "cat greeting.txt && echo '---' && cat src/app.py", cwd=wd, timeout=30.0
            )
            describe("cat result", cat)
            seeded_ok = (
                sorted(pushed) == ["greeting.txt", "src/app.py"]
                and "round-1 greeting" in (getattr(cat, "stdout", "") or "")
                and "round 1" in (getattr(cat, "stdout", "") or "")
            )
            print(f"      seed landed (flat + nested) = {seeded_ok}")

            # (2) Simulate iteration 2: revise the SEEDED file in-container, pull it back.
            print("\n[seeding-smoke] (2) revise the seeded file in-container, then pull:")
            ws.execute_command("echo 'round-2 revision' >> greeting.txt", cwd=wd, timeout=30.0)
            pulled = _pull_workspace(ws, host_out)
            host_greeting = Path(host_out, "greeting.txt")
            content = host_greeting.read_text() if host_greeting.exists() else ""
            round_trip_ok = "round-1 greeting" in content and "round-2 revision" in content
            print(f"      pulled = {pulled}")
            print(f"      host greeting now = {content!r}")
            print(f"      revision-of-seeded-content survived = {round_trip_ok}")

            ok = seeded_ok and round_trip_ok
    except Exception:
        print("\n[seeding-smoke] FAILED during bring-up / seam exercise:")
        traceback.print_exc()
        ok = False
    finally:
        leftover = reap_agent_containers()
        if leftover:
            print(f"[seeding-smoke] finally: reaped leftover = {leftover}")

    print("\n" + "=" * 64)
    print(f"[seeding-smoke] SUMMARY: seeding round-trip OK = {ok}")
    print("[seeding-smoke] Confirm no orphan: docker ps -a | grep agent-server  (expect empty)")
    print("=" * 64)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
