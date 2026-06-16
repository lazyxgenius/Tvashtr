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


def reap_lifecycle_phase(settings, platform_str) -> bool:
    """Ephemeral reap-lifecycle proof (P1.3b) — the one thing the P1.3a smoke never
    showed: that the ``ancestor=`` reaping filter actually matches a REAL running
    container, removes it, and a FRESH container then starts cleanly on a DIFFERENT
    free port with no wait and no collision (the whole point of ephemeral ports —
    no fixed-port release lag to race). The P1.3a smoke only reaped BEFORE bring-up,
    so its reap found nothing; this exercises reap against a live container.

    Reaps in a ``finally`` so a container is never left behind, even on an early
    assertion failure or a mid-bring-up exception. No socket/port-free polling —
    ephemeral ports remove the need.
    """
    from openhands.workspace import DockerWorkspace

    from tvashtr.engines.docker_runtime import (
        list_agent_containers,
        reap_agent_containers,
    )

    print("\n" + "=" * 64)
    print("[docker-smoke] REAP-LIFECYCLE PHASE (ephemeral) — reap vs a REAL container")
    print("=" * 64)

    port1 = None
    ok = False
    try:
        # Clean slate so the proof starts from nothing.
        cleared = reap_agent_containers()
        print(f"[docker-smoke] reap clean-slate cleared = {cleared}  (expect [] if no leftovers)")

        # (1) Bring up one container as an orphan stand-in (ephemeral host port).
        print("\n[docker-smoke] (1) bring up an orphan stand-in (host_port=None, ephemeral)…")
        with DockerWorkspace(
            server_image=settings.agent_server_image,
            host_port=None,
            platform=platform_str,
            extra_ports=False,
        ) as ws1:
            full_id = ws1._container_id or ""  # PrivateAttr: full 64-char docker id
            port1 = ws1.host_port
            print(f"[docker-smoke]     up: container_id={full_id[:12]}… host_port={port1}")

            # (2) The ancestor= filter must match the running container. NOTE the
            # id-width mismatch: `docker run` yields a FULL 64-char id while
            # list_agent_containers (`docker ps -aq`) yields SHORT 12-char ids — so
            # match by PREFIX (full.startswith(short)), not equality.
            listed = list_agent_containers()
            matched = any(full_id.startswith(short) for short in listed if short)
            print(f"[docker-smoke] (2) list_agent_containers() = {listed}")
            print(f"[docker-smoke]     ancestor= filter matches the live container = {matched}")
            if not matched:
                raise AssertionError("ancestor= filter did NOT match the running container")

            # (3) Reap -> our container is removed and the list goes empty
            # (`docker rm -f` is synchronous).
            reaped = reap_agent_containers()
            reaped_ours = any(full_id.startswith(short) for short in reaped if short)
            after = list_agent_containers()
            print(f"[docker-smoke] (3) reap_agent_containers() removed = {reaped}")
            print(f"[docker-smoke]     removed OUR container = {reaped_ours}; list now = {after}")
            if not reaped_ours or after:
                raise AssertionError("reap did not remove the container / list not empty")
            # Already removed out from under the context manager — null the id so the
            # `with` __exit__ (docker stop) is a harmless no-op.
            ws1._container_id = None

        # (4) A FRESH container comes up cleanly on a DIFFERENT free port — NO wait,
        # NO collision (a fixed port here would wedge on the ~30s release of port1).
        print("\n[docker-smoke] (4) bring up a FRESH container (host_port=None)…")
        with DockerWorkspace(
            server_image=settings.agent_server_image,
            host_port=None,
            platform=platform_str,
            extra_ports=False,
        ) as ws2:
            port2 = ws2.host_port
            distinct = port2 != port1
            print(f"[docker-smoke]     up: host_port={port2}  (prev was {port1})")
            print(
                f"[docker-smoke]     fresh container got a DIFFERENT free port = {distinct}; "
                "no wait, no collision"
            )
        ok = True
    except Exception:
        print("\n[docker-smoke] reap-lifecycle phase FAILED:")
        traceback.print_exc()
        ok = False
    finally:
        # Belt-and-suspenders: never leave a container behind on any path.
        leftover = reap_agent_containers()
        if leftover:
            print(f"[docker-smoke] finally: reaped leftover container(s) = {leftover}")

    print(f"\n[docker-smoke] reap-lifecycle OK = {ok}")
    return ok


def main() -> int:
    from openhands.workspace import DockerWorkspace

    from tvashtr.config import get_settings
    from tvashtr.engines.docker_runtime import reap_agent_containers
    from tvashtr.engines.openhands_docker_adapter import _detect_platform

    settings = get_settings()
    platform_str = settings.agent_server_platform or _detect_platform()

    print("[docker-smoke] P1.3a/b container plumbing smoke — NO LLM spend")
    print(f"[docker-smoke] image     = {settings.agent_server_image}")
    print(
        f"[docker-smoke] host_port = {settings.agent_server_host_port}  "
        "(None = ephemeral; the SDK picks a fresh free port per container)"
    )
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
            print(
                f"[docker-smoke] container up on host port={ws.host_port} (ephemeral). "
                f"working_dir = {working_dir!r}\n"
            )

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

    print("\n[docker-smoke] pull-seam container torn down (context exit).")
    print(f"[docker-smoke] pull round-trip OK = {ok_pull}")

    # P1.3b: prove the orphan-reap lifecycle against a REAL running container.
    reap_ok = reap_lifecycle_phase(settings, platform_str)

    print("\n" + "=" * 64)
    print(f"[docker-smoke] SUMMARY: pull round-trip OK = {ok_pull}; reap-lifecycle OK = {reap_ok}")
    print(
        "[docker-smoke] DONE. Confirm no orphan remains:  "
        "docker ps -a | grep agent-server   (expect empty)"
    )
    print("=" * 64)
    return 0 if (ok_pull and reap_ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
