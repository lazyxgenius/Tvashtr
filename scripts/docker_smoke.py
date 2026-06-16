#!/usr/bin/env python
"""Opt-in *live* Docker-sandbox plumbing smoke (P1.3a) — NO LLM spend, ~free.

De-risks the containerized path's plumbing BEFORE the token-spending
``make skeleton-run-docker``. It brings up the OpenHands Agent Server container via
the EXACT same ``DockerWorkspace`` construction the adapter uses, then exercises the
two seams DQ1's pull-at-end depends on — ``execute_command`` (incl. the ``find``
enumeration) and ``file_download`` — and prints the REAL result-object shapes, since
the offline tests only *mock* these (they assume ``.exit_code`` / ``.stdout`` /
``.success``; this proves what the installed SDK actually returns). It also runs the
real ``reap_agent_containers()`` against the live ``docker`` CLI (reap-before-start),
so docker_runtime.py is exercised against real Docker too.

Needs Docker + the agent-server image. Needs NO ``OPENROUTER_API_KEY`` (no model
call is made). A throwaway diagnostic — safe to delete.

Run:  cd backend && uv run python ../scripts/docker_smoke.py
"""

import os
import tempfile
import traceback
from pathlib import Path

CONTAINER_TEST_FILE = "smoke.txt"
CONTAINER_TEST_CONTENT = "smoke-from-tvashtr"

# The attributes the adapter's _pull_workspace relies on (exit_code/stdout/stderr on
# execute_command; success/error on file_download). We also probe a few likely
# alternates so a NAME mismatch is revealed rather than silently defaulted.
_PROBE_ATTRS = ("exit_code", "returncode", "stdout", "stderr", "success", "error", "output")


def describe(label, obj) -> None:
    """Print an object's type + the result attributes the adapter cares about, with a
    fallback dump of any other public attrs so a differing shape is visible."""
    print(f"  {label}: type={type(obj).__name__}")
    for attr in _PROBE_ATTRS:
        if hasattr(obj, attr):
            sval = repr(getattr(obj, attr))
            if len(sval) > 300:
                sval = sval[:300] + "…"
            print(f"      .{attr} = {sval}")
    others = []
    for a in dir(obj):
        if a.startswith("_") or a in _PROBE_ATTRS:
            continue
        try:
            if callable(getattr(obj, a)):
                continue
        except Exception:
            continue
        others.append(a)
    if others:
        print(f"      (other public attrs: {others})")


def main() -> int:
    from openhands.workspace import DockerWorkspace

    from tvashtr.config import get_settings
    from tvashtr.engines.docker_runtime import reap_agent_containers
    from tvashtr.engines.openhands_docker_adapter import _detect_platform

    settings = get_settings()
    platform_str = settings.agent_server_platform or _detect_platform()

    print("[docker-smoke] P1.3a container plumbing smoke — NO LLM spend")
    print(f"[docker-smoke] image     = {settings.agent_server_image}")
    print(f"[docker-smoke] host_port = {settings.agent_server_host_port}")
    print(f"[docker-smoke] platform  = {platform_str}")

    # Mirror the adapter's reap-before-start against the REAL docker CLI.
    print("\n[docker-smoke] reap-before-start (real docker CLI)…")
    reaped = reap_agent_containers()
    print(f"[docker-smoke] reaped = {reaped}  (expect [] on a clean system)")

    host_dir = tempfile.mkdtemp(prefix="tvashtr-docker-smoke-")
    print(f"[docker-smoke] host pull-target = {host_dir}")

    ok_pull = False
    print("\n[docker-smoke] starting container (first start may be slow)…")
    try:
        with DockerWorkspace(
            server_image=settings.agent_server_image,
            host_port=settings.agent_server_host_port,
            platform=platform_str,
            extra_ports=False,
        ) as ws:
            working_dir = ws.working_dir
            print(f"[docker-smoke] container up. working_dir = {working_dir!r}\n")

            print("[docker-smoke] (1) execute_command('echo hi && pwd'):")
            r1 = ws.execute_command("echo hi && pwd", cwd=working_dir, timeout=30.0)
            describe("result", r1)

            print("\n[docker-smoke] (2) write a file in the container:")
            r2 = ws.execute_command(
                f"echo '{CONTAINER_TEST_CONTENT}' > {CONTAINER_TEST_FILE}",
                cwd=working_dir,
                timeout=30.0,
            )
            describe("result", r2)

            print(
                "\n[docker-smoke] (3) enumerate exactly as the adapter does "
                "(find . -type f -not -path '*/.*'):"
            )
            r3 = ws.execute_command(
                "find . -type f -not -path '*/.*'", cwd=working_dir, timeout=30.0
            )
            describe("result", r3)
            listing = getattr(r3, "stdout", "") or ""
            print(f"      parsed files = {[ln for ln in listing.splitlines() if ln.strip()]}")

            print("\n[docker-smoke] (4) file_download the test file to the host:")
            src = f"{working_dir.rstrip('/')}/{CONTAINER_TEST_FILE}"
            dest = os.path.join(host_dir, CONTAINER_TEST_FILE)
            r4 = ws.file_download(src, dest)
            describe("result", r4)
            exists = Path(dest).exists()
            content = Path(dest).read_text() if exists else None
            print(f"      host file exists  = {exists}")
            print(f"      host file content = {content!r}")
            ok_pull = exists and (content or "").strip() == CONTAINER_TEST_CONTENT
            print(f"      pull round-trip OK = {ok_pull}")
    except Exception:
        print("\n[docker-smoke] FAILED during container bring-up / seam exercise:")
        traceback.print_exc()
        return 1

    print("\n[docker-smoke] container torn down (context exit).")
    print(
        "[docker-smoke] DONE. Now confirm no orphan:  "
        "docker ps -a | grep agent-server   (expect empty)"
    )
    return 0 if ok_pull else 1


if __name__ == "__main__":
    raise SystemExit(main())
