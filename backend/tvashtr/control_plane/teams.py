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


# M-runnable: the ONE backend-owned provider catalogue — provider slug -> {default_model, presets} —
# the SINGLE place a provider or model slug is DECLARED. Static, dependency-free, a module const
# (no DB, no network); ``account_default_model`` stays pure + unit-testable. Served READ-ONLY to the
# to the FE on ``GET /api/config`` (slugs only, never keys — ``public_provider_catalogue``); the
# picker's quick-picks + the dashboard's provider suggestions DERIVE from it, nothing to hand-sync.
# Seeded from the UNION of the pre-M-runnable ``PROVIDER_DEFAULT_MODEL`` map and the FE's old
# ``MODEL_PRESETS`` list (so nothing previously offered is lost), PLUS a ``deepseek`` entry — the
# product's own default agent model (``DEFAULT_MODEL``/``TVASHTR_AGENT_MODEL`` in .env + fly.toml).
# INVARIANT (pinned by tests): every ``default_model``/preset slug canonicalizes
# (``credentials.provider_for_model``) to its provider key, and each provider's ``default_model`` is
# itself a preset.
PROVIDER_CATALOGUE: dict[str, dict] = {
    "openrouter": {
        "default_model": "openrouter/openai/gpt-4o-mini",
        "presets": [
            "openrouter/openai/gpt-4o-mini",
            "openrouter/meta-llama/llama-3.1-8b-instruct",
            "openrouter/google/gemini-flash-1.5",
        ],
    },
    "nvidia_nim": {
        "default_model": "nvidia_nim/meta/llama-3.3-70b-instruct",
        "presets": ["nvidia_nim/meta/llama-3.3-70b-instruct"],
    },
    "openai": {
        "default_model": "openai/gpt-4o-mini",
        "presets": ["openai/gpt-4o-mini"],
    },
    "gemini": {
        "default_model": "gemini/gemini-2.0-flash",
        "presets": ["gemini/gemini-2.0-flash"],
    },
    "groq": {
        "default_model": "groq/llama-3.3-70b-versatile",
        "presets": ["groq/llama-3.3-70b-versatile"],
    },
    "deepseek": {
        "default_model": "deepseek/deepseek-chat",
        "presets": ["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"],
    },
}
# Back-compat DERIVED view (provider -> default_model): the registry above is the sole declaration;
# this is a pure projection that ``account_default_model`` reads. Nothing new is declared here.
PROVIDER_DEFAULT_MODEL: dict[str, str] = {
    p: e["default_model"] for p, e in PROVIDER_CATALOGUE.items()
}
# The deterministic preference order when the account holds several mapped providers: ``openrouter``
# is the historical default provider (the legacy ``default_model``/``engineer_model`` slugs live
# there), so it wins first. M-runnable APPENDS ``deepseek`` LAST — the existing entries are NOT
# reordered: order only breaks ties for MULTI-key accounts, and silently changing those accounts'
# defaults is not this milestone's business.
_PROVIDER_DEFAULT_ORDER: tuple[str, ...] = (
    "openrouter",
    "nvidia_nim",
    "openai",
    "gemini",
    "groq",
    "deepseek",
)


def account_default_model(held_providers: set[str]) -> str | None:
    """The default FULL model slug for the FIRST provider (preference order) the account holds a
    credential for, else ``None`` (the caller uses the legacy default). Pure + unit-tested;
    no DB, no env."""
    for provider in _PROVIDER_DEFAULT_ORDER:
        if provider in held_providers and provider in PROVIDER_DEFAULT_MODEL:
            return PROVIDER_DEFAULT_MODEL[provider]
    return None


def public_provider_catalogue() -> list[dict]:
    """The provider catalogue as a serializable, PUBLIC list (served on ``GET /api/config``):
    provider + model slugs ONLY, never any key material. Ordered by ``PROVIDER_CATALOGUE`` insertion
    so the FE renders a stable provider list. The FE DERIVES its model quick-picks + provider
    suggestions from this, so a slug is declared in exactly one place (the catalogue above)."""
    return [
        {"provider": p, "default_model": e["default_model"], "presets": list(e["presets"])}
        for p, e in PROVIDER_CATALOGUE.items()
    ]


def _node_default_model(held_providers: set[str] | None, fallback: str) -> str:
    """The model a builder stamps on a model-bearing node at CREATION: the OWNER's held-provider
    default when the account holds a catalogued provider (``account_default_model``), else the
    per-role fallback (a thinker's ``settings.default_model``; a worker's ``engineer_model()``
    /``reviewer_model()``). This makes the team the account is GIVEN a team it can RUN — every model
    node's provider is one the owner holds. ``held_providers`` empty/``None`` ⇒ the legacy
    fallback, byte-identical to the pre-M-runnable behavior for a non-account (direct) caller."""
    return account_default_model(held_providers or set()) or fallback


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
            model=_node_default_model(held_providers, settings.default_model),
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
            model=_node_default_model(held_providers, engineer_model()),
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
        session.add_all([pm, prd_gate, engineer, ship, stop])
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
            model=_node_default_model(held_providers, settings.default_model),
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
            model=_node_default_model(held_providers, engineer_model()),
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
            model=_node_default_model(held_providers, reviewer_model()),
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
        session.add_all([pm, prd_gate, engineer, reviewer, escalation_gate, ship, stop])
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
            model=_node_default_model(held_providers, settings.default_model),
            engine=None,
            prompt=PM_PROMPT,
            position={"x": 0, "y": 0},
        )
        architect = AgentNode(
            team_graph_id=graph.id,
            role_name="architect",
            kind="completion",
            model=_node_default_model(held_providers, settings.default_model),
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
            model=_node_default_model(held_providers, engineer_model()),
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
        session.add_all([pm, architect, prd_gate, engineer, ship, stop])
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
            model=_node_default_model(held_providers, settings.default_model),
            engine=None,
            prompt=PM_PROMPT,
            position={"x": 0, "y": 0},
        )
        architect = AgentNode(
            team_graph_id=graph.id,
            role_name="architect",
            kind="completion",
            model=_node_default_model(held_providers, settings.default_model),
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
            model=_node_default_model(held_providers, engineer_model()),
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
            model=_node_default_model(held_providers, reviewer_model()),
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
        session.add_all([pm, architect, prd_gate, engineer, reviewer, escalation_gate, ship, stop])
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
            model=_node_default_model(held_providers, settings.default_model),
            engine=None,
            prompt=PM_PROMPT,
            position={"x": 0, "y": 0},
        )
        architect = AgentNode(
            team_graph_id=graph.id,
            role_name="architect",
            kind="completion",
            model=_node_default_model(held_providers, settings.default_model),
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
            model=_node_default_model(held_providers, engineer_model()),
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
            model=_node_default_model(held_providers, reviewer_model()),
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
            [pm, architect, prd_gate, engineer, reviewer, escalation_gate, ship_gate, ship, stop]
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
            model=_node_default_model(held_providers, settings.default_model),
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
        session.add_all([thinker, ship])
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
