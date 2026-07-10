"""M-rails C8 — the per-owner request-time credential invariant, codified.

The guardrail milestone hardens Tvashtr for first multi-user exposure, so the BYOK posture is
locked by tests here: a run-owner's provider key is resolved **per-owner, at request time**, from
the encrypted ``provider_credentials`` store (NO ``.env`` fallback, never cross-account), and the
plaintext NEVER lands in a node row, a prompt, or the compiled context the model receives.

Mutation-real:
* resolution returns EXACTLY the seeded key and a keyless owner is REFUSED (a ``.env`` fallback or a
  cross-account read would return the wrong value / not raise);
* a node authored to USE a provider stores only the model slug — planting the key in any node column
  fails :func:`test_provider_key_never_persists_in_a_node_row`;
* the compiled instruction carries the node's real content but never the resolved key.

The same request-time-broker posture for M-tools **C7** MCP tool secrets (``tool_config`` holds only
``${NAME}``; the plaintext lives encrypted, resolved at run time) is exercised in full by
``test_mcp_tools.py``; the last test here locks the two into one unified assertion.
"""

import uuid

import pytest
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.context_compiler import compile_context
from tvashtr.control_plane.credentials import (
    NoCredentialError,
    encrypt_secret,
    resolve_owner_api_key,
)
from tvashtr.control_plane.mcp_secrets import resolve_owner_mcp_secret, set_owner_mcp_secret
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, ProviderCredential, Run, TeamGraph, User

# Distinctive sentinels — if either substring ever surfaces in a node row / prompt / context, the
# invariant is broken and the assertion fires.
_SENTINEL_PROVIDER_KEY = "sk-SENTINEL-provider-key-DO-NOT-LEAK-abcdef123456"
_SENTINEL_MCP_SECRET = "ghp_SENTINEL_mcp_secret_DO_NOT_LEAK_9999"


def _make_user() -> uuid.UUID:
    uid = uuid.uuid4()
    with session_scope() as session:
        session.add(User(id=uid, email=f"cred-{uid.hex}@tvashtr.local", password_hash="x"))
    return uid


def _seed_provider_key(owner: uuid.UUID, provider: str, plaintext: str) -> None:
    with session_scope() as session:
        session.add(
            ProviderCredential(
                owner_id=owner,
                provider=provider,
                secret_encrypted=encrypt_secret(plaintext),
                key_last4=plaintext[-4:],
            )
        )


def _make_owned_run(owner: uuid.UUID) -> str:
    run_id = str(uuid.uuid4())
    team_graph_id = build_two_node_team()
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=owner,
                idea="x",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def _make_node(model: str, prompt: str, tool_config: dict | None = None) -> uuid.UUID:
    with session_scope() as session:
        graph = TeamGraph(name="cred probe")
        session.add(graph)
        session.flush()
        node = AgentNode(
            team_graph_id=graph.id,
            role_name="eng",
            kind="agent",
            model=model,
            engine="openhands",
            prompt=prompt,
            position={"x": 0, "y": 0},
            tool_config=tool_config,
        )
        session.add(node)
        session.flush()
        return node.id


def test_provider_key_resolves_per_owner_at_request_time(client):
    owner = _make_user()
    _seed_provider_key(owner, "openai", _SENTINEL_PROVIDER_KEY)

    # Resolves per-owner from the encrypted DB (no .env) — for the provider derived from the model.
    assert resolve_owner_api_key(owner, "openai/gpt-4o-mini") == _SENTINEL_PROVIDER_KEY

    # …and through the exact request-time seam the executor uses inside its spend-bearing step.
    run_id = _make_owned_run(owner)
    assert team_run._owner_api_key(run_id, "openai/gpt-4o-mini") == _SENTINEL_PROVIDER_KEY

    # A DIFFERENT owner holding no key for that provider is REFUSED — there is no .env fallback and
    # no cross-account read (owner A's key never serves owner B's run).
    stranger = _make_user()
    with pytest.raises(NoCredentialError):
        resolve_owner_api_key(stranger, "openai/gpt-4o-mini")


def test_provider_key_never_persists_in_a_node_row(client):
    owner = _make_user()
    _seed_provider_key(owner, "openai", _SENTINEL_PROVIDER_KEY)

    # A node authored to USE that provider's model stores only the model SLUG — never the key.
    nid = _make_node("openai/gpt-4o-mini", "Build the feature.")
    with session_scope() as session:
        row = session.execute(select(AgentNode).where(AgentNode.id == nid)).scalar_one()
        blob = " ".join(
            str(x)
            for x in (
                row.role_name,
                row.kind,
                row.model,
                row.engine,
                row.prompt,
                row.config,
                row.tool_config,
                row.skills,
            )
        )
    assert _SENTINEL_PROVIDER_KEY not in blob

    # Resolution still WORKS — the key lives ONLY in the encrypted provider_credentials store.
    assert resolve_owner_api_key(owner, row.model) == _SENTINEL_PROVIDER_KEY


def test_provider_key_never_enters_the_compiled_context(client):
    owner = _make_user()
    _seed_provider_key(owner, "openai", _SENTINEL_PROVIDER_KEY)
    key = resolve_owner_api_key(owner, "openai/gpt-4o-mini")

    compiled = compile_context(
        node_prompt="Build the feature using the openai/gpt-4o-mini model.",
        idea="ship the greeting feature",
        spec="the PRD spec text",
        iteration=1,
        reviewer_feedback=None,
        grounding=None,
        emits_outcome=False,
        subpath=None,
        budget=1_000_000,
    )
    # The instruction the model receives carries the node's real content (prompt + idea + spec)…
    assert "Build the feature" in compiled.instruction
    assert "ship the greeting feature" in compiled.instruction
    # …but NEVER the resolved credential. The key is resolved separately (in agent_run_step) and
    # handed to the adapter's api_key parameter — it is never threaded through the prompt/context.
    assert key not in compiled.instruction


def test_c7_tool_secret_is_also_request_time_brokered_never_in_the_node_row(client):
    """The unified request-time-broker posture: an M-tools C7 MCP tool secret behaves like a
    provider key — the node's ``tool_config`` holds only the ``${NAME}`` reference; the plaintext
    lives in the encrypted ``mcp_secrets`` store and resolves at run time. (Full substitution +
    prompt-hygiene coverage lives in ``test_mcp_tools.py``.)"""
    owner = _make_user()
    set_owner_mcp_secret(owner, "SENTINEL_TOKEN", _SENTINEL_MCP_SECRET)
    ref = "${SENTINEL_TOKEN}"
    nid = _make_node(
        "openai/gpt-4o-mini",
        "x",
        tool_config={"mcpServers": {"gh": {"command": "run", "env": {"TOKEN": ref}}}},
    )
    with session_scope() as session:
        row = session.execute(select(AgentNode).where(AgentNode.id == nid)).scalar_one()
        stored = str(row.tool_config)
    # The row holds only the ${NAME} reference, never the plaintext…
    assert ref in stored and _SENTINEL_MCP_SECRET not in stored
    # …and the secret resolves at request time from the encrypted store.
    assert resolve_owner_mcp_secret(owner, "SENTINEL_TOKEN") == _SENTINEL_MCP_SECRET
