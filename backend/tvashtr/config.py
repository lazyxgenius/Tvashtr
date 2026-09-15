"""Application settings, loaded from the environment / a gitignored .env file."""

import os
from decimal import Decimal
from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, model_validator
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


# EVERY secret-bearing field below is typed ``SecretStr``, never plain ``str``. This is not
# decoration: a pytest traceback once rendered a frame holding a ``Settings`` instance and dumped
# the Fly API token, the GitHub App client secret and its private key into a transcript (all had to
# be rotated). ``make test`` does ``include .env`` + ``export``, so the operator's REAL credentials
# are ambient in the suite — any repr of this object is a live disclosure risk. ``SecretStr`` reprs
# as ``**********``, which makes non-leakage the DEFAULT rather than a thing every future call site
# has to remember.
#
# The contract for call sites:
#   * read the plaintext with ``.get_secret_value()`` AT THE POINT OF USE — never hoist it into a
#     long-lived local, an f-string, or anything that might get logged;
#   * "is it configured?" guards unwrap FIRST and test the plaintext. As of pydantic 2.13 a
#     ``SecretStr`` defines ``__len__`` and no ``__bool__``, so ``SecretStr("")`` happens to be
#     FALSY and a bare guard would work by accident — but that is an implementation detail of the
#     library, not a promise, and reading it off the plaintext says what is actually meant;
#   * defaults are written ``SecretStr("...")`` rather than a bare string because pydantic does NOT
#     validate an unset field's default — a raw-str default would stay a plain ``str`` and every
#     ``.get_secret_value()`` would ``AttributeError`` on exactly the unconfigured installs.
# ``tests/test_config_secret_hardening.py`` pins all three properties.
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
    # own ``max_tokens`` are unaffected.
    default_max_tokens_per_call: int | None = 4096

    # M-memory S1: the embedding model for the agentic memory store, routed through the SAME
    # gateway/litellm path as completions. Default ``openai/text-embedding-3-small`` (1536-dim).
    # The ``vector(1536)`` dimension is PINNED in migration 0025 — switching this to a
    # different-dimension model later needs a NEW migration + a re-embed of every stored row.
    embedding_model: str = Field(
        default="openai/text-embedding-3-small",
        validation_alias=AliasChoices("TVASHTR_EMBEDDING_MODEL", "embedding_model"),
    )

    # M-memory S2: the run-END distiller model — a CHEAP NON-REASONING model (a reasoning model
    # over-thinks a bounded extraction). Given the run outcome + a bounded trail + the existing
    # in-scope facts, it proposes candidate memory ops; the gating + code-authoritative
    # consolidation live in ``control_plane/memory_distill.py``. Metered ON the run with the owner's
    # key (openai provider — shares the embedding model's key).
    memory_distiller_model: str = Field(
        default="openai/gpt-4o-mini",
        validation_alias=AliasChoices("TVASHTR_MEMORY_DISTILLER_MODEL", "memory_distiller_model"),
    )

    # M-ctx1 (C2): the per-worker-node INPUT token budget — a pre-call ceiling on the compiled
    # agent instruction (idea + spec + revision + grounding + …). When the compiled input EXCEEDS
    # this, the executor does NOT call the agent: it fails that node with a clear terminal reason
    # naming the fattest part + its token count (a clean pre-call failure, not a mid-agent context
    # crash). Sized with headroom under a 131072-token model window (~110000) so a genuinely large
    # accumulated context is caught here rather than by the provider mid-run. Env-overridable
    # (``TVASHTR_WORKER_CONTEXT_TOKEN_BUDGET``); a per-NODE override
    # (``config.model_config.worker_context_token_budget``) wins over this default when set — see
    # ``context_compiler.resolve_context_budget``. Tokens are the documented ``len(text)//4``
    # heuristic (``context_compiler.estimate_tokens``); no real per-model tokenizer is in the deps.
    worker_context_token_budget: int = Field(
        default=110000,
        gt=0,
        validation_alias=AliasChoices(
            "TVASHTR_WORKER_CONTEXT_TOKEN_BUDGET", "worker_context_token_budget"
        ),
    )

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
    # ``fly`` (M-h2a) adds the HOSTED path: the agent server runs in a throwaway Fly Firecracker
    # microVM, ONE machine per RUN, on the run owner's own private network (``u<owner_id>-net``),
    # reached only through a one-way Flycast door behind a fresh-per-run ``X-Session-API-Key``. It
    # is a THIRD value, not a replacement — ``local``/``docker`` resolve exactly as before, and the
    # default stays ``docker`` (safety-by-default: forgetting the posture still lands contained).
    agent_sandbox_mode: Literal["local", "docker", "fly"] = Field(
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
    # M-thrift: the per-call OUTPUT ceiling every adapter stamps on its ``LLM``. OpenHands leaves
    # ``max_output_tokens`` unset, so the SDK resolves the MODEL's own maximum (16384 on
    # gpt-4o-mini) and litellm sends that as ``max_tokens`` — which OpenRouter charges against the
    # key's balance as a PRE-FLIGHT CREDIT RESERVATION. A near-empty paid key is then refused with a
    # 402 ("requires more credits, or fewer max_tokens") before a single token is generated, even
    # though the reply would have cost cents. A finite ceiling is the fix, and it is also the
    # cheapest one available: an agent turn that needs more than 4k output tokens is a runaway, not
    # a build step. The host-side completion path already had its own ceiling
    # (``default_max_tokens_per_call``); this is the agent path's equal. Env-dialable.
    agent_max_output_tokens: int = Field(
        default=4096,
        gt=0,
        validation_alias=AliasChoices("TVASHTR_AGENT_MAX_OUTPUT_TOKENS", "agent_max_output_tokens"),
    )
    # M-seat: the per-request HTTP timeout every adapter stamps on its ``LLM``. The SDK's own
    # default is 300s, and the retry envelope above multiplies it: a provider that ACCEPTS the
    # connection and then never answers (observed live on nvidia_nim — §17 Tvashtr-82 records an
    # 8-minute hang, and M-live lost ~30 minutes of a demo to the same shape) burns
    # ``num_retries x 300s`` before anything is reported. 120s caps a single stalled call at two
    # minutes and surfaces it as a litellm ``APITimeoutError`` naming the model — a legible failure
    # the run can classify — instead of an unexplained silence. It is deliberately far above any
    # healthy call: the slowest gate-passing completion measured in the M-seat probe was ~9s, and
    # a long agent turn under the 4096-token output ceiling has never approached this. Env-dialable
    # so a genuinely slow model can be given room without a code change.
    agent_request_timeout_s: int = Field(
        default=120,
        gt=0,
        validation_alias=AliasChoices("TVASHTR_AGENT_REQUEST_TIMEOUT", "agent_request_timeout_s"),
    )
    # M-live: the condenser's TOKEN trigger. M-ctx0 gave every adapter
    # ``LLMSummarizingCondenser(keep_first=2, max_size=80)`` to stop a long transcript overrunning
    # the model's context window — but ``max_size`` counts EVENTS, and the SDK gates its
    # token-based path on a separate ``max_tokens`` that defaults to ``None``:
    #
    #     if self.max_tokens and agent_llm:      # llm_summarizing_condenser.py:104
    #         if total_tokens > self.max_tokens:
    #
    # Unset, that branch is dead code and 80 events is the ONLY trigger — which cannot protect a
    # brownfield run, because reading a handful of large files off a monorepo breaches the window
    # long before 80 events accumulate. Measured: M-live's Engineer node died on a 131,072-token
    # overflow after ~20 events, surfaced as an EMPTY-bodied provider 400 (NIM derives
    # ``window - prompt_tokens`` for max_tokens, gets a negative number, and refuses; litellm drops
    # the body, so the run log reads only ``Nvidia_nimException -``).
    #
    # 96k is chosen against the window this actually has to survive: 131,072 — every NIM model
    # reachable on a build key, and the retired llama-3.3-70b before them. It leaves ~35k of
    # headroom for the reply plus the summarization call itself. A model with a SMALLER window is
    # no worse off than today (the trigger simply never fires, exactly as before); a model with a
    # larger one condenses earlier than it strictly must, which costs a little and risks nothing.
    agent_condenser_max_tokens: int = Field(
        default=96_000,
        gt=0,
        validation_alias=AliasChoices(
            "TVASHTR_AGENT_CONDENSER_MAX_TOKENS", "agent_condenser_max_tokens"
        ),
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

    # --- M-h2a: the Fly microVM sandbox knobs (read only when agent_sandbox_mode == "fly") -------
    # The org-scoped Fly API token. Empty default so an UNCONFIGURED install leaves it blank and the
    # live ``github-pr-fly-e2e`` gate SKIPS cleanly (mirrors the GITHUB_APP_* pattern). It is a
    # SECRET: never logged, never persisted, never serialized into a response — see
    # ``engines/fly_machines.py``'s scrubbing. ``SecretStr`` (see the note on the secret fields
    # below) makes that structural: read it with ``.get_secret_value()``.
    fly_api_token: SecretStr = Field(
        default=SecretStr(""),
        validation_alias=AliasChoices("TVASHTR_FLY_API_TOKEN", "fly_api_token"),
    )
    # The Fly org the per-run apps are created in. ``personal`` is the operator's real org SLUG (the
    # dashboard's ``aditya-sharma-664`` is a URL handle, not the slug). M-h4 moves Tvashtr's runs to
    # their own org for blast radius.
    fly_org: str = Field(
        default="personal",
        validation_alias=AliasChoices("TVASHTR_FLY_ORG", "fly_org"),
    )
    # The region run machines boot in. Choosing the region for USERS' machines is M-h4; ``bom`` is
    # simply nearest the operator today.
    fly_region: str = Field(
        default="bom",
        validation_alias=AliasChoices("TVASHTR_FLY_REGION", "fly_region"),
    )
    # The agent-server image the microVM boots — PINNED BY DIGEST, deliberately, to the byte-
    # identical image the docker path is already proven on (``agent_server_image``'s
    # ``:latest-python`` as resolved on 2026-06-15, ``sha256:0c86a6b2…``).
    #
    # WHY A DIGEST AND NOT ``agent_server_image``'s MOVING TAG (found the hard way, M-h2a Task A):
    # docker only pulls ``:latest-python`` when it is absent, so the laptop has quietly been running
    # a CACHED June build that matches the pinned ``openhands-sdk==1.28.1``. A Fly host has no such
    # cache — it pulls ``latest`` fresh on every cold boot, which today resolves to a NEWER server
    # whose events carry an ``extended_content`` field that SDK 1.28.1's ``Event`` model rejects
    # (``extra_forbidden``), crashing the client mid-conversation. A moving tag on a
    # pull-every-time substrate is a version-skew generator; the digest makes the Fly sandbox and
    # the docker control harness provably the SAME server, which is exactly what an invariant
    # calling docker "the control harness" requires. Re-pin this in lockstep with the SDK.
    #
    # It stays a knob because THE IMAGE IS THE COST LEVER: this build bakes in VSCode + VNC we never
    # open, which on a laptop is paid once and on Fly is paid on EVERY cold host (as bandwidth, and
    # as the user's stare at "Starting sandbox…"). Pointing it at a slim image is the evidence-based
    # follow-up the live gate's measurements feed.
    fly_agent_image: str = Field(
        default=(
            "ghcr.io/openhands/agent-server@sha256:"
            "0c86a6b2396195bdd26fb214902a6ee5298ae897dad31eef116422f97ef23a07"
        ),
        validation_alias=AliasChoices("TVASHTR_FLY_AGENT_IMAGE", "fly_agent_image"),
    )
    # Guest size. Shared-CPU + 2GB comfortably runs the agent server; both are env-dialable so the
    # live gate's measured peak-memory reading can retune them without a code change.
    fly_guest_cpus: int = Field(
        default=1,
        gt=0,
        validation_alias=AliasChoices("TVASHTR_FLY_GUEST_CPUS", "fly_guest_cpus"),
    )
    # M-h2b: 1024, NOT 2048. Fly refuses to SUSPEND a machine with more than 2 GB of RAM, and
    # suspend-on-gate is what stops a run parked overnight from billing CPU/RAM until morning.
    # 2048 sat exactly ON that boundary; M-h2a MEASURED a 570 MB peak, so halving it buys ample
    # headroom under the limit, a smaller/faster memory snapshot, and a cheaper running machine.
    # Raising this above 2048 silently forfeits suspend eligibility — the run still works, it just
    # bills while it waits.
    fly_guest_memory_mb: int = Field(
        default=1024,
        gt=0,
        validation_alias=AliasChoices("TVASHTR_FLY_GUEST_MEMORY_MB", "fly_guest_memory_mb"),
    )

    # M-h2b: the secret the per-run agent-server key is DERIVED from —
    # ``HMAC-SHA256(fly_session_secret, run_id)`` (see ``engines.fly_machines.derive_session_key``).
    # Deriving rather than minting is what lets a RESTARTED backend re-attach to a still-alive
    # microVM without ever having stored the key: same run_id + same secret ⇒ same key, so the C8
    # "never logged, persisted, or serialized" invariant holds while the handle still survives a
    # crash. A dev default keeps the offline suite + local dev working with no extra env; PRODUCTION
    # MUST override ``TVASHTR_FLY_SESSION_SECRET`` with a real random secret, and it MUST be STABLE
    # — rotating it while runs are parked at a gate strands those sandboxes behind a key nobody can
    # re-derive (they fail closed, never silently mis-address). Distinct from ``session_secret`` and
    # ``secret_key``: a leak of one does not compromise the others.
    fly_session_secret: SecretStr = Field(
        default=SecretStr("dev-insecure-fly-session-secret-change-me"),
        validation_alias=AliasChoices("TVASHTR_FLY_SESSION_SECRET", "fly_session_secret"),
    )

    # M-h3: the microVM's EGRESS allowlist — the ports a run's guest may dial OUT on. A comma-
    # separated string rather than a list because it is an env knob first (``AliasChoices`` +
    # ``.env``), parsed by ``engines.fly_machines.parse_egress_ports``.
    #
    # THE DEFAULT IS THE WHOLE SECURITY POSTURE, so each port is here on evidence, not on habit:
    #   443 — the LLM provider, dialed DIRECTLY. Hosted runs are BYOK with the LiteLLM proxy OFF
    #         (``agent_llm_routing(..., "fly", ...)`` returns the bare slug + the owner's key and
    #         NO base_url), so there is no local hop through which this could be narrowed further.
    #   80  — plain-HTTP redirects that package indexes and installers still emit.
    #   53  — DNS. Emitted as udp/53 *and* tcp/53; without it every hostname is unreachable and
    #         the run dies with a symptom that points nowhere near a firewall.
    # Deliberately ABSENT: 22 (git-over-ssh is host-side — clone and push never happen in the
    # guest), 25/465/587 (mail), and every database port. Fly network policies are port/protocol
    # only — there is no host allowlist — so this cannot say "only the provider"; it says "only
    # the ports a coding agent legitimately needs", which still removes SMTP, SSH, and every
    # arbitrary C2 port from an environment that runs model-authored code.
    #
    # Setting it EMPTY does not mean "allow everything" — it makes the client refuse to post a
    # policy at all (see ``create_egress_policy``), because one empty rule would still flip Fly to
    # deny-all and brick the guest.
    #
    # THE DEBUGGING TRAP, measured rather than guessed: a denied port is **DROPPED, not refused**.
    # A refused port fails in milliseconds with a clear ECONNREFUSED; a dropped one HANGS until the
    # caller's own timeout (8.0s in every ``fly-egress-check`` reading). So the symptom of hitting
    # this fence is not "connection refused" anywhere in a log — it is an agent that appears to
    # freeze. If a hosted run stalls on a command with NO error text, check this allowlist against
    # what that command dials before assuming the model wedged. The agent's own workload is what
    # widens it: a repo whose test suite talks to, say, a websocket stream on :9443 will hang here,
    # and the fix is to widen this knob deliberately — not to remove the fence.
    fly_egress_allowed_ports: str = Field(
        default="443,80,53",
        validation_alias=AliasChoices(
            "TVASHTR_FLY_EGRESS_ALLOWED_PORTS", "fly_egress_allowed_ports"
        ),
    )

    @model_validator(mode="after")
    def _fly_agent_image_falls_back_to_the_docker_image(self) -> "Settings":
        """An explicitly-blanked ``TVASHTR_FLY_AGENT_IMAGE=`` falls back to ``agent_server_image``.

        The default above is a digest pin, but blanking the knob is a deliberate "just use whatever
        docker uses" escape hatch (e.g. after re-pinning ``agent_server_image`` to a new build) —
        it must never leave the Fly path with an empty image string."""
        if not self.fly_agent_image:
            self.fly_agent_image = self.agent_server_image
        return self

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
    # api_key when the proxy is on. ``None`` when unset (proxy off / not configured) — the
    # OPTIONAL secret, so call sites must handle ``None`` *before* ``.get_secret_value()``.
    litellm_master_key: SecretStr | None = None

    # M-accounts Slice A: the secret that signs the ``tv_session`` login cookie (itsdangerous,
    # see ``auth.py``). A dev default keeps the offline suite + local dev working with no extra
    # env; PRODUCTION MUST override ``TVASHTR_SESSION_SECRET`` with a real random secret (and the
    # cookie must be marked ``Secure`` over https). Distinct from ``secret_key`` below (which
    # encrypts BYOK provider keys) — a leak of one does not compromise the other.
    session_secret: SecretStr = Field(
        default=SecretStr("dev-insecure-session-secret-change-me"),
        validation_alias=AliasChoices("TVASHTR_SESSION_SECRET", "session_secret"),
    )

    # M-h4 (DEPLOY): mark the ``tv_session`` cookie ``Secure`` — the browser then refuses to send it
    # over plain http at all, so a downgraded/intercepted request cannot carry a live session.
    #
    # The default is FALSE and must stay false, which is the opposite of this codebase's usual
    # safety-by-default posture — deliberately. A browser will not STORE a Secure cookie delivered
    # over ``http://localhost``, so defaulting this True would break local sign-in entirely (login
    # returns 200, the cookie is silently dropped, every subsequent call 401s — a genuinely
    # confusing failure). Production is the environment that knows it has TLS, so production is
    # where it is turned on: fly.toml sets ``TVASHTR_COOKIE_SECURE=true``.
    #
    # ``auth.clear_session_cookie`` reads the SAME value: browsers only clear a cookie when the
    # clearing ``Set-Cookie`` matches the stored one's attributes, so a Secure cookie needs a Secure
    # expiry or logout silently does nothing.
    cookie_secure: bool = Field(
        default=False,
        validation_alias=AliasChoices("TVASHTR_COOKIE_SECURE", "cookie_secure"),
    )

    # M-accounts Slice B: the Fernet key that encrypts BYOK provider keys at rest in
    # ``provider_credentials`` (see ``control_plane.credentials``). A real 44-char urlsafe-base64
    # ``Fernet.generate_key()`` value is hardcoded as the dev default so the offline suite + local
    # dev work with no extra env. PRODUCTION MUST override ``TVASHTR_SECRET_KEY`` with its OWN
    # generated key, and the key MUST be STABLE — the stored secrets are only decryptable with the
    # SAME key, so rotating it strands every saved credential (re-enter them after a rotation).
    # Distinct from ``session_secret`` (which only signs the login cookie); a leak of one does not
    # compromise the other.
    secret_key: SecretStr = Field(
        default=SecretStr("TzxdlCpD6FYWPsjw6h7e3sYQw6EvjI-cmvJI2KQE7ho="),
        validation_alias=AliasChoices("TVASHTR_SECRET_KEY", "secret_key"),
    )

    # M-h1a (HOSTED mode): GitHub App = identity provider + repo source. The posture flag
    # gates the whole feature. With ``hosted_mode`` FALSE (the DEFAULT) NONE of the four
    # GitHub App credentials are read and the app behaves EXACTLY as the self-hosted
    # email/password build does — the password path + ``login_operator`` + ``repo_path`` are
    # untouched. The four credentials are sourced from the operator's real GitHub App via
    # ``.env``; ``client_id``/``app_id`` are public (safe to surface to the FE), but the
    # ``client_secret`` and the base64 PKCS#1 ``private_key_b64`` are SECRETS that are NEVER
    # echoed, logged, or serialized into any API response (see ``control_plane/github_app.py`` +
    # the redaction tests). Empty-string defaults so an UNCONFIGURED install leaves them blank and
    # the live ``github-app-e2e`` gate SKIPS cleanly (mirrors ``docs_chain_check`` env-absent skip).
    hosted_mode: bool = Field(
        default=False,
        validation_alias=AliasChoices("TVASHTR_HOSTED_MODE", "hosted_mode"),
    )
    github_app_id: str = Field(
        default="",
        validation_alias=AliasChoices("GITHUB_APP_ID", "github_app_id"),
    )
    github_app_client_id: str = Field(
        default="",
        validation_alias=AliasChoices("GITHUB_APP_CLIENT_ID", "github_app_client_id"),
    )
    # OPTIONAL public app slug (env ``GITHUB_APP_SLUG``) — the ``github.com/apps/<slug>`` URL name.
    # Used ONLY to build the FE "Continue with GitHub" install URL server-side (exposed by the open
    # ``GET /api/config``); it is public + empty-default, so leaving it unset simply falls back to
    # the client_id OAuth-authorize URL. NOT one of the four credential secrets — it authenticates
    # nothing. (The four credentials above are what the ``github-app-e2e`` gate exercises.)
    github_app_slug: str = Field(
        default="",
        validation_alias=AliasChoices("GITHUB_APP_SLUG", "github_app_slug"),
    )
    github_app_client_secret: SecretStr = Field(
        default=SecretStr(""),
        validation_alias=AliasChoices("GITHUB_APP_CLIENT_SECRET", "github_app_client_secret"),
    )
    github_app_private_key_b64: SecretStr = Field(
        default=SecretStr(""),
        validation_alias=AliasChoices("GITHUB_APP_PRIVATE_KEY_B64", "github_app_private_key_b64"),
    )
    # M-h1b (HOSTED mode): the origin the GitHub sign-in callback bounces back to after it issues
    # the session cookie. The callback runs on the BACKEND origin, but the SPA is served from a
    # SEPARATE origin (Vite dev :5173, the real domain in prod), so redirecting to the backend root
    # ``/`` lands on a bare JSON 404. Default the local Vite origin for dev; M-h4 points
    # ``TVASHTR_FRONTEND_ORIGIN`` at the deployed domain. (Cookies scope by DOMAIN not port, so the
    # cross-port redirect keeps the session.)
    frontend_origin: str = Field(
        default="http://localhost:5173",
        validation_alias=AliasChoices("TVASHTR_FRONTEND_ORIGIN", "frontend_origin"),
    )

    # M-h4 (DEPLOY): this deployment's OWN public origin — the scheme+host a browser reaches the
    # BACKEND at. Distinct from ``frontend_origin`` above: that says where to bounce the user AFTER
    # sign-in, this says what address to tell GitHub to come BACK to. They are the same value in a
    # one-origin deploy and deliberately different locally (Vite :5173 vs the API :8000), which is
    # exactly why they stay two fields.
    #
    # It exists because the GitHub App now carries TWO registered callbacks —
    # ``http://localhost:8000/api/auth/github/callback`` and
    # ``https://tvashtr.fly.dev/api/auth/github/callback``. With no ``redirect_uri`` on the
    # authorize URL, GitHub picks between them itself, so a local sign-in could land on the
    # deployed app (or the reverse). ``github_app.build_install_url`` appends this, URL-encoded.
    # The default is the LOCAL callback so http dev is unchanged; prod sets the .fly.dev origin in
    # fly.toml's ``[env]``.
    public_base_url: str = Field(
        default="http://localhost:8000",
        validation_alias=AliasChoices("TVASHTR_PUBLIC_BASE_URL", "public_base_url"),
    )

    # M-h4: where the BUILT frontend lives, for one-origin serving (``main.mount_frontend``). The
    # default is the path the Dockerfile copies Vite's output to INSIDE the image; on a laptop that
    # path does not exist, and a missing dist is a deliberate no-op (no mount, no catch-all), so a
    # local backend keeps serving only ``/api`` + ``/health`` exactly as it did before M-h4 and
    # local dev keeps using the Vite server on ``frontend_origin``.
    #
    # One-origin is not cosmetic: serving the SPA from the SAME origin as ``/api`` makes the session
    # cookie first-party and same-site, which is what lets ``samesite="lax"`` + ``cookie_secure``
    # below be a complete answer instead of a CORS negotiation.
    frontend_dist: str = Field(
        default="/app/frontend/dist",
        validation_alias=AliasChoices("TVASHTR_FRONTEND_DIST", "frontend_dist"),
    )

    # PolyRAG Domains Phase 2: filesystem root for uploaded domain files.
    # Path layout: {domain_files_dir}/{owner_id}/{domain_id}/{document_id}/{safe_filename}
    # Dev/tests default to /tmp (ephemeral). For Fly multi-replica prod, REQUIRE a shared
    # volume so upload and ingest see the same bytes — set
    # TVASHTR_DOMAIN_FILES_DIR=/data/domain-files on a mounted volume. Single-machine Fly
    # still needs a durable volume (not /tmp) across restarts. No Tigris/S3 in Phase 2.
    domain_files_dir: str = Field(
        default="/tmp/tvashtr-domain-files",
        validation_alias=AliasChoices("TVASHTR_DOMAIN_FILES_DIR", "domain_files_dir"),
    )

    # M-h3 (HOSTED mode): the three RUN CEILINGS that bound the operator's COMPUTE spend. A hosted
    # run is BYOK for the LLM — the owner's own provider key pays for tokens (there is no ``.env``
    # fallback), so what the OPERATOR pays for is a Fly Firecracker microVM per IN-FLIGHT run. These
    # bound exactly that, and are enforced at the TOP of the run-create path (before any Run row
    # exists) by ``routers._enforce_run_ceilings``. They are read ONLY when ``hosted_mode`` is True:
    # self-hosted is the operator's own machine, so it stays UNCAPPED and byte-identical.
    # Distinct from ``default_run_budget_usd`` above, which caps ONE run's token SPEND — that is the
    # BYOK dollar gate and is untouched here. These cap how many sandboxes exist at once, and how
    # fast one account may open them.
    #
    # Finite defaults, in the safety-by-default posture of ``agent_sandbox_mode`` and
    # ``default_run_budget_usd``: forgetting to configure a ceiling lands BOUNDED, never unbounded.
    # All three are env-dialable so the operator retunes capacity with no code change.
    #
    # ``in-flight`` = ``pending|running|awaiting_human``. ``awaiting_human`` COUNTS: M-h2b suspends
    # the microVM at a gate (so it stops billing CPU/RAM), but the machine still exists and still
    # holds a slot — a run parked at a gate has not given its sandbox back.
    hosted_max_concurrent_runs_per_owner: int = Field(
        default=3,
        gt=0,
        validation_alias=AliasChoices(
            "TVASHTR_HOSTED_MAX_CONCURRENT_RUNS_PER_OWNER", "hosted_max_concurrent_runs_per_owner"
        ),
    )
    # The fleet-wide ceiling — the operator's absolute wallet stop across ALL accounts. Sized well
    # above the per-owner cap so one account cannot starve the fleet, while a stampede still lands
    # against a hard wall rather than an unbounded Fly bill.
    hosted_max_concurrent_runs_global: int = Field(
        default=25,
        gt=0,
        validation_alias=AliasChoices(
            "TVASHTR_HOSTED_MAX_CONCURRENT_RUNS_GLOBAL", "hosted_max_concurrent_runs_global"
        ),
    )
    # The per-owner RATE ceiling, over a rolling 24h window on ``runs.created_at`` (a sliding
    # window, not a calendar day — there is no midnight reset to stampede against). Concurrency
    # alone cannot bound a script that launches, cancels, and relaunches all day; this does.
    hosted_max_runs_per_owner_per_day: int = Field(
        default=20,
        gt=0,
        validation_alias=AliasChoices(
            "TVASHTR_HOSTED_MAX_RUNS_PER_OWNER_PER_DAY", "hosted_max_runs_per_owner_per_day"
        ),
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
        master = settings.litellm_master_key
        return {
            "model": f"litellm_proxy/{model}",
            # Unwrapped AT THE USE: the LLM client needs the raw key. ``master_key`` is the
            # OPTIONAL secret, so ``None`` (unset) has to survive as ``None`` — the caller's
            # ``or`` still falls back to it exactly as before.
            "api_key": api_key_override or (master.get_secret_value() if master else None),
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
    # ``num_retries``/``retry_max_wait``/``timeout`` are real OpenHands ``LLM`` fields; they splat
    # into the constructor and SERIALIZE into the in-container agent-server, so the docker and fly
    # paths inherit them too. The proxy-ON branch above deliberately OMITS them (budget-latency).
    #
    # M-seat adds ``timeout``: the envelope above decides how long to keep TRYING, and this decides
    # how long any ONE attempt may hang before it is called a failure. Without it the SDK's 300s
    # default multiplies through the retries, which is how a stalled provider ate ~30 minutes of a
    # live demo while reporting nothing at all.
    return {
        "model": model,
        "api_key": api_key_override,
        "num_retries": settings.agent_num_retries,
        "retry_max_wait": settings.agent_retry_max_wait_s,
        "timeout": settings.agent_request_timeout_s,
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()
