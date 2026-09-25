"""Human memory write-control — promote / reject of memory rows (M-memory S4).

The place a user acts on the quarantined ``pending_review`` negatives S2 wrote (and on any active
fact) — the fourth memory slice. Two owner-scoped operations, both REUSING S2's code-authoritative
Consolidate (imported from :mod:`memory_distill`), never a blind status flip:

* :func:`reject` — a ``pending_review`` OR ``active`` row becomes a **TOMBSTONE**
  (``status='rejected'`` + ``invalid_at``), NOT a delete. A tombstone SUPPRESSES re-proposal: the
  distiller's + agent-remember's consolidation drops a new same-sign candidate that matches it (see
  ``memory_distill._apply_one``'s tombstone-drop). This is what makes a reject STICK.
* :func:`promote` — a ``pending_review`` OR ``rejected`` row becomes ``active`` VIA Consolidate: a
  same-sign active duplicate ⇒ confirm the existing one + retire the promoted row
  as merged (no dup);
  an opposite-sign active fact ⇒ supersede it (retire) + activate the promoted row; else ⇒ activate.

The deliberate hard ``delete`` (true removal / privacy) stays in :mod:`memory.delete_memory`,
unchanged. Kept openhands-free at import (pure DB + the shared consolidation primitives).
"""

import json
import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane.context_compiler import REMEMBER_FILENAME
from tvashtr.control_plane.credentials import NoCredentialError, resolve_owner_api_key
from tvashtr.control_plane.memory import _enrich, _parse_uuid, _to_dict, repo_key_for_run
from tvashtr.control_plane.memory_distill import (
    DUP_THRESHOLD,
    _as_list,
    _best_match,
    _owner_review_mode,
    _polarity_sign,
    _same_scope,
    remember_facts,
)
from tvashtr.db import session_scope
from tvashtr.models import NodeMemory, Run

logger = logging.getLogger(__name__)

# A hard read cap on the capture file — the deliberate-capture cap (``FACT_CAP``) applies at
# consolidation, but bound the parse too so a runaway file can never balloon the read.
_REMEMBER_READ_CAP = 100
# The workspace-relative capture path (the FALLBACK channel — see the module docstring). A
# TOP-LEVEL NON-HIDDEN sidecar (``REMEMBER_FILENAME``) so the docker greenfield pull (which drops
# hidden paths) still carries it to the host in EVERY sandbox mode.
_REMEMBER_REL_PATH = Path(REMEMBER_FILENAME)

# reject applies to a live fact (quarantined or active); a superseded/already-rejected row is beyond
# rejection (return None ⇒ 404). promote resurrects a quarantined or tombstoned fact.
_REJECTABLE = ("pending_review", "active")
_PROMOTABLE = ("pending_review", "rejected")
# requeue sends a kept, merged or discarded fact back to the Inbox (see :func:`requeue`).
_REQUEUEABLE = ("active", "superseded", "rejected", "pending_review")


def reject(owner_id: uuid.UUID, memory_id: str) -> dict | None:
    """Tombstone the owner's ``pending_review``/``active`` memory: ``status='rejected'`` +
    ``invalid_at=now()`` (a TOMBSTONE — it suppresses re-proposal, NOT a delete). Owner-scoped —
    returns ``None`` (⇒ 404) for an unknown/malformed id, another owner's row, or a row not in a
    rejectable state."""
    mid = _parse_uuid(memory_id)
    if mid is None:
        return None
    with session_scope() as session:
        row = session.execute(
            select(NodeMemory).where(
                NodeMemory.id == mid,
                NodeMemory.owner_id == owner_id,
                NodeMemory.status.in_(_REJECTABLE),
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        row.status = "rejected"
        row.invalid_at = datetime.now(UTC)
        session.flush()
        session.refresh(row)
        return _enrich(session, owner_id, [_to_dict(row)])[0]


def promote(owner_id: uuid.UUID, memory_id: str) -> dict | None:
    """Promote the owner's ``pending_review``/``rejected`` memory to ``active`` VIA
    Consolidate (never
    a blind flip). Re-runs S2's consolidation treating the promoted row as a fresh candidate vs the
    owner's current ACTIVE in-scope facts:

    * a SAME-sign active duplicate (cosine ≥ ``DUP_THRESHOLD``) ⇒ confirm the existing one
      (bump ``confirmation_count``) and retire the promoted row as MERGED (``status='superseded'`` +
      ``superseded_by`` the dup) — no second active row;
    * an OPPOSITE-sign active fact ⇒ supersede it (retire) and activate the promoted row;
    * else ⇒ activate the promoted row (``status='active'``, ``invalid_at=NULL``).

    Owner-scoped — ``None`` (⇒ 404) for an unknown/malformed id, another owner's row,
    or a row not in a promotable state (only ``pending_review``/``rejected`` promote —
    an already-active row 404s)."""
    mid = _parse_uuid(memory_id)
    if mid is None:
        return None
    now = datetime.now(UTC)
    with session_scope() as session:
        row = session.execute(
            select(NodeMemory).where(
                NodeMemory.id == mid,
                NodeMemory.owner_id == owner_id,
                NodeMemory.status.in_(_PROMOTABLE),
            )
        ).scalar_one_or_none()
        if row is None:
            return None

        # Consolidate the promoted row against the owner's ACTIVE facts at its EXACT scope. The
        # promoted row (pending/rejected) is definitionally excluded from the active set;
        # guard on id
        # anyway. A rejected tombstone does NOT self-block here — promote is the explicit human
        # override that resurrects it.
        active = [
            r
            for r in _same_scope(session, owner_id, row.repo_key, row.node_id, statuses=("active",))
            if r.id != row.id
        ]
        best, best_sim = _best_match(active, _as_list(row.embedding))
        if best is not None and best_sim >= DUP_THRESHOLD:
            row_sign = _polarity_sign(row.polarity)
            best_sign = _polarity_sign(best.polarity)
            if row_sign == best_sign:
                # SAME-sign dup already active ⇒ confirm it; retire the promoted row as merged.
                best.confirmation_count = (best.confirmation_count or 1) + 1
                row.status = "superseded"
                row.invalid_at = now
                row.superseded_by = best.id
                session.flush()
                session.refresh(best)
                merged = _enrich(session, owner_id, [_to_dict(best)])[0]
                return {**merged, "action": "promote_merged", "merged_id": str(row.id)}
            if {row_sign, best_sign} == {"pos", "neg"}:
                # OPPOSITE-sign active fact ⇒ supersede it (retire) + activate the promoted row.
                best.status = "superseded"
                best.invalid_at = now
                best.superseded_by = row.id
                row.status = "active"
                row.invalid_at = None
                session.flush()
                session.refresh(row)
                kept = _enrich(session, owner_id, [_to_dict(row)])[0]
                return {**kept, "action": "promote_supersede", "superseded": str(best.id)}

        # No consolidating match ⇒ plain activation.
        row.status = "active"
        row.invalid_at = None
        session.flush()
        session.refresh(row)
        return {**_enrich(session, owner_id, [_to_dict(row)])[0], "action": "promote"}


def requeue(owner_id: uuid.UUID, memory_id: str) -> dict | None:
    """Send the owner's memory back to the Inbox (``pending_review``) — the Undo of Keep and of
    Discard. Pass the id that was promoted or rejected (for a merge that is the promote response's
    ``merged_id``, not its ``id``). Reverses each outcome exactly:

    * ``promote`` (row ``active``) ⇒ ``pending_review``.
    * ``promote_supersede`` (row ``active``, it retired an opposite-sign fact) ⇒ ``pending_review``
      AND every fact it superseded (``superseded_by`` = this row, ``status='superseded'``) goes back
      to ``active`` (``invalid_at`` / ``superseded_by`` cleared).
    * ``promote_merged`` (row ``superseded`` into a same-sign active dup X) ⇒ ``pending_review``,
      ``invalid_at`` / ``superseded_by`` cleared, and X's ``confirmation_count`` drops by one
      (never below 1). A row superseded by an OPPOSITE-sign fact only returns to review; the fact
      that replaced it is left alone.
    * ``reject`` (row ``rejected``) ⇒ ``pending_review``, ``invalid_at`` cleared.
    * already ``pending_review`` ⇒ unchanged (idempotent, ``action: "already_pending"``).

    Returns the enriched row + ``action`` (``requeue`` / ``already_pending``), ``restored`` (ids
    re-activated) and ``unmerged_from`` (the dup whose confirmation was taken back, or ``None``).
    Owner-scoped — ``None`` (⇒ 404) for an unknown/malformed id or another owner's row."""
    mid = _parse_uuid(memory_id)
    if mid is None:
        return None
    with session_scope() as session:
        row = session.execute(
            select(NodeMemory).where(
                NodeMemory.id == mid,
                NodeMemory.owner_id == owner_id,
                NodeMemory.status.in_(_REQUEUEABLE),
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        if row.status == "pending_review":
            current = _enrich(session, owner_id, [_to_dict(row)])[0]
            return {**current, "action": "already_pending", "restored": [], "unmerged_from": None}

        restored: list[str] = []
        unmerged_from: str | None = None
        if row.status == "active":
            # Undo a supersede: the facts this one retired come back.
            retired = (
                session.execute(
                    select(NodeMemory).where(
                        NodeMemory.owner_id == owner_id,
                        NodeMemory.superseded_by == row.id,
                        NodeMemory.status == "superseded",
                    )
                )
                .scalars()
                .all()
            )
            for old in retired:
                old.status = "active"
                old.invalid_at = None
                old.superseded_by = None
                restored.append(str(old.id))
        elif row.status == "superseded" and row.superseded_by is not None:
            # Undo a merge: take the confirmation back from the same-sign dup it merged into.
            dup = session.execute(
                select(NodeMemory).where(
                    NodeMemory.id == row.superseded_by, NodeMemory.owner_id == owner_id
                )
            ).scalar_one_or_none()
            if dup is not None and _polarity_sign(dup.polarity) == _polarity_sign(row.polarity):
                dup.confirmation_count = max(1, (dup.confirmation_count or 1) - 1)
                unmerged_from = str(dup.id)

        row.status = "pending_review"
        row.invalid_at = None
        row.superseded_by = None
        session.flush()
        session.refresh(row)
        requeued = _enrich(session, owner_id, [_to_dict(row)])[0]
        return {
            **requeued,
            "action": "requeue",
            "restored": restored,
            "unmerged_from": unmerged_from,
        }


# ------------------------------------------------------------------ agent-remember ingest ----
#
# The FALLBACK channel for the deliberate agent-remember capture (M-memory S4; the PRIMARY live-MCP
# channel was infeasible — no MCP-hosting infra, the in-process gate binds no port). The edits-on
# worker APPENDS ``{"content", "polarity"?}`` JSON lines to ``<workspace>/TVASHTR_REMEMBER.jsonl``
# via its existing FileEditorTool (prompted by ``context_compiler``'s capture-protocol part); the
# control plane reads that host-side file at run-END (the workspace still exists on disk when the
# ship arm's distill hook fires) and routes each line through the SAME trusted Consolidate as any
# agent-remember (``memory_distill.remember_facts``). The sidecar is a TOP-LEVEL NON-HIDDEN file so
# the docker greenfield pull carries it to the host; it is excluded from ``run_diff`` + the ship
# commit, so the capture NEVER pollutes the reviewed diff.


def _read_captures(workspace: str) -> list[dict]:
    """Parse the run's ``TVASHTR_REMEMBER.jsonl`` into ``[{content, polarity?}]`` — one JSON object
    per line, skipping blank/malformed lines + blank-content objects, capped at
    :data:`_REMEMBER_READ_CAP`. Never raises (a bad file ⇒ ``[]``)."""
    path = Path(workspace) / _REMEMBER_REL_PATH
    if not path.exists():
        return []
    caps: list[dict] = []
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except (ValueError, TypeError):
            continue  # skip a malformed line — never let one bad line sink the ingest
        if isinstance(obj, dict) and str(obj.get("content") or "").strip():
            caps.append({"content": obj.get("content"), "polarity": obj.get("polarity")})
        if len(caps) >= _REMEMBER_READ_CAP:
            break
    return caps


def ingest_run_remembers(run_id: str, workspace: str) -> dict:
    """Read the run's deliberate agent-remember captures
    (``TVASHTR_REMEMBER.jsonl`` in ``workspace``)
    and route each through Consolidate
    (``memory_distill.remember_facts`` — trusted: active/repo-tier,
    or pending_review under the owner's review mode; tombstone-drop + dedup + cap applied).

    BEST-EFFORT — never raises: any failure returns ``{"written": 0}``
    so an ingest problem can never
    touch the run's already-finalized terminal status (mirrors ``distill_run_memory_step``). Called
    from the run-graph ship arm with the live workspace path (still on disk at that point)."""
    try:
        captures = _read_captures(workspace)
        if not captures:
            return {"written": 0, "captures": 0}
        settings = get_settings()
        with session_scope() as session:
            run = session.execute(
                select(Run).where(Run.id == uuid.UUID(run_id))
            ).scalar_one_or_none()
            if run is None or run.owner_id is None:
                return {"written": 0, "captures": len(captures), "skipped": "no-owner"}
            owner_id = run.owner_id
            repo_key = repo_key_for_run(run.github_repo, run.repo_path, run.local_repo_label)
        review_mode = _owner_review_mode(owner_id)
        # An owner with no OpenAI key embeds with the OPERATOR key (off-ledger), as distillation
        # and manual memories do — so Desktop subscription users' captures still land.
        on_ledger = True
        try:
            owner_key = resolve_owner_api_key(owner_id, settings.embedding_model)
        except NoCredentialError:
            owner_key, on_ledger = None, False
        except Exception:  # noqa: BLE001 — an unreadable key can't embed; skip (best-effort)
            logger.warning("agent-remember ingest skipped: no key run=%s", run_id, exc_info=True)
            return {"written": 0, "captures": len(captures), "skipped": "no-key"}
        written = remember_facts(
            run_id,
            captures,
            owner_id=owner_id,
            repo_key=repo_key,
            review_mode=review_mode,
            owner_key=owner_key,
            embed_model=settings.embedding_model,
            on_ledger=on_ledger,
        )
        logger.info(
            "agent-remember ingest run=%s captures=%d written=%d",
            run_id,
            len(captures),
            len(written),
        )
        return {"written": len(written), "captures": len(captures), "facts": written}
    except Exception:  # noqa: BLE001 — best-effort: a capture-ingest failure never touches the run
        logger.warning("agent-remember ingest failed run=%s", run_id, exc_info=True)
        return {"written": 0}
