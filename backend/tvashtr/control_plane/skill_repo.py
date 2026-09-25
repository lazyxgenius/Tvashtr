"""Skills from a GitHub repo (revamp B-TOOLKIT, "Add from GitHub"): parse a repo URL, scan a repo at
a ref for the SKILL.md files the SDK loader would load, and import the chosen ones as library rows.

Openhands-free at import (stdlib + the app's own modules only).
"""

from __future__ import annotations

import base64
import re
import uuid
from urllib.parse import quote

from sqlalchemy import select

from tvashtr.control_plane import github_app, tool_usage, toolkit
from tvashtr.control_plane.toolkit import ToolkitError
from tvashtr.db import session_scope
from tvashtr.models import GithubInstallation, SkillLibraryItem

_OWNER = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})"
_REPO = r"[A-Za-z0-9._-]{1,100}"
_URL_RE = re.compile(
    rf"^(?:(?:https?://)?(?:www\.)?github\.com/)?(?P<owner>{_OWNER})/(?P<repo>{_REPO}?)"
    r"(?:\.git)?/?$"
)


def parse_github_repo(url: object) -> tuple[str, str] | None:
    """``(owner, name)`` from ``https://github.com/<o>/<r>`` (``.git`` / trailing slash / no scheme
    / bare ``<o>/<r>`` accepted), or ``None`` when it isn't a GitHub repo URL."""
    if not isinstance(url, str):
        return None
    match = _URL_RE.match(url.strip())
    if match is None:
        return None
    owner, repo = match.group("owner"), match.group("repo")
    if repo.endswith(".git"):
        repo = repo[: -len(".git")]
    if not repo or repo in (".", ".."):
        return None
    return owner, repo


def repo_url(owner: str, repo: str) -> str:
    """The canonical ``https://github.com/<owner>/<repo>`` form stored on a repo skill source."""
    return f"https://github.com/{owner}/{repo}"


# ---- scan: which skills a repo holds at a ref ----------------------------------------------------

NOT_FOUND = (
    "We couldn’t find that repo. Check the name, or install the GitHub App on it if it’s private."
)
_MAX_FILES = 50  # frontmatter reads per scan (unauthenticated calls are capped at 60/h per IP)
_STATUS = re.compile(r"HTTP (\d{3})")


def _status(exc: github_app.GithubAppError) -> int | None:
    """The HTTP status in a ``GithubAppError`` (``None`` = GitHub unreachable)."""
    match = _STATUS.search(str(exc))
    return int(match.group(1)) if match else None


def _unreachable() -> ToolkitError:
    return ToolkitError(
        502, {"code": "github_unreachable", "message": "GitHub didn’t answer. Try again."}
    )


def _get(path: str, token: str | None) -> dict | list:
    return github_app._http("GET", f"{github_app._GITHUB_API}{path}", token=token)


def _installation_ids(owner_id: uuid.UUID) -> list[int]:
    with session_scope() as session:
        return list(
            session.execute(
                select(GithubInstallation.installation_id).where(
                    GithubInstallation.owner_id == owner_id
                )
            ).scalars()
        )


def _open_repo(owner_id: uuid.UUID, owner: str, name: str) -> tuple[dict, str | None]:
    """``(repo, token)``: the repo read with one of the owner's App installation tokens (so a
    private repo the App can see works), else unauthenticated (public repos). 404 when nobody can
    see it; 502 when GitHub is unreachable."""
    tokens: list[str | None] = []
    for installation_id in _installation_ids(owner_id):
        try:
            tokens.append(github_app.get_installation_token(installation_id))
        except github_app.GithubAppError:
            continue  # a dead installation / an unconfigured App — try the next door
    tokens.append(None)
    for token in tokens:
        try:
            repo = _get(f"/repos/{owner}/{name}", token)
        except github_app.GithubAppError as exc:
            if _status(exc) is None:
                raise _unreachable() from None
            continue
        if isinstance(repo, dict):
            return repo, token
    raise ToolkitError(404, {"code": "repo_not_found", "message": NOT_FOUND})


def _skill_files(tree: list) -> list[tuple[str, str]]:
    """``(path, default name)`` for every file the SDK loader reads from ``<repo>/skills/``:
    ``skills/<dir>/SKILL.md`` (named after the dir) and any other ``skills/**.md`` outside those
    dirs except README.md (named after the file stem)."""
    blobs = [e.get("path") for e in tree if isinstance(e, dict) and e.get("type") == "blob"]
    paths = [p for p in blobs if isinstance(p, str) and p.startswith("skills/")]
    skill_dirs: dict[str, str] = {}
    for p in paths:
        parts = p.split("/")
        if len(parts) == 3 and parts[2].lower() == "skill.md":
            skill_dirs[parts[1]] = p
    out = [(path, d) for d, path in skill_dirs.items()]
    for p in paths:
        parts = p.split("/")
        name = parts[-1]
        if not name.lower().endswith(".md") or name == "README.md" or name.lower() == "skill.md":
            continue
        if len(parts) >= 3 and parts[1] in skill_dirs:
            continue  # reference material inside an AgentSkills dir
        out.append((p, name[: -len(".md")]))
    return out


def _frontmatter(text: str) -> dict[str, str]:
    """``name`` / ``description`` from a markdown file's YAML-ish frontmatter (dependency-free)."""
    out: dict[str, str] = {}
    stripped = text.lstrip()
    if not stripped.startswith("---"):
        return out
    end = stripped.find("\n---", 3)
    if end == -1:
        return out
    for line in stripped[3:end].splitlines():
        key, sep, val = line.partition(":")
        key = key.strip()
        if sep and key in ("name", "description"):
            val = val.strip().strip('"').strip("'")
            if val:
                out[key] = val
    return out


def _read_meta(owner: str, name: str, path: str, sha: str, token: str | None) -> dict[str, str]:
    try:
        body = _get(f"/repos/{owner}/{name}/contents/{quote(path)}?ref={sha}", token)
        raw = base64.b64decode(body.get("content", "")).decode("utf-8", "replace")
    except (github_app.GithubAppError, ValueError, AttributeError):
        return {}  # rate limit / odd file: fall back to the path-derived name
    return _frontmatter(raw)


def library_name(skill_name: str) -> str:
    """The library row name for an imported skill: kebab-case, at most 64 characters."""
    slug = re.sub(r"[^a-z0-9]+", "-", skill_name.lower()).strip("-")
    return slug[:64].strip("-")


def scan_repo(owner_id: uuid.UUID, url: object, ref: object = None) -> dict:
    """``POST /api/skill-library/scan``: the skills a GitHub repo holds at ``ref`` (default: its
    default branch), with the resolved commit — ``{repo, url, ref, sha, short_sha,
    skills:[{name, path, description, in_library}]}``."""
    parsed = parse_github_repo(url)
    if parsed is None:
        raise ToolkitError(
            422,
            {
                "code": "invalid_url",
                "message": "Use a GitHub repo URL, like https://github.com/org/skills.",
            },
        )
    owner, name = parsed
    repo, token = _open_repo(owner_id, owner, name)
    owner, name = (repo.get("full_name") or f"{owner}/{name}").split("/", 1)
    ref = ref.strip() if isinstance(ref, str) and ref.strip() else None
    ref = ref or repo.get("default_branch") or "main"
    try:
        commit = _get(f"/repos/{owner}/{name}/commits/{quote(ref, safe='')}", token)
        sha = commit.get("sha") if isinstance(commit, dict) else None
        if not sha:
            raise github_app.GithubAppError("GitHub GET commit -> HTTP 404")
        tree = _get(f"/repos/{owner}/{name}/git/trees/{sha}?recursive=1", token)
    except github_app.GithubAppError as exc:
        if _status(exc) is None:
            raise _unreachable() from None
        raise ToolkitError(
            422,
            {"code": "ref_not_found", "message": f"We couldn’t find {ref} in that repo."},
        ) from None
    entries = tree.get("tree") if isinstance(tree, dict) else None
    files = _skill_files(entries if isinstance(entries, list) else [])
    if not files:
        raise ToolkitError(
            422,
            {
                "code": "no_skills",
                "message": "No skills found. Skills live in a skills/ folder, like "
                "skills/review/SKILL.md.",
            },
        )
    with session_scope() as session:
        taken = set(
            session.execute(
                select(SkillLibraryItem.name).where(SkillLibraryItem.owner_id == owner_id)
            ).scalars()
        )
    skills = []
    for idx, (path, default_name) in enumerate(files):
        meta = _read_meta(owner, name, path, sha, token) if idx < _MAX_FILES else {}
        skill_name = meta.get("name") or default_name
        skills.append(
            {
                "name": skill_name,
                "path": path,
                "description": meta.get("description"),
                "in_library": library_name(skill_name) in taken,
            }
        )
    skills.sort(key=lambda s: s["name"])
    return {
        "repo": f"{owner}/{name}",
        "url": repo_url(owner, name),
        "ref": ref,
        "sha": sha,
        "short_sha": sha[:7],
        "skills": skills,
    }


# ---- import: one library row per chosen skill ----------------------------------------------------

IMPORT_CONFLICTS = ("skip", "replace", "error")


def _exact_glob(name: str) -> str:
    """``name`` as an fnmatch pattern that matches only itself (``*``/``?``/``[`` escaped)."""
    return re.sub(r"([*?\[])", r"[\1]", name)


def import_skills(
    owner_id: uuid.UUID,
    url: object,
    ref: object,
    sha: object,
    skills: object,
    mode: object = "agent",
    triggers: object = None,
    on_conflict: str = "skip",
) -> dict:
    """``POST /api/skill-library/import``: one library row per chosen skill, in ONE transaction.
    Each row is a repo source pinned to the scanned commit — ``{"type":"repo", url, ref,
    "filter": <that skill's exact name>, mode, "resolved_sha": sha}`` — named in kebab-case. A name
    the account already has is skipped (``skip``, default), overwritten (``replace``) or a 409 that
    writes nothing (``error``). Returns ``{added:[item…], skipped:[name…]}``."""
    if on_conflict not in IMPORT_CONFLICTS:
        raise ToolkitError(422, "on_conflict must be skip, replace or error.")
    if not isinstance(skills, list) or not [s for s in skills if isinstance(s, str) and s.strip()]:
        raise ToolkitError(422, "Pick at least one skill.")
    if not (isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{40}", sha)):
        raise ToolkitError(422, "sha must be the full 40-character commit SHA from the scan.")
    base = {"type": "repo", "url": url, "ref": ref, "mode": mode, "resolved_sha": sha}
    if triggers is not None:
        base["triggers"] = triggers
    base = toolkit.check_skill_source(base, "")  # url/ref/mode/triggers rules
    wanted: dict[str, str] = {}
    for raw in skills:
        if not isinstance(raw, str) or not raw.strip():
            continue
        row_name = library_name(raw.strip())
        if not row_name:
            raise ToolkitError(422, f"{raw} can't be used as a skill name.")
        wanted.setdefault(row_name, raw.strip())
    with session_scope() as session:
        existing = {
            r.name: r
            for r in session.execute(
                select(SkillLibraryItem).where(SkillLibraryItem.owner_id == owner_id)
            ).scalars()
        }
        conflicts = [n for n in wanted if n in existing]
        if conflicts and on_conflict == "error":
            raise ToolkitError(
                409,
                {
                    "code": "name_taken",
                    "message": "You already have "
                    + ("a skill called " if len(conflicts) == 1 else "skills called ")
                    + ", ".join(conflicts)
                    + ".",
                    "conflicts": conflicts,
                },
            )
        written: list[SkillLibraryItem] = []
        skipped: list[str] = []
        for row_name, skill_name in wanted.items():
            source = {**base, "filter": _exact_glob(skill_name)}
            if row_name in existing:
                if on_conflict == "skip":
                    skipped.append(row_name)
                    continue
                existing[row_name].source = source
                written.append(existing[row_name])
                continue
            row = SkillLibraryItem(owner_id=owner_id, name=row_name, source=source)
            session.add(row)
            written.append(row)
        session.flush()
        usage = tool_usage.skill_usage(session, owner_id)
        added = [toolkit.skill_item(r, usage.get(r.id, [])) for r in written]
    return {"added": added, "skipped": skipped}
