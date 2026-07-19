"""M-h3 EGRESS: the per-run Fly network policy — the fence on what the microVM reaches OUT to.

M-h2 fenced what reaches **in** (a per-user private network, a one-way Flycast door, a per-run
session key). This is the other half: the guest runs *arbitrary agent-authored code*, so the
interesting question stopped being "who can dial the sandbox" and became "where can the sandbox
dial". A Fly **network policy** answers it at the platform layer, below anything the guest can
reach — an agent that `rm -rf`'d its own iptables could not widen this by a byte.

⚠️ THE HARD RULE, inherited verbatim from ``test_fly_machines.py``: **no test here may ever reach
the real Fly API or spend a cent.** ``make test`` does ``include .env`` + ``export``, so the
operator's live ``TVASHTR_FLY_API_TOKEN`` is ambient in this very process. Every test injects an
``httpx.Client`` bound to an ``httpx.MockTransport``; the token is a fake literal, so even a leaked
request could not authenticate.

WHAT IS MUTATION-REAL HERE (each assertion has a mutation that fails it):

* the exact wire body — Fly network policies are **port/protocol only**, there is no host
  allowlist, and *creating one egress rule flips the app to default-deny for all other egress*.
  That inversion means the body IS the firewall: drop ``udp/53`` and DNS dies; add a port and the
  fence widens silently. Both are pinned below.
* the **ORDER** — the policy must exist before the machine does, or there is a window in which a
  booted guest is unfenced. ``test_the_policy_is_created_before_the_machine_boots`` reads the
  recorded request sequence, not our intentions.
* **fail-closed** — a policy that errors must tear the app down, never boot an unfenced machine.
* **FLY-ONLY** — local/docker are byte-identical and make ZERO ``network_policies`` calls.
"""

from pathlib import Path

import httpx
import pytest

from tvashtr.config import Settings
from tvashtr.control_plane import team_run
from tvashtr.engines.fly_machines import (
    DEFAULT_EGRESS_PORTS,
    EGRESS_POLICY_NAME,
    FlyApiError,
    FlyMachines,
    parse_egress_ports,
)

FAKE_TOKEN = "fly-test-token-NOT-REAL-abc123"
FAKE_IMAGE = "ghcr.io/openhands/agent-server:latest-python"
MACHINE_IP = "fdaa:9e:ceff:a7b:513:4389:6b65:2"

_ENGINES = Path(__file__).resolve().parents[1] / "tvashtr" / "engines"


class FakeFly:
    """A scripted Fly that records the ORDERED (method, path) sequence — the order is the point."""

    def __init__(self, *, policy_status: int = 201):
        self.calls: list[tuple[str, str]] = []
        self.bodies: dict[str, dict] = {}
        self.policy_status = policy_status
        self.deleted: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        import json as _json

        path = request.url.path
        method = request.method
        self.calls.append((method, path))
        if request.content:
            try:
                self.bodies[path] = _json.loads(request.content)
            except ValueError:
                pass

        if method == "POST" and path.endswith("/network_policies"):
            if self.policy_status >= 400:
                return httpx.Response(self.policy_status, text="policy rejected")
            return httpx.Response(201, json={"id": "01KXWNAG11DV1THSFSMFKT5XVR"})
        if method == "POST" and path == "/v1/apps":
            return httpx.Response(201, json={})
        if method == "POST" and "api.fly.io" in request.url.host:
            return httpx.Response(
                200,
                json={"data": {"allocateIpAddress": {"ipAddress": {"address": "fdaa:0:1::3"}}}},
            )
        if method == "POST" and path.endswith("/machines"):
            return httpx.Response(200, json={"id": "abc123machine", "private_ip": MACHINE_IP})
        if method == "GET" and path.endswith("/wait"):
            return httpx.Response(200, json={"ok": True})
        if method == "GET" and path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        if method == "DELETE" and path.startswith("/v1/apps/"):
            self.deleted.append(path.rsplit("/", 1)[-1])
            return httpx.Response(202, json={})
        return httpx.Response(500, text=f"unscripted: {method} {request.url}")


def _client(fake: FakeFly, **kw) -> FlyMachines:
    return FlyMachines(
        token=FAKE_TOKEN,
        image=FAKE_IMAGE,
        client=httpx.Client(transport=httpx.MockTransport(fake.handler)),
        **kw,
    )


# ---- the wire body IS the firewall ----


def test_create_egress_policy_posts_the_exact_allowlist_body_and_url():
    """The one assertion the whole milestone rests on. Fly has no host allowlist — a policy is a
    set of ports — and the moment ONE egress rule exists the app defaults to deny for everything
    else. So this body is not a hint to the platform, it *is* the firewall, and it is pinned
    byte-for-byte (verified against the real API: HTTP 201 ``{"id": "<ulid>"}``)."""
    fake = FakeFly()
    _client(fake).create_egress_policy("tv-run-r1")

    assert fake.calls == [("POST", "/v1/apps/tv-run-r1/network_policies")]
    assert fake.bodies["/v1/apps/tv-run-r1/network_policies"] == {
        "name": EGRESS_POLICY_NAME,
        "selector": {"all": True},
        "rules": [
            {
                "action": "allow",
                "direction": "egress",
                "ports": [
                    {"protocol": "tcp", "port": 443},
                    {"protocol": "tcp", "port": 80},
                    {"protocol": "tcp", "port": 53},
                    {"protocol": "udp", "port": 53},
                ],
            }
        ],
    }


def test_the_policy_allows_udp_53_or_the_guest_cannot_resolve_anything():
    """DNS is UDP. A tcp-only allowlist would leave a machine that can open :443 to a *literal IP*
    and nothing else — every hostname would fail, so inference would fail, so the run would fail,
    and the symptom ("the model call timed out") points nowhere near the firewall. The real API
    accepts ``{"protocol": "udp", "port": 53}`` (probed: HTTP 201), so there is no excuse for
    omitting it. Inference succeeding in the live gate is the end-to-end proof; this is the
    unit-level guard that the rule is even sent."""
    fake = FakeFly()
    _client(fake).create_egress_policy("tv-run-r1")
    ports = fake.bodies["/v1/apps/tv-run-r1/network_policies"]["rules"][0]["ports"]
    assert {"protocol": "udp", "port": 53} in ports


def test_the_allowlist_is_exactly_the_configured_ports_and_nothing_else():
    """A widened fence is the failure mode that leaves no trace — the run still works, it is just
    no longer fenced. Pin the mapping: every configured port gets tcp, 53 additionally gets udp,
    and nothing arrives that was not configured."""
    fake = FakeFly()
    _client(fake, egress_ports=(443,)).create_egress_policy("tv-run-r1")
    ports = fake.bodies["/v1/apps/tv-run-r1/network_policies"]["rules"][0]["ports"]
    assert ports == [{"protocol": "tcp", "port": 443}]
    assert not any(p["port"] in (80, 53) for p in ports)


def test_parse_egress_ports_reads_the_config_string_and_rejects_junk():
    assert parse_egress_ports("443,80,53") == (443, 80, 53)
    assert parse_egress_ports(" 443 , 80 ") == (443, 80)
    assert parse_egress_ports("443,,80,") == (443, 80)  # tolerant of trailing/blank fields
    assert parse_egress_ports("") == ()  # explicitly empty ⇒ no rule at all
    with pytest.raises(ValueError):
        parse_egress_ports("443,not-a-port")
    with pytest.raises(ValueError):
        parse_egress_ports("70000")  # outside the port space


def test_an_empty_allowlist_refuses_to_post_a_meaningless_policy():
    """``TVASHTR_FLY_EGRESS_ALLOWED_PORTS=`` means "no ports". Sending a rule with an EMPTY ports
    list would be the worst of both worlds — it would still flip the app to default-deny while
    allowing nothing, i.e. a machine that cannot even resolve DNS, failing in a way that looks like
    a broken image. Refuse loudly instead of shipping a brick."""
    fake = FakeFly()
    with pytest.raises(ValueError, match="no egress ports"):
        _client(fake, egress_ports=()).create_egress_policy("tv-run-r1")
    assert fake.calls == []  # nothing was sent


# ---- ORDER: the policy must predate the machine ----


def test_the_policy_is_created_before_the_machine_boots():
    """THE ordering invariant. A policy applied *after* ``create_machine`` leaves a window in which
    a fully-booted guest — already running agent code — has unrestricted egress, and a window is
    all an exfiltration needs. Creating it while the app has no machine also means no restart is
    ever required: the machine's first packet is already fenced.

    This reads the recorded request SEQUENCE rather than trusting the source to stay in order."""
    fake = FakeFly()
    _client(fake).start_run_sandbox(run_id="r1", owner_id="o1", session_api_key="k")

    paths = [p for _m, p in fake.calls]
    app_create = paths.index("/v1/apps")
    policy = paths.index("/v1/apps/tv-run-r1/network_policies")
    machine = paths.index("/v1/apps/tv-run-r1/machines")
    assert app_create < policy < machine, f"policy must sit between app and machine: {paths}"


def test_a_failed_policy_tears_the_app_down_instead_of_booting_unfenced():
    """FAIL CLOSED. If the fence cannot be raised, the correct outcome is no sandbox at all — a
    machine that boots without its policy is precisely the thing this milestone exists to prevent,
    and it would boot *silently*, looking exactly like a healthy run."""
    fake = FakeFly(policy_status=422)
    with pytest.raises(FlyApiError):
        _client(fake).start_run_sandbox(run_id="r1", owner_id="o1", session_api_key="k")

    assert ("POST", "/v1/apps/tv-run-r1/machines") not in fake.calls, "booted despite no fence"
    assert fake.deleted == ["tv-run-r1"], "a half-built app must never be left billing"


def test_egress_policy_errors_are_scrubbed_of_the_api_token():
    """C8: the token is ambient during ``make test``; every outbound error path is scrubbed."""

    def reflect(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, text=f"bad request from {request.headers['Authorization']}")

    fly = FlyMachines(
        token=FAKE_TOKEN,
        image=FAKE_IMAGE,
        client=httpx.Client(transport=httpx.MockTransport(reflect)),
    )
    with pytest.raises(FlyApiError) as excinfo:
        fly.create_egress_policy("tv-run-r1")
    assert FAKE_TOKEN not in str(excinfo.value)
    assert "<redacted-fly-token>" in str(excinfo.value)
    assert "create_egress_policy" in str(excinfo.value)


# ---- FLY-ONLY: local/docker are untouched ----


def test_a_local_or_docker_run_never_resolves_to_the_fly_engine(monkeypatch):
    """Half of "local/docker make ZERO network_policies calls": those postures never reach the
    module the call lives in. Any socket opened during this test is itself a failure."""

    def no_network(self, method, url, *a, **kw):
        raise AssertionError(f"an offline test dialed the network: {method} {url}")

    monkeypatch.setattr(httpx.Client, "request", no_network)

    for mode in ("local", "docker", "", "something-unknown"):
        assert team_run._engine_for_sandbox_mode(mode) != "openhands-fly"
    assert team_run._engine_for_sandbox_mode("fly") == "openhands-fly"


def test_the_docker_and_local_paths_cannot_reach_the_egress_call():
    """The other half, and the one that would catch a real regression: the docker/local adapters
    and the docker runtime neither import ``fly_machines`` nor mention a network policy, so there
    is no code path by which a non-fly run could emit one. Adding such a call to any of these
    files fails this test — which is exactly the mutation we care about."""
    for name in (
        "openhands_adapter.py",  # local
        "openhands_docker_adapter.py",  # docker
        "docker_runtime.py",  # the docker container lifecycle
        "sandbox_cache.py",  # shared, mode-agnostic
    ):
        src = (_ENGINES / name).read_text()
        assert "network_polic" not in src, f"{name} must never speak of network policies"
        assert "create_egress_policy" not in src, f"{name} must never call the fly egress fence"
        assert "fly_machines" not in src, f"{name} must not import the fly module at all"


# ---- the config knob ----


def test_the_egress_ports_knob_defaults_to_https_http_and_dns(monkeypatch):
    """443 (the LLM provider — hosted runs are BYOK with the proxy OFF, so the guest dials the
    provider DIRECTLY), 80 (plain-HTTP package/index redirects), 53 (DNS). Deliberately NOT 22 or
    25: the guest needs no git-over-ssh (clone/push are host-side) and no mail."""
    monkeypatch.delenv("TVASHTR_FLY_EGRESS_ALLOWED_PORTS", raising=False)
    monkeypatch.delenv("FLY_EGRESS_ALLOWED_PORTS", raising=False)
    s = Settings(_env_file=None)
    assert s.fly_egress_allowed_ports == "443,80,53"
    assert parse_egress_ports(s.fly_egress_allowed_ports) == DEFAULT_EGRESS_PORTS


def test_the_egress_ports_knob_is_env_dialable(monkeypatch):
    monkeypatch.setenv("TVASHTR_FLY_EGRESS_ALLOWED_PORTS", "443,53")
    assert parse_egress_ports(Settings(_env_file=None).fly_egress_allowed_ports) == (443, 53)
