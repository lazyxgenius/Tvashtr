"""GitHub App client (M-h1a): the whole GitHub credential chain in one openhands-free module.

app JWT (RS256, ``iss`` = app id, ``exp`` <= 10 min)
  -> POST /app/installations/{id}/access_tokens  => a 1-hour installation token, CACHED until near
     expiry
  -> GET /installation/repositories              => the repos that installation can access
plus the OAuth user-code exchange + ``GET /user`` the login callback uses to identify the account.

SECRETS DISCIPLINE (the C8 invariant, mirrored). The app private key, the client secret, the user
access token, and the installation access token live ONLY in memory. They are NEVER written to the
DB (the sole persisted GitHub datum is the non-secret numeric installation id), NEVER logged, and
NEVER returned to a caller-facing serializer. ``GithubAppError`` messages carry only an HTTP status
+ a short non-secret hint, so they are safe to surface. Outbound HTTP is stdlib ``urllib.request``
(mirrors ``litellm_admin._admin_post``; ``httpx`` is a dev-only dep and must NOT be imported here),
and every network call is a named function so offline tests fake it at the seam.

Openhands-free at import (stdlib + PyJWT + the app's own config) — nothing here imports the executor
or openhands, so any module may import it without breaching the import boundary.
"""

import base64
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime

import jwt

from tvashtr.config import get_settings

_GITHUB_API = "https://api.github.com"
_GITHUB_OAUTH_BASE = "https://github.com"
_TIMEOUT_SECONDS = 15.0
# The app JWT lifetime. GitHub caps it at 10 min; 9 min stays under the cap even with clock skew
# (the ``iat`` is also back-dated 60s for the same reason).
_APP_JWT_TTL_SECONDS = 9 * 60
# Refresh a cached installation token this long BEFORE its real expiry so an in-flight request never
# races the 1-hour boundary.
_INSTALLATION_TOKEN_SKEW_SECONDS = 5 * 60
# A defensive cap on repo pagination (100/page) — a run's owner is not expected to have thousands.
_MAX_REPO_PAGES = 10
# Bound the clone/push git subprocess so a wedged network can't hang a run (mirrors worktree's git
# cap, but longer — a clone of a real repo over HTTPS is heavier than a local worktree add).
_GIT_TIMEOUT_SECONDS = 300

# installation_id -> (token, expiry_epoch). In-process ONLY — never persisted; cleared on restart.
_installation_token_cache: dict[int, tuple[str, float]] = {}


class GithubAppError(RuntimeError):
    """A GitHub App credential / API failure whose message is SAFE to log or surface: it carries an
    HTTP status and a short non-secret hint ONLY — never a key, token, client secret, or a response
    body that could echo one."""


def _require(value: str, name: str) -> str:
    if not value:
        raise GithubAppError(f"GitHub App is not configured: {name} is unset.")
    return value


def _safe_path(url: str) -> str:
    """The host+path of a URL with any query dropped — a query can carry a ``code``/secret, so
    it must never reach an error message or log line."""
    return url.split("://", 1)[-1].split("?", 1)[0]


def _load_private_key() -> str:
    """Decode the base64 PKCS#1 PEM (``GITHUB_APP_PRIVATE_KEY_B64``) into the PEM text PyJWT reads
    with RS256 (via cryptography). Never echoes the key material — a decode failure raises a generic
    ``GithubAppError``."""
    b64 = _require(get_settings().github_app_private_key_b64, "GITHUB_APP_PRIVATE_KEY_B64")
    try:
        pem = base64.b64decode(b64).decode("utf-8")
    except Exception:
        raise GithubAppError("GITHUB_APP_PRIVATE_KEY_B64 is not valid base64.") from None
    if "PRIVATE KEY" not in pem:
        raise GithubAppError("GITHUB_APP_PRIVATE_KEY_B64 did not decode to a PEM private key.")
    return pem


def mint_app_jwt(*, now: int | None = None) -> str:
    """Mint the short-lived app JWT: RS256, ``iss`` = the app id, ``exp`` <= 10 min. ``now`` is an
    injectable epoch seam so tests are deterministic without patching the clock."""
    app_id = _require(get_settings().github_app_id, "GITHUB_APP_ID")
    issued = int(now if now is not None else time.time())
    payload = {"iat": issued - 60, "exp": issued + _APP_JWT_TTL_SECONDS, "iss": app_id}
    return jwt.encode(payload, _load_private_key(), algorithm="RS256")


def _http(
    method: str,
    url: str,
    *,
    token: str | None = None,
    body: dict | None = None,
    accept: str = "application/vnd.github+json",
) -> dict | list:
    """One GitHub HTTP call via stdlib urllib (mirrors ``litellm_admin._admin_post``). Raises
    ``GithubAppError`` — with the STATUS ONLY, never the response body — on a non-2xx, so an error
    can never echo a token/secret GitHub reflected back. ``httpx`` is deliberately not used."""
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": accept, "User-Agent": "tvashtr", "X-GitHub-Api-Version": "2022-11-28"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)  # noqa: S310
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as resp:  # noqa: S310
            return json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        # STATUS ONLY — deliberately drop exc.read() (it can echo the presented token/secret).
        raise GithubAppError(f"GitHub {method} {_safe_path(url)} -> HTTP {exc.code}") from None
    except urllib.error.URLError as exc:
        raise GithubAppError(
            f"GitHub {method} {_safe_path(url)} unreachable: {exc.reason}"
        ) from None


def _parse_iso8601(value: object) -> float:
    """GitHub's ``expires_at`` (e.g. ``'2026-07-17T12:00:00Z'``) -> epoch seconds. Falls back to
    ``now + 1h`` (GitHub's installation-token TTL) if the field is missing/unparseable, so
    a cache entry always carries a real expiry."""
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            pass
    return time.time() + 3600


def create_installation_access_token(installation_id: int) -> tuple[str, float]:
    """Mint a 1-hour installation access token for ``installation_id`` from the app JWT. Returns
    ``(token, expiry_epoch)``. The token is a SECRET — the caller caches it in memory only, never
    persists or logs it."""
    result = _http(
        "POST",
        f"{_GITHUB_API}/app/installations/{int(installation_id)}/access_tokens",
        token=mint_app_jwt(),
    )
    token = result.get("token") if isinstance(result, dict) else None
    if not token:
        raise GithubAppError("GitHub returned no installation token.")
    return token, _parse_iso8601(result.get("expires_at"))


def get_installation_token(installation_id: int) -> str:
    """A valid installation token for ``installation_id`` — minting + caching a new one ONLY when
    none is cached or the cached one is within the refresh-skew of expiry. The cache is in-process
    ONLY (never persisted)."""
    installation_id = int(installation_id)
    cached = _installation_token_cache.get(installation_id)
    if cached is not None and cached[1] - time.time() > _INSTALLATION_TOKEN_SKEW_SECONDS:
        return cached[0]
    token, expiry = create_installation_access_token(installation_id)
    _installation_token_cache[installation_id] = (token, expiry)
    return token


def _repo_to_dict(repo: dict) -> dict:
    """A repository as the dashboard shows it — NON-secret fields only (never the token used to
    fetch it)."""
    return {
        "name": repo.get("name"),
        "full_name": repo.get("full_name"),
        "private": repo.get("private"),
        "default_branch": repo.get("default_branch"),
        "html_url": repo.get("html_url"),
    }


def list_installation_repositories(installation_id: int) -> list[dict]:
    """The repositories ``installation_id`` can access, as a whitelist of NON-secret fields. Uses a
    cached installation token; paginates up to ``_MAX_REPO_PAGES`` pages of 100."""
    token = get_installation_token(installation_id)
    repos: list[dict] = []
    page = 1
    while page <= _MAX_REPO_PAGES:
        result = _http(
            "GET",
            f"{_GITHUB_API}/installation/repositories?per_page=100&page={page}",
            token=token,
        )
        batch = result.get("repositories", []) if isinstance(result, dict) else []
        repos.extend(_repo_to_dict(r) for r in batch)
        if len(batch) < 100:
            break
        page += 1
    return repos


def exchange_code_for_user_token(code: str) -> str:
    """Exchange an OAuth ``code`` for a user access token (POST github.com/login/oauth/access_token
    with the client id + client SECRET). The returned token is a SECRET — the callback uses it once
    to read the user identity, then discards it (never stored/logged/returned)."""
    settings = get_settings()
    body = {
        "client_id": _require(settings.github_app_client_id, "GITHUB_APP_CLIENT_ID"),
        "client_secret": _require(settings.github_app_client_secret, "GITHUB_APP_CLIENT_SECRET"),
        "code": code,
    }
    result = _http(
        "POST",
        f"{_GITHUB_OAUTH_BASE}/login/oauth/access_token",
        body=body,
        accept="application/json",
    )
    token = result.get("access_token") if isinstance(result, dict) else None
    if not token:
        # A failed exchange returns {"error": "..."} — surface the error CODE only, never the body.
        err = result.get("error") if isinstance(result, dict) else "unknown"
        raise GithubAppError(f"GitHub OAuth code exchange failed: {err}")
    return token


def get_authenticated_user(user_token: str) -> dict:
    """Identify the user behind a user access token via ``GET /user``. Returns the NON-secret
    identity fields the callback needs: ``{id, login, email}`` (``email`` may be ``None`` if the
    user keeps it private)."""
    result = _http("GET", f"{_GITHUB_API}/user", token=user_token)
    if not isinstance(result, dict) or not result.get("id"):
        raise GithubAppError("GitHub /user returned no id.")
    return {"id": result.get("id"), "login": result.get("login"), "email": result.get("email")}


def build_install_url() -> str:
    """The FE "Continue with GitHub" SIGN-IN target, built server-side from PUBLIC config ONLY. Uses
    the OAuth **authorize** URL (``github.com/login/oauth/authorize?client_id=…``) as the PRIMARY
    door: it authorises an EXISTING installation AND prompts a first-time user to install, so a
    RETURNING hosted user is actually signed in. (The slug ``installations/new`` page only works
    ONCE — GitHub then bounces an already-installed user to its settings and issues no ``code``,
    so the callback never fires. That URL is demoted to the SECONDARY ``build_manage_url``.) Empty
    string when no client_id is configured (hosted mode misconfigured). NEVER contains a secret."""
    client_id = get_settings().github_app_client_id.strip()
    if client_id:
        return f"{_GITHUB_OAUTH_BASE}/login/oauth/authorize?client_id={client_id}"
    return ""


def _normalize_app_slug(raw: str) -> str:
    """The bare ``<slug>`` from a configured ``GITHUB_APP_SLUG`` that MAY have been pasted as the
    full ``https://github.com/apps/<slug>`` URL GitHub's settings page offers (with a copy button).
    Strip that known ``…/apps/`` prefix (any scheme) and keep only the slug segment, so it is never
    interpolated raw into a doubled ``…/apps/https://github.com/apps/<slug>/…`` 404."""
    slug = raw.strip()
    for host in ("https://github.com", "http://github.com", "github.com"):
        prefix = f"{host}/apps/"
        if slug.startswith(prefix):
            slug = slug[len(prefix) :]
            break
    return slug.strip("/").split("/", 1)[0]


def build_manage_url() -> str:
    """The SECONDARY "add repositories on GitHub" target — the
    ``github.com/apps/<slug>/installations/new`` install page — for a signed-in user whose
    installation covers NO repos and needs to grant the App access to some. Built from the PUBLIC
    app slug ONLY (tolerating a slug pasted as the full app URL, see ``_normalize_app_slug``); empty
    string when no slug is configured. NEVER contains a secret."""
    slug = _normalize_app_slug(get_settings().github_app_slug)
    if slug:
        return f"{_GITHUB_OAUTH_BASE}/apps/{slug}/installations/new"
    return ""


# ---- Git clone / push over HTTPS + the Pull Request API (M-h1b) ----------------------------------
#
# The hosted-run delivery chute: clone the user's repo server-side (a durable step then sets
# ``repo_path`` so the run looks like a local brownfield run), then push the ship branch + open a PR
# on the Ship terminal. The 1h installation token is a SECRET — it rides the git command line / the
# tokenised URL ONLY, is scrubbed off ``.git/config`` right after a clone, and NEVER lands in a
# log (this module has none), a row, a response, or an error (``_git`` names only the subcommand;
# git echoes the tokenised remote URL into its OWN stderr, so the raw output must never surface).


def _git(*args: str, cwd: str | None = None) -> subprocess.CompletedProcess:
    """Run a git command, capturing output. On failure raise ``GithubAppError`` naming ONLY the
    subcommand (``args[0]``) + the exit code — NEVER the argv or stderr: a clone/push argv carries
    the tokenised ``https://x-access-token:<token>@…`` URL, and git echoes it back into stderr, so
    surfacing either would leak the token. A timeout is the same hazard: ``subprocess.run`` raises
    ``TimeoutExpired``, whose ``__str__`` renders the full tokenised argv. Catch it and raise a
    token-free error (``from None`` keeps the original out of the traceback)."""
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=_GIT_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        raise GithubAppError(f"git {args[0]} timed out after {_GIT_TIMEOUT_SECONDS}s") from None
    if result.returncode != 0:
        raise GithubAppError(f"git {args[0]} failed (exit {result.returncode})")
    return result


def _tokenized_url(token: str, full_name: str) -> str:
    """The tokenised HTTPS git URL for ``owner/name``. SECRET — command-line / clone use ONLY."""
    return f"https://x-access-token:{token}@github.com/{full_name}.git"


def _tokenless_url(full_name: str) -> str:
    """The plain HTTPS git URL for ``owner/name`` — safe to persist in ``.git/config``."""
    return f"https://github.com/{full_name}.git"


def _clone_and_scrub(tokenized_url: str, tokenless_url: str, dest: str) -> None:
    """Clone ``tokenized_url`` into ``dest``, then IMMEDIATELY rewrite ``remote.origin.url`` to
    ``tokenless_url``. git persists the clone URL into ``dest/.git/config``, so a 1h token left
    there is both a leak and useless by push time — scrub it. Idempotent (crash-resume): a
    ``dest`` that already holds a repo is left as-is, only the tokenless remote re-asserted. Split
    from :func:`clone_repo` (builds the URLs) so the scrub is unit-testable against a local repo."""
    if os.path.isdir(os.path.join(dest, ".git")):
        _git("remote", "set-url", "origin", tokenless_url, cwd=dest)
        return
    parent = os.path.dirname(dest)
    if parent:
        os.makedirs(parent, exist_ok=True)
    _git("clone", tokenized_url, dest)
    _git("remote", "set-url", "origin", tokenless_url, cwd=dest)


def clone_repo(installation_id: int, full_name: str, dest: str) -> None:
    """Clone ``full_name`` (``owner/name``) into ``dest`` with a fresh 1h installation token, then
    scrub the token off ``.git/config`` (see :func:`_clone_and_scrub`). Idempotent on resume."""
    token = get_installation_token(installation_id)
    _clone_and_scrub(_tokenized_url(token, full_name), _tokenless_url(full_name), dest)


def push_branch(installation_id: int, full_name: str, repo_dir: str, branch: str) -> None:
    """Push ``branch`` from ``repo_dir`` to ``full_name`` with a FRESH 1h installation token on the
    command line ONLY — never persisted, never re-added as a remote (the run's ``.git/config`` stays
    tokenless). An explicit refspec so nothing else is pushed. Runs git IN ``repo_dir`` via ``cwd``
    (not ``-C``), so an error names the real subcommand (``git push``), not ``git -C``."""
    token = get_installation_token(installation_id)
    _git("push", _tokenized_url(token, full_name), f"{branch}:{branch}", cwd=repo_dir)


def find_repo_in_installations(
    installation_ids: list[int], full_name: str
) -> tuple[int, dict] | None:
    """The ``(installation_id, repo-dict)`` for ``full_name`` across ``installation_ids`` — or
    ``None`` if no installation can access it. OWNER-SCOPED authorization: the caller passes the ids
    from ``github_installations`` WHERE ``owner_id`` == the current user, so this can only match a
    repo the owner actually controls (a user may POST any ``full_name``)."""
    for installation_id in installation_ids:
        for repo in list_installation_repositories(installation_id):
            if repo.get("full_name") == full_name:
                return installation_id, repo
    return None


def list_open_pull_requests(installation_id: int, full_name: str, *, head: str) -> list[dict]:
    """Open PRs on ``full_name`` whose head branch is ``head`` — for idempotent PR creation (create
    only if absent). GitHub's ``head`` filter wants ``owner:branch``."""
    token = get_installation_token(installation_id)
    owner = full_name.split("/", 1)[0]
    result = _http(
        "GET",
        f"{_GITHUB_API}/repos/{full_name}/pulls?state=open&head={owner}:{head}",
        token=token,
    )
    return result if isinstance(result, list) else []


def create_pull_request(
    installation_id: int, full_name: str, *, head: str, base: str, title: str, body: str
) -> dict:
    """Open a PR on ``full_name`` from ``head`` into ``base``. Returns the NON-secret
    ``{html_url, number}``. A duplicate create returns a 422 whose body ``_http`` drops (status
    alone can't tell 'already exists' from a real error), so callers MUST dedup via
    :func:`list_open_pull_requests` first — never catch-and-guess."""
    token = get_installation_token(installation_id)
    result = _http(
        "POST",
        f"{_GITHUB_API}/repos/{full_name}/pulls",
        token=token,
        body={"title": title, "head": head, "base": base, "body": body},
    )
    if not isinstance(result, dict) or not result.get("html_url"):
        raise GithubAppError("GitHub returned no PR url.")
    return {"html_url": result.get("html_url"), "number": result.get("number")}


def open_pull_request_idempotent(
    installation_id: int, full_name: str, *, head: str, base: str, title: str, body: str
) -> str:
    """Open a PR from ``head`` into ``base`` IDEMPOTENTLY (the ``idempotent_ship`` discipline): list
    open PRs for ``head`` first, create only if absent. Returns the PR html url. Re-runnable — a
    second Ship (crash-resume, or a re-run) reuses the existing PR instead of erroring on a dup."""
    existing = list_open_pull_requests(installation_id, full_name, head=head)
    if existing:
        return existing[0].get("html_url")
    return create_pull_request(
        installation_id, full_name, head=head, base=base, title=title, body=body
    )["html_url"]
