"""M-h4 LIVE smoke against the DEPLOYED app — the acceptance evidence for the deploy.

Read-only: it makes plain GET requests to the public URL and asserts what a browser would see. No
credentials, no writes, no Fly API calls, so it is safe to re-run at any time and prints nothing
secret (the GitHub install URL it echoes carries only the PUBLIC client_id + the callback).

    uv run python ../scripts/deploy_smoke_check.py [--base-url https://tvashtr.fly.dev]

Exit 0 = every check passed. Each check prints its decisive line.
"""

from __future__ import annotations

import argparse
import sys

import httpx

DEFAULT_BASE_URL = "https://tvashtr.fly.dev"
# A path only the SPA's client-side router knows about. A one-origin deploy must answer it with the
# app shell, not a 404 — that is the whole point of the catch-all.
DEEP_LINK = "/dashboard"

failures: list[str] = []


def check(label: str, ok: bool, detail: str) -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {label}\n        {detail}")
    if not ok:
        failures.append(label)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    print(f"\n=== M-h4 LIVE smoke: {base} ===\n")
    # A generous timeout on purpose: the machine sleeps when idle, so the FIRST request of a smoke
    # run is paying for a cold start (auto_start_machines). That wake is the feature, not a fault.
    client = httpx.Client(timeout=60.0, follow_redirects=False)

    # 1. /health — the human check. Proves the deployed process reached Neon AND that the schema the
    #    release_command migrated is really there (db.ping() runs a query).
    resp = client.get(f"{base}/health")
    check(
        "GET /health -> 200 {'status':'ok','db':'ok'} (Neon reachable + schema present)",
        resp.status_code == 200 and resp.json() == {"status": "ok", "db": "ok"},
        f"HTTP {resp.status_code} {resp.text.strip()}",
    )

    # 2. /healthz — the DB-free probe Fly polls, which must NOT wake Neon.
    resp = client.get(f"{base}/healthz")
    check(
        "GET /healthz -> 200 {'status':'ok'} (DB-free liveness)",
        resp.status_code == 200 and resp.json() == {"status": "ok"},
        f"HTTP {resp.status_code} {resp.text.strip()}",
    )

    # 3. /api/config — hosted posture + the redirect_uri that names THIS environment.
    resp = client.get(f"{base}/api/config")
    body = resp.json() if resp.status_code == 200 else {}
    install_url = body.get("github_install_url", "")
    check(
        "GET /api/config -> hosted_mode: true",
        resp.status_code == 200 and body.get("hosted_mode") is True,
        f"HTTP {resp.status_code} hosted_mode={body.get('hosted_mode')!r}",
    )
    check(
        "github_install_url carries redirect_uri pointing at THIS deployment",
        "redirect_uri=" in install_url and "tvashtr.fly.dev" in install_url,
        f"github_install_url={install_url}",
    )

    # 4. The SPA root — one-origin serving.
    resp = client.get(f"{base}/")
    is_html = "text/html" in resp.headers.get("content-type", "") and "<div id=" in resp.text
    check(
        "GET / -> index.html (one-origin SPA root)",
        resp.status_code == 200 and is_html,
        f"HTTP {resp.status_code} content-type={resp.headers.get('content-type')!r} "
        f"bytes={len(resp.content)}",
    )

    # 5. A deep link — the catch-all, i.e. reload-on-a-client-route does not 404.
    deep = client.get(f"{base}{DEEP_LINK}")
    check(
        f"GET {DEEP_LINK} -> index.html (client-route deep link, not 404)",
        deep.status_code == 200 and "<div id=" in deep.text,
        f"HTTP {deep.status_code} bytes={len(deep.content)} "
        f"same-shell-as-root={deep.content == resp.content}",
    )

    # 6. An unknown /api path must STAY a JSON 404 — proof the catch-all never shadowed the API.
    missing = client.get(f"{base}/api/definitely-not-a-route")
    check(
        "GET /api/<unknown> -> 404 JSON (catch-all does not shadow the API)",
        missing.status_code == 404 and "<div id=" not in missing.text,
        f"HTTP {missing.status_code} {missing.text.strip()[:120]}",
    )

    # 7. The session cookie is Secure in production. Read off a REAL login attempt: the credentials
    #    are deliberately bogus, so this 401s — but FastAPI still emits no cookie there. Instead
    #    assert the posture the app advertises via a request that DOES set one is not available
    #    without an account, so we assert the next best real signal: HTTPS is enforced.
    plain = httpx.Client(timeout=60.0, follow_redirects=False).get(
        base.replace("https://", "http://")
    )
    check(
        "http:// -> redirected to https (force_https)",
        plain.status_code in (301, 302, 307, 308)
        and plain.headers.get("location", "").startswith("https://"),
        f"HTTP {plain.status_code} location={plain.headers.get('location')!r}",
    )

    print(f"\n=== {len(failures)} failed / 7 checks ===")
    if failures:
        for name in failures:
            print(f"  FAILED: {name}")
        return 1
    print("ALL LIVE SMOKE CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
