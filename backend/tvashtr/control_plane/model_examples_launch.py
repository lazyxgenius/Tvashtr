"""M2 — Draft with a team: the dialog's options, the estimate and the launch of a drafting run.

A drafting run is an ordinary team run (greenfield, no repository) bound to one model and one
Domain. The launch follows ``POST /api/runs``'s own discipline — compare's launch is the precedent
(``compare._check_runnable`` / ``compare._launch``): the run ceilings, the team's validity, a clone
of the team as the run's snapshot, the launch pre-flight, then the Run row and ``run_team``. Two
things are its own: the run's copy of the team (never the saved team) gets the Domain grant on
every node that can hand in or review examples and on the entry node; and the run's budget cap is
the pause amount, so the existing over-budget pause asks the customer.
"""

from __future__ import annotations

import uuid
from decimal import ROUND_UP, Decimal

from dbos import DBOS, SetWorkflowID
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from tvashtr.control_plane import model_examples, model_tests, model_tests_run, versions
from tvashtr.control_plane import model_examples_pure as pure
from tvashtr.control_plane.credentials import held_provider_slugs, provider_for_model
from tvashtr.control_plane.graph_validity import graph_dicts, owner_domain_ids, validate_graph
from tvashtr.control_plane.teams import clone_team_graph, ensure_example_builder
from tvashtr.db import session_scope
from tvashtr.gateway import gateway as gateway_core
from tvashtr.models import (
    AgentNode,
    Domain,
    DomainDocument,
    Edge,
    ModelExampleBatch,
    ModelExampleDraft,
    Run,
    TeamGraph,
    UserModel,
)

DOMAIN_NOT_FOUND = "domain not found"
TEAM_NOT_FOUND = "team not found"
NEED_DOMAIN = "Pick a Domain."
NO_READY_FILES = "This Domain has no ready files yet. Wait for its files, or pick another."
NEED_COUNTS = "Ask for at least one test or training example."
BAD_TESTS = "Tests can be 0 to 25."
BAD_TRAINING = "Training examples can be 0 to 75."
ONE_AT_A_TIME = "A team is already drafting for this model."
NOT_STARTED = "The drafting run couldn’t start."

HISTORY_HINT = "Based on what these models really used on your last {n} runs."
FIRST_HINT = "A first estimate from each model's listed price. It gets closer after your first run."


# ---- Reading a team ----


def _grant(node: AgentNode) -> str | None:
    meta = (node.tool_config or {}).get("tvashtr") if isinstance(node.tool_config, dict) else None
    value = meta.get("examples") if isinstance(meta, dict) else None
    return value if value in ("read", "write", "review") else None


def _team_parts(session: Session, team_id: uuid.UUID) -> tuple[list[AgentNode], list[Edge]]:
    nodes = list(
        session.execute(select(AgentNode).where(AgentNode.team_graph_id == team_id)).scalars()
    )
    edges = list(session.execute(select(Edge).where(Edge.team_graph_id == team_id)).scalars())
    return nodes, edges


def _is_hand_in(node: AgentNode) -> bool:
    return node.kind == "terminal" and (node.config or {}).get("terminal_kind") == "hand_in"


def _root(nodes: list[AgentNode], edges: list[Edge]) -> AgentNode | None:
    targets = {e.target_node_id for e in edges}
    roots = [n for n in nodes if n.id not in targets]
    return roots[0] if len(roots) == 1 else None


def hand_in_reachable(nodes: list[AgentNode], edges: list[Edge]) -> bool:
    """Whether the walk can reach a Hand in from the start (any edge, stopping at endings)."""
    root = _root(nodes, edges)
    if root is None:
        return False
    by_id = {n.id: n for n in nodes}
    seen, stack = set(), [root.id]
    while stack:
        cur = stack.pop()
        if cur in seen or cur not in by_id:
            continue
        seen.add(cur)
        if _is_hand_in(by_id[cur]):
            return True
        if by_id[cur].kind == "terminal":
            continue
        stack.extend(e.target_node_id for e in edges if e.source_node_id == cur)
    return False


def _label(node: AgentNode) -> str:
    from tvashtr.control_plane.run_failure import node_label

    if _is_hand_in(node):
        return "Hand in"
    return node_label(node.role_name, node.kind, node.config)


def team_steps(nodes: list[AgentNode], edges: list[Edge]) -> list[dict]:
    """The dialog's strip: the team's main path from its start to an ending, each step with its
    model, and ``loop`` on a step a rework loop sends back to the one before."""
    by_id = {n.id: n for n in nodes}
    cur = _root(nodes, edges)
    steps: list[dict] = []
    seen: set = set()
    while cur is not None and cur.id not in seen:
        seen.add(cur.id)
        back = any(
            e.source_node_id == cur.id
            and steps
            and e.target_node_id == uuid.UUID(steps[-1]["node_id"])
            and "loop_limit" in (e.conditions or {})
            for e in edges
        )
        if back:
            steps[-1]["loops_with_next"] = True
        steps.append(
            {
                "node_id": str(cur.id),
                "label": _label(cur),
                "model": cur.model,
                "end": cur.kind == "terminal",
                "hand_in": _is_hand_in(cur),
                "loops_with_next": False,
            }
        )
        if cur.kind == "terminal":
            break
        forward = [
            e
            for e in edges
            if e.source_node_id == cur.id
            and e.edge_type not in ("escalation", "failure")
            and "loop_limit" not in (e.conditions or {})
        ]
        forward.sort(key=lambda e: 0 if (e.conditions or {}).get("when") == "approved" else 1)
        cur = by_id.get(forward[0].target_node_id) if forward else None
    return steps


def _drafting_teams(session: Session, owner_id: uuid.UUID) -> list[dict]:
    """Every team of the account that ends in Hand in, the Example builder first."""
    teams = session.execute(
        select(TeamGraph)
        .where(TeamGraph.owner_id == owner_id, TeamGraph.is_library.is_(True))
        .order_by(TeamGraph.created_at, TeamGraph.id)
    ).scalars()
    out = []
    for team in teams:
        nodes, edges = _team_parts(session, team.id)
        if not any(_is_hand_in(n) for n in nodes):
            continue
        out.append(
            {
                "team_id": str(team.id),
                "name": team.name,
                "builder": team.template_key == "example_builder",
                "steps": team_steps(nodes, edges),
            }
        )
    out.sort(key=lambda t: 0 if t["builder"] else 1)
    return out


def _domains(session: Session, owner_id: uuid.UUID) -> list[dict]:
    rows = session.execute(
        select(Domain.id, Domain.name).where(Domain.owner_id == owner_id).order_by(Domain.name)
    ).all()
    out = []
    for did, name in rows:
        ready = session.execute(
            select(DomainDocument.id).where(
                DomainDocument.domain_id == did, DomainDocument.ingest_status == "ready"
            )
        ).all()
        out.append({"domain_id": str(did), "name": name, "ready_files": len(ready)})
    return out


def options(owner_id: uuid.UUID, model_id: uuid.UUID) -> dict:
    """What the Draft with a team dialog offers. The Example builder is made the first time."""
    with session_scope() as session:
        model_tests.owned_model(session, owner_id, model_id)
    ensure_example_builder(owner_id)
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        busy = model_examples.drafting_batch(session, model.id) is not None
        return {
            "domains": _domains(session, owner_id),
            "teams": _drafting_teams(session, owner_id),
            "drafting": busy,
            "answer_kind": model.answer_kind,
            "choices": list(model.choices),
        }


# ---- The estimate ----


def _seats(nodes: list[AgentNode], edges: list[Edge]) -> list[tuple[str, str]]:
    root = _root(nodes, edges)
    seats = []
    for n in nodes:
        if n.kind not in ("completion", "agent") or not n.model:
            continue
        grant = _grant(n)
        role = "writer" if grant == "write" else "reviewer" if grant == "review" else "reader"
        if root is not None and n.id == root.id and grant not in ("write", "review"):
            role = "reader"
        seats.append((role, n.model))
    return seats


def _model_set(session: Session, graph_id: uuid.UUID) -> frozenset[str]:
    return frozenset(
        m
        for m in session.execute(
            select(AgentNode.model).where(
                AgentNode.team_graph_id == graph_id, AgentNode.model.isnot(None)
            )
        ).scalars()
    )


def _history(session: Session, owner_id: uuid.UUID, models: frozenset[str]) -> list[tuple]:
    """``(cost, drafts)`` of the account's finished drafting runs whose team used these models."""
    rows = session.execute(
        select(ModelExampleBatch, Run.team_graph_id)
        .join(Run, Run.id == ModelExampleBatch.run_id)
        .where(ModelExampleBatch.owner_id == owner_id, ModelExampleBatch.status == "ready")
        .order_by(ModelExampleBatch.created_at.desc())
        .limit(20)
    ).all()
    out = []
    for batch, graph_id in rows:
        if batch.cost_usd is None or _model_set(session, graph_id) != models:
            continue
        drafts = len(
            session.execute(
                select(ModelExampleDraft.id).where(ModelExampleDraft.batch_id == batch.id)
            ).all()
        )
        out.append((float(batch.cost_usd), drafts))
    return out


def _estimate(
    session: Session, owner_id: uuid.UUID, model: UserModel, team_id, tests: int, training: int
) -> dict:
    nodes, edges = _team_parts(session, team_id)
    models = frozenset(n.model for n in nodes if n.model)
    past = [p for p in _history(session, owner_id, models) if p[1] > 0]
    n = tests + training
    from_history = pure.history_estimate(n, past)
    if from_history is not None:
        value, hint, unpriced = from_history, HISTORY_HINT.format(n=len(past)), []
    else:
        learned = {
            slug: model_tests_run.learned_answer_tokens(session, owner_id, slug, model.answer_kind)
            for slug in models
        }
        first = pure.first_estimate(
            _seats(nodes, edges), tests, training, gateway_core.price_per_token, learned
        )
        value, hint, unpriced = first["estimate_usd"], FIRST_HINT, first["unpriced"]
    return {
        "estimate_usd": value,
        "from_history": from_history is not None,
        "runs": len(past),
        "hint": hint,
        "unpriced": unpriced,
        "pause_usd": pure.pause_at(value),
        "agents": sum(1 for x in nodes if x.kind in ("completion", "agent")),
    }


def _counts(tests, training) -> tuple[int, int]:
    try:
        t, r = int(tests), int(training)
    except (TypeError, ValueError) as exc:
        raise ValueError(NEED_COUNTS) from exc
    if not 0 <= t <= pure.MAX_TESTS_PER_BATCH:
        raise ValueError(BAD_TESTS)
    if not 0 <= r <= pure.MAX_TRAINING_PER_BATCH:
        raise ValueError(BAD_TRAINING)
    if t + r == 0:
        raise ValueError(NEED_COUNTS)
    return t, r


def _owned_team(session: Session, owner_id: uuid.UUID, team_id) -> TeamGraph:
    try:
        tid = uuid.UUID(str(team_id))
    except ValueError as exc:
        raise LookupError(TEAM_NOT_FOUND) from exc
    team = session.get(TeamGraph, tid)
    if team is None or team.owner_id != owner_id or not team.is_library:
        raise LookupError(TEAM_NOT_FOUND)
    return team


def _check_team(session: Session, team: TeamGraph) -> None:
    nodes, edges = _team_parts(session, team.id)
    if not any(_is_hand_in(n) for n in nodes):
        raise ValueError(f"{team.name} doesn't end in Hand in, so it can't draft examples.")
    if not hand_in_reachable(nodes, edges):
        raise ValueError(f"{team.name}'s Hand in can't be reached, so it can't draft examples.")


def estimate(owner_id: uuid.UUID, model_id: uuid.UUID, body: dict) -> dict:
    tests, training = _counts(body.get("tests", 0), body.get("training", 0))
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        team = _owned_team(session, owner_id, body.get("team_id"))
        return _estimate(session, owner_id, model, team.id, tests, training)


# ---- The launch ----


def compose_idea(model: UserModel, domain: str, tests: int, training: int) -> str:
    """The run's task, written by the server: the job, the kind of answer, the numbers, the
    Domain."""
    if model.answer_kind == "choice":
        kind = "Pick exactly one of these choices: " + ", ".join(model.choices) + "."
    else:
        kind = "Write text."
    return (
        f'Draft examples for the model "{model.name}" from the Domain "{domain}".\n'
        f"The model's job: {model.job}\n"
        f"Kind of answer: {kind}\n"
        f"Draft {tests} test{'' if tests == 1 else 's'} and {training} training "
        f"example{'' if training == 1 else 's'}. Tests check the model and are never trained on; "
        "training examples are what it will learn from. Tests and training examples must be "
        "different cases, and every example quotes the Domain file it came from."
    )


def stamp_domain_grant(session: Session, snapshot_id: uuid.UUID, domain_id: uuid.UUID) -> int:
    """On the run's own copy of the team only: the Domain grant on every node that can hand in or
    review examples, and on the entry node. Returns how many nodes were stamped."""
    nodes, edges = _team_parts(session, snapshot_id)
    root = _root(nodes, edges)
    stamped = 0
    for node in nodes:
        if node.kind not in ("completion", "agent"):
            continue
        if _grant(node) not in ("write", "review") and (root is None or node.id != root.id):
            continue
        config = dict(node.tool_config or {})
        meta = dict(config.get("tvashtr") or {})
        meta["domains"] = [str(domain_id)]
        config["tvashtr"] = meta
        node.tool_config = config
        flag_modified(node, "tool_config")
        stamped += 1
    return stamped


def _missing(session: Session, owner_id: uuid.UUID, team_id: uuid.UUID) -> list[str]:
    models = {
        m
        for m in session.execute(
            select(AgentNode.model).where(
                AgentNode.team_graph_id == team_id,
                AgentNode.kind.in_(("completion", "agent")),
                AgentNode.model.isnot(None),
            )
        ).scalars()
    }
    return sorted({provider_for_model(m) for m in models} - held_provider_slugs(owner_id))


def start(owner_id: uuid.UUID, model_id: uuid.UUID, body: dict) -> dict:
    """Start a drafting run. Refusals: ``LookupError`` (404), ``ValueError`` (422 with the
    product's words), :class:`model_tests_run.MissingProviders` (422 ``missing_providers``), and
    the launch pre-flight's own ``HTTPException``s."""
    from tvashtr.control_plane.team_run import run_team
    from tvashtr.routers import _enforce_run_ceilings, _launch_preflight  # mounts after this

    tests, training = _counts(body.get("tests", 0), body.get("training", 0))
    with session_scope() as session:
        model = model_tests.owned_model(session, owner_id, model_id)
        if not body.get("domain_id"):
            raise ValueError(NEED_DOMAIN)
        try:
            domain = session.get(Domain, uuid.UUID(str(body["domain_id"])))
        except ValueError as exc:
            raise LookupError(DOMAIN_NOT_FOUND) from exc
        if domain is None or domain.owner_id != owner_id:
            raise LookupError(DOMAIN_NOT_FOUND)
        if not model_examples._ready_files(session, domain.id):
            raise ValueError(NO_READY_FILES)
        team = _owned_team(session, owner_id, body.get("team_id"))
        _check_team(session, team)
        if model_examples.drafting_batch(session, model.id) is not None:
            raise ValueError(ONE_AT_A_TIME)
        missing = _missing(session, owner_id, team.id)
        if missing:
            raise model_tests_run.MissingProviders(missing)
        nodes, edges = graph_dicts(session, team.id)
        verdict = validate_graph(nodes, edges, owner_domain_ids(session, owner_id))
        if not verdict["runnable"]:
            raise HTTPException(
                status_code=422,
                detail={"message": "team graph is not runnable", "errors": verdict["errors"]},
            )
        guess = _estimate(session, owner_id, model, team.id, tests, training)
        idea = compose_idea(model, domain.name, tests, training)
        domain_id, domain_name, team_id, team_name = domain.id, domain.name, team.id, team.name
    _enforce_run_ceilings(owner_id)
    snapshot = uuid.UUID(clone_team_graph(str(team_id)))
    try:
        _launch_preflight(owner_id, str(snapshot), False)
    except HTTPException:
        with session_scope() as session:
            session.execute(delete(TeamGraph).where(TeamGraph.id == snapshot))
        raise
    run_id = uuid.uuid4()
    cap = Decimal(str(guess["pause_usd"])).quantize(Decimal("0.01"), rounding=ROUND_UP)
    with session_scope() as session:
        # Lock the model's row: two launches at once can't both start a drafting run.
        model = model_tests.owned_model(session, owner_id, model_id, lock=True)
        if model_examples.drafting_batch(session, model.id) is not None:
            raise ValueError(ONE_AT_A_TIME)
        # The version is read from the snapshot BEFORE the stamp, so the grant never lands in the
        # saved team's history.
        version_number, _saved = versions.for_run(session, team_id, owner_id, snapshot)
        stamp_domain_grant(session, snapshot, domain_id)
        session.add(
            Run(
                id=run_id,
                team_graph_id=snapshot,
                owner_id=owner_id,
                idea=idea,
                workflow_id=str(run_id),
                status="running",
                budget_cap_usd=cap,
                library_team_id=team_id,
                team_version_number=version_number,
            )
        )
        session.flush()
        batch = ModelExampleBatch(
            model_id=model.id,
            owner_id=owner_id,
            run_id=run_id,
            domain_id=domain_id,
            domain_name=domain_name,
            team_id=team_id,
            team_name=team_name,
            tests_wanted=tests,
            training_wanted=training,
            estimate_usd=Decimal(str(round(guess["estimate_usd"], 6))),
        )
        session.add(batch)
        session.flush()
        batch_id = batch.id
    with SetWorkflowID(str(run_id)):
        DBOS.start_workflow(run_team, idea)
    return {
        "batch_id": str(batch_id),
        "run_id": str(run_id),
        "estimate_usd": guess["estimate_usd"],
        "pause_usd": float(cap),
    }
