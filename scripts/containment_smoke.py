#!/usr/bin/env python
"""Forced-escape containment smoke (P1.3b part 2, Layer A) — DETERMINISTIC, NO LLM.

The airtight, load-bearing half of the containment proof: it proves — without an LLM —
that an agent's out-of-/workspace writes are contained, in TWO layers:

  1. Least-privilege (inside the container): the agent-server runs the shell as a
     non-root user that cannot write the container's privileged paths (``/``, ``/Users``,
     …), so privileged escapes are DENIED outright.
  2. The Docker boundary (no bind-mount, ``--rm``): writes the agent CAN make outside
     /workspace (world-writable ``/tmp``, ``/var/tmp``) LAND in the container — and are
     shown trapped there: absent on the host, excluded from the /workspace-scoped pull,
     then destroyed with the container.

This is the inverse of P0.4b: there, in ``local`` mode, an absolute ``/greeting.txt``
leaked onto the host as ``backend/greeting.txt``. Here, in ``docker`` mode, no such write
reaches the host — whether denied at the door or trapped inside.

Five escape vectors, all issued from /workspace via the shell ``execute_command`` seam:
  privileged (expected DENIED — least-privilege):
    1. container-absolute  ``/escape_abs.txt``
    2. path-traversal      ``../escape_traversal.txt``  ->  ``/escape_traversal.txt``
    3. literal host path   ``<REPO_ROOT>/escape_host.txt``  (phantom in the container,
                           but a REAL path on the host — its host-clean assertion is the
                           critical one)
  writable (expected to LAND, then be trapped — the boundary):
    4. ``/tmp/escape_tmp.txt``
    5. ``/var/tmp/escape_vartmp.txt``

Every assertion is OUTCOME-AWARE: a vector is "contained" whether it was denied outright
OR landed-and-trapped — we never re-assume the container's permission model. PASS
requires >=1 write to actually LAND outside /workspace (so the boundary is genuinely
exercised, not assumed) AND that nothing reached the host or the pull.

Needs Docker + the agent-server image. Needs NO ``OPENROUTER_API_KEY`` (no model call is
made). The ONLY host write is into the script's own ``tempfile`` pull-target. A throwaway
diagnostic — safe to delete.

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

# Escape basenames — hoisted to module constants so the post-``finally`` host-clean check
# can never NameError. Two classes: privileged (expected denied by least-privilege) and
# writable (expected to land in the container, then be shown trapped by the boundary).
ESCAPE_ABS = "escape_abs.txt"
ESCAPE_TRAVERSAL = "escape_traversal.txt"
ESCAPE_HOST = "escape_host.txt"
ESCAPE_TMP = "escape_tmp.txt"
ESCAPE_VARTMP = "escape_vartmp.txt"
ESCAPE_BASENAMES = (ESCAPE_ABS, ESCAPE_TRAVERSAL, ESCAPE_HOST, ESCAPE_TMP, ESCAPE_VARTMP)

# Each escape: (label, shell command from /workspace, ABSOLUTE in-container path, basename,
# expected class). The host-path command first ``mkdir -p``s the phantom parent. The two
# writable vectors target world-writable sticky dirs (mode 1777) OUTSIDE /workspace.
ESCAPES = [
    (
        "absolute",
        f"echo 'ESCAPED-ABS' > /{ESCAPE_ABS}",
        f"/{ESCAPE_ABS}",
        ESCAPE_ABS,
        "privileged",
    ),
    (
        "traversal",
        f"echo 'ESCAPED-TRAVERSAL' > ../{ESCAPE_TRAVERSAL}",
        f"/{ESCAPE_TRAVERSAL}",
        ESCAPE_TRAVERSAL,
        "privileged",
    ),
    (
        "host-path",
        f"mkdir -p '{REPO_ROOT}' && echo 'ESCAPED-HOST' > '{REPO_ROOT}/{ESCAPE_HOST}'",
        f"{REPO_ROOT}/{ESCAPE_HOST}",
        ESCAPE_HOST,
        "privileged",
    ),
    (
        "tmp",
        f"echo 'ESCAPED-TMP' > /tmp/{ESCAPE_TMP}",
        f"/tmp/{ESCAPE_TMP}",
        ESCAPE_TMP,
        "writable",
    ),
    (
        "var-tmp",
        f"echo 'ESCAPED-VARTMP' > /var/tmp/{ESCAPE_VARTMP}",
        f"/var/tmp/{ESCAPE_VARTMP}",
        ESCAPE_VARTMP,
        "writable",
    ),
]

# The literal host path the host-path escape WOULD surface at if the container failed to
# contain it — this exact path is real on the host, so it is the critical assertion.
CRITICAL_HOST_PATH = os.path.join(REPO_ROOT, ESCAPE_HOST)


def host_leak_paths() -> list[str]:
    """The comprehensive set of host locations a real escape could surface at: each escape
    basename across host ``/``, the repo root, its ``backend/``, ``/tmp``, ``/var/tmp`` and
    ``$HOME`` — plus the critical literal ``<REPO_ROOT>/escape_host.txt``."""
    dirs = [
        "/",
        REPO_ROOT,
        os.path.join(REPO_ROOT, "backend"),
        "/tmp",
        "/var/tmp",
        os.path.expanduser("~"),
    ]
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
    result (so a denied write is visible — the writability probe)."""
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

    print("[containment-smoke] P1.3b part 2 (Layer A) — two-layer containment proof (NO LLM)")
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

    boundary_exercised = False
    keep_ok = False
    selectivity_ok = False
    pulled: list[str] = []
    # Per-vector outcome: (label, expected_class, exit_code, landed).
    classifications: list[tuple] = []

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

            # (2) Issue all five out-of-/workspace escapes (each printed exit/stderr is the
            #     writability probe — a denied privileged write shows exit!=0 here).
            print("\n[containment-smoke] (2) issue the five out-of-/workspace escape writes:")
            write_exit: dict[str, object] = {}
            for label, cmd, _abs, basename, expected in ESCAPES:
                r = _run(ws, cmd, working_dir, f"{label} [{expected}]")
                write_exit[basename] = getattr(r, "exit_code", "?")

            # (3) OUTCOME-AWARE classification — test -f each absolute path IN the container:
            #     landed -> contained via the boundary; not landed -> denied (least-privilege).
            print("\n[containment-smoke] (3) classify each vector by ACTUAL in-container outcome:")
            for label, _cmd, abs_path, basename, expected in ESCAPES:
                r = ws.execute_command(
                    f"test -f '{abs_path}' && echo PRESENT || echo ABSENT",
                    cwd=working_dir,
                    timeout=30.0,
                )
                landed = "PRESENT" in (getattr(r, "stdout", "") or "")
                ec = write_exit.get(basename, "?")
                kind = "LANDED -> contained (boundary)" if landed else "DENIED (least-privilege)"
                note = ""
                if landed and expected == "privileged":
                    note = "  (!! unexpected: privileged path writable — still contained)"
                elif not landed and expected == "writable":
                    note = "  (note: expected-writable vector denied — fine while >=1 landed)"
                print(
                    f"[containment-smoke]   {label} [{expected}] {abs_path}: "
                    f"exit={ec} -> {kind}{note}"
                )
                classifications.append((label, expected, ec, landed))

            # The new non-vacuous guard for the BOUNDARY: >=1 write must land outside
            # /workspace, else the boundary was never exercised (only least-privilege).
            boundary_exercised = any(c[3] for c in classifications)

            # (4) SELECTIVITY — the REAL adapter pull (imported, not re-implemented): it
            #     enumerates only /workspace, so it captures keep.txt and NONE of the
            #     escapes (privileged never landed; writable landed OUTSIDE /workspace).
            print("\n[containment-smoke] (4) selectivity — real _pull_workspace(ws, host_dir):")
            pulled = _pull_workspace(ws, host_dir)
            print(f"[containment-smoke]   pulled (files_changed) = {pulled}")
            keep_captured = LEGIT_FILE in pulled
            host_keep = os.path.join(host_dir, LEGIT_FILE)
            keep_content = None
            if os.path.exists(host_keep):
                keep_content = Path(host_keep).read_text().strip()
            content_ok = keep_content == LEGIT_CONTENT
            keep_ok = keep_captured and content_ok
            selectivity_ok = not any(b in pulled for b in ESCAPE_BASENAMES)
            print(
                f"[containment-smoke]   keep.txt captured = {keep_captured}; "
                f"host content = {keep_content!r} (ok={content_ok})"
            )
            print(f"[containment-smoke]   no escape basename in pulled = {selectivity_ok}")
    except Exception:
        print("\n[containment-smoke] FAILED during bring-up / container exercise:")
        traceback.print_exc()
    finally:
        # Never leave a container behind, on any path.
        leftover = reap_agent_containers()
        if leftover:
            print(f"[containment-smoke] finally: reaped leftover container(s) = {leftover}")

    # HOST-CLEAN — after teardown, no watched path may flip absent -> present.
    after = snapshot_present(leak_paths)
    new_leaks = sorted(after - before)
    host_clean = not new_leaks
    # Diagnostic spotlight on the critical path; it is in the watch set, so it already
    # gates PASS via host_clean — surfaced separately here for the operator's eye.
    critical_leaked = os.path.exists(CRITICAL_HOST_PATH) and CRITICAL_HOST_PATH not in before

    # (5) The honest two-layer breakdown.
    denied = [c[0] for c in classifications if not c[3]]
    landed = [c[0] for c in classifications if c[3]]
    print("\n[containment-smoke] (5) two-layer containment report:")
    print(f"[containment-smoke]   least_privilege (DENIED in-container) = {denied}")
    print(f"[containment-smoke]   boundary (LANDED then contained)      = {landed}")
    print(f"[containment-smoke]   boundary_exercised (>=1 landed)       = {boundary_exercised}")
    if not boundary_exercised:
        print(
            "[containment-smoke]   !! no out-of-/workspace write landed — could not "
            "exercise the Docker boundary; add another writable target"
        )

    # (6) Host-clean + pull-target-clean (these prove EVERY landed vector is trapped).
    print("\n[containment-smoke] (6) HOST-CLEAN check (after teardown):")
    print(f"[containment-smoke]   new host leaks = {new_leaks}  -> host_clean = {host_clean}")
    print(f"[containment-smoke]   critical path leaked = {critical_leaked} ({CRITICAL_HOST_PATH})")
    pt_escapes = pull_target_escapes(host_dir)
    pull_target_clean = not pt_escapes
    pt_contents = sorted(str(p) for p in Path(host_dir).rglob("*") if p.is_file())
    print(f"[containment-smoke]   pull-target contents = {pt_contents}")
    print(
        f"[containment-smoke]   pull-target escape files = {pt_escapes} "
        f"-> clean = {pull_target_clean}"
    )

    # PASS: the boundary was genuinely exercised (>=1 landed) AND the legit file shipped
    # AND nothing escaped via the pull or onto the host. Given selectivity ∧ host_clean,
    # every LANDED vector is provably trapped — so denied + landed are BOTH contained.
    ok = boundary_exercised and keep_ok and selectivity_ok and host_clean and pull_target_clean
    print("\n" + "=" * 64)
    print(
        f"[containment-smoke] SUMMARY: boundary_exercised={boundary_exercised} "
        f"keep_ok={keep_ok} selectivity={selectivity_ok} host_clean={host_clean} "
        f"pull_target_clean={pull_target_clean}"
    )
    print(f"[containment-smoke]   least-privilege (denied)      = {denied}")
    print(f"[containment-smoke]   boundary (landed + contained) = {landed}")
    print(f"[containment-smoke] CONTAINMENT PROVEN (least-privilege + boundary) = {ok}")
    print(
        "[containment-smoke] DONE. Confirm no orphan remains:  "
        "docker ps -a | grep agent-server   (expect empty)"
    )
    print("=" * 64)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
