"""P1.3a settings: the agent sandbox mode + container config + its env override."""

from tvashtr.config import Settings


def test_agent_sandbox_defaults(monkeypatch):
    # Default posture is now docker (P1.3b part 3 flipped local -> docker:
    # safety-by-default, after containment was proven in part 2).
    monkeypatch.delenv("TVASHTR_AGENT_SANDBOX", raising=False)
    monkeypatch.delenv("AGENT_SANDBOX_MODE", raising=False)
    s = Settings(_env_file=None)
    assert s.agent_sandbox_mode == "docker"
    assert s.agent_server_image == "ghcr.io/openhands/agent-server:latest-python"
    # P1.3b: ephemeral host port by default (None -> the SDK picks a fresh free port
    # per container), superseding P1.3a's fixed 8010. Still an optional override knob.
    assert s.agent_server_host_port is None
    assert s.agent_server_platform is None


def test_agent_server_host_port_override_accepts_int(monkeypatch):
    # Ephemeral by default, but the field stays int | None so a fixed port can still
    # be pinned (e.g. for local debugging) via the env var.
    monkeypatch.setenv("AGENT_SERVER_HOST_PORT", "8010")
    s = Settings(_env_file=None)
    assert s.agent_server_host_port == 8010


def test_agent_sandbox_env_override_tvashtr_prefix(monkeypatch):
    # The TVASHTR_AGENT_SANDBOX alias pins local off the docker default — the
    # mechanism the fast dev/test demos (skeleton-run/-crash, hitl, budget) rely on.
    monkeypatch.setenv("TVASHTR_AGENT_SANDBOX", "local")
    s = Settings(_env_file=None)
    assert s.agent_sandbox_mode == "local"


def test_agent_sandbox_env_override_field_name(monkeypatch):
    # The field-name alias likewise pins local, tested in isolation (TVASHTR_ alias removed).
    monkeypatch.delenv("TVASHTR_AGENT_SANDBOX", raising=False)
    monkeypatch.setenv("AGENT_SANDBOX_MODE", "local")
    s = Settings(_env_file=None)
    assert s.agent_sandbox_mode == "local"


# ---- M-h2a: the third sandbox value + the Fly knobs ----


def _fly_clean(monkeypatch):
    """Strip every Fly env var. Load-bearing: the Makefile does ``include .env`` + ``export``, so
    the operator's REAL values (including the live API token) are ambient in ``make test``."""
    for name in (
        "TVASHTR_AGENT_SANDBOX",
        "AGENT_SANDBOX_MODE",
        "TVASHTR_FLY_API_TOKEN",
        "TVASHTR_FLY_ORG",
        "TVASHTR_FLY_REGION",
        "TVASHTR_FLY_AGENT_IMAGE",
        "TVASHTR_FLY_GUEST_CPUS",
        "TVASHTR_FLY_GUEST_MEMORY_MB",
    ):
        monkeypatch.delenv(name, raising=False)


def test_agent_sandbox_accepts_fly(monkeypatch):
    # M-h2a adds a THIRD value; local/docker are untouched and the default stays docker.
    monkeypatch.setenv("TVASHTR_AGENT_SANDBOX", "fly")
    assert Settings(_env_file=None).agent_sandbox_mode == "fly"


def test_fly_knob_defaults(monkeypatch):
    _fly_clean(monkeypatch)
    s = Settings(_env_file=None)
    assert s.fly_api_token == ""  # unconfigured install ⇒ the live gate skips cleanly
    assert s.fly_org == "personal"
    assert s.fly_region == "bom"
    assert s.fly_guest_cpus == 1
    assert s.fly_guest_memory_mb == 2048
    # Pinned BY DIGEST, not by the moving ``:latest-python`` tag: a Fly host pulls fresh on every
    # cold boot, so a moving tag silently outruns the pinned SDK (proven in M-h2a Task A — the
    # newer server's ``Event.extended_content`` is rejected by SDK 1.28.1). The digest also makes
    # the Fly sandbox the SAME server the docker control harness runs.
    assert s.fly_agent_image.startswith("ghcr.io/openhands/agent-server@sha256:")


def test_fly_knob_env_overrides(monkeypatch):
    _fly_clean(monkeypatch)
    monkeypatch.setenv("TVASHTR_FLY_API_TOKEN", "tok-123")
    monkeypatch.setenv("TVASHTR_FLY_ORG", "some-org")
    monkeypatch.setenv("TVASHTR_FLY_REGION", "iad")
    monkeypatch.setenv("TVASHTR_FLY_AGENT_IMAGE", "ghcr.io/example/slim:1")
    monkeypatch.setenv("TVASHTR_FLY_GUEST_CPUS", "4")
    monkeypatch.setenv("TVASHTR_FLY_GUEST_MEMORY_MB", "8192")
    s = Settings(_env_file=None)
    assert s.fly_api_token == "tok-123"
    assert s.fly_org == "some-org"
    assert s.fly_region == "iad"
    assert s.fly_agent_image == "ghcr.io/example/slim:1"  # the slim-image cost lever
    assert s.fly_guest_cpus == 4
    assert s.fly_guest_memory_mb == 8192


def test_blank_fly_image_falls_back_to_the_docker_image(monkeypatch):
    # An explicitly-blanked knob means "just use whatever docker uses" — never an empty image.
    _fly_clean(monkeypatch)
    monkeypatch.setenv("TVASHTR_FLY_AGENT_IMAGE", "")
    s = Settings(_env_file=None)
    assert s.fly_agent_image == s.agent_server_image
    assert s.fly_agent_image
