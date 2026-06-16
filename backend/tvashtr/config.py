"""Application settings, loaded from the environment / a gitignored .env file."""

from decimal import Decimal
from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # When run from backend/ the repo-root .env is one level up; env vars
        # (exported by the Makefile) always take precedence over either file.
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Postgres connection, shared by the app (SQLAlchemy/Alembic) and DBOS.
    database_url: str = "postgresql://tvashtr:tvashtr@localhost:5433/tvashtr"

    # DBOS configuration.
    dbos_app_name: str = "tvashtr"
    run_dbos_admin_server: bool = False

    # hello_durable spike: duration of the durable sleep between step 1 and 2.
    # Overridable via env (HELLO_SLEEP_SECONDS) so tests can shrink it.
    hello_sleep_seconds: float = 10.0

    # Model Gateway (architecture decision D9): a single, provider-agnostic
    # metering chokepoint over LiteLLM. Model identifiers are free-form
    # "provider/model" pass-through strings — no enum, the user's choice.
    # The default routes through OpenRouter (one key reaches Llama/Gemini/GPT/
    # etc.); on failure the gateway tries ``model_fallbacks`` in order so a
    # down/ratelimited model transparently fails over.
    default_model: str = "openrouter/meta-llama/llama-3.1-8b-instruct"
    model_fallbacks: list[str] = Field(
        default_factory=lambda: [
            "openrouter/google/gemini-flash-1.5",
            "gpt-4o-mini",
        ]
    )

    # Cost caps (P1.2 — §13 Risk 3). Per-run dollar budget, enforced in the
    # Control Plane. Safety-by-default: every run is bounded unless explicitly
    # uncapped. $5 sits far above a normal run (~$0.002 on the 2-node spine) so it
    # never bites real work, but caps a genuine runaway. A run's ``budget_cap_usd``
    # is seeded from the POST /api/runs body if present, else from this value;
    # set this to ``None`` (or post ``budget_cap_usd: null``) to opt a run out.
    default_run_budget_usd: Decimal | None = Decimal("5.00")
    # Per-call output ceiling the gateway applies when a request omits
    # ``max_tokens`` (static config, like ``model_fallbacks`` — NOT run state, so
    # the gateway stays a pure request->result function). Callers that set their
    # own ``max_tokens`` (e.g. the PM's 400) are unaffected.
    default_max_tokens_per_call: int | None = 4096

    # Agent execution sandbox (P1.3 — §13 top safety item: the DEMONSTRATED
    # write-escape). ``local`` = the in-process local-unsandboxed workspace (P0.3,
    # the proven default); ``docker`` = the OpenHands Agent Server in a Docker
    # container (real containment). P1.3a lands the docker path but keeps the
    # DEFAULT ``local`` — the flip to ``docker`` is P1.3b, after containment +
    # crash-resume are proven over the container. Override per-process with the env
    # var ``TVASHTR_AGENT_SANDBOX`` (e.g. ``TVASHTR_AGENT_SANDBOX=docker``).
    agent_sandbox_mode: Literal["local", "docker"] = Field(
        default="local",
        validation_alias=AliasChoices("TVASHTR_AGENT_SANDBOX", "agent_sandbox_mode"),
    )
    # The prebuilt OpenHands agent-server image the docker path runs (heavy:
    # VSCode/VNC baked in — started with extra_ports=False). Orphan-reaping targets
    # containers from this image (``ancestor=``): the installed DockerWorkspace
    # (1.28.1) names its container ``agent-server-<uuid>`` with no per-run
    # name/label hook, so image-based targeting is the per-brief fallback (DQ2).
    agent_server_image: str = "ghcr.io/openhands/agent-server:latest-python"
    # Host port the agent-server container binds (container:8000 -> host). Default
    # ``None`` = EPHEMERAL: the installed DockerWorkspace picks a fresh free port per
    # container (``find_available_tcp_port``, range 30000-39999). Why not a fixed
    # port (P1.3b, superseding P1.3a's fixed 8010): Docker Desktop holds the host
    # port for ~30s AFTER a container is torn down (``docker rm -f`` returns long
    # before the host-side forwarder releases it), so a FIXED port wedges crash
    # recovery (the boot sweep reaps the orphan, then the resumed step can't rebind
    # the still-held port -> ``RuntimeError: Port .. is not available``) and breaks
    # back-to-back runs. A fresh port per container sidesteps the release lag
    # entirely. Reaping stays image-based (``ancestor=``), which is port-independent,
    # so orphans are still found/removed exactly as before — a fresh container just
    # gets a new port and never waits on the old one's slow release. Kept as an
    # optional override knob: set an int to pin a port (e.g. for local debugging).
    agent_server_host_port: int | None = None
    # Docker image platform; ``None`` auto-detects the host arch (arm64 ->
    # ``linux/arm64``) since the installed SDK has no ``detect_platform`` helper.
    agent_server_platform: Literal["linux/amd64", "linux/arm64"] | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
