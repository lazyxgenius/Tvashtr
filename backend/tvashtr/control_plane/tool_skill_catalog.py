"""Static built-in Tool catalog + Skill presets (free / no-login MVP).

Mirrors ``PROVIDER_CATALOGUE`` / ``public_provider_catalogue``: a module const (no DB, no
network) served read-only to the FE. Attach is opt-in via the existing account library paths
(``/api/tool-library``, ``/api/skill-library`` → ``tvashtr.library`` / ``{type:library,id}``).

NULL ``tool_config`` / ``skills`` stay inert — this module never injects into a run.
"""

from __future__ import annotations

from pathlib import Path

_SKILLS_ROOT = Path(__file__).resolve().parent.parent / "skills"


def _read_skill_md(name: str) -> str:
    return (_SKILLS_ROOT / name / "SKILL.md").read_text(encoding="utf-8")


# access: "free" | "needs_secret" | "needs_github_app"
TOOL_CATALOGUE: dict[str, dict] = {
    "fetch": {
        "key": "fetch",
        "name": "fetch",
        "title": "Web fetch",
        "description": "Fetch HTTP URLs via stdio ``uvx mcp-server-fetch``. No login.",
        "access": "free",
        "secret_names": [],
        "attachable": True,
        "server_config": {"command": "uvx", "args": ["mcp-server-fetch"]},
    },
    "github": {
        "key": "github",
        "name": "github",
        "title": "GitHub (PAT)",
        "description": "GitHub MCP via a personal access token stored as an MCP secret.",
        "access": "needs_secret",
        "secret_names": ["GITHUB_TOKEN"],
        "attachable": True,
        "server_config": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"},
        },
    },
    "github-app": {
        "key": "github-app",
        "name": "github-app",
        "title": "GitHub App repos",
        "description": (
            "Hosted runs use your Tvashtr GitHub App installation — install the App, "
            "then launch against an App repo."
        ),
        "access": "needs_github_app",
        "secret_names": [],
        "attachable": False,
        "server_config": {},
    },
}


def _inline_preset(key: str, title: str, description: str, skill_dir: str) -> dict:
    content = _read_skill_md(skill_dir)
    return {
        "key": key,
        "name": key,
        "title": title,
        "description": description,
        "access": "free",
        "attachable": True,
        "source": {
            "type": "inline",
            "name": key,
            "content": content,
            "mode": "always",
        },
    }


SKILL_PRESETS: dict[str, dict] = {
    "caveman": _inline_preset(
        "caveman",
        "Caveman (terse)",
        "Vendored ultra-compressed output style that keeps technical substance.",
        "caveman",
    ),
    "tdd": _inline_preset(
        "tdd",
        "TDD discipline",
        "Red → green → refactor. Smallest code that makes the failing test pass.",
        "tdd",
    ),
    "yagni": _inline_preset(
        "yagni",
        "YAGNI",
        "Smallest change that solves the asked problem — no speculative extras.",
        "yagni",
    ),
}


def access_badge(access: str, secret_names: list[str] | None = None) -> str:
    """Shelf copy for a catalogue row."""
    if access == "free":
        return "Free"
    if access == "needs_github_app":
        return "Needs GitHub App"
    names = secret_names or []
    if names:
        return "Needs " + ", ".join(f"${{{n}}}" for n in names)
    return "Needs ${SECRET}"


def public_tool_catalogue() -> list[dict]:
    """Serializable public tool catalogue (served on ``GET /api/tool-catalog``)."""
    out: list[dict] = []
    for entry in TOOL_CATALOGUE.values():
        secrets = list(entry.get("secret_names") or [])
        out.append(
            {
                "key": entry["key"],
                "name": entry["name"],
                "title": entry["title"],
                "description": entry["description"],
                "access": entry["access"],
                "secret_names": secrets,
                "badge": access_badge(entry["access"], secrets),
                "attachable": bool(entry["attachable"]),
                "server_config": dict(entry["server_config"] or {}),
            }
        )
    return out


def public_skill_presets() -> list[dict]:
    """Serializable public skill presets (served on ``GET /api/skill-presets``)."""
    out: list[dict] = []
    for entry in SKILL_PRESETS.values():
        source = entry["source"]
        out.append(
            {
                "key": entry["key"],
                "name": entry["name"],
                "title": entry["title"],
                "description": entry["description"],
                "access": entry["access"],
                "badge": access_badge(entry["access"], []),
                "attachable": bool(entry["attachable"]),
                "source": {
                    "type": source["type"],
                    "name": source["name"],
                    "content": source["content"],
                    "mode": source["mode"],
                },
            }
        )
    return out
