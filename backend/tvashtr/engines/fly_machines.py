"""Fly.io Machines lifecycle — the per-run Firecracker microVM sandbox substrate (M-h2a).

This module owns the whole life of ONE run's throwaway sandbox: create a per-run **app** on the
run owner's **private network**, allocate its one-way **Flycast** door, boot a machine from the
agent-server image, and destroy the lot at run-end. It is deliberately:

- **``openhands``-free** — it knows nothing about conversations, workspaces or agents. The engine
  adapter composes this module with the OpenHands ``RemoteWorkspace``; the two never import each
  other. (Same discipline as ``docker_runtime.py`` vs the docker adapter.)
- **pure ``httpx``, NO CLI shell-out** — the docker path's ``docker`` shell-out is the registered
  blocker (a subprocess per call, unparseable failures, a hard dependency on a CLI being installed
  and logged-in). Machines lifecycle is a REST API; IP allocation is one GraphQL mutation. There is
  no ``flyctl`` anywhere in this file, and there must never be.

THE TWO FENCES (D2), both implemented here:

1. **A private network per USER** (``u<owner_id>-net``), passed at ``POST /v1/apps``. Fly pins an
   app's network AT CREATE and it can NEVER change ⇒ **the isolation granularity IS the app**, which
   is exactly why the app is per-run and named for the run. Every Fly private address is
   ``fdaa:<network-id>:…``, so a machine's ``private_ip`` is *self-evidencing*: a run machine whose
   address does NOT carry the operator's default network id is provably NOT on the network the
   backend and Postgres share. That is the live gate's fence assertion — read off the address, not
   off a config flag we set ourselves.

2. **The agent server's ``X-Session-API-Key`` turned ON**, fresh-random per run. The docker path can
   run the agent server passwordless because loopback is its fence (``DockerWorkspace`` literally
   does ``object.__setattr__(self, "api_key", None)``); a network-bound server has no such luxury.
   We mint a key (:func:`mint_session_key`), hand it to the server via the machine's
   ``SESSION_API_KEY`` env var (the agent server's own ``V0_SESSION_API_KEY_ENV`` — see
   ``openhands/agent_server/config.py``), and the adapter presents the SAME key as the
   ``RemoteWorkspace`` ``api_key``, which the SDK sends as the ``X-Session-API-Key`` header.
   Belt AND braces, because what is behind that door is a shell.

WHY THE FLYCAST IP IS ALLOCATED ON THE **DEFAULT** NETWORK (the one-way door): a Flycast address is
reachable from the network it was allocated on. Allocating it on the *default* network means the
backend (which lives there) can dial the run app, while the run app — sitting on ``u<owner>-net`` —
has no route back to us and no route to any other tenant's sandbox. Fly's own words for this shape:
the app "won't be accessible via Flycast from its own network". Allocating on the run's network
instead would quietly hand every sandbox a path to every other one.

COST: the per-user network is free (one interpolated string in a POST body we already send) and the
machine is per-second and dies with the run. **The image is the cost** — it is pulled on every cold
host — which is why ``fly_agent_image`` is a config knob and why the live gate MEASURES pull+boot
seconds rather than guessing. ``restart.policy = "no"`` is set so a crash-looping guest can never
quietly bill forever, and teardown is ``DELETE /v1/apps/<name>`` — atomic and total (machine +
Flycast IP + app in one call), because the #1 way to burn money on Fly is a machine that outlives
its job.

SECRETS (the C8 invariant): the Fly API token and the per-run session key are never logged, never
persisted, and never serialized into a response or an error message. Every outbound error path runs
through :func:`_scrub`, which redacts both before the text can reach a log line or an exception.
"""

from __future__ import annotations

import logging
import re
import secrets
import time
from dataclasses import dataclass

import httpx

logger = logging.getLogger("tvashtr.engines.fly_machines")

# The Machines REST API and the (separate, older) GraphQL API. IP allocation is the one operation
# that has no REST equivalent, so it — and only it — goes to GraphQL.
FLY_MACHINES_API = "https://api.machines.dev/v1"
FLY_GRAPHQL_API = "https://api.fly.io/graphql"

# The agent server's own env var for its session key (openhands/agent_server/config.py:
# ``V0_SESSION_API_KEY_ENV = "SESSION_API_KEY"``). Setting it is what turns the door's lock ON.
SESSION_API_KEY_ENV = "SESSION_API_KEY"

# The port the agent server listens on inside the guest — and the port Flycast publishes. Kept
# identical to the docker path's container port so the two sandboxes are the same shape.
AGENT_SERVER_PORT = 8000

_APP_PREFIX = "tv-run-"
_MAX_APP_NAME = 63  # Fly's limit
_INVALID_CHARS = re.compile(r"[^a-z0-9-]+")
_RUNS_OF_DASHES = re.compile(r"-{2,}")


class FlyApiError(RuntimeError):
    """A Fly API call failed. The message carries the operation + status + a SCRUBBED body (never
    the API token, never the per-run session key)."""


def _slug(raw: object) -> str:
    """Lower-case ``raw`` and squeeze it into Fly's ``^[a-z0-9-]+$``. Runs of invalid characters
    collapse to a single dash and leading/trailing dashes are stripped, so a UUID passes through
    unchanged while anything hostile becomes inert."""
    s = _INVALID_CHARS.sub("-", str(raw).lower())
    s = _RUNS_OF_DASHES.sub("-", s).strip("-")
    return s


def app_name_for_run(run_id: object) -> str:
    """The per-run app name: ``tv-run-<run_id>``, Fly-sanitized and capped at 63 chars.

    Naming the app for the run is what makes teardown, the fence check, and (in M-h2b) orphan
    reaping all addressable by a string we already have. A run_id is a UUID ⇒ 43 chars, comfortably
    inside the cap. Raises on a run_id that sanitizes to nothing rather than creating a shared
    ``tv-run`` app that two runs would then fight over."""
    slug = _slug(run_id)
    if not slug:
        raise ValueError(f"run_id {run_id!r} does not sanitize to a valid Fly app name")
    return f"{_APP_PREFIX}{slug}"[:_MAX_APP_NAME].rstrip("-")


def network_name_for_owner(owner_id: object) -> str:
    """The per-USER private network: ``u<owner_id>-net`` (D2a).

    Per-user, NOT per-run: the trust boundary is between tenants, so one user's runs may share a
    network while no user can ever see another's. Set at app-create and immutable thereafter."""
    slug = _slug(owner_id)
    if not slug:
        raise ValueError(f"owner_id {owner_id!r} does not sanitize to a valid Fly network name")
    return f"u{slug}-net"


def mint_session_key() -> str:
    """A fresh random per-run agent-server key (D2b). ``secrets`` (not ``random``) — this is the
    only thing between the public-ish Flycast door and a shell."""
    return secrets.token_urlsafe(32)


@dataclass(frozen=True)
class FlyRunMachine:
    """One live per-run sandbox. ``flycast_host`` is the base URL the adapter hands to
    ``RemoteWorkspace(host=…)``; ``private_ip`` is the fence evidence (see the module docstring);
    ``boot_seconds`` is the measured image-pull + cold-boot cost the §6 tuning lever needs.

    Deliberately carries NO session key — the key lives in the adapter's in-process cache entry and
    is never attached to an object that might get logged or serialized."""

    app_name: str
    machine_id: str
    private_ip: str
    flycast_address: str
    boot_seconds: float  # create -> machine state=started (image pull + microVM boot)
    ready_seconds: float = 0.0  # create -> agent server answering /health (what a user waits)

    @property
    def flycast_host(self) -> str:
        return f"http://{self.app_name}.flycast:{AGENT_SERVER_PORT}"


class FlyMachines:
    """A thin, testable client over the Fly Machines REST API + the one GraphQL IP mutation.

    ``client`` is injectable so every unit test can bind an ``httpx.MockTransport`` and assert the
    exact request bodies without a socket ever opening. THIS IS LOAD-BEARING: the Makefile does
    ``include .env`` + ``export``, so the real ``TVASHTR_FLY_API_TOKEN`` is ambient during
    ``make test`` — a Fly test that constructed a default client would hit the real API and spend
    real money. Every test injects."""

    def __init__(
        self,
        *,
        token: str,
        org: str = "personal",
        region: str = "bom",
        image: str,
        guest_cpus: int = 1,
        guest_memory_mb: int = 2048,
        client: httpx.Client | None = None,
        timeout: float = 60.0,
    ) -> None:
        if not token:
            raise ValueError("a Fly API token is required")
        self._token = token
        self.org = org
        self.region = region
        self.image = image
        self.guest_cpus = guest_cpus
        self.guest_memory_mb = guest_memory_mb
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=timeout)

    # --- plumbing -------------------------------------------------------------------------

    def _scrub(self, text: str) -> str:
        """Redact the API token and anything key-shaped from text that is about to become a log
        line or an exception message (the C8 invariant)."""
        if not text:
            return ""
        return text.replace(self._token, "<redacted-fly-token>")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    def _request(
        self, method: str, url: str, *, op: str, ok: tuple[int, ...], **kw
    ) -> httpx.Response:
        """One HTTP call with uniform, SCRUBBED error reporting. ``ok`` is the set of statuses this
        operation considers success — passed explicitly per call because Fly is inconsistent
        (201 on app create, 200 on machine create, 202 on app delete)."""
        try:
            resp = self._client.request(method, url, headers=self._headers(), **kw)
        except httpx.HTTPError as exc:
            raise FlyApiError(f"fly {op} failed: {self._scrub(str(exc))}") from None
        if resp.status_code not in ok:
            raise FlyApiError(
                f"fly {op} failed: HTTP {resp.status_code} {self._scrub(resp.text)[:400]}"
            )
        return resp

    def close(self) -> None:
        """Close the HTTP client iff we created it (an injected one belongs to the caller)."""
        if self._owns_client:
            self._client.close()

    # --- lifecycle ------------------------------------------------------------------------

    def create_app(self, app_name: str, network: str) -> None:
        """``POST /v1/apps`` — create the per-run app ON THE OWNER'S PRIVATE NETWORK.

        ``network`` is the whole first fence and it is settable ONLY here: Fly pins an app's network
        at create and offers no way to move it afterwards. That immutability is a feature — it means
        the fence cannot be silently loosened later by any other code path."""
        self._request(
            "POST",
            f"{FLY_MACHINES_API}/apps",
            op="create_app",
            ok=(200, 201),
            json={"app_name": app_name, "org_slug": self.org, "network": network},
        )
        logger.info("fly: created app %s on network %s", app_name, network)

    def allocate_flycast(self, app_name: str) -> str:
        """Allocate the app's Flycast (private v6) address via GraphQL and return it.

        NOTE the deliberate OMISSION of a ``network:`` argument — that is not an oversight, it is
        the one-way door. Omitting it allocates on the org's DEFAULT network (where the backend
        lives), so we can dial the run app while the run app, on ``u<owner>-net``, cannot dial us
        or any sibling sandbox. Allocating on the run's own network instead would silently make the
        door two-way. An app with a Flycast address gets DNS at ``<app-name>.flycast`` ⇒ we never
        bookkeep the IP itself.

        GraphQL returns errors with HTTP 200, so the payload is checked, not just the status."""
        query = (
            "mutation($appId: ID!) {"
            "  allocateIpAddress(input: {appId: $appId, type: private_v6}) {"
            "    ipAddress { address type }"
            "  }"
            "}"
        )
        resp = self._request(
            "POST",
            FLY_GRAPHQL_API,
            op="allocate_flycast",
            ok=(200,),
            json={"query": query, "variables": {"appId": app_name}},
        )
        body = resp.json()
        if body.get("errors"):
            raise FlyApiError(f"fly allocate_flycast failed: {self._scrub(str(body['errors']))}")
        try:
            address = body["data"]["allocateIpAddress"]["ipAddress"]["address"]
        except (KeyError, TypeError):
            raise FlyApiError(
                f"fly allocate_flycast returned no address: {self._scrub(str(body))[:400]}"
            ) from None
        logger.info("fly: allocated flycast for %s -> %s.flycast", app_name, app_name)
        return address

    def machine_config(self, session_api_key: str, env: dict[str, str] | None = None) -> dict:
        """The machine payload's ``config`` block. Split out so a unit test can assert its exact
        shape (image / guest / the key env / the server flags / the Flycast service) without
        standing up the whole create path.

        ``init.cmd`` carries the agent server's OWN flags — ``--host 0.0.0.0 --port 8000`` — which
        is byte-for-byte what ``DockerWorkspace`` appends after the image name (see the SDK's
        ``run_cmd``). Fly's ``init.cmd`` overrides the image's CMD while keeping its ENTRYPOINT, so
        the guest starts the identical server the docker path does. ``0.0.0.0`` (NOT
        ``fly-local-6pn``) is required for Flycast, which routes through fly-proxy.

        ``services`` publishes the port to fly-proxy — without it the Flycast address resolves but
        routes nowhere. ``restart.policy = "no"``: a run's sandbox is a one-shot; a restart loop
        would be a silent, unbounded bill."""
        return {
            "image": self.image,
            "guest": {
                "cpu_kind": "shared",
                "cpus": self.guest_cpus,
                "memory_mb": self.guest_memory_mb,
            },
            # D2b: the server refuses every request without this key once this env var is set.
            "env": {SESSION_API_KEY_ENV: session_api_key, **(env or {})},
            "init": {"cmd": ["--host", "0.0.0.0", "--port", str(AGENT_SERVER_PORT)]},
            "services": [
                {
                    "protocol": "tcp",
                    "internal_port": AGENT_SERVER_PORT,
                    "ports": [{"port": AGENT_SERVER_PORT, "handlers": []}],
                }
            ],
            "restart": {"policy": "no"},
        }

    def create_machine(
        self, app_name: str, session_api_key: str, env: dict[str, str] | None = None
    ) -> tuple[str, str]:
        """``POST /v1/apps/<app>/machines`` — boot the guest. Returns ``(machine_id, private_ip)``.

        The ``private_ip`` is returned to the caller (and, from there, to the live gate) because it
        is the FENCE EVIDENCE: it is minted by Fly on the network the app was created with, so it
        proves the isolation off the address rather than off our own config."""
        resp = self._request(
            "POST",
            f"{FLY_MACHINES_API}/apps/{app_name}/machines",
            op="create_machine",
            ok=(200, 201),
            json={"region": self.region, "config": self.machine_config(session_api_key, env)},
        )
        body = resp.json()
        machine_id = body.get("id") or ""
        private_ip = body.get("private_ip") or ""
        if not machine_id:
            raise FlyApiError(f"fly create_machine returned no id: {self._scrub(str(body))[:400]}")
        logger.info("fly: created machine %s in app %s", machine_id, app_name)
        return machine_id, private_ip

    def wait_started(self, app_name: str, machine_id: str, timeout_s: float = 300.0) -> None:
        """Block until the machine reports ``started`` (``GET …/machines/<id>/wait?state=started``).

        Fly's wait endpoint caps its own timeout at 60s per call, so this loops against an overall
        deadline — a cold host that must pull the heavy agent-server image genuinely takes longer
        than one wait window. A per-call timeout is NOT a failure; only the outer deadline is."""
        deadline = time.monotonic() + timeout_s
        last: str = ""
        while time.monotonic() < deadline:
            remaining = max(1, min(60, int(deadline - time.monotonic())))
            try:
                resp = self._client.request(
                    "GET",
                    f"{FLY_MACHINES_API}/apps/{app_name}/machines/{machine_id}/wait",
                    headers=self._headers(),
                    params={"state": "started", "timeout": remaining},
                )
            except httpx.HTTPError as exc:
                last = self._scrub(str(exc))
                continue
            if resp.status_code == 200:
                return
            last = f"HTTP {resp.status_code} {self._scrub(resp.text)[:200]}"
        raise FlyApiError(
            f"fly machine {machine_id} did not reach state=started within {timeout_s}s: {last}"
        )

    def wait_healthy(self, base_url: str, timeout_s: float = 300.0) -> float:
        """Poll ``GET <base_url>/health`` until the AGENT SERVER answers. Returns seconds waited.

        THIS IS NOT REDUNDANT WITH :meth:`wait_started`, and conflating the two is a real bug (it
        was this module's first live failure): ``state=started`` means Fly has booted the *microVM*,
        which happens well before the Python agent server inside it has bound its port. Dialing
        Flycast in that window gets a TCP connection that fly-proxy accepts and then closes with no
        HTTP response (``RemoteProtocolError: Server disconnected``) — which looks exactly like a
        routing/fence misconfiguration but is pure impatience. The docker path has always done this
        (``DockerWorkspace._wait_for_health``); the Fly path needs it more, because a cold Fly host
        must also pull a 1.4GB image first.

        ``/health`` sits on the agent server's unauthenticated ``server_details_router``, so no key
        is sent here — which is also why an unkeyed ``/api/*`` request remains a meaningful fence
        assertion. Every transport error is swallowed and retried until the deadline (mirroring the
        SDK's own health loop): during boot, connection resets ARE the expected reading."""
        deadline = time.monotonic() + timeout_s
        started = time.monotonic()
        health_url = f"{base_url.rstrip('/')}/health"
        last = "no attempt made"
        while time.monotonic() < deadline:
            try:
                resp = self._client.request("GET", health_url, timeout=10.0)
                if 200 <= resp.status_code < 300:
                    return time.monotonic() - started
                last = f"HTTP {resp.status_code}"
            except Exception as exc:  # every transport failure is expected while booting
                last = type(exc).__name__
            time.sleep(3.0)
        raise FlyApiError(
            f"agent server at {health_url} never became healthy within {timeout_s}s (last: {last})"
        )

    def delete_app(self, app_name: str) -> None:
        """``DELETE /v1/apps/<app>`` — atomic, total teardown: the machine, the Flycast IP and the
        app itself all go in one call. Tolerates 404 so teardown is IDEMPOTENT (a ``finally`` that
        runs twice, or after a partial create, must not raise and mask the real error)."""
        resp = self._client.request(
            "DELETE", f"{FLY_MACHINES_API}/apps/{app_name}", headers=self._headers()
        )
        if resp.status_code in (200, 202, 204, 404):
            logger.info("fly: deleted app %s (status=%s)", app_name, resp.status_code)
            return
        raise FlyApiError(
            f"fly delete_app failed: HTTP {resp.status_code} {self._scrub(resp.text)[:400]}"
        )

    def app_exists(self, app_name: str) -> bool:
        """``GET /v1/apps/<app>`` ⇒ does it still exist? The live gate's no-leaked-app proof."""
        resp = self._client.request(
            "GET", f"{FLY_MACHINES_API}/apps/{app_name}", headers=self._headers()
        )
        if resp.status_code == 404:
            return False
        if resp.status_code == 200:
            return True
        raise FlyApiError(
            f"fly app_exists failed: HTTP {resp.status_code} {self._scrub(resp.text)[:400]}"
        )

    # --- the composed happy path ----------------------------------------------------------

    def start_run_sandbox(
        self,
        *,
        run_id: object,
        owner_id: object,
        session_api_key: str,
        wait_timeout_s: float = 300.0,
        health_timeout_s: float = 300.0,
        env: dict[str, str] | None = None,
    ) -> FlyRunMachine:
        """Create app (on the owner's net) → allocate the one-way Flycast door → boot the machine →
        wait started → wait until the agent server actually answers. Returns the live
        :class:`FlyRunMachine` with the MEASURED boot + ready seconds.

        On ANY failure after the app exists, the partially-created app is torn down before the
        error propagates — a half-built sandbox is exactly the kind of thing that bills forever."""
        app_name = app_name_for_run(run_id)
        network = network_name_for_owner(owner_id)
        started = time.monotonic()
        self.create_app(app_name, network)
        try:
            address = self.allocate_flycast(app_name)
            machine_id, private_ip = self.create_machine(app_name, session_api_key, env)
            self.wait_started(app_name, machine_id, timeout_s=wait_timeout_s)
            boot_seconds = time.monotonic() - started
            # started != serving: the agent server binds its port well after the microVM boots.
            self.wait_healthy(
                f"http://{app_name}.flycast:{AGENT_SERVER_PORT}", timeout_s=health_timeout_s
            )
        except Exception:
            # Never leak the app we just created. Teardown is idempotent + best-effort so it can
            # never mask the original failure.
            try:
                self.delete_app(app_name)
            except Exception:
                logger.warning("fly: teardown of partial app %s failed", app_name, exc_info=True)
            raise
        ready_seconds = time.monotonic() - started
        logger.info(
            "fly: sandbox ready app=%s machine=%s private_ip=%s boot=%.1fs ready=%.1fs",
            app_name,
            machine_id,
            private_ip,
            boot_seconds,
            ready_seconds,
        )
        return FlyRunMachine(
            app_name=app_name,
            machine_id=machine_id,
            private_ip=private_ip,
            flycast_address=address,
            boot_seconds=boot_seconds,
            ready_seconds=ready_seconds,
        )
