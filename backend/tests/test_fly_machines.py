"""M-h2a: the Fly microVM lifecycle module — the API faked ENTIRELY (invariant §5.5).

⚠️ THE HARD RULE THIS FILE ENFORCES: **no test here may ever reach the real Fly API or spend a
cent.** The Makefile does ``include .env`` + ``export``, so the operator's live
``TVASHTR_FLY_API_TOKEN`` is ambient in every ``make test`` process — a test that constructed a
default ``FlyMachines`` would quietly create real machines and bill for them. Every test below
injects an ``httpx.Client`` bound to an ``httpx.MockTransport``; no socket is ever opened. The
token used is a fake literal, so even a bug that leaked a request could not authenticate.

What is asserted is the exact WIRE SHAPE, because that shape *is* the security boundary: the
per-user ``network`` on app-create, the Flycast allocation with NO network argument (the one-way
door), the ``SESSION_API_KEY`` env that turns the agent server's lock on, and the DELETE that makes
teardown total.
"""

import httpx
import pytest

from tvashtr.engines.fly_machines import (
    AGENT_SERVER_PORT,
    SESSION_API_KEY_ENV,
    FlyApiError,
    FlyMachines,
    app_name_for_run,
    derive_session_key,
    network_name_for_owner,
)

FAKE_TOKEN = "fly-test-token-NOT-REAL-abc123"
FAKE_IMAGE = "ghcr.io/openhands/agent-server:latest-python"
MACHINE_IP = "fdaa:9e:ceff:a7b:513:4389:6b65:2"


class FakeFly:
    """A scripted Fly API. Records every request so tests can assert exact bodies."""

    def __init__(self, *, started_after: int = 1, app_deleted: bool = False):
        self.requests: list[httpx.Request] = []
        self.bodies: list[dict] = []
        self.started_after = started_after  # how many /wait calls before state=started
        self.wait_calls = 0
        self.app_deleted = app_deleted
        self.deleted: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        import json as _json

        self.requests.append(request)
        if request.content:
            try:
                self.bodies.append(_json.loads(request.content))
            except ValueError:
                self.bodies.append({})
        path = request.url.path
        method = request.method

        if method == "POST" and path == "/v1/apps":
            return httpx.Response(201, json={})
        if method == "POST" and path.endswith("/network_policies"):
            # M-h3: ``start_run_sandbox`` now raises the egress fence between app-create and
            # machine-create, so this fake has to answer it — mirroring the real API, which
            # returns 201 with the new policy's ULID. The fence's OWN assertions (exact body,
            # ordering, fail-closed) live in ``test_fly_egress.py``; here it is scripted only so
            # the M-h2a composition tests keep testing what they were written to test.
            return httpx.Response(201, json={"id": "01KXWNAG11DV1THSFSMFKT5XVR"})
        if method == "POST" and "api.fly.io" in request.url.host:
            return httpx.Response(
                200,
                json={
                    "data": {
                        "allocateIpAddress": {
                            "ipAddress": {"address": "fdaa:0:1::3", "type": "private_v6"}
                        }
                    }
                },
            )
        if method == "POST" and path.endswith("/machines"):
            return httpx.Response(200, json={"id": "abc123machine", "private_ip": MACHINE_IP})
        if method == "GET" and path.endswith("/wait"):
            self.wait_calls += 1
            if self.wait_calls >= self.started_after:
                return httpx.Response(200, json={"ok": True})
            return httpx.Response(408, text="timeout waiting for state")
        if method == "GET" and path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        if method == "DELETE" and path.startswith("/v1/apps/"):
            self.deleted.append(path.rsplit("/", 1)[-1])
            return httpx.Response(202, json={})
        if method == "GET" and path.startswith("/v1/apps/"):
            if self.app_deleted or path.rsplit("/", 1)[-1] in self.deleted:
                return httpx.Response(404, text="app not found")
            return httpx.Response(200, json={"name": path.rsplit("/", 1)[-1]})
        return httpx.Response(500, text=f"unscripted: {method} {request.url}")


def _client(fake: FakeFly, **kw) -> FlyMachines:
    return FlyMachines(
        token=FAKE_TOKEN,
        image=FAKE_IMAGE,
        client=httpx.Client(transport=httpx.MockTransport(fake.handler)),
        **kw,
    )


# ---- naming: the fence's addressability ----


def test_app_name_and_network_name_are_fly_safe():
    run_id = "AA9D8A2B-D54D-49E2-9CC0-AB20B60A1098"
    owner_id = "2a88d617-b541-4adc-82fb-682d0415fee1"
    app = app_name_for_run(run_id)
    net = network_name_for_owner(owner_id)
    assert app == "tv-run-aa9d8a2b-d54d-49e2-9cc0-ab20b60a1098"
    assert len(app) <= 63
    assert all(c.islower() or c.isdigit() or c == "-" for c in app)
    assert net == "u2a88d617-b541-4adc-82fb-682d0415fee1-net"
    # The org's one pre-existing app must never be matched by our naming (never touch it).
    assert not app.startswith("cryptoground")


def test_hostile_ids_are_sanitized_not_passed_through():
    assert app_name_for_run("../../evil app!!") == "tv-run-evil-app"
    assert network_name_for_owner("Owner ID/../x") == "uowner-id-x-net"
    with pytest.raises(ValueError):
        app_name_for_run("!!!")
    with pytest.raises(ValueError):
        network_name_for_owner("///")


def test_derived_session_keys_are_per_run_and_long():
    """M-h2b replaced the random mint with an HMAC derivation. The properties that MUST survive that
    swap: distinct runs get unrelated keys, and every key is still long."""
    keys = {derive_session_key(f"run-{i}", "a-test-secret") for i in range(50)}
    assert len(keys) == 50  # per RUN — never shared between two runs
    assert all(len(k) >= 32 for k in keys)


def test_the_session_key_is_deterministic_given_run_id_and_secret():
    """THE property the whole storage-free durable handle rests on (M-h2b Piece 3): a restarted
    backend re-cuts the identical key from the run_id, so the key never has to be persisted — which
    is what keeps the C8 "never logged, persisted, or serialized" invariant true while ALSO
    surviving a crash."""
    a = derive_session_key("run-xyz", "a-test-secret")
    b = derive_session_key("run-xyz", "a-test-secret")
    assert a == b, "same run_id + same secret must re-derive the SAME key"


def test_a_different_secret_yields_a_different_key():
    """The secret is what makes a public-ish run_id unguessable: without it, knowing the app name
    (which is the run_id) would be enough to mint the key to the shell behind the door."""
    run_id = "run-xyz"
    assert derive_session_key(run_id, "secret-one") != derive_session_key(run_id, "secret-two")


def test_the_session_key_is_not_the_raw_run_id_or_secret():
    """A derivation that leaked either input would hand an attacker the door."""
    key = derive_session_key("run-xyz", "a-test-secret")
    assert "run-xyz" not in key
    assert "a-test-secret" not in key


# ---- fence 1: the per-user private network, set at app-create ----


def test_create_app_posts_the_owner_network():
    fake = FakeFly()
    _client(fake).create_app("tv-run-r1", "u-owner-net")
    body = fake.bodies[0]
    assert body == {"app_name": "tv-run-r1", "org_slug": "personal", "network": "u-owner-net"}
    assert str(fake.requests[0].url) == "https://api.machines.dev/v1/apps"
    assert fake.requests[0].headers["Authorization"] == f"Bearer {FAKE_TOKEN}"


# ---- the one-way door: Flycast allocated on the DEFAULT network ----


def test_allocate_flycast_omits_network_so_the_door_is_one_way():
    """The absence of a ``network:`` argument IS the one-way door — allocating on the DEFAULT
    network lets the backend dial the run app while the run app (on u<owner>-net) can never dial
    back. A regression that added a network argument here would silently make it two-way, so this
    asserts the omission explicitly rather than trusting the query string to stay put."""
    fake = FakeFly()
    address = _client(fake).allocate_flycast("tv-run-r1")
    assert address == "fdaa:0:1::3"
    body = fake.bodies[0]
    assert body["variables"] == {"appId": "tv-run-r1"}
    assert "private_v6" in body["query"]
    assert "network" not in body["query"]  # <-- the door stays one-way
    assert str(fake.requests[0].url) == "https://api.fly.io/graphql"


def test_allocate_flycast_raises_on_graphql_errors_despite_http_200():
    """GraphQL reports failures with HTTP 200, so the payload must be inspected — otherwise a
    failed allocation would look like success and the run would hang dialing a dead address."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errors": [{"message": "insufficient permissions"}]})

    fly = FlyMachines(
        token=FAKE_TOKEN,
        image=FAKE_IMAGE,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    with pytest.raises(FlyApiError, match="insufficient permissions"):
        fly.allocate_flycast("tv-run-r1")


# ---- fence 2: the per-run session key reaches the guest ----


def test_machine_config_carries_the_session_key_and_the_server_flags():
    fake = FakeFly()
    fly = _client(fake, guest_cpus=2, guest_memory_mb=4096)
    config = fly.machine_config("secret-per-run-key")

    assert config["image"] == FAKE_IMAGE
    assert config["guest"] == {"cpu_kind": "shared", "cpus": 2, "memory_mb": 4096}
    # D2b: this env var is what makes the agent server demand X-Session-API-Key.
    assert config["env"][SESSION_API_KEY_ENV] == "secret-per-run-key"
    # Byte-for-byte the flags DockerWorkspace appends; 0.0.0.0 (NOT fly-local-6pn) for Flycast.
    assert config["init"]["cmd"] == ["--host", "0.0.0.0", "--port", str(AGENT_SERVER_PORT)]
    assert "fly-local-6pn" not in str(config)
    # Without a service, the Flycast address resolves but routes nowhere.
    assert config["services"][0]["internal_port"] == AGENT_SERVER_PORT
    # A one-shot sandbox must never restart-loop into an unbounded bill.
    assert config["restart"] == {"policy": "no"}


def test_create_machine_returns_the_private_ip_for_the_fence_check():
    fake = FakeFly()
    machine_id, private_ip = _client(fake).create_machine("tv-run-r1", "k")
    assert machine_id == "abc123machine"
    assert private_ip == MACHINE_IP
    assert fake.bodies[0]["region"] == "bom"


def test_create_machine_raises_when_no_id_comes_back():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"private_ip": MACHINE_IP})

    fly = FlyMachines(
        token=FAKE_TOKEN,
        image=FAKE_IMAGE,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    with pytest.raises(FlyApiError, match="no id"):
        fly.create_machine("tv-run-r1", "k")


# ---- wait / teardown ----


def test_wait_started_polls_until_the_machine_transitions():
    fake = FakeFly(started_after=3)  # two 408s, then started
    _client(fake).wait_started("tv-run-r1", "abc123machine", timeout_s=30)
    assert fake.wait_calls == 3


def test_wait_started_raises_after_the_deadline():
    fake = FakeFly(started_after=10_000)  # never starts
    with pytest.raises(FlyApiError, match="did not reach state=started"):
        _client(fake).wait_started("tv-run-r1", "abc123machine", timeout_s=0.3)


def test_wait_healthy_retries_transport_errors_then_succeeds(monkeypatch):
    """A booting guest resets connections before it binds — that is the EXPECTED reading, not a
    failure. (This is the live bug the health wait was added for: ``state=started`` fires long
    before the agent server serves, and dialing then yields RemoteProtocolError.)"""
    monkeypatch.setattr("tvashtr.engines.fly_machines.time.sleep", lambda _s: None)
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.RemoteProtocolError("Server disconnected without sending a response.")
        return httpx.Response(200, json={"status": "ok"})

    fly = FlyMachines(
        token=FAKE_TOKEN,
        image=FAKE_IMAGE,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    fly.wait_healthy("http://tv-run-r1.flycast:8000", timeout_s=30)
    assert calls["n"] == 3


def test_delete_app_is_total_and_idempotent():
    fake = FakeFly()
    fly = _client(fake)
    fly.delete_app("tv-run-r1")
    assert fake.deleted == ["tv-run-r1"]
    assert str(fake.requests[-1].url) == "https://api.machines.dev/v1/apps/tv-run-r1"
    # A 404 (already gone) must not raise — a ``finally`` that runs twice can't mask the real error.
    fly.delete_app("tv-run-r1")


def test_app_exists_reports_absence_after_delete():
    fake = FakeFly()
    fly = _client(fake)
    assert fly.app_exists("tv-run-r1") is True
    fly.delete_app("tv-run-r1")
    assert fly.app_exists("tv-run-r1") is False


# ---- the composed path + failure containment ----


def test_start_run_sandbox_composes_the_whole_fence():
    fake = FakeFly()
    fly = _client(fake)
    machine = fly.start_run_sandbox(
        run_id="aa9d8a2b-d54d-49e2-9cc0-ab20b60a1098",
        owner_id="2a88d617-b541-4adc-82fb-682d0415fee1",
        session_api_key="per-run-secret",
    )
    assert machine.app_name == "tv-run-aa9d8a2b-d54d-49e2-9cc0-ab20b60a1098"
    assert machine.private_ip == MACHINE_IP
    assert machine.flycast_host == (
        f"http://tv-run-aa9d8a2b-d54d-49e2-9cc0-ab20b60a1098.flycast:{AGENT_SERVER_PORT}"
    )
    assert machine.boot_seconds >= 0 and machine.ready_seconds >= machine.boot_seconds
    # The app was created on the OWNER's network, not the default one.
    assert fake.bodies[0]["network"] == "u2a88d617-b541-4adc-82fb-682d0415fee1-net"
    # ...and nothing was torn down on the happy path.
    assert fake.deleted == []


def test_start_run_sandbox_tears_down_the_app_when_boot_fails():
    """A half-built sandbox is exactly the thing that bills forever, so a failure anywhere after
    app-create must delete the app before propagating."""
    fake = FakeFly(started_after=10_000)  # machine never starts
    fly = _client(fake)
    with pytest.raises(FlyApiError):
        fly.start_run_sandbox(run_id="r1", owner_id="o1", session_api_key="k", wait_timeout_s=0.3)
    assert fake.deleted == ["tv-run-r1"]  # no leak


# ---- C8: secrets discipline ----


def test_api_token_is_never_echoed_into_an_error_message():
    """The token is ambient in this process during ``make test``; an error path that echoed a
    request would leak it into logs. Errors are scrubbed."""

    def handler(request: httpx.Request) -> httpx.Response:
        # A hostile/verbose API that reflects the caller's own Authorization header back.
        return httpx.Response(400, text=f"bad request from {request.headers['Authorization']}")

    fly = FlyMachines(
        token=FAKE_TOKEN,
        image=FAKE_IMAGE,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    with pytest.raises(FlyApiError) as excinfo:
        fly.create_app("tv-run-r1", "u-o-net")
    assert FAKE_TOKEN not in str(excinfo.value)
    assert "<redacted-fly-token>" in str(excinfo.value)


def test_the_live_machine_object_carries_no_session_key():
    """The per-run key lives in the adapter's in-process cache, never on an object that might be
    logged or serialized."""
    fake = FakeFly()
    machine = _client(fake).start_run_sandbox(
        run_id="r1", owner_id="o1", session_api_key="super-secret-key"
    )
    assert "super-secret-key" not in repr(machine)
    assert not hasattr(machine, "session_api_key")


# ---- M-h2b: suspend / resume — the economics of a run parked at a gate ----


def _suspend_fake():
    """A Fly that records suspend/start/list/machines traffic. Deliberately answers ``/stop`` with a
    500 so that a regression to STOP would fail loudly rather than silently reset the guest."""

    calls: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        path = request.url.path
        if path.endswith("/suspend"):
            return httpx.Response(200, json={"ok": True})
        if path.endswith("/start"):
            return httpx.Response(200, json={"ok": True})
        if path.endswith("/wait"):
            return httpx.Response(200, json={"ok": True})
        if path.endswith("/machines"):
            return httpx.Response(
                200,
                json=[{"id": "m-abc", "state": "suspended", "private_ip": MACHINE_IP}],
            )
        if path == "/v1/apps":
            return httpx.Response(
                200,
                json={
                    "total_apps": 2,
                    "apps": [{"name": "tv-run-r1"}, {"name": "cryptoground-data"}],
                },
            )
        return httpx.Response(500, text=f"unscripted: {request.method} {path}")

    return calls, handler


def _suspend_client(handler) -> FlyMachines:
    return FlyMachines(
        token=FAKE_TOKEN,
        image=FAKE_IMAGE,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_suspend_hits_suspend_and_never_stop():
    """SUSPEND, NOT STOP — the single most important wire assertion in M-h2b.

    A *stopped* Fly machine is reset to its original state on restart, throwing away the agent's
    whole conversation; a *suspended* one snapshots memory and resumes from it. Both are cheap, so
    the mistake is invisible in a cost dashboard and only shows up as an agent that has forgotten
    everything. Pin the verb."""
    calls, handler = _suspend_fake()
    _suspend_client(handler).suspend_machine("tv-run-r1", "m-abc")
    assert ("POST", "/v1/apps/tv-run-r1/machines/m-abc/suspend") in calls
    assert not any(p.endswith("/stop") for _, p in calls), (
        "a stopped machine loses the conversation"
    )


def test_resume_goes_through_start():
    """There is no separate 'resume' verb on Fly — starting a suspended machine restores it."""
    calls, handler = _suspend_fake()
    _suspend_client(handler).start_machine("tv-run-r1", "m-abc")
    assert ("POST", "/v1/apps/tv-run-r1/machines/m-abc/start") in calls


def test_wait_suspended_never_raises_and_reports_failure_as_false():
    """Confirming a suspend is BEST-EFFORT: the only thing at stake is money, so a timeout must
    never propagate into the run that is otherwise fine."""

    def always_timeout(request: httpx.Request) -> httpx.Response:
        return httpx.Response(408, text="still suspending")

    fly = _suspend_client(always_timeout)
    assert fly.wait_suspended("tv-run-r1", "m-abc", timeout_s=0.2) is False  # no exception


def test_get_run_machine_reads_back_the_machine_for_reconstruction():
    """The re-discovery half of the storage-free durable handle: after a restart nothing in memory
    knows the machine id, so it is read back off Fly."""
    _, handler = _suspend_fake()
    info = _suspend_client(handler).get_run_machine("tv-run-r1")
    assert info is not None
    assert info.machine_id == "m-abc"
    assert info.state == "suspended"
    assert info.is_suspended is True
    assert info.private_ip == MACHINE_IP


def test_get_run_machine_returns_none_when_the_app_is_gone():
    """A 404 is a legitimate 'nothing to re-attach to, boot fresh' answer, not an error."""

    def gone(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="app not found")

    assert _suspend_client(gone).get_run_machine("tv-run-missing") is None


def test_list_apps_returns_names_for_the_reaper():
    _, handler = _suspend_fake()
    names = _suspend_client(handler).list_apps()
    assert names == ["tv-run-r1", "cryptoground-data"]


def test_the_machine_qualifies_for_suspend():
    """Fly refuses to suspend a machine with >2 GB RAM, swap, a schedule, or a GPU. This asserts the
    config we actually send meets every one of those requirements — otherwise suspend-on-gate
    silently degrades to 'keep billing all night' with no error anywhere."""
    fake = FakeFly()
    cfg = _client(fake, guest_memory_mb=1024).machine_config("k")
    assert cfg["guest"]["memory_mb"] <= 2048, "over 2 GB is not suspend-eligible"
    assert "swap_size_mb" not in cfg
    assert "schedule" not in cfg
    assert "gpu_kind" not in cfg["guest"]
