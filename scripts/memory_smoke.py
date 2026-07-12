#!/usr/bin/env python
"""Live embedding round-trip smoke for M-memory S1 (acceptance #2).

Drives the REAL ``POST /api/memories`` endpoint (through the FastAPI app + the real DB) with a real
``OPENAI_API_KEY`` so an actual ``text-embedding-3-small`` vector is stored in the pgvector column,
then reads the raw row back and asserts a genuine 1536-float embedding landed. NO monkeypatching —
this is the one check that proves the embedding path is real end-to-end.

Unlike ``smoke_gateway`` (which skips without a key), the live embed IS the point here, so a MISSING
``OPENAI_API_KEY`` is a hard FAIL (exit 1) — per the S1 brief's STOP rule, do NOT fake a vector.

Run via ``make memory-smoke`` (needs Postgres up on the pgvector image + migrated to head).
"""

import os
import sys
import uuid
from pathlib import Path


def _load_dotenv() -> None:
    """Populate ``os.environ`` from the repo-root ``.env`` (litellm reads the key from the
    environment, not from pydantic Settings). Never overrides an already-set var."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> int:
    _load_dotenv()
    if not os.environ.get("OPENAI_API_KEY"):
        print(
            "[memory-smoke] FAIL: OPENAI_API_KEY is not set (checked .env + env).\n"
            "               The live embedding round-trip cannot run — this is a hard stop, NOT a "
            "clean skip (the S1 brief forbids faking a vector).",
            file=sys.stderr,
        )
        return 1

    # Import lazily so the no-key fail above never pays the litellm/app import cost.
    from fastapi.testclient import TestClient
    from sqlalchemy import select

    from tvashtr.config import get_settings
    from tvashtr.db import session_scope
    from tvashtr.main import app
    from tvashtr.models import CostRecord, NodeMemory

    model = get_settings().embedding_model
    print(f"[memory-smoke] embedding_model={model!r} — driving a REAL POST /api/memories ...")

    with TestClient(app) as client:
        email = f"memory-smoke-{uuid.uuid4().hex}@tvashtr.local"
        reg = client.post(
            "/api/auth/register", json={"email": email, "password": "smoke-pw-123456"}
        )
        if reg.status_code != 200:
            print(
                f"[memory-smoke] FAIL: register failed: {reg.status_code} {reg.text}",
                file=sys.stderr,
            )
            return 1

        content = "The Tvashtr backend uses uv, FastAPI, DBOS, and pgvector on Postgres 16."
        resp = client.post("/api/memories", json={"content": content, "repo_key": "/smoke/tvashtr"})
        if resp.status_code != 200:
            print(
                f"[memory-smoke] FAIL: POST /api/memories returned {resp.status_code}: {resp.text}",
                file=sys.stderr,
            )
            return 1
        row = resp.json()

        # Read the raw stored vector straight from pgvector (the API returns only the dimension).
        with session_scope() as session:
            db_row = session.execute(
                select(NodeMemory).where(NodeMemory.id == uuid.UUID(row["id"]))
            ).scalar_one()
            vector = [float(x) for x in db_row.embedding]
            # Confirm the embed was metered OFF-LEDGER (workflow_id = NULL).
            off_ledger = (
                session.execute(
                    select(CostRecord).where(
                        CostRecord.model_requested == model, CostRecord.workflow_id.is_(None)
                    )
                )
                .scalars()
                .first()
            )

    dim = len(vector)
    print("[memory-smoke] OK — a real embedding round-tripped:")
    print(f"  id             = {row['id']}")
    print(f"  tier           = {row['tier']}   (repo_key={row['repo_key']!r})")
    print(f"  status         = {row['status']}   pinned={row['pinned']}")
    print(
        f"  embedding_dim  = {row['embedding_dim']}  (API)  |  stored vector length = {dim}  (DB)"
    )
    print(f"  vector[:4]     = {vector[:4]}")
    print(f"  content        = {content!r}")
    print(f"  off-ledger cost row present = {off_ledger is not None}  (workflow_id IS NULL)")

    if dim != 1536:
        print(f"[memory-smoke] FAIL: stored vector length {dim} != 1536", file=sys.stderr)
        return 1
    if all(x == 0.0 for x in vector):
        print(
            "[memory-smoke] FAIL: stored vector is all-zero (not a real embedding)", file=sys.stderr
        )
        return 1
    print(
        "[memory-smoke] PASS: a real 1536-float text-embedding-3-small vector stored in pgvector."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
