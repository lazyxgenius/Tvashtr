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

from sqlalchemy import func, select

from tvashtr.config import get_settings
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Edge, TeamGraph

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


def engineer_model() -> str:
    return os.environ.get("TVASHTR_AGENT_MODEL", DEFAULT_ENGINEER_MODEL)


def reviewer_model() -> str:
    """The Reviewer's model. Reuses the Engineer's capable slug so review has the
    comprehension to judge a deliverable against the PRD; under the forced-revisions
    harness the model is irrelevant (no LLM call), and real review-quality tuning is
    P1.5c — so this stays the same single ``OPENROUTER_API_KEY`` slug for now."""
    return engineer_model()


def build_two_node_team(name: str = "PM -> Engineer") -> str:
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
            model=settings.default_model,
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
            model=engineer_model(),
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


def build_review_loop_team(name: str = "PM -> Engineer <-> Reviewer") -> str:
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
            model=settings.default_model,
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
            model=engineer_model(),
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
            model=reviewer_model(),
            prompt=REVIEWER_PROMPT,
            position={"x": 780, "y": 0},
            config={"agent_kind": "reviewer"},
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


def build_thinker_chain_team(name: str = "PM -> Architect -> Engineer") -> str:
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
            model=settings.default_model,
            engine=None,
            prompt=PM_PROMPT,
            position={"x": 0, "y": 0},
        )
        architect = AgentNode(
            team_graph_id=graph.id,
            role_name="architect",
            kind="completion",
            model=settings.default_model,
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
            model=engineer_model(),
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


def clone_team_graph(source_team_graph_id: str, name: str | None = None) -> str:
    """Deep-clone a team graph into a NEW run-scoped ``TeamGraph`` and return its id — the
    clone-on-launch snapshot (P1.8b): fresh node ids, every edge remapped onto the cloned node
    ids, and ``position``/``config``/``prompt``/``model``/``engine``/``conditions`` copied
    faithfully. The clone is the run's IMMUTABLE snapshot — editing the authored team afterward
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
        "thinker_chain",
        "PM → Architect → Engineer",
        "Two thinkers shape the spec — a PM drafts it and an Architect adds the technical design — "
        "then an Engineer builds and ships it.",
        build_thinker_chain_team,
    ),
)
_TEMPLATES_BY_KEY: dict[str, TeamTemplate] = {t.key: t for t in _TEMPLATE_CATALOG}


def list_templates() -> list[dict]:
    """The starter templates as ``{template, name, description}`` (what the picker reads)."""
    return [
        {"template": t.key, "name": t.name, "description": t.description} for t in _TEMPLATE_CATALOG
    ]


def _team_summary(session, graph: TeamGraph) -> dict:
    """One library team as a list/summary row: identity + its node count (for the teams rail)."""
    node_count = session.execute(
        select(func.count()).select_from(AgentNode).where(AgentNode.team_graph_id == graph.id)
    ).scalar_one()
    return {
        "team_graph_id": str(graph.id),
        "name": graph.name,
        "created_at": graph.created_at.isoformat(),
        "node_count": node_count,
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
        return [_team_summary(session, g) for g in graphs]


def get_team_summary(team_graph_id: str) -> dict:
    """The summary for a single team by id (used right after create to echo the new team back)."""
    with session_scope() as session:
        graph = session.execute(
            select(TeamGraph).where(TeamGraph.id == uuid.UUID(team_graph_id))
        ).scalar_one()
        return _team_summary(session, graph)


def create_team_from_template(template_key: str, name: str, owner_id: uuid.UUID) -> str:
    """Materialize a starter template into a NEW library team OWNED by ``owner_id``; return its id
    (M-accounts Slice B). Calls the byte-intact builder, then sets the user's ``name``, flips
    ``is_library = True``, and stamps ``owner_id`` (build-then-flip — the builder is untouched).
    Raises ``KeyError`` on an unknown template key (the router maps it to 400)."""
    template = _TEMPLATES_BY_KEY[template_key]
    team_graph_id = template.builder()
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
    with session_scope() as session:
        graph = TeamGraph(name=name, is_library=True, owner_id=owner_id)
        session.add(graph)
        session.flush()

        thinker = AgentNode(
            team_graph_id=graph.id,
            role_name="thinker",
            kind="completion",
            model=settings.default_model,
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
