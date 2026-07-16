#!/usr/bin/env python
"""M-reaper LIVE gate (``make reaper-check``): prove the boot sweep SPARES a container owned by a
LIVE process and REAPS it once the owner is dead — against a REAL container + REAL docker.

Flow:
  1. Start a real container from the configured agent-server image.
  2. Register it in the live-container registry with a LIVE pid (this process); run the boot sweep;
     assert the container SURVIVES.
  3. Re-register the SAME container with a DEAD pid; run the boot sweep again; assert it is REAPED.

Skips cleanly (exit 0) when it cannot run safely: no docker daemon, the image is absent, or there
are PRE-EXISTING agent-server containers (the image-scoped reaper would remove those too — we refuse
to touch the operator's containers). Any assertion failure exits non-zero so ``make reaper-check``
fails loudly. The registry is redirected to a throwaway temp file, so the real one is never touched.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from tvashtr.config import get_settings
from tvashtr.engines import docker_runtime, sandbox_cache

_TIMEOUT = 60


def _docker(*args: str, timeout: int = _TIMEOUT) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["docker", *args], check=False, capture_output=True, text=True, timeout=timeout
    )


def _skip(msg: str) -> None:
    print(f"SKIP: {msg}")
    print("reaper-check: SKIPPED (environment cannot run the live gate; not a failure)")
    sys.exit(0)


def _fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    sys.exit(1)


def _dead_pid() -> int:
    """A pid guaranteed dead: spawn a trivial process, reap it (``wait``), return its freed pid."""
    proc = subprocess.Popen([sys.executable, "-c", ""])
    proc.wait()
    return proc.pid


def _exists(cid: str) -> bool:
    return _docker("inspect", "--format", "{{.Id}}", cid).returncode == 0


def _start_container(image: str) -> tuple[str | None, str]:
    """Start a real container from ``image`` (idle ``sleep`` entrypoint). Falls back to a created-
    but-not-started container, which still descends from the image so the ancestor-scoped reaper
    finds + removes it. Returns ``(container_id | None, detail)``."""
    run = _docker("run", "-d", "--entrypoint", "sleep", image, "3600")
    if run.returncode == 0 and run.stdout.strip():
        return run.stdout.strip(), "running (sleep 3600)"
    created = _docker("create", image)
    if created.returncode == 0 and created.stdout.strip():
        return created.stdout.strip(), "created"
    return None, (run.stderr.strip() or created.stderr.strip() or "unknown docker error")


def main() -> None:
    image = get_settings().agent_server_image

    ver = _docker("version", "--format", "{{.Server.Version}}")
    if ver.returncode != 0:
        _skip(f"docker daemon unavailable ({ver.stderr.strip() or 'no server'})")
    print(f"docker: available (server {ver.stdout.strip()})")

    if _docker("image", "inspect", image).returncode != 0:
        _skip(f"agent-server image not present locally: {image}")
    print(f"image: present ({image})")

    pre = [
        c
        for c in _docker("ps", "-aq", "--filter", f"ancestor={image}").stdout.splitlines()
        if c.strip()
    ]
    if pre:
        _skip(
            f"{len(pre)} pre-existing agent-server container(s) present; refusing to run "
            "(the image-scoped reaper would remove them too). Clean them up and re-run."
        )
    print("pre-existing agent-server containers: none (safe to run)")

    # Redirect the registry to a throwaway temp file — never touch the real one.
    tmpdir = tempfile.mkdtemp(prefix="reaper-check-")
    sandbox_cache._REGISTRY_PATH = Path(tmpdir) / "live_containers.json"

    cid: str | None = None
    try:
        cid, detail = _start_container(image)
        if cid is None:
            _fail(f"could not start a container from {image}: {detail}")
        print(f"started container {cid[:12]} from the agent-server image [{detail}]")

        # --- Sweep #1: owner pid ALIVE -> the container must SURVIVE (the fix) ---
        sandbox_cache.register_live_container(cid, run_id="reaper-check", pid=os.getpid())
        if cid not in sandbox_cache.spared_container_ids():
            _fail("a live-pid registry entry was not in the spare set")
        docker_runtime.sweep_orphaned_agent_containers()
        if not _exists(cid):
            _fail("boot sweep REAPED a container owned by a LIVE process — it must be spared")
        print(f"sweep #1 (owner pid {os.getpid()} ALIVE): container {cid[:12]} SURVIVES  [PASS]")

        # --- Sweep #2: owner pid DEAD -> the container must be REAPED (the P1.3a backstop) ---
        dead = _dead_pid()
        sandbox_cache.register_live_container(cid, run_id="reaper-check", pid=dead)
        if cid in sandbox_cache.spared_container_ids():
            _fail("a dead-pid registry entry was wrongly in the spare set")
        docker_runtime.sweep_orphaned_agent_containers()
        if _exists(cid):
            _fail("boot sweep did NOT reap a DEAD-owner container (orphan backstop broken)")
        print(f"sweep #2 (owner pid {dead} DEAD): container {cid[:12]} REAPED  [PASS]")
        cid = None  # already gone; skip the finally rm

        print("reaper-check: PASS — live-owned SPARED, dead-owner REAPED (P1.3a backstop intact)")
    finally:
        if cid and _exists(cid):
            _docker("rm", "-f", cid)
        shutil.rmtree(tmpdir, ignore_errors=True)  # remove the throwaway registry dir on every exit


if __name__ == "__main__":
    main()
