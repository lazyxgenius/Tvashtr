#!/usr/bin/env python
"""Forced-escape containment smoke (P1.3b part 2, Layer A) — DETERMINISTIC, NO LLM.

The airtight, load-bearing half of the containment proof: it proves the OpenHands
Agent Server container is a *real* boundary against a write-escape WITHOUT involving
an LLM. The harness itself issues the three escape writes (so the proof never depends
on a model choosing to misbehave), confirms IN THE CONTAINER that each write actually
landed (positive evidence — the non-vacuous core), then proves the host stays clean
and the real DQ1 pull ships only the legit deliverable.

This is the inverse of P0.4b: there, in ``local`` mode, an absolute ``/greeting.txt``
leaked onto the host as ``backend/greeting.txt``. Here, in ``docker`` mode, the same
class of write lands inside the container's own filesystem (no bind-mount; the pull
reads only ``/workspace``; ``--rm`` teardown) and never reaches the host.

Three escape vectors, all issued from ``/workspace`` via the shell ``execute_command``
seam:
  1. container-absolute  ``/escape_abs.txt``
  2. path-traversal      ``../escape_traversal.txt``  ->  ``/escape_traversal.txt``
  3. literal host path   ``<REPO_ROOT>/escape_host.txt``  (phantom in the container,
                         but a REAL path on the host — its host-clean assertion is
                         the critical one)

Needs Docker + the agent-server image. Needs NO ``OPENROUTER_API_KEY`` (no model call
is made). The ONLY host write is into the script's own ``tempfile`` pull-target. A
throwaway diagnostic — safe to delete.

Run:  cd backend && uv run python ../scripts/containment_smoke.py
"""

import os
import tempfile
import traceback
from pathlib import Path

# REPO_ROOT is this repo's real root on the HOST (…/scripts/.. == project root). The
# host-path escape vector targets this path INSIDE the container (phantom there) while
# the host-clean check asserts on the SAME real path — so the two are guaranteed to
# refer to the identical location, and it is machine-independent.
REPO_ROOT = str(Path(__file__).resolve().parent.parent)

# The legit in-/workspace deliverable the boundary MUST let through.
LEGIT_FILE = "keep.txt"
LEGIT_CONTENT = "LEGIT-DELIVERABLE"

# Escape basenames — hoisted to module constants so the post-``finally`` host-clean
# check can never NameError, even if container bring-up failed before they were used.
ESCAPE_ABS = "escape_abs.txt"
ESCAPE_TRAVERSAL = "escape_traversal.txt"
ESCAPE_HOST = "escape_host.txt"
ESCAPE_BASENAMES = (ESCAPE_ABS, ESCAPE_TRAVERSAL, ESCAPE_HOST)

# Each escape: (label, shell command issued from /workspace, the ABSOLUTE in-container
# path it lands at, its basename). The host-path command first ``mkdir -p``s the
# phantom parent inside the container.
ESCAPES = [
    (
        "absolute",
        f"echo 'ESCAPED-ABS' > /{ESCAPE_ABS}",
        f"/{ESCAPE_ABS}",
        ESCAPE_ABS,
    ),
    (
        "traversal",
        f"echo 'ESCAPED-TRAVERSAL' > ../{ESCAPE_TRAVERSAL}",
        f"/{ESCAPE_TRAVERSAL}",
        ESCAPE_TRAVERSAL,
    ),
    (
        "host-path",
        f"mkdir -p '{REPO_ROOT}' && echo 'ESCAPED-HOST' > '{REPO_ROOT}/{ESCAPE_HOST}'",
        f"{REPO_ROOT}/{ESCAPE_HOST}",
        ESCAPE_HOST,
    ),
]

# The literal host path the host-path escape WOULD surface at if the container failed
# to contain it — this exact path is real on the host, so it is the critical assertion.
CRITICAL_HOST_PATH = os.path.join(REPO_ROOT, ESCAPE_HOST)


def host_leak_paths() -> list[str]:
    """The comprehensive set of host locations a real escape could surface at: each
    escape basename across host ``/``, the repo root, its ``backend/``, ``/tmp`` and
    ``$HOME`` — plus the critical literal ``<REPO_ROOT>/escape_host.txt``."""
    dirs = ["/", REPO_ROOT, os.path.join(REPO_ROOT, "backend"), "/tmp", os.path.expanduser("~")]
    paths = {os.path.join(d, b) for d in dirs for b in ESCAPE_BASENAMES}
    paths.add(CRITICAL_HOST_PATH)  # already in the cross-product; explicit for safety
    return sorted(paths)


def snapshot_present(paths) -> set:
    """Of ``paths``, the subset that currently exists on the host."""
    return {p for p in paths if os.path.exists(p)}


def pull_target_escapes(host_dir: str) -> list[str]:
    """Any file under the host pull-target whose basename is an escape basename (there
    must be none — the escapes live outside /workspace, so the pull cannot see them)."""
    hits = []
    for root, _dirs, files in os.walk(host_dir):
        for f in files:
            if f in ESCAPE_BASENAMES:
                hits.append(os.path.join(root, f))
    return hits


def _run(ws, cmd: str, working_dir: str, label: str):
    """Run a shell command in the container, print its exit_code/stderr, return the
    result (so a denied write is visible — the folded-in Task-0 writability probe)."""
    r = ws.execute_command(cmd, cwd=working_dir, timeout=30.0)
    print(
        f"[containment-smoke]   {label}: exit={getattr(r, 'exit_code', '?')} "
        f"stderr={getattr(r, 'stderr', '')!r}"
    )
    return r


def main() -> int:
    from openhands.workspace import DockerWorkspace

    from tvashtr.config import get_settings
    from tvashtr.engines.docker_runtime import reap_agent_containers
    from tvashtr.engines.openhands_docker_adapter import _detect_platform, _pull_workspace

    settings = get_settings()
    platform_str = settings.agent_server_platform or _detect_platform()

    print("[containment-smoke] P1.3b part 2 (Layer A) — forced-escape containment (NO LLM)")
    print(f"[containment-smoke] image     = {settings.agent_server_image}")
    print(f"[containment-smoke] platform  = {platform_str}")
    print(f"[containment-smoke] REPO_ROOT = {REPO_ROOT}")
    print(f"[containment-smoke] critical host path = {CRITICAL_HOST_PATH}")

    host_dir = tempfile.mkdtemp(prefix="tvashtr-containment-smoke-")
    print(f"[containment-smoke] host pull-target = {host_dir}")

    # Snapshot the host leak locations BEFORE the run so only NEW leaks are flagged.
    leak_paths = host_leak_paths()
    before = snapshot_present(leak_paths)
    print(f"[containment-smoke] host leak locations watched = {len(leak_paths)}")
    if before:
        print(f"[containment-smoke] (pre-existing, NOT counted as new leaks: {sorted(before)})")

    in_container_ok = False
    selectivity_ok = False
    pulled: list[str] = []
    write_results: dict[str, tuple] = {}

    try:
        # Reap-before-start (mirror the adapter) so a stale orphan cannot confuse us.
        reap_agent_containers()

        print("\n[containment-smoke] bringing up ONE container (first start may be slow)…")
        with DockerWorkspace(
            server_image=settings.agent_server_image,
            host_port=settings.agent_server_host_port,
            platform=platform_str,
            extra_ports=False,
        ) as ws:
            working_dir = ws.working_dir
            print(
                f"[containment-smoke] container up on host port={ws.host_port} (ephemeral); "
                f"working_dir={working_dir!r}\n"
            )

            # (1) Legit deliverable inside /workspace — the boundary must let it through.
            print("[containment-smoke] (1) write the legit deliverable (keep.txt):")
            _run(ws, f"echo '{LEGIT_CONTENT}' > {LEGIT_FILE}", working_dir, "keep.txt")

            # (2) Issue the three escapes (each printed exit/stderr = the writability probe).
            print("\n[containment-smoke] (2) issue the three escape writes:")
            for label, cmd, _abs, basename in ESCAPES:
                r = _run(ws, cmd, working_dir, label)
                write_results[basename] = (getattr(r, "exit_code", "?"), getattr(r, "stderr", ""))

            # (3) POSITIVE in-container evidence — each escape's absolute path IS present
            #     INSIDE the container (non-vacuous: the writes really happened).
            print("\n[containment-smoke] (3) confirm each escape PRESENT inside the container:")
            all_present = True
            for label, _cmd, abs_path, basename in ESCAPES:
                r = ws.execute_command(
                    f"test -f '{abs_path}' && echo PRESENT || echo ABSENT",
                    cwd=working_dir,
                    timeout=30.0,
                )
                present = "PRESENT" in (getattr(r, "stdout", "") or "")
                tag = "PRESENT" if present else "ABSENT"
                print(f"[containment-smoke]   {label} {abs_path} -> {tag}")
                if not present:
                    ec, se = write_results.get(basename, ("?", ""))
                    print(
                        f"[containment-smoke]     !! ABSENT — the escape write FAILED "
                        f"(exit={ec} stderr={se!r}); the proof would be VACUOUS"
                    )
                all_present = all_present and present
            in_container_ok = all_present

            # (4) SELECTIVITY — the REAL adapter pull (imported, not re-implemented): it
            #     enumerates only /workspace, so it captures keep.txt and NONE of the
            #     escapes (they live outside /workspace).
            print("\n[containment-smoke] (4) selectivity — real _pull_workspace(ws, host_dir):")
            pulled = _pull_workspace(ws, host_dir)
            print(f"[containment-smoke]   pulled (files_changed) = {pulled}")
            keep_captured = LEGIT_FILE in pulled
            host_keep = os.path.join(host_dir, LEGIT_FILE)
            keep_content = None
            if os.path.exists(host_keep):
                keep_content = Path(host_keep).read_text().strip()
            content_ok = keep_content == LEGIT_CONTENT
            no_escape_pulled = not any(b in pulled for b in ESCAPE_BASENAMES)
            print(
                f"[containment-smoke]   keep.txt captured = {keep_captured}; "
                f"host content = {keep_content!r} (ok={content_ok})"
            )
            print(f"[containment-smoke]   no escape basename in pulled = {no_escape_pulled}")
            selectivity_ok = keep_captured and content_ok and no_escape_pulled
    except Exception:
        print("\n[containment-smoke] FAILED during bring-up / container exercise:")
        traceback.print_exc()
    finally:
        # Never leave a container behind, on any path.
        leftover = reap_agent_containers()
        if leftover:
            print(f"[containment-smoke] finally: reaped leftover container(s) = {leftover}")

    # (5/6) HOST-CLEAN — after teardown, no watched path may flip absent -> present.
    after = snapshot_present(leak_paths)
    new_leaks = sorted(after - before)
    host_clean = not new_leaks
    critical_leaked = os.path.exists(CRITICAL_HOST_PATH) and CRITICAL_HOST_PATH not in before
    print("\n[containment-smoke] (5) HOST-CLEAN check (after teardown):")
    print(f"[containment-smoke]   new host leaks = {new_leaks}  -> host_clean = {host_clean}")
    print(f"[containment-smoke]   critical path leaked = {critical_leaked} ({CRITICAL_HOST_PATH})")

    # pull-target clean — the tempfile dir holds only the legit pull, no escape files.
    pt_escapes = pull_target_escapes(host_dir)
    pull_target_clean = not pt_escapes
    pt_contents = sorted(str(p) for p in Path(host_dir).rglob("*") if p.is_file())
    print(f"[containment-smoke]   pull-target contents = {pt_contents}")
    print(
        f"[containment-smoke]   pull-target escape files = {pt_escapes} "
        f"-> clean = {pull_target_clean}"
    )

    ok = in_container_ok and selectivity_ok and host_clean and pull_target_clean
    print("\n" + "=" * 64)
    print(
        f"[containment-smoke] SUMMARY: in_container_present={in_container_ok} "
        f"selectivity={selectivity_ok} host_clean={host_clean} "
        f"pull_target_clean={pull_target_clean}"
    )
    print(f"[containment-smoke] CONTAINMENT PROVEN = {ok}")
    print(
        "[containment-smoke] DONE. Confirm no orphan remains:  "
        "docker ps -a | grep agent-server   (expect empty)"
    )
    print("=" * 64)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
