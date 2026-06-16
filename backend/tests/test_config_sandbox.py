"""P1.3a settings: the agent sandbox mode + container config + its env override."""

from tvashtr.config import Settings


def test_agent_sandbox_defaults(monkeypatch):
    # Default posture is the proven local path (the flip to docker is P1.3b).
    monkeypatch.delenv("TVASHTR_AGENT_SANDBOX", raising=False)
    monkeypatch.delenv("AGENT_SANDBOX_MODE", raising=False)
    s = Settings(_env_file=None)
    assert s.agent_sandbox_mode == "local"
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
    monkeypatch.setenv("TVASHTR_AGENT_SANDBOX", "docker")
    s = Settings(_env_file=None)
    assert s.agent_sandbox_mode == "docker"


def test_agent_sandbox_env_override_field_name(monkeypatch):
    monkeypatch.delenv("TVASHTR_AGENT_SANDBOX", raising=False)
    monkeypatch.setenv("AGENT_SANDBOX_MODE", "docker")
    s = Settings(_env_file=None)
    assert s.agent_sandbox_mode == "docker"
