"""M2 test helpers: an account with a key, a choice model, a Domain with ready files, and a fake
agent that hands in drafts through the examples server's own functions (what its MCP tools call)."""

import time
import uuid
from pathlib import Path

from home_fixtures import fresh_account
from sqlalchemy import select

from tvashtr.control_plane import model_examples, team_run
from tvashtr.control_plane.credentials import encrypt_secret
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.db import session_scope
from tvashtr.models import (
    Domain,
    DomainChunk,
    DomainDocument,
    ModelExampleBatch,
    ProviderCredential,
    Run,
)

CHOICES = ["Motor", "Property", "Health", "Travel", "Fraud review", "Other"]
SECRET = "sk-m2-made-up-test-key-not-real-0000"
FILES = {
    "motor-rules.md": [
        "Damage to an insured vehicle caused by another vehicle, whether moving or parked, is "
        "handled by the Motor team, including hit-and-run cases.",
        "Own-damage to two-wheelers, with or without injury to the rider, goes to Motor.",
    ],
    "property-rules.md": [
        "Storm, cyclone and flood damage to the insured building and its contents is handled by "
        "the Property team.",
    ],
    "fraud-rules.md": [
        "Send to Fraud review any claim where a purchase document is dated after the loss it "
        "supports.",
    ],
}
QUOTES = {
    "motor-rules.md": "caused by another vehicle, whether moving or parked",
    "property-rules.md": "Storm, cyclone and flood damage to the insured building",
    "fraud-rules.md": "a purchase document is dated after the loss it supports",
}


def account(*providers: str):
    c, owner = fresh_account("m2")
    with session_scope() as s:
        for p in providers:
            s.add(
                ProviderCredential(
                    owner_id=owner,
                    provider=p,
                    secret_encrypted=encrypt_secret(SECRET),
                    key_last4=SECRET[-4:],
                )
            )
    return c, owner


def choice_model(c, name="Claims triage") -> str:
    resp = c.post(
        "/api/models",
        json={
            "name": name,
            "job": "Reads a new insurance claim and picks the team that should handle it.",
            "answer_kind": "choice",
            "choices": CHOICES,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["model_id"]


def domain(owner: uuid.UUID, name="Claims handbook", files=FILES, ready=True) -> str:
    with session_scope() as s:
        d = Domain(owner_id=owner, name=name, template="blank", config={})
        s.add(d)
        s.flush()
        for filename, passages in files.items():
            doc = DomainDocument(
                domain_id=d.id,
                filename=filename,
                content_type="text/markdown",
                storage_path=f"m2/{uuid.uuid4().hex}",
                byte_size=100,
                ingest_status="ready" if ready else "pending",
            )
            s.add(doc)
            s.flush()
            for i, text in enumerate(passages):
                s.add(
                    DomainChunk(
                        domain_id=d.id,
                        document_id=doc.id,
                        ordinal=i,
                        text=text,
                        meta={"filename": filename},
                    )
                )
        return str(d.id)


def options(c, mid: str) -> dict:
    resp = c.get(f"/api/models/{mid}/drafting")
    assert resp.status_code == 200, resp.text
    return resp.json()


def builder_id(c, mid: str) -> str:
    return options(c, mid)["teams"][0]["team_id"]


def start(c, mid, did, team, tests=2, training=2):
    return c.post(
        f"/api/models/{mid}/drafting",
        json={"domain_id": did, "team_id": team, "tests": tests, "training": training},
    )


def batch_of(run_id: str) -> uuid.UUID:
    with session_scope() as s:
        return s.execute(
            select(ModelExampleBatch.id).where(ModelExampleBatch.run_id == uuid.UUID(run_id))
        ).scalar_one()


def wait_run(run_id: str, timeout: float = 60.0) -> Run:
    deadline = time.monotonic() + timeout
    while True:
        with session_scope() as s:
            run = s.get(Run, uuid.UUID(run_id))
            if run.status != "running":
                s.expunge(run)
                return run
        assert time.monotonic() < deadline, "the drafting run never ended"
        time.sleep(0.1)


def draft(kind: str, input_: str, answer: str, file: str) -> dict:
    return {
        "kind": kind,
        "input": input_,
        "answer": answer,
        "source_file": file,
        "quote": QUOTES[file],
    }


def fake_team(monkeypatch, workspace: Path, *, writes, reviews):
    """Patch the walk's agent step. ``writes(batch_id, iteration)`` is the Writer's work and
    ``reviews(batch_id, iteration)`` the Reviewer's, returning its outcome. Returns what each call
    saw: ``[(grant, tool_config)]``."""
    seen: list[tuple[str | None, dict | None]] = []

    def _agent(
        run_id,
        node_prompt,
        model,
        iteration,
        idea,
        prd_text,
        workspace_dir,
        vkey,
        reviewer_feedback,
        emits_outcome,
        budget,
        invocation_id=None,
        **kwargs,
    ):
        tool_config = kwargs.get("tool_config")
        grant = ((tool_config or {}).get("tvashtr") or {}).get("examples")
        seen.append((grant, tool_config))
        batch_id = batch_of(run_id)
        usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "cost_usd": 0.0}
        if grant == "write":
            writes(batch_id, iteration)
            return {
                "status": "completed",
                "outcome": None,
                "reasons": None,
                "report": "Handed in.",
                "files_changed": [],
                "context_manifest": None,
                **usage,
            }
        if grant == "review":
            outcome = reviews(batch_id, iteration)
            return {
                "status": "completed",
                "outcome": outcome,
                "reasons": None if outcome == "approved" else "Fix the flagged drafts.",
                **usage,
            }
        return {
            "status": "completed",
            "outcome": None,
            "reasons": None,
            "report": "Plan: motor, property, fraud.",
            "files_changed": [],
            "context_manifest": None,
            **usage,
        }

    init_workspace_repo(str(workspace))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(workspace))
    monkeypatch.setattr(team_run, "agent_run_step", _agent)
    monkeypatch.setattr(team_run, "retrieve_memory_step", lambda *a, **k: [])
    return seen


def write_four(batch_id, iteration):
    if iteration > 1:
        return
    model_examples.agent_add(
        batch_id, draft("test", "A truck reversed into my parked car.", "Motor", "motor-rules.md")
    )
    model_examples.agent_add(
        batch_id,
        draft("test", "The cyclone flooded my ground floor.", "property", "property-rules.md"),
    )
    model_examples.agent_add(
        batch_id,
        draft("training", "Laptop bill dated after the theft.", "Fraud review", "fraud-rules.md"),
    )
    model_examples.agent_add(
        batch_id, draft("training", "Hit and run in the mall parking.", "Motor", "motor-rules.md")
    )


def approve_all(batch_id, iteration):
    for d in model_examples.agent_list(batch_id)["drafts"]:
        model_examples.agent_review(batch_id, d["id"], "ok", "The quote supports it.", None)
    return "approved"
