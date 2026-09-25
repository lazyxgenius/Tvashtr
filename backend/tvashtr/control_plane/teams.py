"""The hardcoded team-graph builders (pure functions).

Seed the rows the run is *driven by* — the uniform graph the executor walks
(P1.5b): completion nodes (PM/Reviewer), an agent node (Engineer, ``openhands``
engine), **gate** nodes (a human-approval checkpoint the walk pauses at — the PRD
gate, and the review-escalation gate), and **terminal** nodes (the walk's
endpoint: a ``ship`` terminal that commits+finalizes, a ``stop`` terminal that
finalizes ``rejected``). Edges carry the routing (``conditions``); the loop cap
rides the loop-back edge as a ``loop_limit``. This is the seed of "the team is
authored"; the builders stay hardcoded (the Supervisor swaps them in P1.8).
"""

import os
import uuid
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path

from dbos import DBOS
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import aliased

from tvashtr.config import get_settings
from tvashtr.control_plane.credentials import held_provider_slugs
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    CostRecord,
    Edge,
    EngineerRunAttempt,
    HumanTask,
    Run,
    RunEvent,
    TeamGraph,
)

# The Engineer needs a stronger instruction-follower than the cheap completion
# default; same single OPENROUTER_API_KEY, different slug (matches agent-smoke).
DEFAULT_ENGINEER_MODEL = "openrouter/openai/gpt-4o-mini"

# P1.8a: the per-node behavior text, seeded onto ``AgentNode.prompt`` and run GENERICALLY by the
# executor (which appends the run's idea / live PRD / revision context). This is the static
# role behavior MOVED off ``team_run.py`` — the executor no longer hardcodes any of it, and a
# node's role in the loop is decided by the authored topology (its out-edges), not these strings.
# Kept byte-faithful to the pre-P1.8a instructions (minus the idea/PRD tails the executor appends):
# combined with the executor's append, the PM and Reviewer instructions are identical to before;
# the Engineer additionally sees the ORIGINAL IDEA (a benign superset — the deliverable is the
# same). The Reviewer text MUST keep the ``python -B -m unittest`` command, the
# ``REVIEW_VERDICT.json`` sidecar name, and the ``approved``/``changes_requested`` label
# vocabulary verbatim — ``_harvest_verdict``, the §14.1 view, the A/B view, and the smoke
# assertions all depend on them. Slice 4 (Item C) ADDED a literal-safe procedural step 3 (state the
# required behavior + how you verified it before the verdict) — additive, all literals preserved.
PM_PROMPT = (
    "You are the PM on a software team. Write a concise mini-PRD (3-5 sentences) "
    "for the feature request below. You MUST restate, verbatim, the exact file path "
    "and the exact required file contents (each clearly labelled on its own line), "
    "plus one sentence of context for the engineer."
)
ENGINEER_PROMPT = (
    "Read the PRD below and create exactly the file it specifies, with exactly the "
    "specified contents. Write the deliverable into your current working directory using "
    "a RELATIVE path (the bare filename, e.g. 'greeting.txt') so it can be shipped; if the "
    "PRD shows a leading '/' or './', treat it as relative to your working directory. Do not "
    "add any extra files and do not modify anything else."
)
REVIEWER_PROMPT = (
    "You are the Reviewer on a software team. The engineer's build is in your current "
    "working directory. Review it — do NOT improve it.\n\n"
    "Do these steps in order:\n"
    "1. Inspect the files in your current working directory (the engineer's build).\n"
    "2. Run the repository's tests. PREFER pytest:\n"
    "       python -m pytest -q\n"
    "   If pytest is unavailable or collects no tests, fall back to EXACTLY this command "
    "(the -B is required — do not write bytecode):\n"
    "       python -B -m unittest\n"
    "3. Before deciding, state in ONE sentence the single concrete behavior the ORIGINAL IDEA "
    "and the PRD below require, then state in ONE sentence HOW you verified the build actually "
    "exhibits that behavior — cite the specific test or command output you observed, not an "
    "assumption.\n"
    "4. Decide the verdict:\n"
    '   - "approved" ONLY IF the tests pass AND the deliverable fulfills the ORIGINAL '
    "IDEA and the PRD below.\n"
    '   - "changes_requested" otherwise (any test fails, a required behavior or file from '
    "the idea/PRD is missing, or it otherwise falls short).\n"
    "5. Write a file named EXACTLY REVIEW_VERDICT.json in your current working directory "
    "(the bare filename), containing EXACTLY this JSON and nothing else:\n"
    '       {"verdict": "approved" | "changes_requested", "reasons": "<1-3 short, '
    'specific, actionable sentences>"}\n\n'
    "STRICT RULES:\n"
    "- You are REVIEWING, not editing. Do NOT modify, create, or delete ANY file except "
    "REVIEW_VERDICT.json.\n"
    '- Base "approved" on the tests actually passing and the spec actually being met — do '
    "not approve on assumption."
)

# P1.8c: the Architect — a SECOND thinker (kind ``completion``), composable after the root because
# the executor now generalizes the completion branch. It REFINES the PM's spec in place (the
# executor reads the current spec, runs this prompt, appends a new version). The instruction MUST
# restate the PM's content verbatim (so the exact file path + required contents survive into the
# spec the Engineer reads) and APPEND a technical-design section — exercising a real non-start
# thinker on the ``thinker_chain`` template.
ARCHITECT_PROMPT = (
    "You are the software architect on the team. The current spec (the PM's mini-PRD) is provided "
    "below. Produce the COMPLETE updated spec: restate the PM's content VERBATIM — especially the "
    "exact file path and the exact required file contents — and APPEND a short '## Technical "
    "design' section (2-4 sentences) covering the approach and any implementation detail the "
    "engineer needs. Output the full updated spec and nothing else."
)

# The PRD-approval gate node's config — identical in both teams (the human-approval
# checkpoint the walk pauses at before the Engineer builds).
_PRD_GATE_CONFIG = {
    "gate_kind": "prd_approval",
    "title": "Approve the PRD before the Engineer builds",
    "description": (
        "The PM wrote the PRD. Approve to let the Engineer build and ship it; reject "
        "to stop the run without shipping."
    ),
}

# The ship-approval gate node's config (F2a ``full_squad``) — a SECOND human checkpoint in front of
# the ship terminal: after the review loop converges (or escalation approves), a human approves the
# actual ship. Handled GENERICALLY by the executor (``wait_at_gate`` → approved/rejected → the
# matching out-edge), exactly like the PRD + escalation gates; no ``gate_kind`` branch is needed.
_SHIP_GATE_CONFIG = {
    "gate_kind": "ship_approval",
    "title": "Approve the ship?",
    "description": "Approve to ship the reviewed change; reject to stop without shipping.",
}


def engineer_model() -> str:
    return os.environ.get("TVASHTR_AGENT_MODEL", DEFAULT_ENGINEER_MODEL)


def reviewer_model() -> str:
    """The Reviewer's model. Reuses the Engineer's capable slug so review has the
    comprehension to judge a deliverable against the PRD; under the forced-revisions
    harness the model is irrelevant (no LLM call), and real review-quality tuning is
    P1.5c — so this stays the same single ``OPENROUTER_API_KEY`` slug for now."""
    return engineer_model()


# M-runnable: the ONE backend-owned provider catalogue — the SINGLE place a provider or model slug
# is DECLARED. Static, dependency-free, a module const (no DB, no network);
# ``account_default_model``
# stays pure + unit-testable. Served READ-ONLY to the FE on ``GET /api/config`` (slugs only, never
# keys — ``public_provider_catalogue``); the picker's quick-picks + the dashboard's provider
# suggestions DERIVE from it, nothing to hand-sync.
#
# M-seat SPLITS every entry by SEAT. One ``default_model`` per provider could only answer "which
# provider?", never "can that provider's model do this job?" — and the two seats are not
# interchangeable. A THINKER makes one completion and returns a deliverable; a WORKER drives the
# OpenHands agent loop, with tool calls, content blocks and a transcript that grows all run. M-live
# proved the difference in production: the nvidia_nim default drove the PM node to a real PRD and a
# human-approved gate, then killed the Engineer on an empty-bodied provider 400.
#
# ``worker_default: None`` is therefore a legal, meaningful answer — "this provider cannot serve a
# worker seat" — and the walk yields that seat to the next held provider while keeping the seat the
# provider CAN serve. A capability with no default offers no presets either, or the picker would
# invite by hand the exact failure the defaults avoid.
#
# EVERY value below is PROBED, never guessed: ``scripts/seat_probe.py`` runs four gates for a worker
# seat (a live gateway completion; the OpenHands content-block + tool shape; a real agent step whose
# file lands INSIDE the workspace with exact contents; no crash in the loop) and two for a thinker
# (a live completion; a real deliverable under the 400-token ceiling, not a chain-of-thought). The
# transcript that filled this table in is in ``STATE.md``.
#
# INVARIANT (pinned by tests): every slug canonicalizes (``credentials.provider_for_model``) to its
# provider key; each declared default is one of its own seat's presets; a seat with no default has
# no presets.
CAPABILITIES: tuple[str, ...] = ("thinker", "worker")


def capability_of(kind: str) -> str:
    """The SEAT a node's ``kind`` column names: ``agent`` (engine-backed) is a WORKER, anything
    else that carries a model is a THINKER. The ``kind``/capability pair is the P1.8c authoring
    vocabulary; this is the ONE translation between the column and the catalogue's seat names."""
    return "worker" if kind == "agent" else "thinker"


#
# Revamp (Engines + the agent panel's model picker) adds DISPLAY metadata to every entry — none of
# it is read by the default walk, so it changes no stamped model:
#
# * ``label`` — the vendor's display name ("Uses your xAI API key", "Paste your Anthropic API key");
# * ``model_labels`` — a friendly name for every slug the entry declares ("Grok 4.7");
# * ``subscription`` — the Desktop subscription engine that can run this provider's models on the
#   owner's own computer (``claude``/``grok``; ``None`` otherwise). It mirrors
#   ``credential_gate.MODEL_PROVIDER_TO_SUB`` restricted to ``RUNNER_SUBSCRIPTIONS`` (pinned by a
#   test), so the picker and the launch gate can never disagree about which models a plan covers;
# * ``byok_probed`` — whether the seat presets were proven with an API key by
#   ``scripts/seat_probe.py``. ``False`` means the slugs are offered on other evidence (the
#   Desktop runner's CLIs for ``anthropic``/``xai``; M-runnable's seed for ``openrouter``), so the
#   picker can say so honestly instead of claiming "proven to run a full build".
#
# ``anthropic`` and ``xai`` are deliberately ABSENT from ``_PROVIDER_DEFAULT_ORDER`` below: nothing
# probed them on the BYOK path, so they are never stamped as an account default or fallback — they
# are offered in the picker, and a user chooses them by hand.
PROVIDER_CATALOGUE: dict[str, dict] = {
    # UNPROBED — the operator holds no OpenRouter key (its credits ran out, and the variable is gone
    # from ``.env``), so no gate could be run against it. Declaring ``None`` here would retire a
    # provider for every OTHER account on no evidence at all, which is a worse error than carrying a
    # slug that the M-live launch pre-flight will catch the moment it does go dead. Left exactly as
    # M-runnable seeded it, and it stays LAST in the preference order.
    "openrouter": {
        "thinker_default": "openrouter/openai/gpt-4o-mini",
        "worker_default": "openrouter/openai/gpt-4o-mini",
        "thinker_presets": [
            "openrouter/openai/gpt-4o-mini",
            "openrouter/meta-llama/llama-3.1-8b-instruct",
            "openrouter/google/gemini-flash-1.5",
        ],
        "worker_presets": ["openrouter/openai/gpt-4o-mini"],
        "label": "OpenRouter",
        "model_labels": {
            "openrouter/openai/gpt-4o-mini": "GPT-4o mini",
            "openrouter/meta-llama/llama-3.1-8b-instruct": "Llama 3.1 8B Instruct",
            "openrouter/google/gemini-flash-1.5": "Gemini 1.5 Flash",
        },
        "subscription": None,
        "byok_probed": False,
    },
    # PROBED 2026-09-08 (full transcript in ``STATE.md``). Both seats land on the same slug: it is
    # the ONLY nvidia_nim candidate that passed BOTH matrices, and it passed the worker gates 3/3 on
    # re-probe. Its first-run ``W1: FAIL — empty content`` was transient (a 95s stall), which is why
    # a single observation was not allowed to decide a catalogue entry. Rejected here, and the
    # rejections are real: ``moonshotai/kimi-k2.6`` 404s (not entitled), and
    # ``minimaxai/minimax-m3`` passed all four WORKER gates but truncates as a thinker
    # (T2 RateLimitError, then a fragment) — it is kept as a worker quick-pick, not a default.
    "nvidia_nim": {
        "thinker_default": "nvidia_nim/openai/gpt-oss-20b",
        # WORKER: `openai/gpt-oss-20b` passes all four probe gates 3/3 and then fails the REAL
        # brownfield loop DETERMINISTICALLY — twice, on runs 647f9c86 and 98427784, each time on the
        # Engineer's FIRST request with zero completed calls and an empty-bodied
        # `Nvidia_nimException`. That is the fifth gate only the full loop exposes, and the probe
        # cannot see it. `minimaxai/minimax-m3` is the other NIM candidate that passed all four
        # worker gates, so promoting it is an EVIDENCED swap between two probed models, not a
        # hand-pick — and `_PROVIDER_DEFAULT_ORDER` is untouched. gpt-oss-20b stays a worker preset
        # (it is genuinely worker-capable by every check we can automate) and keeps the thinker
        # seat, which it serves live in every run to date.
        "worker_default": "nvidia_nim/minimaxai/minimax-m3",
        "thinker_presets": ["nvidia_nim/openai/gpt-oss-20b"],
        "worker_presets": [
            "nvidia_nim/minimaxai/minimax-m3",
            "nvidia_nim/openai/gpt-oss-20b",
        ],
        "label": "NVIDIA NIM",
        "model_labels": {
            "nvidia_nim/openai/gpt-oss-20b": "gpt-oss-20b",
            "nvidia_nim/minimaxai/minimax-m3": "MiniMax M3",
        },
        "subscription": None,
        "byok_probed": True,
    },
    # PROBED 2026-09-08. The two seats genuinely differ here, first-pass in preference order each:
    # ``gpt-4.1-mini`` took the worker seat (W1-W4, 11s) and ``gpt-4o-mini`` the thinker seat
    # (T1-T2, 1889 chars, 3/4 headings). Neither list carries the other's winner, because neither
    # was probed in the other seat — an unprobed slug is exactly what this milestone removed.
    "openai": {
        "thinker_default": "openai/gpt-4o-mini",
        "worker_default": "openai/gpt-4.1-mini",
        "thinker_presets": ["openai/gpt-4o-mini"],
        "worker_presets": ["openai/gpt-4.1-mini"],
        "label": "OpenAI",
        "model_labels": {
            "openai/gpt-4o-mini": "GPT-4o mini",
            "openai/gpt-4.1-mini": "GPT-4.1 mini",
        },
        # Codex is a subscription for openai models, but Tvashtr Desktop cannot run nodes on it
        # (``RUNNER_SUBSCRIPTIONS``), so it never covers a node here.
        "subscription": None,
        "byok_probed": True,
    },
    # PROBED 2026-09-08 — and the clearest case in the table for why the seats are separate.
    # ``gemini-2.5-flash`` passes ALL FOUR worker gates (W3: a real agent step whose file landed in
    # the workspace with exact contents) and CANNOT serve a thinker: under the product's own
    # ``agent_max_output_tokens`` ceiling it spends the whole budget reasoning and returns a
    # truncated fragment — 63 then 91 characters for completion_tokens=396, twice. The other
    # candidate, ``gemini-flash-latest``, was given the full flaky-gate retry budget (6 attempts):
    # it passes T1, a trivial completion, and never once returned a T2 deliverable — every attempt
    # ServiceUnavailable. So `None` here is EVIDENCE, not a gap: this account's Gemini quota admits
    # trivial calls and refuses substantial ones, and the thinker seat yields to the next provider.
    "gemini": {
        "thinker_default": None,
        "worker_default": "gemini/gemini-2.5-flash",
        "thinker_presets": [],
        "worker_presets": ["gemini/gemini-2.5-flash"],
        "label": "Gemini",
        "model_labels": {"gemini/gemini-2.5-flash": "Gemini 2.5 Flash"},
        "subscription": None,
        "byok_probed": True,
    },
    # PROBED 2026-09-08. One model, both seats. The worker gates took 232s because Groq's free tier
    # 429s on tokens (``rate_limit_exceeded``) and the BYOK retry envelope rode it out rather than
    # failing — which is the envelope doing its job, and the reason a slow gate is not a failed one.
    "groq": {
        "thinker_default": "groq/openai/gpt-oss-120b",
        "worker_default": "groq/openai/gpt-oss-120b",
        "thinker_presets": ["groq/openai/gpt-oss-120b"],
        "worker_presets": ["groq/openai/gpt-oss-120b"],
        "label": "Groq",
        "model_labels": {"groq/openai/gpt-oss-120b": "gpt-oss-120b"},
        "subscription": None,
        "byok_probed": True,
    },
    # PROBED 2026-09-08. Both seats, first candidate, clean (W1-W4 in 11s; T2 1675 chars).
    # ``deepseek-reasoner`` was a preset before this milestone and is GONE: no gate ever covered it,
    # and carrying an unprobed slug forward is precisely the habit the seat split exists to end.
    "deepseek": {
        "thinker_default": "deepseek/deepseek-chat",
        "worker_default": "deepseek/deepseek-chat",
        "thinker_presets": ["deepseek/deepseek-chat"],
        "worker_presets": ["deepseek/deepseek-chat"],
        "label": "DeepSeek",
        "model_labels": {"deepseek/deepseek-chat": "DeepSeek Chat"},
        "subscription": None,
        "byok_probed": True,
    },
    # Revamp: NOT probed on the BYOK path (``byok_probed: False``). These are the models Tvashtr
    # Desktop runs today through the owner's own CLI sign-in — Claude Code for ``anthropic/*``,
    # the Grok CLI for ``xai/*`` (``desktop/electron/runner/cliCommand.cjs``) — and both node kinds
    # route there (``team_run._desktop_route`` covers thinker and worker alike), so both seats offer
    # them. They are NOT in ``_PROVIDER_DEFAULT_ORDER``: offered, never auto-stamped.
    "anthropic": {
        "thinker_default": "anthropic/claude-sonnet-5",
        "worker_default": "anthropic/claude-sonnet-5",
        "thinker_presets": ["anthropic/claude-sonnet-5", "anthropic/claude-sonnet-4"],
        "worker_presets": ["anthropic/claude-sonnet-5", "anthropic/claude-sonnet-4"],
        "label": "Anthropic",
        "model_labels": {
            "anthropic/claude-sonnet-5": "Claude Sonnet 5",
            "anthropic/claude-sonnet-4": "Claude Sonnet 4",
        },
        "subscription": "claude",
        "byok_probed": False,
    },
    "xai": {
        "thinker_default": "xai/grok-4.7",
        "worker_default": "xai/grok-4.7",
        "thinker_presets": ["xai/grok-4.7"],
        "worker_presets": ["xai/grok-4.7"],
        "label": "xAI",
        "model_labels": {"xai/grok-4.7": "Grok 4.7"},
        "subscription": "grok",
        "byok_probed": False,
    },
}
# The deterministic preference order when the account holds several mapped providers.
#
# M-thrift REORDERS it: ``nvidia_nim`` FIRST, ``openrouter`` LAST. The tie-break's job is to
# maximise the chance a new account's FIRST run succeeds, and openrouter had been winning it for a
# historical reason only — the legacy ``default_model``/``engineer_model`` slugs happened to live
# there. In practice it is the provider that fails: its free tier is credit-metered, so a
# low-balance key is refused with a 402 pre-flight credit reservation before generating a token
# (the wall the output ceiling and the 402 classifier above exist for). NVIDIA NIM's tier is
# request-metered, not balance-metered, so it degrades to throttling — which the agent's retry
# envelope already rides out — instead of a hard refusal.
#
# This changes ONLY the defaults stamped on NEWLY created teams for accounts holding 2+ providers.
# Persisted node models are never rewritten, and a single-provider account is unaffected: the walk
# has exactly one candidate whatever the order.
_PROVIDER_DEFAULT_ORDER: tuple[str, ...] = (
    "nvidia_nim",
    "openai",
    "gemini",
    "groq",
    "deepseek",
    "openrouter",
)


def _capability_keys(capability: str) -> tuple[str, str]:
    """``(default_key, presets_key)`` for a seat name — and the ONE place a bad seat name is
    refused. A typo must never resolve silently to the other seat: that is precisely the class of
    bug this milestone exists to remove."""
    if capability not in CAPABILITIES:
        raise ValueError(f"unknown capability {capability!r} (expected one of {CAPABILITIES})")
    return f"{capability}_default", f"{capability}_presets"


def catalogue_default(provider: str, capability: str) -> str | None:
    """The catalogued default model for one provider in one SEAT, or ``None``.

    ``None`` is a real answer, not a gap: it means the probe found no model this provider serves
    that can do that job (``scripts/seat_probe.py``). Callers must YIELD the seat rather than
    substitute the other capability's slug."""
    default_key, _ = _capability_keys(capability)
    entry = PROVIDER_CATALOGUE.get(provider)
    return entry.get(default_key) if entry else None


def catalogue_presets(provider: str, capability: str) -> list[str]:
    """The quick-picks one provider offers for one SEAT (a fresh list — callers may mutate)."""
    _, presets_key = _capability_keys(capability)
    entry = PROVIDER_CATALOGUE.get(provider)
    return list(entry.get(presets_key) or []) if entry else []


def account_default_model(held_providers: set[str], capability: str) -> str | None:
    """The default FULL model slug for the FIRST provider (preference order) that the account holds
    a credential for AND that declares a default for THIS SEAT; else ``None`` (the caller uses its
    legacy default). Pure + unit-tested; no DB, no env.

    M-seat added ``capability``. Before it, the walk asked only "which provider?", so a provider
    that leads the order decided every seat — and the model proven as its THINKER was stamped on
    WORKER nodes that cannot run it. A provider declaring ``None`` for a capability now yields that
    seat to the next held provider, while keeping the seat it CAN serve."""
    for provider in _PROVIDER_DEFAULT_ORDER:
        if provider not in held_providers:
            continue
        model = catalogue_default(provider, capability)
        if model is not None:
            return model
    return None


def public_provider_catalogue() -> list[dict]:
    """The provider catalogue as a serializable, PUBLIC list (served on ``GET /api/config``):
    provider + model slugs ONLY, never any key material. Ordered by ``PROVIDER_CATALOGUE`` insertion
    so the FE renders a stable provider list. The FE DERIVES its model quick-picks + provider
    suggestions from this, so a slug is declared in exactly one place (the catalogue above).

    M-seat serves BOTH seats. The picker needs the split as much as the builders do: offering a
    worker node a thinker-only quick-pick invites, by hand, the exact failure the defaults now
    avoid.

    Revamp adds the display metadata (``label``, ``model_labels``, ``subscription``,
    ``byok_probed``). Read with ``.get`` so a synthetic catalogue a test swaps in still serves."""
    return [
        {
            "provider": p,
            "thinker_default": e["thinker_default"],
            "worker_default": e["worker_default"],
            "thinker_presets": list(e["thinker_presets"]),
            "worker_presets": list(e["worker_presets"]),
            "label": e.get("label") or p,
            "model_labels": dict(e.get("model_labels") or {}),
            "subscription": e.get("subscription"),
            "byok_probed": bool(e.get("byok_probed", False)),
        }
        for p, e in PROVIDER_CATALOGUE.items()
    ]


def account_fallback_model(held_providers: set[str], capability: str) -> str | None:
    """The default model of the SECOND catalogued provider (preference order) the account holds a
    credential for AND that can serve THIS SEAT, else ``None``.

    This is the node's ``config["fallback_model"]`` — the one authored escape hatch the executor
    uses when the PRIMARY provider hard-fails (a dead key, an unreachable provider, or the 402
    credit wall M-thrift made classifiable). Deliberately the SECOND entry of the SAME walk
    :func:`account_default_model` takes its first from, so primary and fallback can never name the
    same provider and the failover always crosses a real vendor boundary.

    It walks the SAME capability for two reasons, and both are correctness, not tidiness: a worker's
    failover target that can only serve thinkers is a safety net tied to nothing; and a
    capability-blind walk would skip a provider for the primary and then hand that same provider
    back as the fallback — or worse, hand the worker its own primary provider, collapsing the
    cross-vendor property this function exists for.

    An account holding fewer than two providers that can serve this seat has nowhere to fail over
    TO, so this returns ``None`` and the builders write no key at all. Pure + unit-tested."""
    ordered = [
        p
        for p in _PROVIDER_DEFAULT_ORDER
        if p in held_providers and catalogue_default(p, capability) is not None
    ]
    return catalogue_default(ordered[1], capability) if len(ordered) > 1 else None


# M-thrift: the vendored ``caveman`` skill — an ultra-compressed output style that keeps technical
# substance and drops filler. Stamped on every WORKER node so an agent round emits far fewer
# completion tokens (the run's dominant per-round cost) with no change to what it DOES.
#
# READ FROM DISK, ONCE, AT IMPORT — never fetched. The agent runs inside a Fly microVM behind the
# M-h3 egress fence, so a runtime fetch would fail closed; and the content has to be materialized
# anyway, because an ``inline`` skill source stores its own text (see ``node_skills``). Provenance,
# the upstream commit and the MIT license live beside the file in ``skills/caveman/``.
_CAVEMAN_SKILL_PATH = Path(__file__).resolve().parent.parent / "skills" / "caveman" / "SKILL.md"
CAVEMAN_SKILL_MD: str = _CAVEMAN_SKILL_PATH.read_text(encoding="utf-8")


def caveman_skill_sources() -> list[dict]:
    """The worker skill list a builder stamps: the vendored caveman skill, ``always`` on.

    ``always`` (not ``trigger``/``agent``) because the point is a standing output style for every
    turn — a trigger-gated compression skill would save nothing on the turns that cost the most.
    A fresh list per call: these become each node's own mutable ``skills`` JSON, so they must never
    share one object across nodes."""
    return [
        {
            "type": "inline",
            "name": "caveman",
            "content": CAVEMAN_SKILL_MD,
            "mode": "always",
        }
    ]


def _stamp_account_defaults(nodes: list, held_providers: set[str] | None) -> list:
    """Stamp M-thrift's two per-node defaults across a builder's freshly-constructed node list, and
    return it (so a builder can inline this straight into ``session.add_all``).

    * every MODEL-BEARING node (``model is not None`` — thinker or worker alike) gets
      ``config["fallback_model"]``, so a dead primary provider costs a swap and not the run;
    * every WORKER node (``kind == "agent"`` — the engine-backed capability) gets the caveman skill.

    ONE rule in ONE place rather than the same two kwargs repeated across seventeen ``AgentNode``
    constructions, which is how a builder silently drifts out of the set. Both stamps are additive:
    with no second held provider and on a non-worker node this function changes nothing, so a
    node's ``config``/``skills`` stay byte-identical to the pre-M-thrift builder output.
    Gates and terminals carry no model and no engine, so neither stamp can reach them.

    M-seat: the fallback is resolved PER NODE, for that node's own seat — a worker's failover target
    has to be a model that can actually drive the agent loop."""
    for node in nodes:
        if node.model is not None:
            fallback = account_fallback_model(held_providers or set(), capability_of(node.kind))
            if fallback is not None:
                node.config = {**(node.config or {}), "fallback_model": fallback}
        if node.kind == "agent":
            node.skills = caveman_skill_sources()
    return nodes


def _node_default_model(held_providers: set[str] | None, fallback: str, capability: str) -> str:
    """The model a builder stamps on a model-bearing node at CREATION: the OWNER's held-provider
    default FOR THAT NODE'S SEAT (``account_default_model``), else the per-role fallback (a
    thinker's ``settings.default_model``; a worker's ``engineer_model()``/``reviewer_model()``).
    This makes the team the account is GIVEN a team it can RUN — every model node's provider is one
    the owner holds, and every model can do the job its node was built for. ``held_providers``
    empty/``None`` ⇒ the legacy fallback, byte-identical to the pre-M-runnable behavior for a
    non-account (direct) caller."""
    return account_default_model(held_providers or set(), capability) or fallback


def build_two_node_team(
    name: str = "PM -> Engineer", held_providers: set[str] | None = None
) -> str:
    """Insert the 2-node team as a uniform walk and return its team_graph id.

    Topology (the walk the generic executor traces): PM (completion) writes the PRD
    -> prd_gate (gate; approve -> Engineer, reject -> stop) -> Engineer (agent)
    builds -> ship (terminal; commit + finalize ``completed``). The explicit terminal
    means the walk always ends at a node (no implicit fall-off-the-end ship). No
    loop-back/escalation, so the cap never trips: the Engineer runs once -> ship."""
    settings = get_settings()
    with session_scope() as session:
        graph = TeamGraph(name=name)
        session.add(graph)
        session.flush()

        pm = AgentNode(
            team_graph_id=graph.id,
            role_name="pm",
            kind="completion",
            model=_node_default_model(held_providers, settings.default_model, "thinker"),
            engine=None,
            prompt=PM_PROMPT,
            position={"x": 0, "y": 0},
        )
        prd_gate = AgentNode(
            team_graph_id=graph.id,
            role_name="prd_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 260, "y": 0},
            config=_PRD_GATE_CONFIG,
        )
        engineer = AgentNode(
            team_graph_id=graph.id,
            role_name="engineer",
            kind="agent",
            model=_node_default_model(held_providers, engineer_model(), "worker"),
            engine="openhands",
            prompt=ENGINEER_PROMPT,
            position={"x": 520, "y": 0},
        )
        ship = AgentNode(
            team_graph_id=graph.id,
            role_name="ship",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 780, "y": 0},
            config={"terminal_kind": "ship"},
        )
        stop = AgentNode(
            team_graph_id=graph.id,
            role_name="stop",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 260, "y": 160},
            config={"terminal_kind": "stop"},
        )
        session.add_all(
            _stamp_account_defaults([pm, prd_gate, engineer, ship, stop], held_providers)
        )
        session.flush()

        session.add_all(
            [
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=pm.id,
                    target_node_id=prd_gate.id,
                    edge_type="work",
                    conditions=None,
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=engineer.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=engineer.id,
                    target_node_id=ship.id,
                    edge_type="work",
                    conditions=None,
                ),
            ]
        )
        return str(graph.id)


def build_review_loop_team(
    name: str = "PM -> Engineer <-> Reviewer", held_providers: set[str] | None = None
) -> str:
    """Insert the 3-role cyclic review-loop team as a uniform walk and return its id.

    Topology (the cycle the generic executor walks): PM (completion) -> prd_gate
    (gate; approve -> Engineer, reject -> stop) -> Engineer (agent) -> Reviewer
    (completion). The Reviewer's ``approved`` routes to the ship terminal; its
    ``changes_requested`` follows the loop-back ``review`` edge to the Engineer — that
    edge carries ``loop_limit`` = ``max_review_iterations`` (the cap). When the cap is
    exhausted the walk leaves the Engineer via the dedicated ``escalation`` edge to the
    escalation gate (ship-as-is on approve / stop on reject). Same hardcoded-builder /
    generic-executor split as :func:`build_two_node_team`; the Supervisor (P1.8) later
    swaps the builder."""
    settings = get_settings()
    max_iters = settings.max_review_iterations
    with session_scope() as session:
        graph = TeamGraph(name=name)
        session.add(graph)
        session.flush()

        pm = AgentNode(
            team_graph_id=graph.id,
            role_name="pm",
            kind="completion",
            model=_node_default_model(held_providers, settings.default_model, "thinker"),
            engine=None,
            prompt=PM_PROMPT,
            position={"x": 0, "y": 0},
        )
        prd_gate = AgentNode(
            team_graph_id=graph.id,
            role_name="prd_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 260, "y": 0},
            config=_PRD_GATE_CONFIG,
        )
        engineer = AgentNode(
            team_graph_id=graph.id,
            role_name="engineer",
            kind="agent",
            model=_node_default_model(held_providers, engineer_model(), "worker"),
            engine="openhands",
            prompt=ENGINEER_PROMPT,
            position={"x": 520, "y": 0},
            # P1.8a: the executor no longer reads ``agent_kind`` — a node's loop role is derived
            # from its out-edges (:func:`node_emits_outcome`). ``agent_kind`` is LEFT as-is (the FE
            # may still read ``config``); removing it is a deferred P1.8b cleanup. The
            # behavior the executor runs now comes from ``prompt`` (ENGINEER_PROMPT) above.
            config={"agent_kind": "engineer"},
        )
        reviewer = AgentNode(
            team_graph_id=graph.id,
            role_name="reviewer",
            # P1.5c: the Reviewer is a full agent — it runs the deliverable's tests in the sandbox
            # (behind the unchanged EngineAdapter, like the Engineer) and judges the build against
            # the idea + PRD, emitting REVIEW_VERDICT.json the Control Plane harvests. P1.8a: the
            # executor runs its ``prompt`` (REVIEWER_PROMPT) generically and treats it as an
            # outcome-emitting node because it has a conditional out-edge (``{when: approved}``) —
            # NOT because of ``agent_kind`` (left as-is for the FE; the executor ignores it).
            kind="agent",
            engine="openhands",
            model=_node_default_model(held_providers, reviewer_model(), "worker"),
            prompt=REVIEWER_PROMPT,
            position={"x": 780, "y": 0},
            config={"agent_kind": "reviewer"},
            # M-unify U3: the Reviewer GATES the diff — it emits a verdict, never ships
            # edits. Author it EXPLICITLY edits-off (overriding the kind-mapped agent →
            # edits-on default); the Slice-4 verdict-only pull already enforced this, so
            # it's a behavior-consistent default alignment. Under loop-always it still runs
            # the deliverable's tests in the sandbox.
            edits_allowed=False,
        )
        escalation_gate = AgentNode(
            team_graph_id=graph.id,
            role_name="escalation_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 520, "y": 180},
            config={
                "gate_kind": "review_escalation",
                "title": (
                    f"Couldn't satisfy the spec in {max_iters} review rounds — "
                    "ship the last build as-is, or stop"
                ),
                "description": (
                    "The Engineer and Reviewer did not converge within the cap. Approve "
                    "to ship the last completed build as-is, or reject to stop the run "
                    "without shipping."
                ),
            },
        )
        ship = AgentNode(
            team_graph_id=graph.id,
            role_name="ship",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 1040, "y": 0},
            config={"terminal_kind": "ship"},
        )
        stop = AgentNode(
            team_graph_id=graph.id,
            role_name="stop",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 260, "y": 160},
            config={"terminal_kind": "stop"},
        )
        session.add_all(
            _stamp_account_defaults(
                [pm, prd_gate, engineer, reviewer, escalation_gate, ship, stop], held_providers
            )
        )
        session.flush()

        session.add_all(
            [
                # PM -> prd_gate (unconditional work edge).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=pm.id,
                    target_node_id=prd_gate.id,
                    edge_type="work",
                    conditions=None,
                ),
                # prd_gate -> Engineer (approved) / -> stop (rejected).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=engineer.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
                # Engineer -> Reviewer (unconditional review edge).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=engineer.id,
                    target_node_id=reviewer.id,
                    edge_type="review",
                    conditions=None,
                ),
                # Reviewer -> Engineer: the loop-back, carrying the cap as loop_limit. P1.8a: NO
                # ``"when"`` — combined with ``next_node``'s extended fallthrough this is the
                # CATCH-ALL out of the Reviewer (``Reviewer -> ship {when: approved}`` fires on
                # approve; EVERYTHING ELSE — changes_requested, or a missing/garbled verdict —
                # falls through here and the loop cycles). ``loop_limit_for`` still finds it
                # (it matches on the ``loop_limit`` key, "when"-agnostic).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=reviewer.id,
                    target_node_id=engineer.id,
                    edge_type="review",
                    conditions={"loop_limit": max_iters},
                ),
                # Reviewer -> ship (approved).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=reviewer.id,
                    target_node_id=ship.id,
                    edge_type="review",
                    conditions={"when": "approved"},
                ),
                # Engineer -> escalation_gate: the cap-exhaustion route out of the agent.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=engineer.id,
                    target_node_id=escalation_gate.id,
                    edge_type="escalation",
                    conditions=None,
                ),
                # escalation_gate -> ship (approved) / -> stop (rejected).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=escalation_gate.id,
                    target_node_id=ship.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=escalation_gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
            ]
        )
        return str(graph.id)


def build_thinker_chain_team(
    name: str = "PM -> Architect -> Engineer", held_providers: set[str] | None = None
) -> str:
    """Insert the linear PM -> Architect -> Engineer team as a uniform walk; return its id (P1.8c).

    Two THINKERS shape the spec before the build: the PM (the root completion) drafts the mini-PRD,
    then the Architect (a SECOND completion — the non-start thinker this milestone unblocks) reads
    that spec and appends a technical-design section in place. Topology (the walk the generic
    executor traces): PM (completion) -> Architect (completion) -> prd_gate (gate; approve ->
    Engineer, reject -> stop) -> Engineer (agent) builds -> ship (terminal; commit + finalize
    ``completed``). Linear — NO review loop / escalation (review is already proven by
    :func:`build_review_loop_team`; this template isolates the non-start thinker). Same
    hardcoded-builder / generic-executor split as the others."""
    settings = get_settings()
    with session_scope() as session:
        graph = TeamGraph(name=name)
        session.add(graph)
        session.flush()

        pm = AgentNode(
            team_graph_id=graph.id,
            role_name="pm",
            kind="completion",
            model=_node_default_model(held_providers, settings.default_model, "thinker"),
            engine=None,
            prompt=PM_PROMPT,
            position={"x": 0, "y": 0},
        )
        architect = AgentNode(
            team_graph_id=graph.id,
            role_name="architect",
            kind="completion",
            model=_node_default_model(held_providers, settings.default_model, "thinker"),
            engine=None,
            prompt=ARCHITECT_PROMPT,
            position={"x": 260, "y": 0},
        )
        prd_gate = AgentNode(
            team_graph_id=graph.id,
            role_name="prd_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 520, "y": 0},
            config=_PRD_GATE_CONFIG,
        )
        engineer = AgentNode(
            team_graph_id=graph.id,
            role_name="engineer",
            kind="agent",
            model=_node_default_model(held_providers, engineer_model(), "worker"),
            engine="openhands",
            prompt=ENGINEER_PROMPT,
            position={"x": 780, "y": 0},
            # P1.8a parity: the executor derives the loop role from the topology, not from
            # ``agent_kind``; this is left for the FE (which reads ``config``), as in the others.
            config={"agent_kind": "engineer"},
        )
        ship = AgentNode(
            team_graph_id=graph.id,
            role_name="ship",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 1040, "y": 0},
            config={"terminal_kind": "ship"},
        )
        stop = AgentNode(
            team_graph_id=graph.id,
            role_name="stop",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 520, "y": 160},
            config={"terminal_kind": "stop"},
        )
        session.add_all(
            _stamp_account_defaults([pm, architect, prd_gate, engineer, ship, stop], held_providers)
        )
        session.flush()

        session.add_all(
            [
                # PM -> Architect (unconditional): the first thinker hands the spec to the second.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=pm.id,
                    target_node_id=architect.id,
                    edge_type="work",
                    conditions=None,
                ),
                # Architect -> prd_gate (unconditional): the refined spec goes to the human gate.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=architect.id,
                    target_node_id=prd_gate.id,
                    edge_type="work",
                    conditions=None,
                ),
                # prd_gate -> Engineer (approved) / -> stop (rejected).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=engineer.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
                # Engineer -> ship (unconditional): build once, then ship.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=engineer.id,
                    target_node_id=ship.id,
                    edge_type="work",
                    conditions=None,
                ),
            ]
        )
        return str(graph.id)


def build_plan_review_team(
    name: str = "PM -> Architect -> Engineer <-> Reviewer", held_providers: set[str] | None = None
) -> str:
    """Insert the plan-and-review team (two thinkers + a review loop) as a uniform walk; return its
    id (F2a). This is EXACTLY :func:`build_review_loop_team` with an Architect thinker inserted
    between the PM and the PRD gate — ``pm -> prd_gate`` becomes ``pm -> architect -> prd_gate``:
    PM (completion) drafts the mini-PRD -> Architect (completion) appends the technical design in
    place -> prd_gate (gate; approve -> Engineer, reject -> stop) -> Engineer (agent) -> Reviewer
    (agent). The Reviewer's ``approved`` ships; its catch-all loop-back follows the ``review`` edge
    (carrying ``loop_limit`` = the cap) to the Engineer; cap-exhaustion leaves the Engineer via the
    ``escalation`` edge to the escalation gate (ship-as-is on approve / stop on reject). Mirrors the
    review-loop builder's node fields, gate configs, and edge construction; the generic executor
    runs it with NO new code (the non-start Architect thinker is already proven by
    :func:`build_thinker_chain_team`)."""
    settings = get_settings()
    max_iters = settings.max_review_iterations
    with session_scope() as session:
        graph = TeamGraph(name=name)
        session.add(graph)
        session.flush()

        pm = AgentNode(
            team_graph_id=graph.id,
            role_name="pm",
            kind="completion",
            model=_node_default_model(held_providers, settings.default_model, "thinker"),
            engine=None,
            prompt=PM_PROMPT,
            position={"x": 0, "y": 0},
        )
        architect = AgentNode(
            team_graph_id=graph.id,
            role_name="architect",
            kind="completion",
            model=_node_default_model(held_providers, settings.default_model, "thinker"),
            engine=None,
            prompt=ARCHITECT_PROMPT,
            position={"x": 260, "y": 0},
        )
        prd_gate = AgentNode(
            team_graph_id=graph.id,
            role_name="prd_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 520, "y": 0},
            config=_PRD_GATE_CONFIG,
        )
        engineer = AgentNode(
            team_graph_id=graph.id,
            role_name="engineer",
            kind="agent",
            model=_node_default_model(held_providers, engineer_model(), "worker"),
            engine="openhands",
            prompt=ENGINEER_PROMPT,
            position={"x": 780, "y": 0},
            config={"agent_kind": "engineer"},
        )
        reviewer = AgentNode(
            team_graph_id=graph.id,
            role_name="reviewer",
            kind="agent",
            engine="openhands",
            model=_node_default_model(held_providers, reviewer_model(), "worker"),
            prompt=REVIEWER_PROMPT,
            position={"x": 1040, "y": 0},
            config={"agent_kind": "reviewer"},
        )
        escalation_gate = AgentNode(
            team_graph_id=graph.id,
            role_name="escalation_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 780, "y": 180},
            config={
                "gate_kind": "review_escalation",
                "title": (
                    f"Couldn't satisfy the spec in {max_iters} review rounds — "
                    "ship the last build as-is, or stop"
                ),
                "description": (
                    "The Engineer and Reviewer did not converge within the cap. Approve "
                    "to ship the last completed build as-is, or reject to stop the run "
                    "without shipping."
                ),
            },
        )
        ship = AgentNode(
            team_graph_id=graph.id,
            role_name="ship",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 1300, "y": 0},
            config={"terminal_kind": "ship"},
        )
        stop = AgentNode(
            team_graph_id=graph.id,
            role_name="stop",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 520, "y": 160},
            config={"terminal_kind": "stop"},
        )
        session.add_all(
            _stamp_account_defaults(
                [pm, architect, prd_gate, engineer, reviewer, escalation_gate, ship, stop],
                held_providers,
            )
        )
        session.flush()

        session.add_all(
            [
                # PM -> Architect (unconditional): the first thinker hands the spec to the second.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=pm.id,
                    target_node_id=architect.id,
                    edge_type="work",
                    conditions=None,
                ),
                # Architect -> prd_gate (unconditional): the refined spec goes to the human gate.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=architect.id,
                    target_node_id=prd_gate.id,
                    edge_type="work",
                    conditions=None,
                ),
                # prd_gate -> Engineer (approved) / -> stop (rejected).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=engineer.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
                # Engineer -> Reviewer (unconditional review edge).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=engineer.id,
                    target_node_id=reviewer.id,
                    edge_type="review",
                    conditions=None,
                ),
                # Reviewer -> Engineer: the loop-back catch-all carrying the cap as loop_limit.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=reviewer.id,
                    target_node_id=engineer.id,
                    edge_type="review",
                    conditions={"loop_limit": max_iters},
                ),
                # Reviewer -> ship (approved).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=reviewer.id,
                    target_node_id=ship.id,
                    edge_type="review",
                    conditions={"when": "approved"},
                ),
                # Engineer -> escalation_gate: the cap-exhaustion route out of the agent.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=engineer.id,
                    target_node_id=escalation_gate.id,
                    edge_type="escalation",
                    conditions=None,
                ),
                # escalation_gate -> ship (approved) / -> stop (rejected).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=escalation_gate.id,
                    target_node_id=ship.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=escalation_gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
            ]
        )
        return str(graph.id)


def build_full_squad_team(
    name: str = "Full feature squad", held_providers: set[str] | None = None
) -> str:
    """Insert the full feature-squad team as a uniform walk; return its id (F2a). EXACTLY
    :func:`build_plan_review_team` PLUS a ``ship_approval`` gate in front of the ship terminal, so
    BOTH ship-bound approvals (the Reviewer's and the escalation gate's) pass a SECOND human
    checkpoint before shipping. Two thinkers (PM + Architect), two workers (Engineer + Reviewer),
    two human gates (PRD + ship). Mirrors the review-loop builder's node fields / gate configs /
    edge construction; the ``ship_approval`` gate is handled generically by the executor
    (``wait_at_gate``) with NO new code."""
    settings = get_settings()
    max_iters = settings.max_review_iterations
    with session_scope() as session:
        graph = TeamGraph(name=name)
        session.add(graph)
        session.flush()

        pm = AgentNode(
            team_graph_id=graph.id,
            role_name="pm",
            kind="completion",
            model=_node_default_model(held_providers, settings.default_model, "thinker"),
            engine=None,
            prompt=PM_PROMPT,
            position={"x": 0, "y": 0},
        )
        architect = AgentNode(
            team_graph_id=graph.id,
            role_name="architect",
            kind="completion",
            model=_node_default_model(held_providers, settings.default_model, "thinker"),
            engine=None,
            prompt=ARCHITECT_PROMPT,
            position={"x": 260, "y": 0},
        )
        prd_gate = AgentNode(
            team_graph_id=graph.id,
            role_name="prd_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 520, "y": 0},
            config=_PRD_GATE_CONFIG,
        )
        engineer = AgentNode(
            team_graph_id=graph.id,
            role_name="engineer",
            kind="agent",
            model=_node_default_model(held_providers, engineer_model(), "worker"),
            engine="openhands",
            prompt=ENGINEER_PROMPT,
            position={"x": 780, "y": 0},
            config={"agent_kind": "engineer"},
        )
        reviewer = AgentNode(
            team_graph_id=graph.id,
            role_name="reviewer",
            kind="agent",
            engine="openhands",
            model=_node_default_model(held_providers, reviewer_model(), "worker"),
            prompt=REVIEWER_PROMPT,
            position={"x": 1040, "y": 0},
            config={"agent_kind": "reviewer"},
        )
        escalation_gate = AgentNode(
            team_graph_id=graph.id,
            role_name="escalation_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 780, "y": 180},
            config={
                "gate_kind": "review_escalation",
                "title": (
                    f"Couldn't satisfy the spec in {max_iters} review rounds — "
                    "ship the last build as-is, or stop"
                ),
                "description": (
                    "The Engineer and Reviewer did not converge within the cap. Approve "
                    "to ship the last completed build as-is, or reject to stop the run "
                    "without shipping."
                ),
            },
        )
        ship_gate = AgentNode(
            team_graph_id=graph.id,
            role_name="ship_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 1300, "y": 0},
            config=_SHIP_GATE_CONFIG,
        )
        ship = AgentNode(
            team_graph_id=graph.id,
            role_name="ship",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 1560, "y": 0},
            config={"terminal_kind": "ship"},
        )
        stop = AgentNode(
            team_graph_id=graph.id,
            role_name="stop",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 520, "y": 160},
            config={"terminal_kind": "stop"},
        )
        session.add_all(
            _stamp_account_defaults(
                [
                    pm,
                    architect,
                    prd_gate,
                    engineer,
                    reviewer,
                    escalation_gate,
                    ship_gate,
                    ship,
                    stop,
                ],
                held_providers,
            )
        )
        session.flush()

        session.add_all(
            [
                # PM -> Architect (unconditional): the first thinker hands the spec to the second.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=pm.id,
                    target_node_id=architect.id,
                    edge_type="work",
                    conditions=None,
                ),
                # Architect -> prd_gate (unconditional): the refined spec goes to the human gate.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=architect.id,
                    target_node_id=prd_gate.id,
                    edge_type="work",
                    conditions=None,
                ),
                # prd_gate -> Engineer (approved) / -> stop (rejected).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=engineer.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
                # Engineer -> Reviewer (unconditional review edge).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=engineer.id,
                    target_node_id=reviewer.id,
                    edge_type="review",
                    conditions=None,
                ),
                # Reviewer -> Engineer: the loop-back catch-all carrying the cap as loop_limit.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=reviewer.id,
                    target_node_id=engineer.id,
                    edge_type="review",
                    conditions={"loop_limit": max_iters},
                ),
                # Reviewer -> ship_gate (approved): the reviewed build routes to the ship gate.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=reviewer.id,
                    target_node_id=ship_gate.id,
                    edge_type="review",
                    conditions={"when": "approved"},
                ),
                # Engineer -> escalation_gate: the cap-exhaustion route out of the agent.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=engineer.id,
                    target_node_id=escalation_gate.id,
                    edge_type="escalation",
                    conditions=None,
                ),
                # escalation_gate -> ship_gate (approved): ship-as-is also passes the ship gate.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=escalation_gate.id,
                    target_node_id=ship_gate.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                # escalation_gate -> stop (rejected).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=escalation_gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
                # ship_gate -> ship (approved) / -> stop (rejected): the second human checkpoint.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=ship_gate.id,
                    target_node_id=ship.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=ship_gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
            ]
        )
        return str(graph.id)


def clone_team_graph(source_team_graph_id: str, name: str | None = None) -> str:
    """Deep-clone a team graph into a NEW run-scoped ``TeamGraph`` and return its id — the
    clone-on-launch snapshot (P1.8b): fresh node ids, every edge remapped onto the cloned node
    ids, and ``position``/``config``/``prompt``/``model``/``engine``/``tool_config``/``skills``/
    ``conditions`` copied faithfully. The clone is the run's IMMUTABLE snapshot — editing authored
    team afterward
    never perturbs an in-flight run. Pure DB (no LLM, no workflow); openhands-free at import."""
    src_id = uuid.UUID(source_team_graph_id)
    with session_scope() as session:
        source = session.execute(select(TeamGraph).where(TeamGraph.id == src_id)).scalar_one()
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == src_id))
            .scalars()
            .all()
        )
        edges = session.execute(select(Edge).where(Edge.team_graph_id == src_id)).scalars().all()

        # Distinct name so the clone never collides with PERSISTENT_TEAM_NAME (which would corrupt
        # the get-or-create lookup) and is legible as a run snapshot in the team list.
        clone = TeamGraph(name=name or f"{source.name} (run snapshot)")
        session.add(clone)
        session.flush()

        id_map: dict[uuid.UUID, uuid.UUID] = {}
        for n in nodes:
            new_node = AgentNode(
                team_graph_id=clone.id,
                role_name=n.role_name,
                kind=n.kind,
                model=n.model,
                engine=n.engine,
                prompt=n.prompt,
                position=deepcopy(n.position),
                config=deepcopy(n.config),
                # M-tools C7.0: the inline tools + skills ride the clone snapshot exactly as
                # config/prompt/model do (deepcopy, since they are JSONB dict/list values). NULL on
                # every node today, so the clone is byte-for-byte unchanged.
                tool_config=deepcopy(n.tool_config),
                skills=deepcopy(n.skills),
                # M-unify U1: carry the capability toggle onto the run snapshot EXPLICITLY (not via
                # the kind-mapped ORM default) so a node PATCH-toggled OFF-kind (e.g. an edits-off
                # worker) clones faithfully — the run executes the authored capability.
                edits_allowed=n.edits_allowed,
                # M2: link the clone back to its origin authored node so the authoring endpoint can
                # read "what did THIS authored node do last run" — correct even for duplicates.
                cloned_from_node_id=n.id,
            )
            session.add(new_node)
            session.flush()
            id_map[n.id] = new_node.id

        session.add_all(
            [
                Edge(
                    team_graph_id=clone.id,
                    source_node_id=id_map[e.source_node_id],
                    target_node_id=id_map[e.target_node_id],
                    edge_type=e.edge_type,
                    conditions=deepcopy(e.conditions),
                )
                for e in edges
            ]
        )
        return str(clone.id)


# ---- The team library (P1.8b): first-class, multiple persistent teams from curated templates ----


@dataclass(frozen=True)
class TeamTemplate:
    """One curated starter template: a stable ``key``, its display ``name``/``description``, and the
    byte-intact builder that materializes it. The ``teams.py`` builders ARE the library the user
    drops from — code, not rows; user-authored/shareable templates are the Phase-4 marketplace."""

    key: str
    name: str
    description: str
    builder: Callable[..., str]


# Ordered catalog the New-team picker reads (the FE renders from this, never a hardcoded list).
_TEMPLATE_CATALOG: tuple[TeamTemplate, ...] = (
    TeamTemplate(
        "two_node",
        "PM → Engineer",
        "A PM writes the spec; an Engineer builds and ships it. No review step.",
        build_two_node_team,
    ),
    TeamTemplate(
        "review_loop",
        "PM → Engineer ↔ Reviewer",
        "Adds a Reviewer that runs the tests and loops back for fixes until it passes "
        "(or the cap trips).",
        build_review_loop_team,
    ),
    TeamTemplate(
        "plan_review",
        "PM → Architect → Engineer ↔ Reviewer",
        "Two thinkers plan it — a PM drafts the spec, an Architect adds the technical design — "
        "then a build-and-review loop ships it once the tests pass (or the cap trips).",
        build_plan_review_team,
    ),
    TeamTemplate(
        "full_squad",
        "Full feature squad",
        "The works — a PM and Architect plan the feature, you approve the plan, an Engineer and "
        "Reviewer build and test in a loop, then you approve the ship. Two thinkers, two workers, "
        "two human checkpoints.",
        build_full_squad_team,
    ),
)
_TEMPLATES_BY_KEY: dict[str, TeamTemplate] = {t.key: t for t in _TEMPLATE_CATALOG}


def list_templates() -> list[dict]:
    """The starter templates as ``{template, name, description}`` (what the picker reads)."""
    return [
        {"template": t.key, "name": t.name, "description": t.description} for t in _TEMPLATE_CATALOG
    ]


def _run_rollup_by_origin(session, library_team_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """Map each LIBRARY team id -> ``{"last_run": {...} | None, "spend_usd": float}`` from its runs.

    A run points at an immutable CLONE of a library team (``runs.team_graph_id`` = the clone), whose
    nodes carry ``cloned_from_node_id`` back to the origin library-team nodes. So a run joins to its
    library team via clone node -> ``cloned_from_node_id`` -> origin node -> origin team (the SAME
    link ``_latest_invocation_by_origin`` uses). ``last_run`` = the most recent run (max created_at)
    across ALL clones of the team; ``spend_usd`` = the SUM of ``runs.cost_total_usd`` (NULL as 0)
    across them. Batched over all ids at once (NO N+1); a clone has many nodes so the run join fans
    out, so a ``DISTINCT`` collapses it to one row per (team, run) before aggregating (spend is not
    multiplied by node count). Owner-isolation rides on the caller passing only that owner's
    library-team ids. Read-only (SELECTs over runs + agent_nodes)."""
    rollup: dict[uuid.UUID, dict] = {
        tid: {"last_run": None, "spend_usd": 0.0} for tid in library_team_ids
    }
    if not library_team_ids:
        return rollup

    clone = aliased(AgentNode)  # a node of the run's cloned (run-snapshot) graph
    origin = aliased(AgentNode)  # the library-team node it was cloned from
    # One de-duped row per (library team, run): a clone's nodes all point back to origin nodes in
    # the same library team, so DISTINCT over the run's columns collapses the fan-out to one row.
    per_run = (
        select(
            origin.team_graph_id.label("team_id"),
            Run.id.label("run_id"),
            Run.status.label("status"),
            Run.created_at.label("created_at"),
            func.coalesce(Run.cost_total_usd, 0).label("cost"),
        )
        .select_from(Run)
        .join(clone, clone.team_graph_id == Run.team_graph_id)
        .join(origin, origin.id == clone.cloned_from_node_id)
        .where(origin.team_graph_id.in_(library_team_ids))
        .distinct()
        .subquery()
    )

    # Latest run per team — Postgres DISTINCT ON (team) with the newest created_at first.
    for team_id, run_id, status, created_at in session.execute(
        select(per_run.c.team_id, per_run.c.run_id, per_run.c.status, per_run.c.created_at)
        .distinct(per_run.c.team_id)
        .order_by(per_run.c.team_id, per_run.c.created_at.desc())
    ).all():
        rollup[team_id]["last_run"] = {
            "status": status,
            "at": created_at.isoformat(),
            "run_id": str(run_id),
        }

    # Total spend per team — SUM over the de-duped per-run rows (NULL cost already coalesced to 0).
    for team_id, total in session.execute(
        select(per_run.c.team_id, func.coalesce(func.sum(per_run.c.cost), 0)).group_by(
            per_run.c.team_id
        )
    ).all():
        rollup[team_id]["spend_usd"] = float(total)

    return rollup


def _team_summary(session, graph: TeamGraph, rollup: dict | None = None) -> dict:
    """One library team as a list/summary row: identity + node count + its run rollup — ``last_run``
    (the most recent run's ``{status, at, run_id}``, or ``None`` if never run) + ``spend_usd`` (the
    total across the team's runs, ``0`` if never run). ``rollup`` is the batched map that
    :func:`list_library_teams` computes ONCE so the list is not N+1; single-team callers omit it and
    it is computed for just this team. Read-only."""
    node_count = session.execute(
        select(func.count()).select_from(AgentNode).where(AgentNode.team_graph_id == graph.id)
    ).scalar_one()
    if rollup is None:
        rollup = _run_rollup_by_origin(session, [graph.id])
    run_rollup = rollup.get(graph.id, {"last_run": None, "spend_usd": 0.0})
    return {
        "team_graph_id": str(graph.id),
        "name": graph.name,
        "created_at": graph.created_at.isoformat(),
        "node_count": node_count,
        "last_run": run_rollup["last_run"],
        "spend_usd": run_rollup["spend_usd"],
    }


def list_library_teams(owner_id: uuid.UUID) -> list[dict]:
    """The OWNER's managed shelf — their ``is_library = true`` teams, ordered ``(created_at, id)``,
    each as a summary (M-accounts Slice B: owner-scoped). Library teams ONLY: run-snapshot clones,
    A/B graphs, and smoke graphs default ``is_library = false`` (``owner_id`` NULL) so they never
    appear here; and another account's library teams are filtered out by ``owner_id``."""
    with session_scope() as session:
        graphs = (
            session.execute(
                select(TeamGraph)
                .where(TeamGraph.is_library.is_(True), TeamGraph.owner_id == owner_id)
                .order_by(TeamGraph.created_at, TeamGraph.id)
            )
            .scalars()
            .all()
        )
        rollup = _run_rollup_by_origin(session, [g.id for g in graphs])
        return [_team_summary(session, g, rollup) for g in graphs]


def get_team_summary(team_graph_id: str) -> dict:
    """The summary for a single team by id (used right after create to echo the new team back)."""
    with session_scope() as session:
        graph = session.execute(
            select(TeamGraph).where(TeamGraph.id == uuid.UUID(team_graph_id))
        ).scalar_one()
        return _team_summary(session, graph)


def rename_library_team(team_id: uuid.UUID, name: str, owner_id: uuid.UUID) -> dict | None:
    """Rename ONE of the owner's library teams; return its updated summary, or ``None`` if there is
    no such team of theirs.

    Owner-scoped by the SAME predicate ``list_library_teams`` and the delete path use
    (``is_library`` AND ``owner_id``), which is what makes the three not-found cases collapse into
    one honest answer: an id that does not exist, a RUN-SNAPSHOT CLONE (immutable — renaming one
    would rewrite the record of what actually ran), and another account's team all return ``None``,
    which the endpoint maps to 404. A foreign team's existence is therefore not even probeable.

    The name is trimmed and required: a blank or whitespace-only name raises ``ValueError`` (the
    endpoint maps it to 422) rather than storing an unlabelled row the rail cannot render. The rule
    lives HERE, not only in the endpoint, so no future caller can write a nameless team.

    Migration-free by construction — this is an UPDATE of an existing column, nothing else."""
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError("a team name is required")
    with session_scope() as session:
        graph = session.execute(
            select(TeamGraph).where(
                TeamGraph.id == team_id,
                TeamGraph.is_library.is_(True),
                TeamGraph.owner_id == owner_id,
            )
        ).scalar_one_or_none()
        if graph is None:
            return None
        graph.name = cleaned
        session.flush()
        return _team_summary(session, graph)


def create_team_from_template(template_key: str, name: str, owner_id: uuid.UUID) -> str:
    """Materialize a starter template into a NEW library team OWNED by ``owner_id``; return its id
    (M-accounts Slice B). Calls the builder — passing the OWNER's held providers so every model node
    defaults to a provider the account can run (M-runnable) — then sets the user's ``name``, flips
    ``is_library = True``, and stamps ``owner_id`` (build-then-flip; the builder's TOPOLOGY is
    untouched, only its model DEFAULTS become account-aware). Raises ``KeyError`` on an unknown
    template key (the router maps it to 400)."""
    template = _TEMPLATES_BY_KEY[template_key]
    team_graph_id = template.builder(held_providers=held_provider_slugs(owner_id))
    with session_scope() as session:
        graph = session.execute(
            select(TeamGraph).where(TeamGraph.id == uuid.UUID(team_graph_id))
        ).scalar_one()
        graph.name = name
        graph.is_library = True
        graph.owner_id = owner_id
    return team_graph_id


def create_blank_team(name: str, owner_id: uuid.UUID) -> str:
    """Materialize the MINIMAL valid skeleton — one root thinker → a Ship terminal (2 nodes, 1
    forward edge) — as a NEW library team and return its id (P1.8d topology editing). NEVER a
    0-node canvas (which ``validate_graph`` itself rejects): a blank team is the smallest graph that
    already passes validity, so the user starts from something runnable and reshapes it. The root
    thinker carries an empty editable prompt (the user fills it). A NEW function — the byte-intact
    builders are untouched; the run-start guard + the canvas validity both accept this skeleton."""
    settings = get_settings()
    held_providers = held_provider_slugs(owner_id)
    with session_scope() as session:
        graph = TeamGraph(name=name, is_library=True, owner_id=owner_id)
        session.add(graph)
        session.flush()

        thinker = AgentNode(
            team_graph_id=graph.id,
            role_name="thinker",
            kind="completion",
            model=_node_default_model(held_providers, settings.default_model, "thinker"),
            engine=None,
            prompt="",
            position={"x": 0, "y": 0},
        )
        ship = AgentNode(
            team_graph_id=graph.id,
            role_name="ship",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 320, "y": 0},
            config={"terminal_kind": "ship"},
        )
        session.add_all(_stamp_account_defaults([thinker, ship], held_providers))
        session.flush()
        session.add(
            Edge(
                team_graph_id=graph.id,
                source_node_id=thinker.id,
                target_node_id=ship.id,
                edge_type="work",
                conditions=None,
            )
        )
        return str(graph.id)


def seed_library_if_empty(owner_id: uuid.UUID) -> None:
    """Ensure the OWNER's library is never empty (M-accounts Slice B: per-account anti-dead-zone,
    §13 S2): if the owner has zero library teams, create one from the ``review_loop`` template named
    ``"My team"`` — so a fresh account (or one whose last team was deleted) still lands ≥1 team for
    the canvas to open to."""
    with session_scope() as session:
        count = session.execute(
            select(func.count())
            .select_from(TeamGraph)
            .where(TeamGraph.is_library.is_(True), TeamGraph.owner_id == owner_id)
        ).scalar_one()
    if count == 0:
        create_team_from_template("review_loop", "My team", owner_id)


# ── F2-delete: stop-a-run + team teardown ───────────────────────────────────────────────────────
# Run statuses that are already terminal — the cancel core must never clobber one, and a delete
# never re-cancels one. "cancelled" is appended at the check site so a re-cancel is also a no-op.
# The canonical home for the set (the /cancel endpoint imports the core, not this constant).
_TERMINAL_RUN_STATUSES = ("completed", "failed", "rejected", "over_budget")


def cancel_run_core(run_id: str) -> None:
    """The SHARED cancel core — used by ``POST /api/runs/{id}/cancel`` AND team deletion, so both
    stop a run the SAME way. If the run is not already terminal, ``DBOS.cancel_workflow`` flips its
    workflow to CANCELLED (recovery's PENDING-only scan never resurrects it; its next step/recv
    boundary aborts), then ``Run.status`` is set ``cancelled`` directly (the workflow may run no
    further step to record it) and the run's pending ``HumanTask``s are closed
    (``resolution="cancelled"``) so a dead run leaves nothing actionable. An already-terminal (or
    missing) run is left untouched; idempotent — a second call is a no-op. Ownership is the caller's
    job (both resolve it first). ``DBOS.cancel_workflow`` opens its own txn and runs OUTSIDE any
    caller-held DB transaction — both keep it that way (no nested app txn), so nothing nests."""
    blocked = (*_TERMINAL_RUN_STATUSES, "cancelled")
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        if run is None or run.status in blocked:
            return
    DBOS.cancel_workflow(run_id)
    with session_scope() as session:
        session.execute(
            update(Run)
            .where(Run.workflow_id == run_id, Run.status.notin_(blocked))
            .values(status="cancelled")
        )
        session.execute(
            update(HumanTask)
            .where(HumanTask.run_id == run_id, HumanTask.status == "pending")
            .values(status="resolved", resolution="cancelled", resolved_at=func.now())
        )


def _team_run_teardown_targets(
    session, library_team_id: uuid.UUID
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    """Every run of a library team, paired with its clone-graph id as
    ``(run_id, clone_team_graph_id)``. Uses the SAME clone→origin link the summary does: a run's
    clone node ``cloned_from_node_id`` points back to an origin library-team node. A clone has many
    nodes, so the join fans out; ``DISTINCT`` collapses it to one row per run."""
    clone = aliased(AgentNode)  # a node of the run's clone (run-snapshot) graph
    origin = aliased(AgentNode)  # the library-team node it was cloned from
    rows = session.execute(
        select(Run.id, Run.team_graph_id)
        .select_from(Run)
        .join(clone, clone.team_graph_id == Run.team_graph_id)
        .join(origin, origin.id == clone.cloned_from_node_id)
        .where(origin.team_graph_id == library_team_id)
        .distinct()
    ).all()
    return [(run_id, clone_graph_id) for run_id, clone_graph_id in rows]


def list_team_runs(team_id: uuid.UUID, owner_id: uuid.UUID) -> list[dict] | None:
    """Every run of one of the owner's library teams, NEWEST FIRST — the dashboard's per-team
    history drill-down. ``None`` if there is no such team of theirs; ``[]`` for a team that exists
    but has never run.

    Those two answers are deliberately DISTINCT rather than both empty: ``None`` is "not your team"
    (the endpoint 404s, so a foreign team is not probeable) while ``[]`` is "your team, no history
    yet" (a 200 the drill-down renders as an empty state). Collapsing them would make a foreign
    team indistinguishable from an unrun one — and would silently show a user an empty panel for a
    team they are not allowed to see, instead of an honest 404.

    Uses the SAME clone→origin link :func:`_run_rollup_by_origin` and
    :func:`_team_run_teardown_targets` use — a run points at an immutable CLONE of the library team,
    whose nodes carry ``cloned_from_node_id`` back to the origin library-team nodes. A clone has
    MANY
    nodes, so that join fans out to one row per node; ``DISTINCT`` collapses it to one row per run
    (without it a 6-node team would report every run six times). ``created_at DESC`` orders,
    with ``Run.id`` as a deterministic tie-break so two runs created in the same instant do not
    reorder between reads. Both ordering columns are in the select list, as ``SELECT DISTINCT``
    requires.

    Read-only (SELECTs over ``runs`` + ``agent_nodes``) — migration-free by construction. The first
    row is by definition the summary's ``last_run``, computed by the same join."""
    with session_scope() as session:
        owned = session.execute(
            select(TeamGraph.id).where(
                TeamGraph.id == team_id,
                TeamGraph.is_library.is_(True),
                TeamGraph.owner_id == owner_id,
            )
        ).scalar_one_or_none()
        if owned is None:
            return None

        clone = aliased(AgentNode)  # a node of the run's clone (run-snapshot) graph
        origin = aliased(AgentNode)  # the library-team node it was cloned from
        rows = session.execute(
            select(
                Run.id,
                Run.status,
                Run.idea,
                Run.created_at,
                func.coalesce(Run.cost_total_usd, 0).label("cost"),
            )
            .select_from(Run)
            .join(clone, clone.team_graph_id == Run.team_graph_id)
            .join(origin, origin.id == clone.cloned_from_node_id)
            .where(origin.team_graph_id == team_id)
            .distinct()
            .order_by(Run.created_at.desc(), Run.id)
        ).all()
        return [
            {
                "run_id": str(run_id),
                "status": status,
                "idea": idea,
                "created_at": created_at.isoformat(),
                "cost_total_usd": float(cost),
            }
            for run_id, status, idea, created_at, cost in rows
        ]


def delete_library_team_and_runs(library_team_id: uuid.UUID) -> None:
    """F2-delete: hard-delete a library team AND all of its runs, stopping any in-flight run first,
    so nothing under a deleted team keeps running, spending, or existing. The caller (the endpoint)
    already resolved + owner-checked the team. Enumerate the team's runs via the clone→origin link,
    cancel every non-terminal one via the SHARED cancel core, then in ONE transaction tear each run
    down in FK-safe order: its run-scoped rows (``cost_records`` by ``workflow_id``;
    ``run_events`` / ``agent_invocations`` / ``human_tasks`` / ``engineer_run_attempts`` by
    ``run_id``), the ``Run`` row, THEN its clone ``TeamGraph`` (nodes/edges cascade); finally the
    library team (nodes/edges cascade). The Run precedes its clone graph so ``runs.team_graph_id``
    (no ``ondelete``) is never left dangling. One transaction for the deletes ⇒ a failure can't
    half-delete; the cancels run before it (each in its own txn), so nothing nests."""
    with session_scope() as session:
        targets = _team_run_teardown_targets(session, library_team_id)

    for run_id, _clone_graph_id in targets:
        cancel_run_core(str(run_id))

    with session_scope() as session:
        for run_id, clone_graph_id in targets:
            rid = str(run_id)
            session.execute(delete(CostRecord).where(CostRecord.workflow_id == rid))
            session.execute(delete(RunEvent).where(RunEvent.run_id == rid))
            session.execute(delete(AgentInvocation).where(AgentInvocation.run_id == rid))
            session.execute(delete(HumanTask).where(HumanTask.run_id == rid))
            session.execute(delete(EngineerRunAttempt).where(EngineerRunAttempt.run_id == rid))
            session.execute(delete(Run).where(Run.id == run_id))
            session.execute(delete(TeamGraph).where(TeamGraph.id == clone_graph_id))
        session.execute(delete(TeamGraph).where(TeamGraph.id == library_team_id))
