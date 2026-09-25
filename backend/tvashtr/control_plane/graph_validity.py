"""Pure, importable team-graph validity (P1.8d topology editing).

The canvas became fully editable, so a user can now author an *arbitrary* graph. This module
decides whether a graph is RUNNABLE before the executor walks it — the same verdict the FE greys
``Run`` out on and the ``create_run`` guard refuses a launch with. :func:`validate_graph` is PURE
(no DB, no DBOS, no I/O) so it unit-tests trivially and runs identically server-side and (mirrored
via the ``…/validate`` endpoint) on the canvas. :func:`graph_dicts` is the thin DB loader that
materializes a stored graph into the dict shape :func:`validate_graph` consumes.

Strictness (the §3 contract): **BLOCK only un-runnable graphs** — ones where the executor would
crash, hang, loop forever, or stop with no outcome. **WARN** on the merely-suspect (an orphan node
the walk never reaches). It deliberately does NOT police prompt↔capability coherence (semantic,
unreliable) nor unmatched outcome labels (the executor's catch-all safe-default routes those to
rework at runtime).

To guarantee the verdict can never drift from how the walk ACTUALLY routes, the route-existence
and escalation checks reuse the executor's own pure routers (:func:`next_node` /
:func:`escalation_target` from ``team_run`` — that module is otherwise untouched this slice)."""

from collections import defaultdict

from sqlalchemy import select

from tvashtr.control_plane.team_run import escalation_target, next_node
from tvashtr.models import AgentNode, Edge


def _routing_edges(edges: list[dict]) -> list[dict]:
    """Normalize the serialized canvas edge shape (``source_node_id``/``target_node_id`` — what
    ``_edge_to_dict`` and the FE produce) into the executor's routing shape (``source``/``target``)
    so the imported :func:`next_node` / :func:`escalation_target` route exactly as the walk does.
    The original edge ``id`` is carried through (the routers ignore unknown keys) so a finding can
    point at the offending edge."""
    return [
        {
            "id": str(e["id"]) if e.get("id") is not None else None,
            "source": str(e["source_node_id"]),
            "target": str(e["target_node_id"]),
            "edge_type": e["edge_type"],
            "conditions": e["conditions"],
        }
        for e in edges
    ]


def _is_loop_back(edge: dict) -> bool:
    """A bounded rework edge — it carries ``conditions.loop_limit`` (no ``when``)."""
    return bool(edge["conditions"]) and "loop_limit" in edge["conditions"]


def validate_graph(nodes: list[dict], edges: list[dict]) -> dict:
    """Decide whether an authored team graph is runnable. PURE — ``nodes``/``edges`` are the
    serialized canvas dicts (nodes carry ``id``/``kind``; edges carry ``id``/``source_node_id``/
    ``target_node_id``/``edge_type``/``conditions``). Returns ``{"errors": [...], "warnings": [...],
    "runnable": bool}`` where each finding is ``{"code", "message", "node_id", "edge_id"}`` and
    ``runnable`` is ``len(errors) == 0``.

    BLOCK (errors): not exactly one root; the root is not a thinker; a reachable node has no valid
    outgoing route for an outcome it can emit; a reachable node can't reach a terminal; an unbounded
    loop (a reachable cycle with no ``loop_limit`` back-edge); a bounded rework loop whose
    re-entered node has no escalation exit. WARN: an orphan (unreachable) node."""
    errors: list[dict] = []
    warnings: list[dict] = []

    def err(
        code: str, message: str, node_id: str | None = None, edge_id: str | None = None
    ) -> None:
        errors.append({"code": code, "message": message, "node_id": node_id, "edge_id": edge_id})

    def warn(code: str, message: str, node_id: str | None = None) -> None:
        warnings.append({"code": code, "message": message, "node_id": node_id, "edge_id": None})

    nodes_by_id = {str(n["id"]): n for n in nodes}
    redges = _routing_edges(edges)

    # --- BLOCK 1: exactly one root (a node no edge targets — the single walk entry). ---
    all_targets = {e["target"] for e in redges}
    root_ids = sorted(nid for nid in nodes_by_id if nid not in all_targets)
    root: str | None = None
    if not nodes_by_id:
        err("empty_graph", "The team is empty — add a starting thinker and an ending node.")
    elif len(root_ids) == 0:
        err(
            "no_root",
            "No starting point — every node has an incoming edge, so the team has no entry. "
            "Leave exactly one node unconnected on its input side.",
        )
    elif len(root_ids) > 1:
        for rid in root_ids:
            err(
                "multiple_roots",
                f"More than one starting point ({len(root_ids)}) — a team needs exactly one. "
                "Wire these into a single entry.",
                node_id=rid,
            )
    else:
        root = root_ids[0]
        # --- BLOCK 2: the root is a thinker (it writes the shared spec every worker reads). ---
        if nodes_by_id[root]["kind"] != "completion":
            err(
                "root_not_thinker",
                "The first node must be a thinker — it writes the shared spec the rest of the "
                "team reads. Make it a thinker, or start from one.",
                node_id=root,
            )

    # Forward-reachable from the root(s), NOT expanding past a terminal (the walk ends there) — the
    # live set the per-outcome / termination / loop checks operate on. Computed from all roots so a
    # second disconnected entry doesn't masquerade every node as an orphan.
    out_by_source: dict[str, list[dict]] = defaultdict(list)
    for e in redges:
        out_by_source[e["source"]].append(e)
    reachable: set[str] = set()
    stack = list(root_ids)
    while stack:
        cur = stack.pop()
        if cur in reachable:
            continue
        reachable.add(cur)
        if nodes_by_id[cur]["kind"] == "terminal":
            continue  # the walk returns at a terminal — do not traverse its out-edges
        for e in out_by_source[cur]:
            if e["target"] in nodes_by_id and e["target"] not in reachable:
                stack.append(e["target"])

    # Nodes from which a terminal is reachable (reverse BFS over forward edges) — for the dead-end
    # check. Following ALL edge types (incl. escalation) since the walk can take any of them.
    terminals = {nid for nid, n in nodes_by_id.items() if n["kind"] == "terminal"}
    rev: dict[str, list[str]] = defaultdict(list)
    for e in redges:
        rev[e["target"]].append(e["source"])
    can_reach_terminal: set[str] = set(terminals)
    stack = list(terminals)
    while stack:
        cur = stack.pop()
        for src in rev[cur]:
            if src not in can_reach_terminal:
                can_reach_terminal.add(src)
                stack.append(src)

    # --- BLOCK 3a: route-existence — every reachable non-terminal node has a defined next for
    # every outcome it can emit (else the walk falls off the end and the run FAILS). Reuses the
    # executor's own ``next_node`` so "has a valid route" means exactly what the walk computes. ---
    for nid in sorted(reachable):
        kind = nodes_by_id[nid]["kind"]
        if kind == "completion":
            if next_node(redges, nid, None) is None:
                err(
                    "no_exit",
                    "This thinker has no outgoing connection — add a 'Then →' edge.",
                    node_id=nid,
                )
        elif kind == "agent":
            if next_node(redges, nid, None) is None:
                err(
                    "no_exit",
                    "This worker has no outgoing connection — add a 'Then →' or a branch edge.",
                    node_id=nid,
                )
        elif kind == "domain_query":
            if next_node(redges, nid, None) is None:
                err(
                    "no_exit",
                    "This Query domain node has no outgoing connection — add a 'Then →' edge.",
                    node_id=nid,
                )
        elif kind == "gate":
            if next_node(redges, nid, "approved") is None:
                err(
                    "gate_no_branch",
                    "This checkpoint has no path for 'approved' — connect where "
                    "it goes when approved.",
                    node_id=nid,
                )
            if next_node(redges, nid, "rejected") is None:
                err(
                    "gate_no_branch",
                    "This checkpoint has no path for 'rejected' — connect where "
                    "it goes when rejected.",
                    node_id=nid,
                )

    for nid in sorted(reachable):
        n = nodes_by_id[nid]
        if n.get("kind") != "domain_query":
            continue
        cfg = n.get("config") or {}
        did = cfg.get("domain_id") if isinstance(cfg, dict) else None
        if not did:
            err(
                "domain_query_no_domain",
                "Select a Domain on this Query domain node before running.",
                node_id=nid,
            )

    # --- BLOCK 3b: every reachable non-terminal node can reach a terminal (no dead-end). ---
    for nid in sorted(reachable):
        if nodes_by_id[nid]["kind"] == "terminal":
            continue
        if nid not in can_reach_terminal:
            err(
                "dead_end",
                "This node can't reach an ending (Ship or Stop) — the run would never finish.",
                node_id=nid,
            )

    # --- BLOCK 3c: bounded loops. A reachable cycle with no loop_limit back-edge loops forever;
    # a bounded rework loop whose re-entered node has no escalation exit is never actually capped
    # (the executor only enforces the cap on a node that HAS an escalation edge). ---
    adj: dict[str, list[str]] = defaultdict(list)
    for e in redges:
        if _is_loop_back(e):
            continue  # the loop bound is what BREAKS the cycle — exclude it from the cycle check
        if e["source"] in reachable and e["target"] in reachable:
            adj[e["source"]].append(e["target"])
    # DFS three-colour cycle detection over the loop_limit-free reachable subgraph.
    WHITE, GRAY, BLACK = 0, 1, 2
    color = dict.fromkeys(reachable, WHITE)
    cycle_node: str | None = None

    def _find_cycle(u: str) -> bool:
        nonlocal cycle_node
        color[u] = GRAY
        for v in adj[u]:
            if color[v] == GRAY:
                cycle_node = v
                return True
            if color[v] == WHITE and _find_cycle(v):
                return True
        color[u] = BLACK
        return False

    for nid in sorted(reachable):
        if color[nid] == WHITE and _find_cycle(nid):
            break
    if cycle_node is not None:
        err(
            "unbounded_loop",
            "This loop never ends — it has no bounded rework edge. Make the loop-back a "
            "'Rework loop' with a limit (and an exit when the limit is hit).",
            node_id=cycle_node,
        )

    for e in redges:
        if _is_loop_back(e) and e["target"] in reachable:
            if escalation_target(redges, e["target"]) is None:
                err(
                    "loop_no_exit",
                    "This rework loop has no exit — route somewhere (a checkpoint or Stop) "
                    "for when the limit is hit, or the loop can never end.",
                    node_id=e["target"],
                    edge_id=e["id"],
                )

    # --- WARN: orphan (unreachable) nodes. Only when a single entry exists — otherwise the
    # root errors above already explain why nothing is reachable. ---
    if len(root_ids) == 1:
        for nid in sorted(nodes_by_id):
            if nid not in reachable:
                warn("orphan", "This node is never reached when the team runs.", node_id=nid)

    return {"errors": errors, "warnings": warnings, "runnable": len(errors) == 0}


# ---- The pipeline strip (revamp G-1): a team's main path from its start node to Ship ----

# Role names the built-in templates and the node presets use; anything else is labelled by kind.
_PRESET_ROLE_LABELS = {
    "pm": "PM",
    "architect": "Architect",
    "engineer": "Engineer",
    "reviewer": "Reviewer",
}
_KIND_TO_SHAPE_KIND = {"completion": "thinker", "agent": "worker"}
_ROLE_LABELS = {
    **_PRESET_ROLE_LABELS,
    "thinker": "Thinker",
    "worker": "Worker",
    "gate": "Approval",
    "ship": "Ship",
    "stop": "Stop",
    "domain_query": "Domain",
}


def _shape_role(node: dict) -> str:
    """The strip's role for a node: a preset role name (``pm``/``architect``/``engineer``/
    ``reviewer``), else the node's kind (``thinker``/``worker``/``gate``/``ship``/``stop``/
    ``domain_query``)."""
    role_name = str(node.get("role_name") or "").lower()
    kind = node.get("kind")
    if kind in ("completion", "agent") and role_name in _PRESET_ROLE_LABELS:
        return role_name
    if kind == "terminal":
        cfg = node.get("config") or {}
        return "stop" if cfg.get("terminal_kind") == "stop" else "ship"
    return _KIND_TO_SHAPE_KIND.get(kind, kind or "thinker")


def _shape_label(node: dict, role: str) -> str:
    """A thinker/worker/domain node's own display name (``config.title``) when it has one; a gate's
    ``config.title`` is its approval prompt, not a name, so gates always read "Approval"."""
    cfg = node.get("config") or {}
    title = cfg.get("title") if isinstance(cfg, dict) else None
    if node.get("kind") in ("completion", "agent", "domain_query") and isinstance(title, str):
        if title.strip():
            return title.strip()
    return _ROLE_LABELS.get(role, role.replace("_", " ").capitalize())


def team_shape(nodes: list[dict], edges: list[dict]) -> dict:
    """The team's pipeline strip: its MAIN PATH from the start node to Ship, plus the rework loops
    on it. PURE (no DB) so it unit-tests trivially and runs on any node/edge dicts (nodes carry
    ``id``/``kind``/``role_name``/``config``; edges carry ``source_node_id``/``target_node_id``/
    ``edge_type``/``conditions``).

    * Start at the root — the node no edge targets (the lowest id when there are several, the same
      rule as the canvas's start-node lock).
    * Follow forward and branch edges (never ``escalation`` edges, never a ``loop_limit`` rework
      edge), preferring the edge whose target can still reach a Ship terminal; among those an
      ``approved`` branch, then an unconditional edge, then the lowest target id.
    * Stop terminals and escalation-only targets never appear; the walk ends at Ship (or where the
      graph ends).
    * A ``loop_limit`` edge between two nodes on the path is a loop: ``{"from": i, "to": j}``,
      indices into ``nodes``.

    Returns ``{"nodes": [{"id", "kind", "role", "label"}], "loops": [{"from", "to"}]}`` where
    ``kind`` is ``thinker|worker|gate|terminal|domain_query``."""
    nodes_by_id = {str(n["id"]): n for n in nodes}
    redges = _routing_edges(edges)
    if not nodes_by_id:
        return {"nodes": [], "loops": []}

    targets = {e["target"] for e in redges}
    roots = sorted(nid for nid in nodes_by_id if nid not in targets)
    if not roots:
        return {"nodes": [], "loops": []}

    def is_stop(nid: str) -> bool:
        return _shape_role(nodes_by_id[nid]) == "stop"

    main_edges = [
        e
        for e in redges
        if e["edge_type"] != "escalation"
        and not _is_loop_back(e)
        and e["source"] in nodes_by_id
        and e["target"] in nodes_by_id
    ]
    # Nodes that can reach a Ship terminal over main-path edges (reverse BFS from every Ship).
    rev: dict[str, list[str]] = defaultdict(list)
    for e in main_edges:
        rev[e["target"]].append(e["source"])
    reaches_ship = {
        nid for nid, n in nodes_by_id.items() if n.get("kind") == "terminal" and not is_stop(nid)
    }
    stack = list(reaches_ship)
    while stack:
        cur = stack.pop()
        for src in rev[cur]:
            if src not in reaches_ship:
                reaches_ship.add(src)
                stack.append(src)

    def preference(e: dict) -> tuple:
        when = (e["conditions"] or {}).get("when")
        branch_rank = 0 if when == "approved" else (1 if when is None else 2)
        return (0 if e["target"] in reaches_ship else 1, branch_rank, e["target"])

    path: list[str] = []
    cur: str | None = roots[0]
    while cur is not None and cur not in path:
        path.append(cur)
        if nodes_by_id[cur].get("kind") == "terminal":
            break
        candidates = [e for e in main_edges if e["source"] == cur and not is_stop(e["target"])]
        cur = min(candidates, key=preference)["target"] if candidates else None

    index = {nid: i for i, nid in enumerate(path)}
    loops = sorted(
        {
            (index[e["source"]], index[e["target"]])
            for e in redges
            if _is_loop_back(e) and e["source"] in index and e["target"] in index
        }
    )
    shaped = []
    for nid in path:
        node = nodes_by_id[nid]
        role = _shape_role(node)
        kind = node.get("kind")
        shaped.append(
            {
                "id": nid,
                "kind": _KIND_TO_SHAPE_KIND.get(kind, kind),
                "role": role,
                "label": _shape_label(node, role),
            }
        )
    return {"nodes": shaped, "loops": [{"from": a, "to": b} for a, b in loops]}


_ROLE_TO_SHAPE_KIND = {
    "pm": "thinker",
    "architect": "thinker",
    "thinker": "thinker",
    "engineer": "worker",
    "reviewer": "worker",
    "worker": "worker",
    "gate": "gate",
    "ship": "terminal",
    "stop": "terminal",
    "domain_query": "domain_query",
}


def shape_from_roles(roles: tuple[str, ...], loops: tuple[tuple[int, int], ...] = ()) -> dict:
    """A strip in the :func:`team_shape` format for a graph that is not stored — the starter
    templates declare theirs statically (running a builder would write rows). Node ids are
    ``None``."""
    return {
        "nodes": [
            {
                "id": None,
                "kind": _ROLE_TO_SHAPE_KIND[role],
                "role": role,
                "label": _ROLE_LABELS[role],
            }
            for role in roles
        ],
        "loops": [{"from": a, "to": b} for a, b in loops],
    }


def graph_dicts(session, graph_id) -> tuple[list[dict], list[dict]]:
    """Load a team graph's nodes + edges (within ``session``) into the serialized dict shape
    :func:`validate_graph` consumes — the same node/edge fields the canvas reads. The DB-touching
    companion to the pure validator; used by the ``create_run`` guard, the ``…/validate`` endpoint,
    and the regression tests so they all validate the identical shape."""
    nodes = (
        session.execute(select(AgentNode).where(AgentNode.team_graph_id == graph_id))
        .scalars()
        .all()
    )
    edges = session.execute(select(Edge).where(Edge.team_graph_id == graph_id)).scalars().all()
    node_dicts = [{"id": str(n.id), "kind": n.kind, "config": n.config} for n in nodes]
    edge_dicts = [
        {
            "id": str(e.id),
            "source_node_id": str(e.source_node_id),
            "target_node_id": str(e.target_node_id),
            "edge_type": e.edge_type,
            "conditions": e.conditions,
        }
        for e in edges
    ]
    return node_dicts, edge_dicts
