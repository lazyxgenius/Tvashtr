"""Application settings, loaded from the environment / a gitignored .env file."""

import os
from decimal import Decimal
from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# P1.5c capstone idea (env-overridable via ``TVASHTR_TASK_IDEA``). The real, non-trivial
# multi-file feature the M1 capstone proves: a stdlib-only Python task-list CLI. Seeded into
# ``Run.idea`` (the canonical-idea seat — no migration) for ``make loop-feature-docker``,
# exactly as ``DEFAULT_IDEA`` (the greeting.txt skeleton) is for ``make loop-run``. The
# overdue check is pinned as a PURE function of ``(due_date, reference_date)`` — no
# ``datetime.now()`` — so the build's OWN unittest suite (which the agent-Reviewer runs via
# ``python -B -m unittest`` to judge it) is time-stable, not clock-flaky. The brief REQUIRES a
# unittest suite so the Reviewer's discover-and-run command finds real tests to gate ``approved``.
TASK_LIST_IDEA = os.environ.get(
    "TVASHTR_TASK_IDEA",
    "Build a small command-line task-list application in a single directory using ONLY the "
    "Python 3 standard library (no third-party packages, no network calls, no external "
    "services).\n"
    "\n"
    "Functional requirements:\n"
    "- Add a task with a title, a priority (exactly one of: high, medium, low), and an "
    "optional due date given as an ISO 'YYYY-MM-DD' string.\n"
    "- List tasks, with support for sorting by priority (high before medium before low) and "
    "filtering by status (pending or done).\n"
    "- Complete a task (mark it done) by its id.\n"
    "- Delete a task by its id.\n"
    "- Overdue check: expose a PURE function with the EXACT signature "
    "`overdue_check(due_date: str, reference_date: str) -> bool` that returns True if and only "
    "if due_date is strictly before reference_date (both ISO 'YYYY-MM-DD' strings). It MUST NOT "
    "call datetime.now(), date.today(), or otherwise read the system clock — the reference date "
    "is always passed in, so the result is deterministic and the tests are time-stable.\n"
    "\n"
    "Engineering requirements:\n"
    "- Standard library only; prefer pure functions for the task operations and the sort/filter "
    "logic so they are directly unit-testable.\n"
    "- Include a unittest test suite in files named test_*.py that the command "
    "`python -B -m unittest` discovers and runs, covering add, list, complete, delete, the "
    "priority sort, the status filter, and overdue_check — including the boundary case where "
    "due_date == reference_date (which must return False).\n"
    "- Keep it small and self-contained; argparse is fine for the CLI, but no heavier "
    "argument-parsing framework is needed.",
)


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

    # The review-loop safety cap (P1.5a — D4 enforced termination). The cyclic
    # Engineer<->Reviewer sub-walk runs at most this many Engineer iterations; on
    # exhaustion the executor does NOT loop again but raises a high-priority
    # ``review_escalation`` blocker (ship-as-is / stop). The forced-revisions proof
    # uses N=1 (one loop-back, 2 Engineer iterations) so it never trips this cap.
    # Env-overridable in the usual style (env ``MAX_REVIEW_ITERATIONS``).
    max_review_iterations: int = 3

    # Agent execution sandbox (P1.3 — §13 top safety item: the DEMONSTRATED
    # write-escape, now PROVEN CONTAINED). ``docker`` = the OpenHands Agent Server in
    # a Docker container (real containment: least-privilege + the --rm no-bind-mount
    # boundary, proven in P1.3b part 2); ``local`` = the in-process unsandboxed
    # workspace (P0.3 — fast, no isolation). DEFAULT is ``docker`` (P1.3b part 3,
    # safety-by-default like default_run_budget_usd): the product's default run is
    # contained, and *forgetting* to set the mode lands on the SAFE path. The fast
    # dev/test agent targets (skeleton-run, skeleton-crash, hitl-demo, budget-demo)
    # opt out explicitly with ``TVASHTR_AGENT_SANDBOX=local`` — they test
    # orchestration, not containment. Override per-process with the env var, e.g.
    # ``TVASHTR_AGENT_SANDBOX=local``.
    agent_sandbox_mode: Literal["local", "docker"] = Field(
        default="docker",
        validation_alias=AliasChoices("TVASHTR_AGENT_SANDBOX", "agent_sandbox_mode"),
    )
    # Agent-LLM rate-limit retry envelope (milestone B — BYOK throttle survival).
    # The OpenHands SDK ``LLM`` retries a provider 429 (``RateLimitError``) with an
    # exponential back-off; its defaults (``num_retries=5`` x ``retry_max_wait=64s``)
    # give only a ~3-min wait-out per call, after which the exception crashes the run.
    # A capable BYOK worker on a low-tier key (free NIM, low-tier paid OpenAI) hits a
    # per-minute/TPM throttle that can sit longer than that, so the loop dies mid-build.
    # These widen the envelope ON THE BYOK (proxy-OFF) PATH ONLY (see ``agent_llm_routing``):
    # 8 retries x a 120s cap ~= a ~10-min worst-case wait-out per call, sized against the
    # rung-2 harness's 2400s (40-min) poll budget — a mild throttle clears inside the
    # window; a hard throttle drags to a clean timeout, NOT a crash. ``retry_min_wait`` and
    # the multiplier keep the SDK defaults. Env-dialable so the envelope re-tunes with no
    # code change. NOT carried on the proxy-ON path (its only 429 is the budget cutoff —
    # lengthening it would worsen the registered proxy budget-latency deferral).
    agent_num_retries: int = Field(
        default=8,
        ge=0,
        validation_alias=AliasChoices("TVASHTR_AGENT_NUM_RETRIES", "agent_num_retries"),
    )
    agent_retry_max_wait_s: int = Field(
        default=120,
        ge=0,
        validation_alias=AliasChoices("TVASHTR_AGENT_RETRY_MAX_WAIT", "agent_retry_max_wait_s"),
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

    # LiteLLM proxy (P1.4a — the agent-internal spend chokepoint; the per-key budget
    # cutoff is P1.4b). **OPT-IN.** When OFF (the default) the agent's LLM is built
    # EXACTLY as before (direct OpenRouter), so the offline suite + no-key demos are
    # byte-for-byte unaffected. When ON, the OpenHands agent's own LLM calls route
    # through the proxy (a docker-compose sibling to Postgres) — the physical endpoint
    # all that traffic flows through. The PM/gateway path is NOT routed here in 4a.
    litellm_proxy_enabled: bool = False
    # Host port the proxy publishes (LiteLLM default 4000; Postgres is on 5433, no clash).
    litellm_proxy_port: int = 4000
    # The host the agent reaches the proxy at, chosen by sandbox mode (see
    # ``agent_llm_base_url``): docker mode runs the agent INSIDE an ad-hoc container on
    # Docker's default bridge (started by ``DockerWorkspace``, NOT on the compose
    # network), so it reaches the host-published proxy port via ``host.docker.internal``;
    # local mode runs in-process on the host, so ``127.0.0.1``.
    litellm_proxy_host_local: str = "127.0.0.1"
    litellm_proxy_host_docker: str = "host.docker.internal"
    # The proxy master key (env ``LITELLM_MASTER_KEY``); the agent presents it as its
    # api_key when the proxy is on. ``None`` when unset (proxy off / not configured).
    litellm_master_key: str | None = None

    # M-accounts Slice A: the secret that signs the ``tv_session`` login cookie (itsdangerous,
    # see ``auth.py``). A dev default keeps the offline suite + local dev working with no extra
    # env; PRODUCTION MUST override ``TVASHTR_SESSION_SECRET`` with a real random secret (and the
    # cookie must be marked ``Secure`` over https). Distinct from ``secret_key`` below (which
    # encrypts BYOK provider keys) — a leak of one does not compromise the other.
    session_secret: str = Field(
        default="dev-insecure-session-secret-change-me",
        validation_alias=AliasChoices("TVASHTR_SESSION_SECRET", "session_secret"),
    )

    # M-accounts Slice B: the Fernet key that encrypts BYOK provider keys at rest in
    # ``provider_credentials`` (see ``control_plane.credentials``). A real 44-char urlsafe-base64
    # ``Fernet.generate_key()`` value is hardcoded as the dev default so the offline suite + local
    # dev work with no extra env. PRODUCTION MUST override ``TVASHTR_SECRET_KEY`` with its OWN
    # generated key, and the key MUST be STABLE — the stored secrets are only decryptable with the
    # SAME key, so rotating it strands every saved credential (re-enter them after a rotation).
    # Distinct from ``session_secret`` (which only signs the login cookie); a leak of one does not
    # compromise the other.
    secret_key: str = Field(
        default="TzxdlCpD6FYWPsjw6h7e3sYQw6EvjI-cmvJI2KQE7ho=",
        validation_alias=AliasChoices("TVASHTR_SECRET_KEY", "secret_key"),
    )

    def agent_llm_base_url(self, sandbox_mode: str) -> str:
        """The proxy base URL the agent's LLM points at, chosen by THIS run's sandbox
        mode. ``docker`` -> ``host.docker.internal`` (the agent-server container is on
        Docker's default bridge, not the compose network, so it reaches the host-published
        proxy port via the Docker-Desktop host alias); anything else (``local``) ->
        ``127.0.0.1`` (the agent runs in-process on the host)."""
        host = (
            self.litellm_proxy_host_docker
            if sandbox_mode == "docker"
            else self.litellm_proxy_host_local
        )
        return f"http://{host}:{self.litellm_proxy_port}"


def agent_llm_routing(
    settings: Settings,
    model: str,
    sandbox_mode: str,
    api_key_override: str | None = None,
) -> dict:
    """Resolve the agent LLM's routing kwargs (model / api_key [/ base_url]).

    Proxy ON  -> route through the LiteLLM proxy: model ``litellm_proxy/<slug>`` (the
                 litellm client convention that targets a proxy endpoint), ``base_url`` =
                 the mode-aware proxy URL, and an api_key that is the **per-run virtual key**
                 (``api_key_override``) when one was minted, else the master key. UNCHANGED by
                 M-accounts Slice B — BYOK is the proxy-OFF path; the proxy holds upstream keys in
                 its own config.
    Proxy OFF -> the BYOK direct path (M-accounts Slice B): the bare slug + the **per-owner** key
                 the executor resolved from the run owner's encrypted ``provider_credentials`` and
                 threaded in as ``api_key_override`` — and NO ``base_url``. This REPLACES the prior
                 ``.env`` per-provider lookup: there is **no** ``.env`` fallback. A run reaches here
                 only after the launch pre-flight confirmed the owner has a key for every node's
                 provider, so ``api_key_override`` is always set; if it is somehow ``None``, REFUSE
                 (raise) rather than silently fall back to an ``.env`` key (which would leak the
                 operator's key/spend to a keyless account).

    Why two keys on the proxy path (P1.4b): the **master key** stays the *admin* credential (it
    authenticates minting/deleting keys); the per-run **virtual key** — minted with a ``max_budget``
    — is the agent's api_key, so the proxy enforces the run's remaining budget *mid-call*. When no
    per-run key was minted (``api_key_override is None``, e.g. proxy on but mint returned nothing),
    fall back to the master key so a proxy-ON run still authenticates.

    The adapter adds ``temperature``/``usage_id``; this owns only the routing kwargs, so
    both adapters share one verified decision (kept here, openhands-free, so it is unit-
    testable without spinning an agent and the import boundary is untouched)."""
    if settings.litellm_proxy_enabled:
        return {
            "model": f"litellm_proxy/{model}",
            "api_key": api_key_override or settings.litellm_master_key,
            "base_url": settings.agent_llm_base_url(sandbox_mode),
        }
    if api_key_override is None:
        # Proxy OFF + no per-owner key threaded: refuse rather than fall back to ``.env``. The
        # pre-flight makes this unreachable on a real run; it is the defense-in-depth hard wall.
        raise ValueError(
            "proxy-OFF agent routing requires a per-owner api_key (BYOK); none was provided "
            "(the run owner must have a provider_credentials key for this model's provider)"
        )
    # BYOK direct path: carry the widened rate-limit retry envelope (milestone B) so a
    # throttled low-tier key rides out a busy window instead of crashing the agent loop.
    # ``num_retries``/``retry_max_wait`` are real OpenHands ``LLM`` fields; they splat into
    # the constructor and SERIALIZE into the in-container agent-server, so the docker path
    # inherits them too. The proxy-ON branch above deliberately OMITS them (budget-latency).
    return {
        "model": model,
        "api_key": api_key_override,
        "num_retries": settings.agent_num_retries,
        "retry_max_wait": settings.agent_retry_max_wait_s,
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()
