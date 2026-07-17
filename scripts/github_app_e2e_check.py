#!/usr/bin/env python
"""Opt-in LIVE gate for the M-h1a GitHub App credential chain, against the operator's REAL
App — NO browser, NO TestClient. Proves:

  app JWT (RS256, iss=app id, exp<=10min)
    -> POST /app/installations/{id}/access_tokens  => a 1-hour installation token
    -> GET /installation/repositories              => the repos that installation can access
    -> asserts the expected repo (``trade_mcp``) IS in the list.

SECRETS: the app JWT and the installation token are NEVER printed — only "minted OK", the token's
expiry + character length, and the (non-secret) repo names. Skips cleanly (``return 0``) when the
GITHUB_APP_* vars are absent, mirroring ``docs_chain_check.py``'s provider-key skip.

Run via ``make github-app-e2e``. The browser OAuth round-trip (code -> user token -> /user) is the
operator's to test with a real GitHub login; this gate exercises only the App-authenticated chain.
"""

import os
import sys
from datetime import UTC, datetime
from pathlib import Path

# The gate ground truth (operator's App). Overridable so the harness is not a hardcode-only.
_INSTALLATION_ID = int(os.environ.get("TVASHTR_GH_INSTALLATION_ID", "147133756"))
_EXPECT_REPO = os.environ.get("TVASHTR_GH_EXPECT_REPO", "trade_mcp")
# The App credentials this gate needs (the JWT + installation-token chain). client_id/secret drive
# the OAuth code exchange, which is the operator's browser test — NOT exercised here.
_REQUIRED_ENV = ("GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY_B64")


def _load_dotenv() -> None:
    """Load ../.env with a defensive parser (a hyphenated key breaks a plain ``source``). Only
    ``KEY=value`` identifier lines are set; existing env wins."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.isidentifier():
            os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def _matches(repo: dict) -> bool:
    """True if ``repo`` is the expected repo — by bare name or the ``owner/name`` tail."""
    return repo.get("name") == _EXPECT_REPO or (repo.get("full_name") or "").endswith(
        f"/{_EXPECT_REPO}"
    )


def main() -> int:
    _load_dotenv()

    missing = [name for name in _REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        print(
            f"[github-app-e2e] missing {', '.join(missing)} in .env — skipping the live GitHub App "
            "gate. (Not a failure.)"
        )
        return 0

    # Import AFTER the env is loaded so get_settings() picks up the credentials.
    from tvashtr.control_plane import github_app

    print(f"[github-app-e2e] installation_id={_INSTALLATION_ID}, expecting repo {_EXPECT_REPO!r}")

    # 1) App JWT — RS256, iss=app id, exp<=10min. NEVER printed.
    try:
        app_jwt = github_app.mint_app_jwt()
    except github_app.GithubAppError as exc:
        print(f"[github-app-e2e] FAILED to mint the app JWT: {exc}", file=sys.stderr)
        return 1
    segments = app_jwt.count(".") + 1
    if segments != 3:
        print(
            f"[github-app-e2e] FAILED: app JWT is not a 3-segment JWS (got {segments})",
            file=sys.stderr,
        )
        return 1
    print(f"[github-app-e2e] app-JWT minted OK (RS256, {len(app_jwt)} chars, {segments} segments)")

    # 2) Installation token — echo ONLY its expiry + length, NEVER the token itself.
    try:
        token, expiry_epoch = github_app.create_installation_access_token(_INSTALLATION_ID)
    except github_app.GithubAppError as exc:
        print(f"[github-app-e2e] FAILED to mint the installation token: {exc}", file=sys.stderr)
        return 1
    expiry = datetime.fromtimestamp(expiry_epoch, tz=UTC).isoformat()
    print(
        f"[github-app-e2e] installation token minted for {_INSTALLATION_ID}: "
        f"expires {expiry}, length={len(token)} chars"
    )
    # Seed the cache so the repos call reuses this token (no second mint).
    github_app._installation_token_cache[_INSTALLATION_ID] = (token, expiry_epoch)

    # 3) Repos — the (non-secret) list the installation can access.
    try:
        repos = github_app.list_installation_repositories(_INSTALLATION_ID)
    except github_app.GithubAppError as exc:
        print(f"[github-app-e2e] FAILED to list installation repositories: {exc}", file=sys.stderr)
        return 1
    names = sorted(r.get("full_name") or r.get("name") or "" for r in repos)
    print(f"[github-app-e2e] {len(repos)} repositories: {names}")

    # 4) Assert the expected repo is present.
    present = any(_matches(r) for r in repos)
    print("\n================= GITHUB-APP-E2E RESULT =================")
    print("app JWT minted            : True (RS256)")
    print(f"installation token minted : True (for {_INSTALLATION_ID})")
    print(f"repositories fetched      : {len(repos)}")
    print(f"{_EXPECT_REPO!r} in the list       : {present}")
    print("========================================================")
    return 0 if present else 1


if __name__ == "__main__":
    raise SystemExit(main())
