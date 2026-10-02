"""M4 — the team file (``tvashtr_team: 1``): a library team as one readable file, a check of a file
before anything changes, and the import of a file as a NEW team.

The file names everything account-specific by NAME — Toolkit tools and skills, connectors by their
provider key, Domains, secrets — and never holds a secret value, a key, a sign-in, a token or a
memory: an inline tool server goes out as its name and the ``${SECRET}`` names it uses, never its
command, url, arguments, environment or headers; free text gets a last ``mask_secrets`` pass.
Contract: ``docs/superpowers/plans/api/team-file.md``. Openhands-free.
"""

import json
import re
import uuid
from datetime import UTC, datetime
from decimal import Decimal

import yaml
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane.credential_gate import missing_providers_for_launch
from tvashtr.control_plane.credentials import held_provider_slugs, provider_for_model
from tvashtr.control_plane.graph_validity import validate_graph
from tvashtr.control_plane.guardrails import GUARDRAIL_GATE_KINDS, mask_secrets
from tvashtr.control_plane.run_failure import node_label
from tvashtr.control_plane.run_views import MAX_RUN_BUDGET_USD
from tvashtr.control_plane.toolkit import owner_secret_names, secret_refs
from tvashtr.models import (
    AgentNode,
    ConnectorConnection,
    Domain,
    Edge,
    GithubInstallation,
    Run,
    SkillLibraryItem,
    TeamGraph,
    ToolLibraryItem,
)

FORMAT = 1
MAX_BYTES = 512 * 1024

# Built-in roles ↔ the file's ``based_on``; every other role is ``custom/<role_name>``.
_BUILT_IN = {
    "pm": "product-manager",
    "architect": "architect",
    "engineer": "engineer",
    "reviewer": "reviewer",
}
_ROLE_OF = {v: k for k, v in _BUILT_IN.items()}
_KIND_OF = {"thinker": "completion", "worker": "agent", "query-domain": "domain_query"}
_FILE_KIND = {v: k for k, v in _KIND_OF.items()}
# What a built-in role is unless the file says otherwise.
_DEFAULT_KIND = {
    "pm": "thinker",
    "architect": "thinker",
    "engineer": "worker",
    "reviewer": "worker",
}

_TOP_KEYS = (
    "tvashtr_team",
    "name",
    "budget_usd",
    "repo",
    "agents",
    "gates",
    "ends",
    "routes",
    "needs",
    "layout",
)
_AGENT_KEYS = (
    "id",
    "name",
    "based_on",
    "kind",
    "model",
    "backup_model",
    "file_access",
    "skills",
    "tools",
    "tools_off",
    "connectors",
    "domains",
    "reads",
    "reads_spec",
    "writes",
    "remember",
    "images",
    "context_budget",
    "output_format",
    "description",
    "domain",
    "pass_to_spec",
    "on_no_answer",
    "instructions",
)
_GATE_KEYS = (
    "id",
    "after",
    "asks",
    "checks",
    "kind",
    "title",
    "description",
    "forbidden_paths",
    "output_file",
    "schema",
)
_END_KEYS = ("id", "kind")
_ROUTE_KEYS = ("from", "to", "when", "loop_limit", "type")


class FileError(Exception):
    """The file can't be imported: ``line`` (1-based) and a plain ``message``."""

    def __init__(self, line: int, message: str):
        super().__init__(f"Line {line}: {message}")
        self.line = line
        self.message = message


# ---------------------------------------------------------------------------------- export


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s or "agent"


def file_name(team_name: str, fmt: str) -> str:
    return f"{_slug(team_name)}.{fmt}"


_GITHUB_REPO = re.compile(r"github\.com[/:]([\w.-]+)/([\w.-]+?)(?:\.git)?(?:[/?#]|$)", re.I)


def _github_repo(url: object) -> str | None:
    """A repo skill's source as ``https://github.com/<owner>/<repo>`` — never its userinfo, query or
    fragment — or None when it isn't a GitHub repo (the Toolkit only takes GitHub sources)."""
    match = _GITHUB_REPO.search(url) if isinstance(url, str) else None
    return f"https://github.com/{match[1]}/{match[2]}" if match else None


def _team_defaults(session, team: TeamGraph) -> tuple[float | None, str | None]:
    """The team's own budget / repo, else its last run's (a hosted repo only — never a path)."""
    budget = float(team.budget_usd) if team.budget_usd is not None else None
    repo = team.repo
    if budget is None or repo is None:
        last = session.execute(
            select(Run.budget_cap_usd, Run.github_repo)
            .where(Run.library_team_id == team.id, Run.owner_id == team.owner_id)
            .order_by(Run.created_at.desc())
            .limit(1)
        ).first()
        if last is not None:
            if budget is None and last.budget_cap_usd is not None:
                budget = float(last.budget_cap_usd)
            repo = repo if repo is not None else last.github_repo
    return budget, repo


def export_team(session, team: TeamGraph) -> dict:
    """The team as the ``tvashtr_team: 1`` data (ordered dicts, ready for YAML / JSON)."""
    owner = team.owner_id
    nodes = sorted(
        session.execute(select(AgentNode).where(AgentNode.team_graph_id == team.id)).scalars(),
        key=lambda n: ((n.position or {}).get("x", 0), (n.position or {}).get("y", 0), str(n.id)),
    )
    edges = session.execute(select(Edge).where(Edge.team_graph_id == team.id)).scalars().all()
    tools = dict(
        session.execute(
            select(ToolLibraryItem.id, ToolLibraryItem.name).where(
                ToolLibraryItem.owner_id == owner
            )
        ).all()
    )
    tool_configs = dict(
        session.execute(
            select(ToolLibraryItem.name, ToolLibraryItem.server_config).where(
                ToolLibraryItem.owner_id == owner
            )
        ).all()
    )
    skills = dict(
        session.execute(
            select(SkillLibraryItem.id, SkillLibraryItem.name).where(
                SkillLibraryItem.owner_id == owner
            )
        ).all()
    )
    connections = dict(
        session.execute(
            select(ConnectorConnection.id, ConnectorConnection.connector_key).where(
                ConnectorConnection.owner_id == owner
            )
        ).all()
    )
    domains = dict(
        session.execute(select(Domain.id, Domain.name).where(Domain.owner_id == owner)).all()
    )

    ids: dict[uuid.UUID, str] = {}
    taken: set[str] = set()

    def file_id(node: AgentNode) -> str:
        """Stable, readable ids: a built-in role's own name, an end's kind, a gate's label, else
        the title's slug."""
        cfg = node.config if isinstance(node.config, dict) else {}
        if node.kind == "terminal":
            base = cfg.get("terminal_kind") or node.role_name or "end"
        elif node.kind == "gate":
            base = _slug(node_label(node.role_name, node.kind, cfg))
        elif node.role_name in _BUILT_IN:
            base = node.role_name
        else:
            base = _slug(cfg.get("title") or node.role_name)
        candidate, k = base, 2
        while candidate in taken:
            candidate, k = f"{base}-{k}", k + 1
        taken.add(candidate)
        return candidate

    for n in nodes:
        ids[n.id] = file_id(n)

    secrets: set[str] = set()
    needs_connectors: set[str] = set()
    agents, gates, ends = [], [], []
    for n in nodes:
        cfg = dict(n.config) if isinstance(n.config, dict) else {}
        nid = ids[n.id]
        if n.kind == "terminal":
            ends.append({"id": nid, "kind": cfg.get("terminal_kind") or n.role_name})
            continue
        if n.kind == "gate":
            gate: dict = {"id": nid}
            before = [ids[e.source_node_id] for e in edges if e.target_node_id == n.id]
            if len(before) == 1:
                gate["after"] = before[0]
            kind = cfg.get("gate_kind") or "approval"
            if kind not in GUARDRAIL_GATE_KINDS:
                gate["asks"] = "you"
                gate["kind"] = kind
            else:
                gate["checks"] = kind
            for key in ("title", "description", "forbidden_paths", "output_file", "schema"):
                if cfg.get(key) not in (None, "", []):
                    gate[key] = cfg[key]
            gates.append(gate)
            continue
        agent: dict = {"id": nid, "name": cfg.get("title") or node_label(n.role_name, n.kind, cfg)}
        agent["based_on"] = (
            f"built-in/{_BUILT_IN[n.role_name]}"
            if n.role_name in _BUILT_IN
            else f"custom/{n.role_name}"
        )
        kind = _FILE_KIND.get(n.kind, "worker")
        if _DEFAULT_KIND.get(n.role_name) != kind:
            agent["kind"] = kind
        if n.model:
            agent["model"] = n.model
        if cfg.get("fallback_model"):
            agent["backup_model"] = cfg["fallback_model"]
        if n.kind != "domain_query":
            agent["file_access"] = "can-edit" if n.edits_allowed else "read-only"
        skill_list = _export_skills(n.skills, skills)
        if skill_list:
            agent["skills"] = skill_list
        tc = n.tool_config if isinstance(n.tool_config, dict) else {}
        tv = tc.get("tvashtr") if isinstance(tc.get("tvashtr"), dict) else {}
        servers = tc.get("mcpServers") if isinstance(tc.get("mcpServers"), dict) else {}
        states = tv.get("servers") if isinstance(tv.get("servers"), dict) else {}
        tool_names: list[str] = []
        for ref in tv.get("library") if isinstance(tv.get("library"), list) else []:
            name = tools.get(_as_uuid(ref))
            if name:
                tool_names.append(name)
                secrets.update(secret_refs(tool_configs.get(name)))
        for name, server in servers.items():
            if name not in tool_names:
                tool_names.append(name)
            secrets.update(secret_refs(server))
        if tool_names:
            agent["tools"] = tool_names
        off = sorted(
            name
            for name, state in states.items()
            if isinstance(state, dict) and state.get("enabled") is False
        )
        if off:
            agent["tools_off"] = off
        grants = []
        for grant in tv.get("connectors") if isinstance(tv.get("connectors"), list) else []:
            key = connections.get(_as_uuid(grant.get("id") if isinstance(grant, dict) else None))
            if key:
                entry = {"connector": key}
                if isinstance(grant, dict) and grant.get("access") == "write":
                    entry["access"] = "write"
                grants.append(entry)
                needs_connectors.add(key)
        if grants:
            agent["connectors"] = grants
        doms = tv.get("domains")
        if doms is True:
            agent["domains"] = "all"
        elif isinstance(doms, list) and doms:
            agent["domains"] = [domains[d] for d in map(_as_uuid, doms) if d in domains]
        for src, dst in (
            ("reads_from", "reads"),
            ("writes_to", "writes"),
            ("memory_remember_enabled", "remember"),
            ("multimodal", "images"),
            ("output_schema", "output_format"),
            ("description", "description"),
        ):
            if cfg.get(src) not in (None, "", [], False):
                agent[dst] = cfg[src]
        if cfg.get("reads_default") is False:
            agent["reads_spec"] = False
        budget = (cfg.get("model_config") or {}).get("worker_context_token_budget")
        if budget:
            agent["context_budget"] = budget
        if n.kind == "domain_query":
            dom = domains.get(_as_uuid(cfg.get("domain_id")))
            if dom:
                agent["domain"] = dom
            for key in ("pass_to_spec", "on_no_answer"):
                if key in cfg:
                    agent[key] = cfg[key]
        if n.prompt:
            agent["instructions"] = mask_secrets(n.prompt)
        agents.append(agent)

    routes = []
    for e in sorted(edges, key=lambda e: (ids[e.source_node_id], ids[e.target_node_id])):
        route: dict = {"from": ids[e.source_node_id], "to": ids[e.target_node_id]}
        cond = e.conditions if isinstance(e.conditions, dict) else {}
        if cond.get("when"):
            route["when"] = str(cond["when"]).replace("_", " ")
        if cond.get("loop_limit") is not None:
            route["loop_limit"] = cond["loop_limit"]
        if e.edge_type and e.edge_type != "work":
            route["type"] = e.edge_type
        routes.append(route)

    budget, repo = _team_defaults(session, team)
    if repo:
        needs_connectors.add("github")
    data: dict = {"tvashtr_team": FORMAT, "name": team.name}
    if budget is not None:
        data["budget_usd"] = budget
    if repo:
        data["repo"] = repo
    data["agents"] = agents
    if gates:
        data["gates"] = gates
    if ends:
        data["ends"] = ends
    data["routes"] = routes
    data["needs"] = {"connectors": sorted(needs_connectors), "secrets": sorted(secrets)}
    data["layout"] = {
        ids[n.id]: [round((n.position or {}).get("x", 0)), round((n.position or {}).get("y", 0))]
        for n in nodes
    }
    return _masked(data)


def _masked(value):
    """Every string the file holds through ``mask_secrets`` — the last pass before it leaves."""
    if isinstance(value, str):
        return mask_secrets(value)
    if isinstance(value, list):
        return [_masked(v) for v in value]
    if isinstance(value, dict):
        return {k: _masked(v) for k, v in value.items()}
    return value


def _as_uuid(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _export_skills(entries: object, library: dict) -> list:
    out: list = []
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict):
            continue
        kind = entry.get("type")
        extra = {k: entry[k] for k in ("mode", "triggers") if entry.get(k)}
        if kind == "library":
            name = library.get(_as_uuid(entry.get("id")))
            if name:
                out.append({"name": name, **extra} if extra else name)
        elif kind == "inline":
            out.append(
                {
                    "name": entry.get("name") or "skill",
                    **extra,
                    "inline": mask_secrets(entry.get("content") or ""),
                }
            )
        elif kind == "repo":
            repo = _github_repo(entry.get("url"))
            if repo is None:
                continue
            item = {"repo": repo}
            for key in ("ref", "filter"):
                if entry.get(key):
                    item[key] = entry[key]
            out.append({**item, **extra})
        elif kind == "project_rules":
            out.append("project-rules")
    return out


# ---------------------------------------------------------------------------------- rendering


def _scalar(value) -> str:
    text = yaml.safe_dump(value, default_flow_style=True, allow_unicode=True, width=10_000)
    text = text.strip()
    return text[: -len("...")].strip() if text.endswith("...") else text


_PLAIN = re.compile(r"[A-Za-z_][A-Za-z0-9 _./@+-]*")


def _flow(value) -> str:
    """Flow style (``{a: b}``, ``[a, b]``); a string that isn't plain words is double-quoted (JSON's
    quoting is valid YAML), so commas, colons and question marks never split it."""
    if isinstance(value, dict):
        return "{" + ", ".join(f"{_flow(k)}: {_flow(v)}" for k, v in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ", ".join(_flow(v) for v in value) + "]"
    if isinstance(value, str):
        plain = (
            _PLAIN.fullmatch(value) and not value.endswith(" ") and yaml.safe_load(value) == value
        )
        return value if plain else json.dumps(value, ensure_ascii=False)
    return _scalar(value)


def _block(lead: str, key: str, text: str, indent: str) -> list[str]:
    """``key: |`` with the chomping that gives ``text`` back exactly; a quoted scalar when a literal
    block can't (leading whitespace, carriage returns)."""
    text = str(text)
    if not text or text[0] in " \t" or "\r" in text:
        return [f"{lead}{key}: {_scalar(text)}"]
    if not text.endswith("\n"):
        style, body = "|-", text
    elif text.endswith("\n\n"):
        style, body = "|+", text[:-1]
    else:
        style, body = "|", text[:-1]
    return [f"{lead}{key}: {style}"] + [
        f"{indent}{line}" if line else "" for line in body.split("\n")
    ]


def to_yaml(data: dict, *, made: datetime | None = None) -> str:
    """The board's layout: a header comment, top-level fields, agents as blocks (instructions as a
    literal block), gates / ends / routes one flow mapping per line, needs with their notes."""
    made = made or datetime.now(UTC)
    title = " ".join(str(data["name"]).split())  # a line break in a name never makes a new key
    out = [f"# Tvashtr team file · {title} · made {made:%Y-%m-%d}"]
    for key in ("tvashtr_team", "name", "budget_usd", "repo"):
        if key in data:
            out.append(f"{key}: {_scalar(data[key])}")
    out.append("")
    out.append("agents:")
    for agent in data["agents"]:
        first = True
        for key, value in agent.items():
            lead = "  - " if first else "    "
            first = False
            if key == "instructions":
                out.extend(_block(lead, key, value, "      "))
            elif isinstance(value, list) and any(
                isinstance(v, dict) and "inline" in v for v in value
            ):
                out.append(f"{lead}{key}:")
                for item in value:
                    if isinstance(item, dict) and "inline" in item:
                        out.append(f"      - name: {_scalar(item['name'])}")
                        for k, v in item.items():
                            if k not in ("name", "inline"):
                                out.append(f"        {k}: {_flow(v)}")
                        out.extend(_block("        ", "inline", item["inline"], "          "))
                    else:
                        out.append(f"      - {_flow(item)}")
            elif isinstance(value, (dict, list)):
                out.append(f"{lead}{key}: {_flow(value)}")
            else:
                out.append(f"{lead}{key}: {_scalar(value)}")
    for section in ("gates", "ends", "routes"):
        if data.get(section):
            out.append("")
            out.append(f"{section}:")
            out.extend(f"  - {_flow(item)}" for item in data[section])
    needs = data.get("needs") or {}
    out.append("")
    out.append("needs:")
    out.append(
        f"  connectors: {_flow(needs.get('connectors') or [])}"
        "  # each person signs in on their own computer"
    )
    out.append(f"  secrets: {_flow(needs.get('secrets') or [])}  # names only, never values")
    if data.get("layout"):
        out.append("")
        out.append("layout:")
        out.extend(f"  {k}: {_flow(v)}" for k, v in data["layout"].items())
    return "\n".join(out) + "\n"


def to_json(data: dict) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------------------------- reading


MAX_ITEMS = 200
MAX_LOOP_LIMIT = 50
_GATE_KINDS = frozenset(
    {"approval", "gate_approval", "prd_approval", "ship_approval", "review_escalation"}
)
_ROUTE_TYPES = ("work", "review", "escalation")
_ON_NO_ANSWER = ("continue", "stop")


def _events_and_keys(content: str) -> None:
    """Refuse what a team file never needs before anything expands: anchors / aliases (a few
    hundred bytes of aliases can expand to gigabytes) and a key given twice in one set of fields."""
    for event in yaml.parse(content, Loader=yaml.SafeLoader):
        if isinstance(event, yaml.AliasEvent) or getattr(event, "anchor", None):
            raise FileError(
                event.start_mark.line + 1,
                "anchors and aliases (&name, *name) aren’t allowed in a team file.",
            )


def _check_keys(node) -> None:
    if isinstance(node, yaml.MappingNode):
        seen: set = set()
        for key, value in node.value:
            if not isinstance(key, yaml.ScalarNode):
                raise FileError(key.start_mark.line + 1, "a field’s name should be a word.")
            if key.value in seen:
                raise FileError(key.start_mark.line + 1, f"`{key.value}` appears twice.")
            seen.add(key.value)
            _check_keys(value)
    elif isinstance(node, yaml.SequenceNode):
        for value in node.value:
            _check_keys(value)


def _plain(value, path, at) -> None:
    """Only text, numbers, true / false, lists and sets of fields (no dates, binary, NaN)."""
    if isinstance(value, dict):
        for key, inner in value.items():
            if not isinstance(key, str):
                raise FileError(at(*path, str(key)), "a field’s name should be a word.")
            _plain(inner, (*path, key), at)
    elif isinstance(value, list):
        for i, inner in enumerate(value):
            _plain(inner, (*path, i), at)
    elif isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise FileError(at(*path), "numbers should be finite.")
    elif value is not None and not isinstance(value, (str, int, bool)):
        raise FileError(
            at(*path), "only text, numbers, true / false, lists and fields are allowed here."
        )


def parse(content: str) -> tuple[dict, list[str]]:
    """``(data, unknown)``: the checked file and the paths of the fields left out. Raises
    :class:`FileError` naming the line of the first problem."""
    if len(content.encode()) > MAX_BYTES:
        raise FileError(1, "the file is too big for a team file (over 512 KB).")
    try:
        _events_and_keys(content)
        root = yaml.compose(content, Loader=yaml.SafeLoader)
        _check_keys(root)
        data = yaml.safe_load(content)
    except yaml.MarkedYAMLError as exc:
        mark = exc.problem_mark or exc.context_mark
        line = mark.line + 1 if mark else 1
        raise FileError(
            line, f"this isn’t valid YAML or JSON ({exc.problem or 'unreadable'})."
        ) from exc
    except yaml.YAMLError as exc:
        raise FileError(1, "this isn’t valid YAML or JSON.") from exc
    except RecursionError as exc:
        raise FileError(1, "the file is nested too deeply.") from exc
    lines = _line_map(root) if root is not None else {}

    def at(*path) -> int:
        while path and path not in lines:
            path = path[:-1]
        return lines.get(path, 1)

    if not isinstance(data, dict):
        raise FileError(1, "a team file is a set of fields (`tvashtr_team`, `name`, `agents`, …).")
    try:
        _plain(data, (), at)
    except RecursionError as exc:
        raise FileError(1, "the file is nested too deeply.") from exc
    if data.get("tvashtr_team") != FORMAT:
        if "tvashtr_team" not in data:
            raise FileError(1, "this isn’t a Tvashtr team file (it has no `tvashtr_team: 1`).")
        raise FileError(
            at("tvashtr_team"),
            f"this file is format {data['tvashtr_team']!r}; this Tvashtr reads 1.",
        )
    unknown = [k for k in data if k not in _TOP_KEYS]

    def text(value, where, what: str, *, limit: int = 200, required: bool = True) -> None:
        if value is None and not required:
            return
        if not isinstance(value, str) or (required and not value.strip()) or len(value) > limit:
            raise FileError(at(*where), what)

    def words(value, where, what: str) -> None:
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise FileError(at(*where), what)

    text(data.get("name"), ("name",), "`name` should be the team’s name.")
    if "budget_usd" in data:
        budget = data["budget_usd"]
        if (
            isinstance(budget, bool)
            or not isinstance(budget, (int, float))
            or not 0 < budget <= float(MAX_RUN_BUDGET_USD)
        ):
            raise FileError(
                at("budget_usd"),
                f"`budget_usd` should be dollars, more than 0 and at most {MAX_RUN_BUDGET_USD}.",
            )
    if "repo" in data and not (
        isinstance(data["repo"], str) and re.fullmatch(r"[\w.-]+/[\w.-]+", data["repo"])
    ):
        raise FileError(at("repo"), "`repo` should be a GitHub repo, like owner/name.")
    agents = data.get("agents")
    if not isinstance(agents, list) or not agents:
        raise FileError(at("agents"), "`agents` should be a list of agents.")
    for section in ("gates", "ends", "routes"):
        if not isinstance(data.get(section, []), list):
            raise FileError(at(section), f"`{section}` should be a list.")
    if len(agents) + len(data.get("gates") or []) + len(data.get("ends") or []) > MAX_ITEMS:
        raise FileError(
            at("agents"), f"a team file holds at most {MAX_ITEMS} agents, gates and ends."
        )
    ids: set[str] = set()

    def take(item_id, where) -> None:
        if not isinstance(item_id, str) or not re.fullmatch(r"[\w.-]{1,60}", item_id):
            raise FileError(at(*where), "each item needs an `id` (letters, digits, - or _).")
        if item_id in ids:
            raise FileError(at(*where, "id"), f"the id `{item_id}` is used twice.")
        ids.add(item_id)

    for i, agent in enumerate(agents):
        where = ("agents", i)
        if not isinstance(agent, dict):
            raise FileError(at(*where), "each agent is a set of fields (`id`, `name`, `model`, …).")
        take(agent.get("id"), where)
        unknown += [f"agents[{i}].{k}" for k in agent if k not in _AGENT_KEYS]
        text(
            agent.get("name"),
            (*where, "name"),
            "`name` should be the agent’s name.",
            limit=60,
            required=False,
        )
        text(
            agent.get("based_on"),
            (*where, "based_on"),
            "`based_on` should be built-in/<role> or custom/<role>.",
            limit=80,
            required=False,
        )
        kind = agent.get("kind") or _DEFAULT_KIND.get(_role(agent), "worker")
        if not isinstance(kind, str) or kind not in _KIND_OF:
            raise FileError(at(*where, "kind"), "`kind` should be thinker, worker or query-domain.")
        if kind != "query-domain":
            text(
                agent.get("model"), (*where, "model"), f"the agent `{agent['id']}` needs a `model`."
            )
        else:
            text(
                agent.get("model"), (*where, "model"), "`model` should be a model.", required=False
            )
        text(
            agent.get("backup_model"),
            (*where, "backup_model"),
            "`backup_model` should be a model.",
            required=False,
        )
        if agent.get("file_access", "can-edit") not in ("can-edit", "read-only"):
            raise FileError(
                at(*where, "file_access"), "`file_access` should be can-edit or read-only."
            )
        for key in ("tools", "tools_off", "reads"):
            if key in agent:
                words(agent[key], (*where, key), f"`{key}` should be a list of names.")
        for j, skill in enumerate(agent.get("skills") or []):
            if isinstance(skill, str):
                continue
            ok = (
                isinstance(skill, dict)
                and all(
                    isinstance(skill.get(k), str)
                    for k in ("name", "repo", "inline", "ref", "filter", "mode")
                    if k in skill
                )
                and ("name" in skill or "repo" in skill)
            )
            if not ok or ("triggers" in skill and not isinstance(skill["triggers"], list)):
                raise FileError(
                    at(*where, "skills", j), "a skill is a name, or {name, inline} / {repo, ref}."
                )
        if "skills" in agent and not isinstance(agent["skills"], list):
            raise FileError(at(*where, "skills"), "`skills` should be a list.")
        for j, grant in enumerate(agent.get("connectors") or []):
            key = grant.get("connector") if isinstance(grant, dict) else grant
            access = grant.get("access", "read") if isinstance(grant, dict) else "read"
            if not isinstance(key, str) or access not in ("read", "write"):
                raise FileError(
                    at(*where, "connectors", j),
                    "a connector is {connector: <name>, access?: write}.",
                )
        if "connectors" in agent and not isinstance(agent["connectors"], list):
            raise FileError(at(*where, "connectors"), "`connectors` should be a list.")
        domains = agent.get("domains")
        if domains is not None and domains != "all":
            words(
                domains, (*where, "domains"), "`domains` should be all, or a list of Domain names."
            )
        text(
            agent.get("writes"),
            (*where, "writes"),
            "`writes` should be a document name.",
            limit=80,
            required=False,
        )
        text(
            agent.get("description"),
            (*where, "description"),
            "`description` should be text.",
            limit=120,
            required=False,
        )
        text(
            agent.get("domain"),
            (*where, "domain"),
            "`domain` should be a Domain name.",
            required=False,
        )
        for key in ("remember", "images", "reads_spec", "pass_to_spec"):
            if key in agent and not isinstance(agent[key], bool):
                raise FileError(at(*where, key), f"`{key}` should be true or false.")
        budget = agent.get("context_budget")
        if budget is not None and (
            isinstance(budget, bool) or not isinstance(budget, int) or not 0 < budget <= 2_000_000
        ):
            raise FileError(
                at(*where, "context_budget"), "`context_budget` should be a number of tokens."
            )
        if "output_format" in agent and not isinstance(agent["output_format"], dict):
            raise FileError(
                at(*where, "output_format"), "`output_format` should be a set of fields."
            )
        if agent.get("on_no_answer", "continue") not in _ON_NO_ANSWER:
            raise FileError(
                at(*where, "on_no_answer"), "`on_no_answer` should be continue or stop."
            )
        text(
            agent.get("instructions"),
            (*where, "instructions"),
            "`instructions` should be text.",
            limit=100_000,
            required=False,
        )
    for i, gate in enumerate(data.get("gates") or []):
        where = ("gates", i)
        if not isinstance(gate, dict):
            raise FileError(at(*where), "each item of `gates` is a set of fields.")
        take(gate.get("id"), where)
        unknown += [f"gates[{i}].{k}" for k in gate if k not in _GATE_KEYS]
        if "checks" in gate and gate["checks"] not in GUARDRAIL_GATE_KINDS:
            raise FileError(at(*where, "checks"), "`checks` isn’t a check Tvashtr knows.")
        if "kind" in gate and gate["kind"] not in _GATE_KINDS:
            raise FileError(at(*where, "kind"), "`kind` isn’t a gate Tvashtr knows.")
        for key in ("title", "description", "output_file"):
            text(
                gate.get(key), (*where, key), f"`{key}` should be text.", limit=500, required=False
            )
        if "forbidden_paths" in gate:
            words(
                gate["forbidden_paths"],
                (*where, "forbidden_paths"),
                "`forbidden_paths` should be a list of paths.",
            )
        if "schema" in gate and not isinstance(gate["schema"], dict):
            raise FileError(at(*where, "schema"), "`schema` should be a set of fields.")
    for i, end in enumerate(data.get("ends") or []):
        where = ("ends", i)
        if not isinstance(end, dict):
            raise FileError(at(*where), "each item of `ends` is a set of fields.")
        take(end.get("id"), where)
        unknown += [f"ends[{i}].{k}" for k in end if k not in _END_KEYS]
        if end.get("kind") not in ("ship", "stop"):
            raise FileError(at(*where, "kind"), "an end’s `kind` should be ship or stop.")
    for i, route in enumerate(data.get("routes") or []):
        where = ("routes", i)
        if not isinstance(route, dict):
            raise FileError(at(*where), "each route is {from, to, when?, loop_limit?}.")
        unknown += [f"routes[{i}].{k}" for k in route if k not in _ROUTE_KEYS]
        for end in ("from", "to"):
            if not isinstance(route.get(end), str) or route[end] not in ids:
                raise FileError(
                    at(*where, end),
                    f"the route’s `{end}` names `{route.get(end)}`, which isn’t in the file.",
                )
        text(
            route.get("when"),
            (*where, "when"),
            "`when` should be a word, like approved.",
            limit=60,
            required=False,
        )
        limit = route.get("loop_limit")
        if limit is not None and (
            isinstance(limit, bool)
            or not isinstance(limit, int)
            or not 1 <= limit <= MAX_LOOP_LIMIT
        ):
            raise FileError(
                at(*where, "loop_limit"),
                f"`loop_limit` should be a whole number from 1 to {MAX_LOOP_LIMIT}.",
            )
        if route.get("type", "work") not in _ROUTE_TYPES:
            raise FileError(at(*where, "type"), "`type` should be work, review or escalation.")
    needs = data.get("needs", {})
    if not isinstance(needs, dict):
        raise FileError(at("needs"), "`needs` should be {connectors: [...], secrets: [...]}.")
    for key in ("connectors", "secrets"):
        if key in needs:
            words(needs[key], ("needs", key), f"`needs.{key}` should be a list of names.")
    layout = data.get("layout", {})
    if not isinstance(layout, dict):
        raise FileError(at("layout"), "`layout` should map each id to [x, y].")
    for key, pos in layout.items():
        if key not in ids:
            unknown.append(f"layout.{key}")
        elif not (
            isinstance(pos, list)
            and len(pos) == 2
            and all(
                isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) <= 1_000_000
                for v in pos
            )
        ):
            raise FileError(at("layout", key), f"the layout of `{key}` should be [x, y].")
    return data, unknown


def _role(agent: dict) -> str:
    based = str(agent.get("based_on") or "")
    kind, _, name = based.partition("/")
    if kind == "built-in" and name in _ROLE_OF:
        return _ROLE_OF[name]
    if kind == "custom" and name:
        return name
    return {"thinker": "thinker", "query-domain": "domain_query"}.get(agent.get("kind"), "worker")


def _line_map(node, path=()) -> dict:
    out = {path: node.start_mark.line + 1}
    if isinstance(node, yaml.MappingNode):
        for key, value in node.value:
            k = key.value
            out[(*path, k)] = key.start_mark.line + 1
            out.update(_line_map(value, (*path, k)))
            out[(*path, k)] = key.start_mark.line + 1
    elif isinstance(node, yaml.SequenceNode):
        for i, value in enumerate(node.value):
            out.update(_line_map(value, (*path, i)))
    return out


# ---------------------------------------------------------------------------------- the check


def _who(names: list[str]) -> str:
    names = list(dict.fromkeys(names))
    if not names:
        return "The team"
    if len(names) == 1:
        return f"The {names[0]}"
    return "The " + ", the ".join(names[:-1]) + f" and the {names[-1]}"


def _gather(session, owner_id: uuid.UUID, data: dict) -> dict:
    """What the account has, by name, for the file's needs."""
    tools = {
        name: tid
        for tid, name in session.execute(
            select(ToolLibraryItem.id, ToolLibraryItem.name).where(
                ToolLibraryItem.owner_id == owner_id
            )
        ).all()
    }
    skills = {
        name: sid
        for sid, name in session.execute(
            select(SkillLibraryItem.id, SkillLibraryItem.name).where(
                SkillLibraryItem.owner_id == owner_id
            )
        ).all()
    }
    connections = {
        key: (cid, status)
        for cid, key, status in session.execute(
            select(
                ConnectorConnection.id,
                ConnectorConnection.connector_key,
                ConnectorConnection.status,
            ).where(ConnectorConnection.owner_id == owner_id)
        ).all()
    }
    domains = {
        name: did
        for did, name in session.execute(
            select(Domain.id, Domain.name).where(Domain.owner_id == owner_id)
        ).all()
    }
    installed = (
        session.execute(
            select(GithubInstallation.installation_id).where(
                GithubInstallation.owner_id == owner_id
            )
        ).first()
        is not None
    )
    return {
        "tools": tools,
        "skills": skills,
        "connections": connections,
        "domains": domains,
        "secrets": owner_secret_names(session, owner_id),
        "held": held_provider_slugs(owner_id),
        "github": installed,
    }


def _skill_name(entry) -> str | None:
    if isinstance(entry, str):
        return None if entry == "project-rules" else entry
    if isinstance(entry, dict) and "inline" not in entry and "repo" not in entry:
        return entry.get("name")
    return None


def check(session, owner_id: uuid.UUID, data: dict, unknown: list[str]) -> list[dict]:
    """The rows of "What we checked", in the board's order (tone ok | warn; ``fix`` marks the
    warn rows that need the person after importing)."""
    have = _gather(session, owner_id, data)
    agents = data["agents"]
    rows: list[dict] = []
    gates = data.get("gates") or []
    n_agents, n_gates, n_routes = len(agents), len(gates), len(data.get("routes") or [])

    def count(n, word):
        return f"{n} {word}" + ("" if n == 1 else "s")

    rows.append(
        {
            "key": "shape",
            "tone": "ok",
            "title": f"{count(n_agents, 'agent')}, {count(n_gates, 'gate')} and "
            f"{count(n_routes, 'route')}",
            "detail": "The canvas will look the same as in the file.",
            "code": [],
        }
    )
    problems = validate_graph(
        *_graph_dicts(data, have["domains"]), {str(d) for d in have["domains"].values()}
    )["errors"]
    if problems:
        first = problems[0]
        rows.append(
            {
                "key": "graph",
                "tone": "warn",
                "fix": True,
                "title": "The team needs a change before it can run",
                "detail": str(first.get("message") or first.get("code")),
                "code": [],
            }
        )
    # Models (and backup models) this account can use.
    users: dict[str, list[str]] = {}
    for agent in agents:
        for key in ("model", "backup_model"):
            if isinstance(agent.get(key), str) and agent[key]:
                users.setdefault(agent[key], []).append(agent.get("name") or agent["id"])
    models = list(users)
    missing = set(
        missing_providers_for_launch(
            models, byok=have["held"], fresh_subscriptions=set(), desktop_target=False
        )
    )
    bad = [m for m in models if provider_for_model(m) in missing]
    good = [m for m in models if m not in bad]
    if good:
        title = (
            "The model is set up on this computer"
            if len(good) == 1
            else "Both models are set up on this computer"
            if len(good) == 2
            else f"All {len(good)} models are set up on this computer"
        )
        if bad:
            verb = "is" if len(good) == 1 else "are"
            title = f"{count(len(good), 'model')} {verb} set up on this computer"
        rows.append(
            {
                "key": "models",
                "tone": "ok",
                "title": title,
                "detail": " and ".join(good)
                if len(good) <= 2
                else ", ".join(good[:-1]) + " and " + good[-1],
                "code": good,
            }
        )
    for m in bad:
        rows.append(
            {
                "key": f"model:{m}",
                "tone": "warn",
                "fix": True,
                "title": f"{m} isn’t set up here",
                "detail": f"{_who(users[m])} uses it. Add a key for {provider_for_model(m)} in"
                " Engines,"
                " or pick another model.",
                "code": [m],
                "action": "open_engines",
                "target": provider_for_model(m),
                "agents": users[m],
            }
        )
    # Connectors and GitHub.
    needs = data.get("needs") or {}
    connector_users: dict[str, list[str]] = {}
    for agent in agents:
        for grant in agent.get("connectors") or []:
            key = grant.get("connector") if isinstance(grant, dict) else grant
            if key:
                connector_users.setdefault(key, []).append(agent.get("name") or agent["id"])
    for key in needs.get("connectors") or []:
        connector_users.setdefault(key, [])
    hosted = get_settings().hosted_mode
    for key, names in connector_users.items():
        if key == "github":
            if not hosted or have["github"]:
                continue
            ships = [
                a.get("name") or a["id"]
                for a in agents
                if a.get("file_access", "can-edit") == "can-edit"
                and _role(a) not in ("pm", "architect")
            ]
            rows.append(
                {
                    "key": "connector:github",
                    "tone": "warn",
                    "fix": True,
                    "title": "GitHub isn’t signed in here",
                    # The period opens the next literal: test_connector_net's guard would read
                    # the word and a period together as an HTTP call.
                    "detail": f"{_who(ships[:1] or names)} needs it to open pull requests"
                    ". Runs still work; sign in before you want one to ship.",
                    "code": [],
                    "action": "sign_in",
                    "target": "github",
                    "agents": ships[:1] or names,
                }
            )
            continue
        connection = have["connections"].get(key)
        if connection is None or connection[1] != "connected":
            label = _connector_label(key)
            rows.append(
                {
                    "key": f"connector:{key}",
                    "tone": "warn",
                    "fix": True,
                    "title": f"{label} isn’t signed in here",
                    "detail": f"{_who(names)} uses it. Runs still work without it; sign in before"
                    " it needs it.",
                    "code": [],
                    "action": "sign_in",
                    "target": key,
                    "agents": names,
                }
            )
    # Tools, skills and Domains the Toolkit doesn't have.
    for word, field, library in (("tool", "tools", "tools"), ("skill", "skills", "skills")):
        wanted: dict[str, list[str]] = {}
        for agent in agents:
            for entry in agent.get(field) or []:
                name = entry if field == "tools" else _skill_name(entry)
                if isinstance(name, str) and name not in have[library]:
                    wanted.setdefault(name, []).append(agent.get("name") or agent["id"])
        for name, names in wanted.items():
            rows.append(
                {
                    "key": f"{word}:{name}",
                    "tone": "warn",
                    "fix": True,
                    "title": f"The {word} {name} isn’t in your Toolkit",
                    "detail": f"{_who(names)} runs without it until you add it or remove it from"
                    " the team.",
                    "code": [name],
                    "action": "open_toolkit",
                    "target": name,
                    "agents": names,
                }
            )
    for agent in agents:
        wanted_domains = [agent["domain"]] if agent.get("domain") else []
        if isinstance(agent.get("domains"), list):
            wanted_domains += agent["domains"]
        for name in wanted_domains:
            if name not in have["domains"]:
                rows.append(
                    {
                        "key": f"domain:{name}",
                        "tone": "warn",
                        "fix": True,
                        "title": f"The Domain {name} isn’t in your account",
                        "detail": f"{_who([agent.get('name') or agent['id']])} can’t ask it until"
                        " you pick a Domain.",
                        "code": [name],
                        "action": "open_domains",
                        "target": name,
                        "agents": [agent.get("name") or agent["id"]],
                    }
                )
    # What the import will use of yours: it binds by name, so say so.
    uses: dict[str, dict] = {}
    for agent in agents:
        who = agent.get("name") or agent["id"]
        for grant in agent.get("connectors") or []:
            key = grant.get("connector") if isinstance(grant, dict) else grant
            connection = have["connections"].get(key)
            if connection is not None and connection[1] == "connected":
                row = uses.setdefault(
                    f"uses:connector:{key}",
                    {
                        "label": _connector_label(key),
                        "who": [],
                        "write": False,
                        "kind": "connector",
                    },
                )
                row["who"].append(who)
                row["write"] |= isinstance(grant, dict) and grant.get("access") == "write"
        for name in agent.get("tools") or []:
            if name in have["tools"]:
                uses.setdefault(f"uses:tool:{name}", {"label": name, "who": [], "kind": "tool"})[
                    "who"
                ].append(who)
        if agent.get("domains") == "all" and have["domains"]:
            uses.setdefault("uses:domains", {"label": "", "who": [], "kind": "domains"})[
                "who"
            ].append(who)
        for entry in agent.get("skills") or []:
            if isinstance(entry, dict) and "repo" in entry and _github_repo(entry["repo"]) is None:
                rows.append(
                    {
                        "key": f"repo:{entry['repo']}",
                        "tone": "warn",
                        "title": "A skill source isn’t a GitHub repo, so it’s left out",
                        "detail": f"{_who([who])} listed it; the Toolkit only takes GitHub repos.",
                        "code": [],
                    }
                )
    for key, use in uses.items():
        if use["kind"] == "connector":
            title = f"{_who(use['who'])} will use your {use['label']}"
            detail = "Read-only." + (
                " The file asks it to change things there; allow that on the agent if you want it."
                if use["write"]
                else ""
            )
        elif use["kind"] == "tool":
            title = f"{_who(use['who'])} will use your Toolkit tool {use['label']}"
            detail = "With your own settings and secrets."
        else:
            title = f"{_who(use['who'])} can ask every Domain you have"
            detail = "Pick fewer on the agent if you want."
        rows.append(
            {
                "key": key,
                "tone": "ok",
                "title": title,
                "detail": detail,
                "code": [use["label"]] if use["kind"] == "tool" else [],
            }
        )
    # Secrets: named, never inside.
    secrets = [s for s in needs.get("secrets") or [] if isinstance(s, str)]
    lacking = [s for s in secrets if s not in have["secrets"]]
    if not secrets:
        rows.append(
            {
                "key": "secrets",
                "tone": "ok",
                "title": "No secrets inside the file",
                "detail": "It names none.",
                "code": [],
            }
        )
    else:
        named = (
            " and ".join(secrets)
            if len(secrets) <= 2
            else ", ".join(secrets[:-1]) + " and " + secrets[-1]
        )
        rows.append(
            {
                "key": "secrets",
                "tone": "ok",
                "title": "No secrets inside the file",
                "detail": f"It names {named}. You’ll use your own.",
                "code": [],
            }
        )
        for name in lacking:
            rows.append(
                {
                    "key": f"secret:{name}",
                    "tone": "warn",
                    "fix": True,
                    "title": f"Add the secret {name} to your Toolkit",
                    "detail": "The file names it but never holds its value.",
                    "code": [name],
                    "action": "open_toolkit",
                    "target": name,
                    "agents": [],
                }
            )
    if unknown:
        rows.append(
            {
                "key": "unknown",
                "tone": "warn",
                "title": f"{count(len(unknown), 'field')} Tvashtr doesn’t know "
                + ("was" if len(unknown) == 1 else "were")
                + " left out",
                "detail": ", ".join(unknown[:6]) + (" …" if len(unknown) > 6 else ""),
                "code": [],
            }
        )
    return rows


def _connector_label(key: str) -> str:
    from tvashtr.control_plane import connector_catalog

    entry = connector_catalog.resolve(key)
    return (entry or {}).get("name") or key


def _graph_dicts(data: dict, domains: dict | None = None) -> tuple[list[dict], list[dict]]:
    """The file as ``validate_graph``'s node / edge dicts (``graph_validity.graph_dicts``' shape,
    with the file's ids)."""
    nodes = []
    for agent in data["agents"]:
        kind = _KIND_OF[agent.get("kind") or _DEFAULT_KIND.get(_role(agent), "worker")]
        nodes.append(
            {
                "id": agent["id"],
                "kind": kind,
                "config": _agent_config(agent, domains or {}),
                "model": agent.get("model"),
                "prompt": agent.get("instructions"),
            }
        )
    for gate in data.get("gates") or []:
        nodes.append(
            {
                "id": gate["id"],
                "kind": "gate",
                "config": _gate_config(gate),
                "model": None,
                "prompt": None,
            }
        )
    for end in data.get("ends") or []:
        nodes.append(
            {
                "id": end["id"],
                "kind": "terminal",
                "config": {"terminal_kind": end["kind"]},
                "model": None,
                "prompt": None,
            }
        )
    edges = [
        {
            "id": f"r{i}",
            "source_node_id": r["from"],
            "target_node_id": r["to"],
            "edge_type": r.get("type") or "work",
            "conditions": _conditions(r),
        }
        for i, r in enumerate(data.get("routes") or [])
    ]
    return nodes, edges


def _conditions(route: dict) -> dict | None:
    cond: dict = {}
    if route.get("when"):
        cond["when"] = str(route["when"]).strip().replace(" ", "_")
    if route.get("loop_limit") is not None:
        cond["loop_limit"] = route["loop_limit"]
    return cond or None


def _gate_config(gate: dict) -> dict:
    cfg: dict = {"gate_kind": gate.get("checks") or gate.get("kind") or "approval"}
    for key in ("title", "description", "forbidden_paths", "output_file", "schema"):
        if key in gate:
            cfg[key] = gate[key]
    return cfg


def _agent_config(agent: dict, domains: dict) -> dict:
    cfg: dict = {}
    if agent.get("name"):
        cfg["title"] = agent["name"]
    for src, dst in (
        ("backup_model", "fallback_model"),
        ("reads", "reads_from"),
        ("writes", "writes_to"),
        ("remember", "memory_remember_enabled"),
        ("images", "multimodal"),
        ("output_format", "output_schema"),
        ("description", "description"),
        ("pass_to_spec", "pass_to_spec"),
        ("on_no_answer", "on_no_answer"),
    ):
        if src in agent:
            cfg[dst] = agent[src]
    if agent.get("reads_spec") is False:
        cfg["reads_default"] = False
    if agent.get("context_budget"):
        cfg["model_config"] = {"worker_context_token_budget": agent["context_budget"]}
    if agent.get("domain") and agent["domain"] in domains:
        cfg["domain_id"] = str(domains[agent["domain"]])
    elif (agent.get("kind") == "query-domain") and "domain_id" not in cfg:
        cfg["domain_id"] = None
    return cfg


# ---------------------------------------------------------------------------------- import


def suggested_name(data: dict) -> str:
    return f"{data['name'].strip()} (copy)"


def create(
    session, owner_id: uuid.UUID, data: dict, name: str, rows: list[dict]
) -> tuple[uuid.UUID, list[dict]]:
    """Insert the file as a NEW library team named ``name`` (in ``session``); returns its id and
    the "things to fix" (the check's fix rows, with the new nodes that need each)."""
    have = _gather(session, owner_id, data)
    team = TeamGraph(
        name=name,
        is_library=True,
        owner_id=owner_id,
        template_key="import",
        budget_usd=Decimal(str(data["budget_usd"])) if data.get("budget_usd") else None,
        repo=data.get("repo"),
    )
    session.add(team)
    session.flush()
    layout = data.get("layout") or {}
    new_ids: dict[str, uuid.UUID] = {}
    by_name: dict[str, list[uuid.UUID]] = {}

    def place(item_id: str, k: int) -> dict:
        x, y = layout.get(item_id, [k * 260, 0])
        return {"x": x, "y": y}

    k = 0
    targeted = {r["to"] for r in data.get("routes") or []}
    for agent in data["agents"]:
        kind = _KIND_OF[agent.get("kind") or _DEFAULT_KIND.get(_role(agent), "worker")]
        # A thinker reads only unless the file says otherwise; the entry agent (no route into it)
        # writes the spec everyone reads, so it is always read-only (the canvas refuses otherwise).
        default_access = "read-only" if kind == "completion" else "can-edit"
        edits = (
            kind != "domain_query"
            and agent["id"] in targeted
            and agent.get("file_access", default_access) == "can-edit"
        )
        node = AgentNode(
            team_graph_id=team.id,
            role_name=_role(agent),
            kind=kind,
            model=agent.get("model"),
            engine="openhands" if kind == "agent" else None,
            prompt=agent.get("instructions")
            if kind != "domain_query"
            else agent.get("instructions", "{idea}"),
            position=place(agent["id"], k),
            config=_agent_config(agent, have["domains"]),
            tool_config=_tool_config(agent, have),
            skills=_skills(agent, have),
            edits_allowed=edits,
        )
        session.add(node)
        session.flush()
        new_ids[agent["id"]] = node.id
        by_name.setdefault(agent.get("name") or agent["id"], []).append(node.id)
        k += 1
    for gate in data.get("gates") or []:
        cfg = _gate_config(gate)
        node = AgentNode(
            team_graph_id=team.id,
            role_name="prd_gate" if cfg["gate_kind"] == "prd_approval" else "gate",
            kind="gate",
            model=None,
            engine=None,
            prompt=None,
            position=place(gate["id"], k),
            config=cfg,
            edits_allowed=False,
        )
        session.add(node)
        session.flush()
        new_ids[gate["id"]] = node.id
        k += 1
    for end in data.get("ends") or []:
        node = AgentNode(
            team_graph_id=team.id,
            role_name=end["kind"],
            kind="terminal",
            model=None,
            engine=None,
            prompt=None,
            position=place(end["id"], k),
            config={"terminal_kind": end["kind"]},
            edits_allowed=False,
        )
        session.add(node)
        session.flush()
        new_ids[end["id"]] = node.id
        k += 1
    for route in data.get("routes") or []:
        session.add(
            Edge(
                team_graph_id=team.id,
                source_node_id=new_ids[route["from"]],
                target_node_id=new_ids[route["to"]],
                edge_type=route.get("type") or "work",
                conditions=_conditions(route),
            )
        )
    session.flush()
    fixes = []
    for row in rows:
        if not row.get("fix"):
            continue
        fixes.append(
            {
                "key": row["key"],
                "text": _fix_text(row),
                "action": row.get("action") or "open_team",
                "target": row.get("target"),
                "node_ids": [str(i) for n in row.get("agents") or [] for i in by_name.get(n, [])],
            }
        )
    return team.id, fixes


def _fix_text(row: dict) -> str:
    key = row["key"]
    if key == "connector:github":
        return "Sign in to GitHub"
    if key.startswith("connector:"):
        return f"Sign in to {row['title'].split(' isn’t')[0]}"
    if key.startswith(("tool:", "skill:")):
        return f"Add {row['target']} or remove it"
    if key.startswith("model:"):
        return f"Add a key for {row['target']}, or pick another model"
    if key.startswith("secret:"):
        return f"Add the secret {row['target']}"
    if key.startswith("domain:"):
        return f"Pick a Domain for {', '.join(row.get('agents') or ['the query'])}"
    return row["title"]


def import_note(fixes: list[dict]) -> str | None:
    if any(f["key"] == "graph" for f in fixes):
        return "The team can’t run until the canvas is changed: “Can’t run yet” above it says what."
    if any(f["key"].startswith("model:") for f in fixes):
        return "The team can’t run until each model has a key here, or you pick another model."
    if any(f["key"] == "connector:github" for f in fixes):
        return "You can run the team now. It can’t open a pull request until GitHub is signed in."
    if fixes:
        return "You can run the team now; fix these before it needs them."
    return None


def _tool_config(agent: dict, have: dict) -> dict | None:
    library = [str(have["tools"][t]) for t in agent.get("tools") or [] if t in have["tools"]]
    connectors = []
    for grant in agent.get("connectors") or []:
        key = grant.get("connector") if isinstance(grant, dict) else grant
        connection = have["connections"].get(key)
        if connection is not None:
            # Read-only, always: a shared file never gets to change things in your accounts; the
            # check says when the file asked for more, and the agent's panel can allow it.
            connectors.append({"id": str(connection[0])})
    tv: dict = {}
    if library:
        tv["library"] = library
    off = [t for t in agent.get("tools_off") or [] if isinstance(t, str)]
    if off:
        tv["servers"] = {t: {"enabled": False} for t in off}
    if connectors:
        tv["connectors"] = connectors
    domains = agent.get("domains")
    if domains == "all":
        tv["domains"] = True
    elif isinstance(domains, list):
        found = [str(have["domains"][d]) for d in domains if d in have["domains"]]
        if found:
            tv["domains"] = found
    return {"tvashtr": tv} if tv else None


def _skills(agent: dict, have: dict) -> list | None:
    out: list = []
    for entry in agent.get("skills") or []:
        if entry == "project-rules":
            out.append({"type": "project_rules"})
            continue
        if isinstance(entry, str):
            if entry in have["skills"]:
                out.append({"type": "library", "id": str(have["skills"][entry])})
            continue
        if not isinstance(entry, dict):
            continue
        extra = {k: entry[k] for k in ("mode", "triggers") if entry.get(k)}
        if "inline" in entry:
            out.append(
                {
                    "type": "inline",
                    "name": entry.get("name") or "skill",
                    "content": entry["inline"],
                    **extra,
                }
            )
        elif "repo" in entry:
            repo = _github_repo(entry["repo"])
            if repo is None:
                continue  # the Toolkit only takes GitHub sources; the check says it's left out
            item = {"type": "repo", "url": repo}
            for key in ("ref", "filter"):
                if entry.get(key):
                    item[key] = entry[key]
            out.append({**item, **extra})
        elif entry.get("name") in have["skills"]:
            out.append({"type": "library", "id": str(have["skills"][entry["name"]]), **extra})
    return out or None
