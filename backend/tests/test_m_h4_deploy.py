"""M-h4 (DEPLOY): the reproduce-first proofs for what a PUBLIC, one-origin, HTTPS deploy needs.

Every test below was written BEFORE its fix and was RED on ``main`` @ ``857d9b2``:

* **the cookie** — ``set_session_cookie`` hardcoded ``secure=False``, so the session cookie a real
  HTTPS deployment hands out was still sendable over plain http, and ``clear_session_cookie``
  emitted a DIFFERENT attribute set (browsers only clear a cookie when the clearing
  ``Set-Cookie`` matches, so a Secure cookie would not have logged out);
* **the region** — ``create_machine`` POSTed a SINGLE region, so Fly answering HTTP 422
  ``insufficient_capacity`` (which ``bom`` did twice inside one minute on 2026-07-19) failed the
  whole run rather than trying the next region;
* **the GitHub redirect** — ``build_install_url()`` carried no ``redirect_uri``, so with BOTH
  callbacks now registered on the App (localhost + tvashtr.fly.dev) GitHub could not tell which
  environment to return the user to;
* **the SPA** — nothing served the frontend, so a one-origin deploy had no ``/`` and no deep links.

The local-safe defaults are asserted here too, deliberately: every knob this milestone adds
defaults to today's exact behaviour, which is what keeps local ``make test`` and http dev
byte-identical to ``main``.

⚠️ THE HARD RULE, same as ``test_fly_machines.py``: **no test here may reach the real Fly API or
spend a cent.** ``make test`` does ``include .env`` + ``export``, so the operator's live
``TVASHTR_FLY_API_TOKEN`` is ambient in this very process. Every Fly test below injects an
``httpx.Client`` bound to an ``httpx.MockTransport`` and uses a fake token literal, so no socket
opens and even a leaked request could not authenticate.
"""

import json
import uuid
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient

from tvashtr import auth as auth_module
from tvashtr import db
from tvashtr.config import Settings, get_settings
from tvashtr.control_plane import github_app
from tvashtr.engines.fly_machines import FlyApiError, FlyMachines, parse_regions
from tvashtr.main import mount_frontend

FAKE_TOKEN = "fly-test-token-NOT-REAL-abc123"
FAKE_IMAGE = "ghcr.io/openhands/agent-server:latest-python"
MACHINE_IP = "fdaa:9e:ceff:a7b:513:4389:6b65:2"


def _settings(monkeypatch, **env: str) -> Settings:
    """A real ``Settings`` built from an explicit env, with the repo ``.env`` file switched OFF.

    A real instance rather than a stub because the patched module reads MORE than the field under
    test (``set_session_cookie`` also signs with ``session_secret``) — a stub would pass for the
    wrong reason."""
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return Settings(_env_file=None)


# ---- D4: the session cookie is Secure in production, plain http locally --------------------------


def test_session_cookie_carries_secure_when_configured(monkeypatch):
    """RED on main: ``secure=False`` was hardcoded, so this header never contained ``Secure``."""
    secure = _settings(monkeypatch, TVASHTR_COOKIE_SECURE="true")
    monkeypatch.setattr(auth_module, "get_settings", lambda: secure)
    response = Response()
    auth_module.set_session_cookie(response, str(uuid.uuid4()))

    header = response.headers["set-cookie"].lower()
    assert "secure" in header, header
    # The attributes that were already right must stay right — Secure is an ADDITION, not a swap.
    assert "httponly" in header and "samesite=lax" in header and "path=/" in header


def test_session_cookie_defaults_to_plain_http_for_local_dev(monkeypatch):
    """The local-safe default (the byte-identity guard): unset ⇒ exactly today's cookie.

    If this ever goes green-by-default it means local http dev silently stopped being able to log
    in — the browser would refuse to store a Secure cookie on ``http://localhost``."""
    monkeypatch.delenv("TVASHTR_COOKIE_SECURE", raising=False)
    settings = _settings(monkeypatch)
    assert settings.cookie_secure is False

    monkeypatch.setattr(auth_module, "get_settings", lambda: settings)
    response = Response()
    auth_module.set_session_cookie(response, str(uuid.uuid4()))
    assert "secure" not in response.headers["set-cookie"].lower()


def test_clear_session_cookie_matches_the_set_attributes(monkeypatch):
    """RED on main: logout emitted no ``Secure``, so a Secure cookie would NOT have been cleared.

    This is the half of the pair that is easy to forget: a browser matches the clearing
    ``Set-Cookie`` against the stored cookie's attributes, so logging out of a Secure session
    requires a Secure expiry."""
    secure = _settings(monkeypatch, TVASHTR_COOKIE_SECURE="true")
    monkeypatch.setattr(auth_module, "get_settings", lambda: secure)
    response = Response()
    auth_module.clear_session_cookie(response)

    header = response.headers["set-cookie"].lower()
    assert "secure" in header, header
    assert "samesite=lax" in header and "path=/" in header


# ---- D5: the region-fallback ladder --------------------------------------------------------------


def test_parse_regions_mirrors_the_egress_port_parser():
    assert parse_regions("bom") == ["bom"]
    assert parse_regions("sin,iad,fra") == ["sin", "iad", "fra"]
    # Tolerant about whitespace/case/empties (an env knob gets pasted by hand)...
    assert parse_regions(" SIN , ,iad ") == ["sin", "iad"]
    # ...but an entirely empty knob is a configuration error, not "no regions": a machine has to
    # boot SOMEWHERE, so this fails loudly at client construction instead of at POST time.
    with pytest.raises(ValueError, match="at least one region"):
        parse_regions("   ")


def _capacity_handler(full_regions: set[str]) -> tuple[object, list[str]]:
    """A Fly that is out of capacity in ``full_regions`` and healthy everywhere else.

    Returns the handler plus the list it records each attempted region into, so a test asserts the
    ORDER of attempts rather than merely the outcome."""
    attempted: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        region = body.get("region")
        attempted.append(region)
        if region in full_regions:
            # The real wire shape Fly returns when a region is out of hosts (Tvashtr-74, ``bom``).
            return httpx.Response(
                422, json={"error": "insufficient_capacity: no capacity for this machine size"}
            )
        return httpx.Response(200, json={"id": "m-ok", "private_ip": MACHINE_IP})

    return handler, attempted


def _fly(handler, **kw) -> FlyMachines:
    return FlyMachines(
        token=FAKE_TOKEN,
        image=FAKE_IMAGE,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        **kw,
    )


def test_create_machine_falls_back_to_the_next_region_on_insufficient_capacity():
    """RED on main: one region was POSTed, so the 422 was the end of the run.

    The assertion is on the ATTEMPT ORDER, not just success — a fallback that silently reordered
    the ladder would still "pass" an outcome-only test while sending users to the wrong continent.
    """
    handler, attempted = _capacity_handler(full_regions={"sin"})
    machine_id, private_ip = _fly(handler, regions=["sin", "iad", "fra"]).create_machine(
        "tv-run-r1", "k"
    )

    assert machine_id == "m-ok"
    assert private_ip == MACHINE_IP
    assert attempted == ["sin", "iad"], "must try sin first, then fall back to iad and STOP"


def test_create_machine_raises_immediately_on_a_non_capacity_error():
    """A real failure must NOT walk the ladder — three retries of a bad request is three times the
    latency and, on a half-created app, three times the mess."""
    attempted: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempted.append(json.loads(request.content).get("region"))
        return httpx.Response(400, text="bad machine config")

    with pytest.raises(FlyApiError, match="400"):
        _fly(handler, regions=["sin", "iad", "fra"]).create_machine("tv-run-r1", "k")
    assert attempted == ["sin"], "a non-capacity error must stop at the first region"


def test_create_machine_does_not_walk_the_ladder_on_a_non_422_capacity_lookalike():
    """Belt-and-braces on the guard's shape: the marker is the 422 STATUS *and* the body text, so a
    500 that merely mentions capacity is still a hard failure."""
    attempted: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempted.append(json.loads(request.content).get("region"))
        return httpx.Response(500, text="insufficient_capacity")

    with pytest.raises(FlyApiError, match="500"):
        _fly(handler, regions=["sin", "iad"]).create_machine("tv-run-r1", "k")
    assert attempted == ["sin"]


def test_create_machine_soft_fails_clearly_when_every_region_is_full():
    """All regions full is rare, transient, and NOT the user's fault — so the error has to say so
    and name the ladder it tried, rather than surfacing a bare HTTP 422."""
    handler, attempted = _capacity_handler(full_regions={"sin", "iad", "fra"})

    with pytest.raises(FlyApiError, match="capacity") as excinfo:
        _fly(handler, regions=["sin", "iad", "fra"]).create_machine("tv-run-r1", "k")

    message = str(excinfo.value)
    assert "sin, iad, fra" in message, message
    assert "retry" in message.lower(), message
    assert attempted == ["sin", "iad", "fra"], "every region must actually have been tried"


def test_single_region_is_byte_identical_to_the_old_behaviour():
    """The invariant that keeps every existing local/docker gate untouched: a 1-element ladder POSTs
    exactly one region, exactly as the pre-M-h4 single-region client did."""
    handler, attempted = _capacity_handler(full_regions=set())
    machine_id, _ = _fly(handler).create_machine("tv-run-r1", "k")

    assert machine_id == "m-ok"
    assert attempted == ["bom"], "the default ladder is the unchanged single 'bom'"


# ---- D6: the GitHub install URL names the environment to come back to ---------------------------


def test_build_install_url_carries_the_configured_redirect_uri(monkeypatch):
    """RED on main: no ``redirect_uri`` at all, so GitHub picked between the two registered
    callbacks on its own — a coin flip between localhost and the deployed app."""
    settings = get_settings()
    monkeypatch.setattr(settings, "github_app_client_id", "Iv1.abc")
    monkeypatch.setattr(settings, "public_base_url", "https://tvashtr.fly.dev")

    url = github_app.build_install_url()

    assert url.startswith("https://github.com/login/oauth/authorize?client_id=Iv1.abc")
    # URL-ENCODED, not raw: an unencoded ``://`` in a query value is what makes GitHub reject the
    # callback as not matching a registered one.
    assert "redirect_uri=https%3A%2F%2Ftvashtr.fly.dev%2Fapi%2Fauth%2Fgithub%2Fcallback" in url


def test_build_install_url_defaults_to_the_local_callback(monkeypatch):
    """The local-safe default: unset ⇒ local sign-in keeps working against localhost:8000."""
    monkeypatch.delenv("TVASHTR_PUBLIC_BASE_URL", raising=False)
    assert _settings(monkeypatch).public_base_url == "http://localhost:8000"

    settings = get_settings()
    monkeypatch.setattr(settings, "github_app_client_id", "Iv1.abc")
    monkeypatch.setattr(settings, "public_base_url", "http://localhost:8000")
    assert (
        "redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fapi%2Fauth%2Fgithub%2Fcallback"
        in github_app.build_install_url()
    )


def test_build_install_url_stays_empty_without_a_client_id(monkeypatch):
    """Unchanged: no client_id means hosted mode is misconfigured and there is nothing to link to —
    a bare ``redirect_uri=`` link would be worse than none."""
    monkeypatch.setattr(get_settings(), "github_app_client_id", "")
    assert github_app.build_install_url() == ""


# ---- D3: one-origin SPA serving + the DB-free health check ---------------------------------------


def _dist(tmp_path: Path) -> Path:
    """A minimal built-frontend layout: ``index.html`` + a hashed asset, exactly what Vite emits."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Tvashtr</title><div id=root></div>")
    (dist / "assets" / "index-abc123.js").write_text("console.log('tvashtr')")
    (dist / "favicon.svg").write_text("<svg/>")
    return dist


def _app_with_spa(dist: Path) -> TestClient:
    """An app wired in the REAL order main.py uses: API routes first, the SPA catch-all LAST."""
    app = FastAPI()

    @app.get("/api/config")
    def _config() -> dict:
        return {"hosted_mode": True}

    assert mount_frontend(app, str(dist)) is True
    return TestClient(app)


def test_spa_serves_index_at_the_root(tmp_path):
    client = _app_with_spa(_dist(tmp_path))
    resp = client.get("/")
    assert resp.status_code == 200
    assert "<div id=root>" in resp.text


def test_spa_serves_index_for_a_deep_link(tmp_path):
    """The whole point of the catch-all: a reload on ``/dashboard`` is a real HTTP request for a
    path only the client-side router knows about, and it must return the app, not a 404."""
    client = _app_with_spa(_dist(tmp_path))
    for path in ("/dashboard", "/runs/abc-123", "/teams/1/edit"):
        resp = client.get(path)
        assert resp.status_code == 200, path
        assert "<div id=root>" in resp.text, path


def test_spa_never_shadows_an_api_route(tmp_path):
    """The ordering invariant, asserted from both sides: a REAL api route still answers, and an
    UNKNOWN one still 404s as JSON instead of being swallowed into index.html (which would turn
    every frontend API bug into a silent 200 of HTML)."""
    client = _app_with_spa(_dist(tmp_path))
    assert client.get("/api/config").json() == {"hosted_mode": True}

    missing = client.get("/api/definitely-not-a-route")
    assert missing.status_code == 404
    assert "<div id=root>" not in missing.text


def test_spa_serves_real_static_files_from_the_dist_root(tmp_path):
    client = _app_with_spa(_dist(tmp_path))
    assert client.get("/assets/index-abc123.js").status_code == 200
    assert client.get("/favicon.svg").status_code == 200


def test_spa_refuses_to_escape_the_dist_directory(tmp_path):
    """A catch-all that concatenates a user-controlled path onto a directory is a traversal bug
    waiting to happen; anything that resolves outside dist falls back to index.html."""
    secret = tmp_path / "secret.txt"
    secret.write_text("do not serve me")
    client = _app_with_spa(_dist(tmp_path))

    resp = client.get("/..%2Fsecret.txt")
    assert "do not serve me" not in resp.text


def test_mount_frontend_is_a_no_op_without_a_build(tmp_path):
    """The local-safe default: no ``dist`` on disk ⇒ NO routes are added at all, so a local backend
    is byte-identical to main (``/`` 404s exactly as it does today)."""
    app = FastAPI()
    before = len(app.routes)

    assert mount_frontend(app, str(tmp_path / "does-not-exist")) is False
    assert len(app.routes) == before

    assert TestClient(app).get("/").status_code == 404


def test_healthz_is_db_free_while_health_still_pings(client, monkeypatch):
    """Fly's health check must not be what keeps Neon awake: ``/health`` pings the DB (and so wakes
    a scale-to-zero Neon on every hit), ``/healthz`` must not touch it at all.

    Proven by BREAKING the database: ``/healthz`` stays 200 ok, while ``/health`` degrades — if
    ``/healthz`` were quietly pinging too, this would fail."""

    def _boom() -> bool:
        raise RuntimeError("database is unreachable")

    monkeypatch.setattr(db, "ping", _boom)

    healthz = client.get("/healthz")
    assert healthz.status_code == 200
    assert healthz.json() == {"status": "ok"}

    assert client.get("/health").json() == {"status": "degraded", "db": "down"}
