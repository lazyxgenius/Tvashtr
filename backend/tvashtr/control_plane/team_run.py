"""The 2-node skeleton run: PM -> Engineer in one durable DBOS workflow.

``run_team`` is started with ``DBOS.workflow_id == run_id == str(runs.id)`` (the
endpoint uses ``SetWorkflowID``), so every side-effecting write keys its
idempotency on ``run_id``. The node models/engine are read from the team-graph
rows (the team is *authored*, not hardcoded).

Crash-durability (Decision 1): the agent run is **one coarse step**
(``engineer_run_step``) — no checkpointing inside OpenHands' loop. On a crash DBOS
re-runs the whole step (the agent runs again, overwriting files harmlessly); the
ship is dedup'd by the ``ship-{run_id}`` git tag, so it happens exactly once.

``openhands.*`` is imported only lazily inside the steps that need it, so this
module (and app startup) never loads it.
"""

import os
import uuid

from dbos import DBOS
from sqlalchemy import select, update

from tvashtr.control_plane.budget import budget_check_step, mark_budget_overridden_step
from tvashtr.control_plane.gates import wait_at_gate
from tvashtr.control_plane.shipping import idempotent_ship, init_workspace_repo
from tvashtr.db import session_scope
from tvashtr.documents.service import create_document_with_initial_version
from tvashtr.engines.base import AgentTask
from tvashtr.engines.registry import resolve_adapter
from tvashtr.engines.run_event_sink import make_run_event_sink
from tvashtr.gateway import CompletionRequest, complete
from tvashtr.metering import record_agent_cost, record_cost, running_cost
from tvashtr.models import AgentNode, EngineerRunAttempt, Run


@DBOS.step()
def load_team_config_step(run_id: str) -> dict:
    """Read the PM + Engineer model from the run's team-graph rows."""
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id))
            .scalars()
            .all()
        )
    by_role = {n.role_name: n for n in nodes}
    return {"pm_model": by_role["pm"].model, "eng_model": by_role["engineer"].model}


@DBOS.step()
def pm_step(run_id: str, idea: str, pm_model: str) -> dict:
    """PM node: a direct, metered gateway completion -> a versioned PRD document."""
    prompt = (
        "You are the PM on a software team. Write a concise mini-PRD (3-5 sentences) "
        "for the feature request below. You MUST restate, verbatim, the exact file path "
        "and the exact required file contents (each clearly labelled on its own line), "
        "plus one sentence of context for the engineer.\n\n"
        f"Feature request:\n{idea}"
    )
    request = CompletionRequest(
        model=pm_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=400,
    )
    result = complete(request)
    record_cost(result, workflow_id=run_id, idempotency_key=f"{run_id}:pm-llm")

    document = create_document_with_initial_version(
        title="Mini-PRD",
        doc_type="prd",
        content=result.text,
        created_by="agent:pm",
        idempotency_key=f"{run_id}:pm-prd-v1",
    )
    with session_scope() as session:
        session.execute(
            update(Run).where(Run.id == uuid.UUID(run_id)).values(pm_document_id=document.id)
        )
    return {"document_id": str(document.id), "prd_text": result.text}


@DBOS.step()
def engineer_setup_step(run_id: str) -> str:
    """Create a fresh local workspace and git-init it (repo-local identity)."""
    from tvashtr.engines.openhands_adapter import make_local_workspace  # lazy (openhands)

    workspace = make_local_workspace(run_id)
    init_workspace_repo(workspace)
    return workspace


@DBOS.step()
def engineer_run_step(run_id: str, prd_text: str, workspace: str, eng_model: str) -> dict:
    """The ONE coarse step wrapping the agent run. No commit / no cost write here."""
    # Attempt log — intentionally NOT idempotent: one row per execution. A
    # crash-then-resume re-runs this whole step, yielding a second row with a
    # different pid (the observable proof the agent step re-executed).
    with session_scope() as session:
        session.add(EngineerRunAttempt(run_id=run_id, pid=os.getpid()))

    instruction = (
        "Read the following PRD and create exactly the file it specifies, with exactly "
        "the specified contents. Create it in the current working directory using a "
        "RELATIVE path — the bare filename only (e.g. 'greeting.txt'); if the PRD shows "
        "a path with a leading '/' or './', ignore that prefix and create the file "
        "relative to the current directory. Do not add any extra files and do not "
        "modify anything else.\n\n--- PRD ---\n"
        f"{prd_text}"
    )
    task = AgentTask(instruction=instruction, workspace_dir=workspace, model=eng_model)
    adapter = resolve_adapter("openhands")  # lazy openhands import happens here
    result = adapter.run(task, on_event=make_run_event_sink(run_id))
    return {
        "status": result.status,
        "files_changed": result.files_changed,
        "error": result.error,
        "prompt_tokens": result.prompt_tokens,
        "completion_tokens": result.completion_tokens,
        "total_tokens": result.total_tokens,
        "cost_usd": result.cost_usd,
    }


@DBOS.step()
def persist_agent_cost_step(run_id: str, eng_model: str, usage: dict) -> None:
    """Write one CostRecord for the agent invocation, idempotent on the key."""
    record_agent_cost(
        workflow_id=run_id,
        idempotency_key=f"{run_id}:agent-cost",
        model=eng_model,
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
        total_tokens=usage["total_tokens"],
        cost_usd=usage["cost_usd"],
    )


@DBOS.step()
def ship_step(run_id: str, workspace: str) -> dict:
    """Idempotently ship the agent's work; record the sha/tag on the run."""
    ship = idempotent_ship(workspace, run_id)
    with session_scope() as session:
        session.execute(
            update(Run)
            .where(Run.id == uuid.UUID(run_id))
            .values(ship_commit_sha=ship["sha"], ship_tag=ship["tag"])
        )
    return ship


@DBOS.step()
def finalize_run_step(run_id: str, status: str = "completed") -> dict:
    """Mark the run terminal and total its cost rows (idempotent aggregate).

    ``status`` defaults to ``completed``; the workflow passes ``rejected`` (human
    rejected the PRD gate) or ``over_budget`` (human rejected a budget breach).
    The terminal total reuses the shared ``running_cost`` query — the same one
    ``budget_check_step`` reads in flight."""
    total = running_cost(run_id)
    with session_scope() as session:
        session.execute(
            update(Run)
            .where(Run.id == uuid.UUID(run_id))
            .values(status=status, cost_total_usd=total)
        )
    return {"cost_total_usd": float(total)}


@DBOS.step()
def mark_run_failed_step(run_id: str) -> None:
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == uuid.UUID(run_id)).values(status="failed"))


def enforce_budget(run_id: str, *, checkpoint: str, description: str) -> bool:
    """Reactive, between-steps budget enforcement (DP-C). Check accumulated prior
    spend and gate the *next* step; on a breach, open a high-priority blocker and
    wait. Call from a **workflow body** — it issues ``wait_at_gate`` (a
    ``DBOS.recv``), which must run in workflow context, not nested in a step.

    Returns ``True`` if the human **rejected** the breach (the caller must finalize
    the run ``over_budget`` and stop) and ``False`` to continue — either under
    budget, or the human approved (which records the override via
    ``mark_budget_overridden_step`` so the rest of the run is not re-gated:
    "approve = continue to completion").
    """
    check = budget_check_step(run_id)
    if not check["over"]:
        return False

    spent, cap = check["spent"], check["cap"]
    title = f"Over budget: ${spent:.4f} of ${cap:.4f} — approve to continue, reject to stop"
    gate = wait_at_gate(
        run_id,
        topic=f"budget:{run_id}:{checkpoint}",
        kind="budget_approval",
        priority="high_blocker",
        blocking=True,
        title=title,
        description=description,
    )
    if gate["resolution"] == "rejected":
        DBOS.logger.info(f"run_team over_budget rejected at {checkpoint} run_id={run_id}")
        return True
    mark_budget_overridden_step(run_id)
    return False


@DBOS.workflow()
def run_team(idea: str) -> dict:
    run_id = DBOS.workflow_id
    DBOS.logger.info(f"run_team start run_id={run_id} idea={idea!r}")

    config = load_team_config_step(run_id)
    pm = pm_step(run_id, idea, config["pm_model"])

    # HitL gate (P1.1a): pause for human PRD approval before the Engineer builds.
    # Inlined at a fixed position here; first-class graph-placed gates are P1.5.
    gate = wait_at_gate(
        run_id,
        topic=f"gate:{run_id}:prd-approval",
        kind="gate_approval",
        priority="high_blocker",
        blocking=True,
        title="Approve the PRD before the Engineer builds",
        description=(
            f"The PM wrote PRD document {pm['document_id']}. Approve to let the "
            "Engineer build and ship it; reject to stop the run without shipping."
        ),
    )
    if gate["resolution"] == "rejected":
        final = finalize_run_step(run_id, status="rejected")
        DBOS.logger.info(f"run_team rejected at PRD gate run_id={run_id}")
        return {
            "run_id": run_id,
            "status": "rejected",
            "document_id": pm["document_id"],
            "cost_total": final["cost_total_usd"],
        }

    # Budget checkpoint 1 (DP-C): before the Engineer runs. Reactive on the PM's
    # accumulated spend; a breach pauses as a high-priority blocker.
    if enforce_budget(
        run_id,
        checkpoint="pre-engineer",
        description=(
            "The run is over budget before the Engineer runs. Approve to continue "
            "(the rest of the run will not be re-gated), or reject to stop without "
            "building."
        ),
    ):
        final = finalize_run_step(run_id, status="over_budget")
        DBOS.logger.info(f"run_team over_budget (pre-engineer) run_id={run_id}")
        return {
            "run_id": run_id,
            "status": "over_budget",
            "document_id": pm["document_id"],
            "cost_total": final["cost_total_usd"],
        }

    workspace = engineer_setup_step(run_id)
    engineer = engineer_run_step(run_id, pm["prd_text"], workspace, config["eng_model"])

    if engineer["status"] != "completed":
        mark_run_failed_step(run_id)
        DBOS.logger.error(f"run_team failed run_id={run_id}: {engineer.get('error')}")
        return {"run_id": run_id, "status": "failed", "error": engineer.get("error")}

    persist_agent_cost_step(run_id, config["eng_model"], engineer)

    # Budget checkpoint 2 (DP-C): after the agent's spend is recorded, before
    # shipping. The agent's own LLM loop bills inside one step and can't be
    # interrupted mid-flight (that's P1.4's proxy), so we catch its spend here.
    if enforce_budget(
        run_id,
        checkpoint="pre-ship",
        description=(
            "The agent's run exceeded the budget. Approve to ship the completed "
            "work, or reject to stop without shipping."
        ),
    ):
        final = finalize_run_step(run_id, status="over_budget")
        DBOS.logger.info(f"run_team over_budget (pre-ship) run_id={run_id}")
        return {
            "run_id": run_id,
            "status": "over_budget",
            "document_id": pm["document_id"],
            "cost_total": final["cost_total_usd"],
        }

    ship = ship_step(run_id, workspace)
    final = finalize_run_step(run_id)

    DBOS.logger.info(f"run_team done run_id={run_id} ship_sha={ship['sha']} tag={ship['tag']}")
    return {
        "run_id": run_id,
        "status": "completed",
        "document_id": pm["document_id"],
        "ship_sha": ship["sha"],
        "ship_tag": ship["tag"],
        "cost_total": final["cost_total_usd"],
    }
