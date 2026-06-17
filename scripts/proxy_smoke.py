#!/usr/bin/env python
"""Opt-in *live* LiteLLM-proxy plumbing smoke (P1.4a) — proves the chokepoint is
reachable BEFORE any agent run spends tokens through it.

Three checks, mirroring ``scripts/docker_smoke.py``'s "prove the plumbing first":
  (1) HOST -> proxy:        GET http://127.0.0.1:4000/health/liveliness == 200.
  (2) CONTAINER -> proxy:   the #1 risk created by the docker-default flip — start a
      DockerWorkspace EXACTLY as the docker adapter does and ``execute_command`` an HTTP
      GET to http://host.docker.internal:4000/health/liveliness from INSIDE the container;
      assert 200, tear down (--rm), assert no orphan remains. This is the assumption the
      whole proxy-in-docker-mode design rests on.
  (3) HOST -> proxy completion (only if a key is present): one cheap completion THROUGH the
      proxy (base_url + master key + ``litellm_proxy/<cheap-model>``) returning text + usage.

Skips cleanly when Docker / the proxy / the key are absent. NO product code is touched; a
throwaway diagnostic, safe to delete. Step 3 makes a tiny real call (~$0); steps 1-2 are free.

Run:  make proxy-smoke        (needs the proxy up: `make db-up` or `docker compose up -d`)
  or: cd backend && uv run python ../scripts/proxy_smoke.py
"""

import traceback
import urllib.error
import urllib.request

LIVENESS_PATH = "/health/liveliness"
# In-container probe (curl/wget may be absent on the agent-server image). Try whichever
# python interpreter exists — python3 OR python — so a missing alias can't masquerade as a
# reachability failure on this (the #1-risk) step.
_CONTAINER_GET = (
    "for py in python3 python; do command -v $py >/dev/null 2>&1 && "
    "$py -c \"import urllib.request; "
    "r=urllib.request.urlopen('http://host.docker.internal:{port}{path}', timeout=5); "
    "print('STATUS', r.status)\" && exit 0; done; echo NO_PYTHON; exit 1"
)


def _http_status(url: str, timeout: float = 5.0) -> int | None:
    """GET ``url`` and return the HTTP status, or None if the host can't be reached."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:  # noqa: S310 (local)
            return resp.status
    except urllib.error.HTTPError as exc:  # reached the proxy, non-2xx
        return exc.code
    except Exception:  # connection refused / DNS / timeout -> not reachable
        return None


def host_health_phase(settings) -> bool | None:
    """(1) Host -> proxy liveness. Returns True/False on PASS/FAIL, or None to SKIP
    cleanly (the proxy isn't up)."""
    url = f"http://{settings.litellm_proxy_host_local}:{settings.litellm_proxy_port}{LIVENESS_PATH}"
    print(f"[proxy-smoke] (1) HOST -> proxy liveness: GET {url}")
    status = _http_status(url)
    if status is None:
        print(
            "[proxy-smoke] (1) SKIP — proxy not reachable from the host. Bring it up with "
            "`make db-up` (or `docker compose up -d`) and retry."
        )
        return None
    ok = status == 200
    print(f"[proxy-smoke] (1) status={status}  PASS={ok}")
    return ok


def container_reachability_phase(settings, platform_str) -> bool:
    """(2) THE #1 RISK — container -> host.docker.internal:<port> -> 200, then teardown +
    no-orphan. Starts the same DockerWorkspace the docker adapter uses."""
    from openhands.workspace import DockerWorkspace

    from tvashtr.engines.docker_runtime import list_agent_containers, reap_agent_containers

    print("\n" + "=" * 64)
    print("[proxy-smoke] (2) CONTAINER -> proxy reachability (host.docker.internal) — #1 risk")
    print("=" * 64)

    cmd = _CONTAINER_GET.format(port=settings.litellm_proxy_port, path=LIVENESS_PATH)
    ok = False
    try:
        reap_agent_containers()  # clean slate
        print("[proxy-smoke]     starting agent-server container (first start may be slow)…")
        with DockerWorkspace(
            server_image=settings.agent_server_image,
            host_port=settings.agent_server_host_port,
            platform=platform_str,
            extra_ports=False,
        ) as ws:
            print(f"[proxy-smoke]     container up on host port={ws.host_port}; GET from inside:")
            print(f"[proxy-smoke]       {cmd}")
            result = ws.execute_command(cmd, cwd=ws.working_dir, timeout=30.0)
            stdout = (getattr(result, "stdout", "") or "").strip()
            exit_code = getattr(result, "exit_code", None)
            print(f"[proxy-smoke]     exit_code={exit_code}  stdout={stdout!r}")
            ok = exit_code == 0 and "STATUS 200" in stdout
            print(f"[proxy-smoke]     container reached the proxy via host.docker.internal = {ok}")
    except Exception:
        print("\n[proxy-smoke] (2) FAILED during container reachability:")
        traceback.print_exc()
        ok = False
    finally:
        leftover = reap_agent_containers()
        if leftover:
            print(f"[proxy-smoke]     finally: reaped leftover container(s) = {leftover}")

    no_orphan = not list_agent_containers()
    print(f"[proxy-smoke] (2) no orphan after teardown = {no_orphan}; PASS={ok and no_orphan}")
    return ok and no_orphan


def completion_phase(settings) -> bool | None:
    """(3) Host -> proxy completion (only with a key). One cheap call THROUGH the proxy
    returning text + usage. Returns None to SKIP (no key)."""
    import os

    import litellm

    # Need a provider key behind the proxy AND the master key the proxy authenticates.
    if not os.environ.get("OPENROUTER_API_KEY"):
        print("\n[proxy-smoke] (3) SKIP — no OPENROUTER_API_KEY (no completion attempted).")
        return None
    # No silent fallback: present exactly what a real agent run would (settings.litellm_master_key).
    # If it's unset, a real run would 401 too — so skip honestly rather than mask it.
    if not settings.litellm_master_key:
        print(
            "\n[proxy-smoke] (3) SKIP — LITELLM_MASTER_KEY not set. A real proxy-enabled agent "
            "run would present api_key=None and 401 at the proxy; set LITELLM_MASTER_KEY "
            "(matching the proxy's key) to exercise a completion."
        )
        return None
    master_key = settings.litellm_master_key
    base_url = settings.agent_llm_base_url("local")
    model = f"litellm_proxy/{settings.default_model}"

    print("\n" + "=" * 64)
    print(f"[proxy-smoke] (3) HOST -> proxy completion via {base_url}  model={model}")
    print("=" * 64)
    litellm.suppress_debug_info = True
    litellm.telemetry = False
    try:
        resp = litellm.completion(
            model=model,
            base_url=base_url,
            api_key=master_key,
            messages=[{"role": "user", "content": "Reply with the single word: ok"}],
            max_tokens=8,
            temperature=0.0,
        )
        text = resp.choices[0].message.content or ""
        usage = getattr(resp, "usage", None)
        total = int(getattr(usage, "total_tokens", 0) or 0)
        print(f"[proxy-smoke]     text={text.strip()!r}  total_tokens={total}")
        ok = bool(text.strip()) and total > 0
        print(f"[proxy-smoke] (3) completion through the proxy returned text + usage = {ok}")
        return ok
    except Exception:
        print("\n[proxy-smoke] (3) FAILED during completion through the proxy:")
        traceback.print_exc()
        return False


def main() -> int:
    try:
        import shutil

        from tvashtr.config import get_settings
        from tvashtr.engines.openhands_docker_adapter import _detect_platform
    except Exception:
        print("[proxy-smoke] could not import deps; run via `make proxy-smoke`.")
        return 0

    settings = get_settings()
    print("[proxy-smoke] P1.4a LiteLLM-proxy plumbing smoke")
    print(f"[proxy-smoke] proxy port = {settings.litellm_proxy_port}")
    print(f"[proxy-smoke] docker host alias = {settings.litellm_proxy_host_docker}")

    # (1) Host health — also the SKIP gate (no proxy -> nothing to prove).
    health = host_health_phase(settings)
    if health is None:
        return 0  # clean skip
    if not health:
        print("\n[proxy-smoke] SUMMARY: host liveness FAILED — proxy up but not 200.")
        return 1

    # (2) Container reachability — needs Docker. Skip cleanly if absent.
    if shutil.which("docker") is None:
        print("\n[proxy-smoke] (2) SKIP — docker CLI not found.")
        reach = None
    else:
        platform_str = settings.agent_server_platform or _detect_platform()
        reach = container_reachability_phase(settings, platform_str)

    # (3) Completion through the proxy — needs a key.
    completion = completion_phase(settings)

    print("\n" + "=" * 64)
    print(
        f"[proxy-smoke] SUMMARY: host_liveness={health}  "
        f"container_reachability={'SKIP' if reach is None else reach}  "
        f"completion={'SKIP' if completion is None else completion}"
    )
    print("[proxy-smoke] DONE. (step 2 is the #1 risk: container -> host.docker.internal -> 200)")
    print("=" * 64)
    # FAIL only on a check that actually ran and returned False.
    failed = (reach is False) or (completion is False)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
