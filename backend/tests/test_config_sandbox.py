"""P1.3a settings: the agent sandbox mode + container config + its env override."""

from tvashtr.config import Settings


def test_agent_sandbox_defaults(monkeypatch):
    # Default posture is the proven local path (the flip to docker is P1.3b).
    monkeypatch.delenv("TVASHTR_AGENT_SANDBOX", raising=False)
    monkeypatch.delenv("AGENT_SANDBOX_MODE", raising=False)
    s = Settings(_env_file=None)
    assert s.agent_sandbox_mode == "local"
    assert s.agent_server_image == "ghcr.io/openhands/agent-server:latest-python"
    assert s.agent_server_host_port == 8010
    assert s.agent_server_platform is None


def test_agent_sandbox_env_override_tvashtr_prefix(monkeypatch):
    monkeypatch.setenv("TVASHTR_AGENT_SANDBOX", "docker")
    s = Settings(_env_file=None)
    assert s.agent_sandbox_mode == "docker"


def test_agent_sandbox_env_override_field_name(monkeypatch):
    monkeypatch.delenv("TVASHTR_AGENT_SANDBOX", raising=False)
    monkeypatch.setenv("AGENT_SANDBOX_MODE", "docker")
    s = Settings(_env_file=None)
    assert s.agent_sandbox_mode == "docker"
