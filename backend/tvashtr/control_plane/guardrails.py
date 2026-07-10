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

import os
import re
from pathlib import Path

from dbos import DBOS

# The set of ``config.gate_kind`` values the executor's gate arm dispatches DETERMINISTICALLY (no
# human ``wait_at_gate``). Any other / absent kind stays the human-approval path, byte-identical.
GUARDRAIL_GATE_KINDS: frozenset[str] = frozenset({"secret_leak_scan"})

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


@DBOS.step()
def guardrail_gate_step(run_id: str, node_id: str, gate_kind: str, workspace: str | None) -> dict:
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
    else:
        resolution, reasons = "approved", None
    DBOS.logger.info(
        f"guardrail_gate run_id={run_id} node_id={node_id} kind={gate_kind} resolution={resolution}"
    )
    return {"resolution": resolution, "reasons": reasons}
