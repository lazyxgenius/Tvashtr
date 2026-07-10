"""Deterministic **guardrail gate** checks — the first automatic (no-human) gate disposition
(M-rails C8).

A guardrail gate is an ordinary ``kind="gate"`` node whose ``config.gate_kind`` names a
DETERMINISTIC check instead of a human approval. The executor's gate arm runs the check against
the run's workspace and auto-emits ``approved`` / ``rejected`` — routed through the SAME
``next_node`` machinery a human gate uses, with NO ``DBOS.recv`` pause. The verdict is produced by
a recorded ``@DBOS.step`` (:func:`guardrail_gate_step`) so a crash-resume replays the SAME
disposition without re-scanning the (possibly-mutated) filesystem.

This slice ships one check, ``secret_leak_scan``: it walks the workspace's text files for
high-signal secret shapes (AWS keys, private-key blocks, provider API-key/token shapes, and a
conservative labelled-assignment pattern) and REJECTS on the first hit — naming the offending file
+ the pattern that matched, but NEVER echoing the secret itself. The bar is deliberately
high-signal / low-false-positive: shape-based patterns fire unconditionally; the one generic
labelled pattern skips obvious placeholders.

Imports NEITHER ``litellm`` NOR ``openhands`` (only stdlib + ``dbos``), exactly like
:mod:`tvashtr.control_plane.gates` — so ``team_run`` stays openhands-free at import.
"""

import fnmatch
import json
import os
import re
import subprocess
from pathlib import Path

from dbos import DBOS

# The set of ``config.gate_kind`` values the executor's gate arm dispatches DETERMINISTICALLY (no
# human ``wait_at_gate``). Any other / absent kind stays the human-approval path, byte-identical.
GUARDRAIL_GATE_KINDS: frozenset[str] = frozenset(
    {"secret_leak_scan", "diff_touches_forbidden_paths", "output_schema_check"}
)

# Directories never worth scanning (VCS internals, dependency/build caches) — skipped wholesale
# for speed AND to avoid false positives from vendored fixtures. Matched on the directory basename.
_SKIP_DIRS: frozenset[str] = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        "node_modules",
        "__pycache__",
        ".venv",
        "venv",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        "dist",
        "build",
        ".next",
        ".cache",
    }
)

# Per-file byte cap: a leaked credential lives near the top of a config/source file, so reading the
# first chunk is enough and bounds the walk's cost on a large repo.
_MAX_BYTES = 512 * 1024

# High-signal secret shapes. ORDER is stable so the first-hit report is deterministic. Each entry is
# ``(name, compiled_regex)``; ``name`` is what the redacted reason cites (never the matched text).
# The shape-based patterns (all but ``generic-secret-assignment``) fire unconditionally — their
# shape alone is high-signal. ``generic-secret-assignment`` additionally rejects obvious
# placeholders (see :func:`_is_placeholder`) to keep the false-positive bar low.
_SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    # PEM private-key blocks (RSA/EC/OpenSSH/DSA/PGP or bare) — zero false positives.
    ("private-key", re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----")),
    # AWS access key id (AKIA/ASIA/AGPA/AIDA/AROA/…) — a fixed 20-char shape.
    (
        "aws-access-key-id",
        re.compile(r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b"),
    ),
    # OpenAI / Stripe-style ``sk-`` (and ``sk-proj-``) secret keys.
    ("openai-secret-key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b")),
    # GitHub personal-access / app tokens.
    (
        "github-token",
        re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b"),
    ),
    # Slack tokens.
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    # Google API keys.
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    # HTTP Bearer tokens (≥20 chars of token material after the scheme).
    ("bearer-token", re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}")),
    # A labelled long secret assignment: ``api_key = "…"`` / ``AUTH_TOKEN: …`` etc. Placeholder-
    # filtered (below) so ``api_key = "YOUR_KEY_HERE"`` does not trip it.
    (
        "generic-secret-assignment",
        re.compile(
            r"(?i)(?:api[_-]?key|apikey|secret[_-]?key|secret|access[_-]?token|auth[_-]?token|"
            r"client[_-]?secret|password|passwd)"
            r"['\"]?\s*[:=]\s*['\"]?([A-Za-z0-9_\-./+]{20,})"
        ),
    ),
)

# Substrings that mark a captured generic-assignment value as an obvious placeholder, not a real
# leak — case-insensitive. Keeps the ONE non-shape pattern's false-positive bar low.
_PLACEHOLDER_MARKERS: tuple[str, ...] = (
    "your",
    "example",
    "placeholder",
    "changeme",
    "change-me",
    "dummy",
    "sample",
    "redacted",
    "xxxx",
    "todo",
    "fixme",
    "<",
    "${",
    "{{",
)


def _is_placeholder(value: str) -> bool:
    """True when a generic-assignment captured ``value`` is an obvious non-secret placeholder."""
    low = value.lower()
    return any(marker in low for marker in _PLACEHOLDER_MARKERS)


def _looks_binary(chunk: bytes) -> bool:
    """A NUL byte in the leading chunk ⇒ treat the file as binary (skip — no text secrets)."""
    return b"\x00" in chunk


def _scan_text(text: str) -> str | None:
    """Return the NAME of the first pattern that matches ``text`` (patterns in declared order), or
    ``None``. The generic labelled pattern is skipped when its captured value is a placeholder."""
    for name, pattern in _SECRET_PATTERNS:
        for match in pattern.finditer(text):
            if name == "generic-secret-assignment" and _is_placeholder(match.group(1)):
                continue
            return name
    return None


def secret_leak_scan(workspace: str) -> tuple[str, str | None]:
    """Deterministically scan ``workspace`` for leaked secrets.

    Walks the workspace's text files (sorted, VCS/build dirs skipped, binaries + oversize files
    skipped) and tests each against the curated :data:`_SECRET_PATTERNS`. Returns:

    * ``("rejected", reason)`` on the FIRST offending file — ``reason`` names the
      workspace-relative file and the pattern that matched (e.g. ``"potential secret in
      config/creds.env (matched: aws-access-key-id)"``); the secret VALUE is never included.
    * ``("approved", None)`` when nothing matches.

    Pure + deterministic (sorted walk, ordered patterns) so a caller can record the verdict once and
    replay it verbatim. A missing workspace path scans nothing ⇒ ``approved``."""
    root = Path(workspace)
    if not root.is_dir():
        return "approved", None

    for dirpath, dirnames, filenames in os.walk(root):
        # Prune skip-dirs in place (and keep the walk order deterministic).
        dirnames[:] = sorted(d for d in dirnames if d not in _SKIP_DIRS)
        for filename in sorted(filenames):
            path = Path(dirpath) / filename
            try:
                if path.is_symlink() or not path.is_file():
                    continue
                with open(path, "rb") as fh:
                    raw = fh.read(_MAX_BYTES)
            except OSError:
                continue
            if _looks_binary(raw[:1024]):
                continue
            hit = _scan_text(raw.decode("utf-8", errors="ignore"))
            if hit is not None:
                rel = os.path.relpath(path, root)
                return "rejected", f"potential secret in {rel} (matched: {hit})"
    return "approved", None


# ---- M-rails C9 kind: diff_touches_forbidden_paths -------------------------


def _git_changed_files(workspace: str) -> list[str]:
    """The agent's changed paths in ``workspace`` (name-only), via git — a SORTED, de-duplicated
    list of workspace-relative POSIX paths. The union of tracked modifications/deletions vs ``HEAD``
    (``git diff --name-only HEAD``) and NEW untracked files respecting ``.gitignore``
    (``git ls-files --others --exclude-standard``) — together the full "since the base commit" set
    the agent produced (staged or not) BEFORE the ship commit. A non-repo path or any git error
    yields ``[]`` (nothing detectable ⇒ the caller approves)."""
    if not (Path(workspace) / ".git").exists():
        return []
    changed: set[str] = set()
    for args in (
        ("diff", "--name-only", "HEAD"),
        ("ls-files", "--others", "--exclude-standard"),
    ):
        proc = subprocess.run(
            ["git", "-C", workspace, "-c", "core.quotePath=false", *args],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0:
            changed.update(line for line in proc.stdout.splitlines() if line)
    return sorted(changed)


def diff_touches_forbidden_paths(workspace: str, config: dict) -> tuple[str, str | None]:
    """Deterministically REJECT if the agent's git diff touches a forbidden path.

    ``config["forbidden_paths"]`` is a list of ``fnmatch`` globs (e.g. ``".github/**"``,
    ``"infra/**"``, ``"*.pem"``; ``*`` matches ``/`` too, so a directory prefix forbids its whole
    subtree). Returns ``("rejected", reason)`` on the FIRST offending change — the reason names the
    workspace-relative file + the matched glob, NEVER the file's contents — else
    ``("approved", None)``. Deterministic: changed files are tested in SORTED order, globs in
    configured order, so the first-hit report is stable. No forbidden globs (or no detectable diff)
    ⇒ approve."""
    globs = [g for g in (config.get("forbidden_paths") or []) if isinstance(g, str) and g.strip()]
    if not globs:
        return "approved", None
    for path in _git_changed_files(workspace):  # sorted → deterministic first hit
        for glob in globs:  # configured order
            if fnmatch.fnmatchcase(path, glob):
                return "rejected", f"changed file {path} matches forbidden path {glob}"
    return "approved", None


# ---- M-rails C9 kind: output_schema_check ----------------------------------


def _type_ok(value: object, type_name: str) -> bool:
    """True if ``value`` satisfies a single JSON-Schema ``type`` name. ``bool`` is excluded from the
    numeric types (a JSON boolean is not an integer/number)."""
    if type_name == "object":
        return isinstance(value, dict)
    if type_name == "array":
        return isinstance(value, list)
    if type_name == "string":
        return isinstance(value, str)
    if type_name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if type_name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if type_name == "boolean":
        return isinstance(value, bool)
    if type_name == "null":
        return value is None
    return True  # an unknown/unsupported constraint is not enforced (never a false reject)


def _join_path(path: str, key: str) -> str:
    return key if not path else f"{path}.{key}"


def _schema_violation(value: object, schema: object, path: str) -> str | None:
    """Return the dotted path of the FIRST schema violation in ``value`` under ``schema``, or
    ``None`` if it validates. A deterministic SUBSET validator (stdlib-only, no ``jsonschema``
    dependency): ``type`` (incl. a list of types), ``enum``, object ``required`` + ``properties``,
    and array ``items``. Traversal order is fixed — ``required`` in listed order, then
    ``properties`` in SORTED key order, then array items by index — so the first-failure report is
    stable. Only KEY names/paths are ever surfaced, never values (the redaction rule)."""
    if not isinstance(schema, dict):
        return None
    declared = schema.get("type")
    if declared is not None:
        names = declared if isinstance(declared, list) else [declared]
        if not any(_type_ok(value, str(n)) for n in names):
            return path or "(root)"
    if "enum" in schema and isinstance(schema["enum"], list) and value not in schema["enum"]:
        return path or "(root)"
    if isinstance(value, dict):
        for key in schema.get("required", []) or []:
            if key not in value:
                return _join_path(path, key)
        props = schema.get("properties")
        if isinstance(props, dict):
            for key in sorted(props):
                if key in value:
                    hit = _schema_violation(value[key], props[key], _join_path(path, key))
                    if hit is not None:
                        return hit
    if isinstance(value, list):
        items = schema.get("items")
        if isinstance(items, dict):
            for i, item in enumerate(value):
                hit = _schema_violation(item, items, f"{path}[{i}]")
                if hit is not None:
                    return hit
    return None


def output_schema_check(workspace: str, config: dict) -> tuple[str, str | None]:
    """Deterministically REJECT if a required output file is missing / not JSON / off-schema.

    ``config["output_file"]`` is a workspace-relative path; ``config["schema"]`` is a JSON-Schema
    subset (see :func:`_schema_violation`). Returns ``("rejected", reason)`` when the file is
    missing or unreadable, is not valid JSON, or violates the schema — the reason names the file
    (and, for a schema failure, the FIRST failing key/path), NEVER the file's contents or the
    offending value — else ``("approved", None)``. No ``output_file`` configured ⇒ nothing to check
    ⇒ approve."""
    output_file = config.get("output_file")
    if not isinstance(output_file, str) or not output_file.strip():
        return "approved", None
    schema = config.get("schema") or {}
    path = Path(workspace) / output_file
    if not path.is_file():
        return "rejected", f"required output file {output_file} is missing"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):  # ValueError covers JSONDecodeError + UnicodeDecodeError
        return "rejected", f"output file {output_file} is not valid JSON"
    violation = _schema_violation(data, schema, "")
    if violation is not None:
        return "rejected", f"output file {output_file} fails schema at {violation}"
    return "approved", None


@DBOS.step()
def guardrail_gate_step(
    run_id: str, node_id: str, gate_kind: str, workspace: str | None, config: dict
) -> dict:
    """Recorded deterministic guardrail verdict for a gate node (M-rails C8).

    Runs the ``gate_kind`` check against ``workspace`` and returns
    ``{"resolution": "approved"|"rejected", "reasons": str | None}`` — the SAME shape the human
    ``wait_at_gate`` returns for ``resolution``, so the executor routes both identically. Being a
    ``@DBOS.step`` the verdict is CHECKPOINTED: a crash-resume replays the recorded disposition
    instead of re-scanning a filesystem that may have changed, keeping the walk deterministic.

    ``workspace is None`` (a guardrail gate reached before any agent node created a workspace) ⇒
    nothing to scan ⇒ ``approved``. An unrecognized ``gate_kind`` (unreachable — the gate arm
    gates on :data:`GUARDRAIL_GATE_KINDS`) is defensively approved rather than blocking the walk."""
    if workspace is None:
        return {"resolution": "approved", "reasons": None}
    if gate_kind == "secret_leak_scan":
        resolution, reasons = secret_leak_scan(workspace)
    elif gate_kind == "diff_touches_forbidden_paths":
        resolution, reasons = diff_touches_forbidden_paths(workspace, config or {})
    elif gate_kind == "output_schema_check":
        resolution, reasons = output_schema_check(workspace, config or {})
    else:
        resolution, reasons = "approved", None
    DBOS.logger.info(
        f"guardrail_gate run_id={run_id} node_id={node_id} kind={gate_kind} resolution={resolution}"
    )
    return {"resolution": resolution, "reasons": reasons}
