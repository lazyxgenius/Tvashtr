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

from tvashtr.config import get_settings
from tvashtr.control_plane.budget import budget_check_step, mark_budget_overridden_step
from tvashtr.control_plane.gates import wait_at_gate
from tvashtr.control_plane.litellm_admin import delete_virtual_key, mint_virtual_key
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


# P1.4b: per-run virtual-key lifecycle constants.
# TTL on the minted key — the crash-robust floor (no teardown step can be skipped by a crash;
# orphan keys self-clean). 30m comfortably outlives a single engineer run.
_VKEY_TTL = "30m"
# A tiny positive floor for the key's max_budget so a run that passed the pre-engineer gate
# (spent <= cap, so remaining >= 0) always mints a USABLE key the agent can at least start with
# — never a zero/negative budget that would reject call #1 before the run even begins.
_VKEY_MIN_BUDGET_USD = 1e-6


@DBOS.step()
def mint_vkey_step(run_id: str) -> str | None:
    """Mint a per-run LiteLLM virtual key whose ``max_budget`` is the run's REMAINING budget,
    so the proxy cuts the agent off **mid-call** at the cap (P1.4b). Returns the key value, or
    ``None`` when the proxy is off (then the agent uses ``OPENROUTER_API_KEY`` exactly as today).

    Budget = ``cap − running_cost(run_id)`` at mint time (after the PM has run, so the PM's
    spend is already counted) — one per-run cap enforced from two angles (this proxy cutoff
    mid-step + P1.2's between-steps gate), no double-count. Two uncapped-key guards: a run a
    human already approved over budget (``budget_overridden``), or one with no cap
    (``budget_cap_usd is None``), mints with **no** ``max_budget``.

    Idempotency is provided by DBOS step-output checkpointing — a completed step replays its
    recorded key on resume (no re-mint). The narrow in-step crash window (key minted on the
    proxy but the output not yet recorded → a resume re-mints, orphaning the first key)
    self-cleans via the key TTL — the same accepted class as the ship commit/tag window."""
    settings = get_settings()
    if not settings.litellm_proxy_enabled:
        return None
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        cap = run.budget_cap_usd
        overridden = run.budget_overridden
    if overridden or cap is None:
        max_budget: float | None = None  # uncapped key (human-approved breach, or no cap)
    else:
        remaining = float(cap) - float(running_cost(run_id))
        max_budget = max(remaining, _VKEY_MIN_BUDGET_USD)
    result = mint_virtual_key(max_budget=max_budget, duration=_VKEY_TTL)
    key = result.get("key")
    if not key:
        # Fail CLOSED: a mint that returned no usable key would otherwise fall back to the
        # master key in ``agent_llm_routing`` -> an UNCAPPED run. For a budget-enforcement
        # step, refuse rather than run unbudgeted. (Not reachable against the pinned proxy —
        # a 200 from /key/generate always carries "key" — this is defense-in-depth.)
        raise RuntimeError("proxy /key/generate returned no 'key'; refusing to run unbudgeted")
    return key


@DBOS.step()
def delete_vkey_step(run_id: str, key: str | None) -> None:
    """Best-effort immediate invalidation of the per-run key right after the agent runs. A
    no-op when ``key is None`` (proxy off). Never raises — the key's TTL backstops a skipped
    or failed delete, so this adds no correctness dependency (P1.4b Q5)."""
    if key is None:
        return
    delete_virtual_key(key)


@DBOS.step()
def engineer_run_step(
    run_id: str, prd_text: str, workspace: str, eng_model: str, vkey: str | None
) -> dict:
    """The ONE coarse step wrapping the agent run. No commit / no cost write here.

    ``vkey`` (P1.4b) is the per-run virtual key (or None when the proxy is off); it rides into
    the agent's LLM as its api_key via ``AgentTask.llm_api_key``. The returned ``status`` may
    now be ``"over_budget"`` (the proxy cut the agent off mid-call) — passed through unchanged."""
    # Attempt log — intentionally NOT idempotent: one row per execution. A
    # crash-then-resume re-runs this whole step, yielding a second row with a
    # different pid (the observable proof the agent step re-executed).
    with session_scope() as session:
        session.add(EngineerRunAttempt(run_id=run_id, pid=os.getpid()))

    # Happy-path correctness instruction (DQ3): a relative path keeps the deliverable
    # in the working dir so it ships. The security justification is dropped — in
    # docker mode the container, not the prompt, is the boundary; in local mode this
    # is plain "land it where the ship can find it" (containment is P1.3's job, not
    # the prompt's).
    instruction = (
        "Read the following PRD and create exactly the file it specifies, with exactly "
        "the specified contents. Write the deliverable into your current working "
        "directory using a RELATIVE path (the bare filename, e.g. 'greeting.txt') so it "
        "can be shipped; if the PRD shows a leading '/' or './', treat it as relative to "
        "your working directory. Do not add any extra files and do not modify anything "
        "else.\n\n--- PRD ---\n"
        f"{prd_text}"
    )
    task = AgentTask(
        instruction=instruction, workspace_dir=workspace, model=eng_model, llm_api_key=vkey
    )
    # Select local vs Docker-sandboxed engine from the configured sandbox mode
    # (P1.3a, DQ4). Default "local" keeps the proven path; "docker" routes through
    # the containerized adapter. The EngineAdapter contract + AgentRunResult shape
    # are identical across modes; reap-before-start lives inside the docker adapter.
    engine_name = (
        "openhands-docker" if get_settings().agent_sandbox_mode == "docker" else "openhands"
    )
    adapter = resolve_adapter(engine_name)  # lazy openhands import happens here
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
    # P1.4b: mint the per-run virtual key (proxy on) right before the engineer, AFTER the
    # pre-engineer gate so `remaining > 0` is guaranteed unless the run is uncapped/overridden.
    # The agent runs under that key; the proxy cuts it off mid-call if it blows the budget.
    vkey = mint_vkey_step(run_id)
    engineer = engineer_run_step(run_id, pm["prd_text"], workspace, config["eng_model"], vkey)
    # Best-effort immediate invalidation of the live credential (the key TTL backstops a
    # skipped/failed delete, so a crash here breaks nothing).
    delete_vkey_step(run_id, vkey)

    # P1.4b: the proxy cut the agent off MID-CALL at the per-run key budget. Record whatever
    # partial spend the cut-off conversation carried (best-effort, idempotent) so the ledger
    # reflects it, then finalize over_budget — no ship. P1.2's between-steps gate never fires
    # on this path (the proxy cutoff returns first), so the two angles never double-count.
    if engineer["status"] == "over_budget":
        if engineer["total_tokens"] or engineer["cost_usd"]:
            persist_agent_cost_step(run_id, config["eng_model"], engineer)
        final = finalize_run_step(run_id, status="over_budget")
        DBOS.logger.info(f"run_team over_budget (proxy mid-loop cutoff) run_id={run_id}")
        return {
            "run_id": run_id,
            "status": "over_budget",
            "document_id": pm["document_id"],
            "cost_total": final["cost_total_usd"],
        }

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
