"""M-runnable: the team the product GIVES you must be a team you can RUN.

Reproduction-first (each FAILS on main c675517): the team builders + templates must default every
model-bearing node from the OWNER's held providers, so a deepseek-only account is handed a deepseek
team (not an openrouter one it is then refused at launch), the launch refusal names the offending
NODES, and the legacy fallback is preserved for an account holding nothing. Discriminating, never
smoke: each asserts the EXACT provider/slug, and the fallback tests unset ``TVASHTR_AGENT_MODEL`` so
the legacy worker default is openrouter — a deepseek node then PROVES the held-default beat it,
not that it coincidentally matched ``.env``.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane.credentials import provider_for_model
from tvashtr.control_plane.teams import (
    build_full_squad_team,
    build_plan_review_team,
    build_review_loop_team,
    build_two_node_team,
    clone_team_graph,
    engineer_model,
)
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import AgentNode

ALL_BUILDERS = (
    build_two_node_team,
    build_review_loop_team,
    build_plan_review_team,
    build_full_squad_team,
)


def _node_rows(team_graph_id: str) -> list[tuple[str, str | None]]:
    with session_scope() as session:
        return [
            (rn, m)
            for rn, m in session.execute(
                select(AgentNode.role_name, AgentNode.model).where(
                    AgentNode.team_graph_id == uuid.UUID(team_graph_id)
                )
            ).all()
        ]


def _model_providers(team_graph_id: str) -> list[str]:
    return [provider_for_model(m) for _rn, m in _node_rows(team_graph_id) if m]


# ---- REPRODUCTION 1: a deepseek-only account's builders yield deepseek nodes (today: openrouter) -


@pytest.mark.parametrize("builder", ALL_BUILDERS, ids=lambda b: b.__name__)
def test_builder_defaults_every_model_node_to_the_only_held_provider(builder, monkeypatch):
    # Delete TVASHTR_AGENT_MODEL so the legacy worker default is openrouter — a deepseek node then
    # proves account_default_model({"deepseek"}) WON, not that it matched .env's deepseek slug.
    monkeypatch.delenv("TVASHTR_AGENT_MODEL", raising=False)
    gid = builder(held_providers={"deepseek"})
    providers = _model_providers(gid)
    assert providers, "the team must have model-bearing nodes"
    assert all(p == "deepseek" for p in providers), providers


def test_builder_makes_the_seeded_review_team_runnable_for_a_deepseek_account(monkeypatch):
    # The fresh-account default (seed_library_if_empty → review_loop) must be RUNNABLE by a
    # deepseek-only account: EVERY model node (incl. the Reviewer) resolves to a held provider, so
    # the launch pre-flight (needed - held) is empty. Today the Reviewer/Engineer are openrouter.
    monkeypatch.delenv("TVASHTR_AGENT_MODEL", raising=False)
    gid = build_review_loop_team(held_providers={"deepseek"})
    needed = set(_model_providers(gid))
    assert needed <= {"deepseek"}, needed  # nothing outside what the account holds ⇒ no 422


# ---- FALLBACK: an account holding NOTHING keeps the legacy thinker/worker defaults ----


def test_builder_with_no_held_providers_preserves_legacy_thinker_worker_split(monkeypatch):
    monkeypatch.delenv("TVASHTR_AGENT_MODEL", raising=False)
    gid = build_review_loop_team(held_providers=set())
    by_role = {rn: m for rn, m in _node_rows(gid)}
    assert by_role["pm"] == get_settings().default_model  # thinker → settings.default_model
    assert by_role["engineer"] == engineer_model()  # worker → engineer_model()
    assert by_role["reviewer"] == engineer_model()  # reviewer is a worker (reviewer_model=engineer)


# ---- INVARIANT: creation-only — an existing persisted team's node models are never rewritten ----


def test_clone_preserves_persisted_models_and_never_re_defaults(monkeypatch):
    monkeypatch.delenv("TVASHTR_AGENT_MODEL", raising=False)
    # Build the source with a deepseek-held owner so its models are deepseek — DISTINCT from the
    # legacy fallback. A "re-derive during clone" bug (the clone has no held set → would fall to the
    # legacy default) would produce NON-deepseek models, so this test discriminates it — not merely
    # passing because both sides collapse to the same legacy default.
    gid = build_review_loop_team(held_providers={"deepseek"})
    before = sorted(m for _rn, m in _node_rows(gid) if m)
    assert before and all(provider_for_model(m) == "deepseek" for m in before)  # source is deepseek
    clone = clone_team_graph(gid)  # the clone-on-launch path
    after = sorted(m for _rn, m in _node_rows(clone) if m)
    assert after == before  # copied verbatim, NOT re-derived from any account's held providers


# ---- CATALOGUE: one backend-owned registry, deepseek included, canonical, nothing lost ----


def test_provider_catalogue_is_the_single_registry_with_deepseek():
    from tvashtr.control_plane.teams import PROVIDER_CATALOGUE

    provs = set(PROVIDER_CATALOGUE)
    # nothing currently offered is lost + deepseek is added
    assert {"openrouter", "nvidia_nim", "openai", "gemini", "groq", "deepseek"} <= provs
    for provider, entry in PROVIDER_CATALOGUE.items():
        assert provider_for_model(entry["default_model"]) == provider  # slug canonicalizes to key
        assert entry["presets"], f"{provider} has no presets"
        assert entry["default_model"] in entry["presets"]  # the default is itself offered
        for preset in entry["presets"]:
            assert provider_for_model(preset) == provider
    ds = PROVIDER_CATALOGUE["deepseek"]
    assert ds["default_model"] == "deepseek/deepseek-chat"
    assert "deepseek/deepseek-reasoner" in ds["presets"]


# ---- CONFIG: GET /api/config serves the catalogue (slugs only) and leaks NO key material ----


def test_config_serves_the_catalogue_with_deepseek_and_no_key_material():
    import re

    c = TestClient(app)
    resp = c.get("/api/config")
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    cat = payload["provider_catalogue"]
    provs = {e["provider"] for e in cat}
    assert {"openrouter", "nvidia_nim", "openai", "gemini", "groq", "deepseek"} <= provs
    # every served value is a provider/model SLUG — no key material can hide as a preset/default
    slug = re.compile(r"^[a-z0-9_]+(?:/[a-zA-Z0-9._-]+)*$")
    for e in cat:
        assert slug.match(e["provider"]), e
        for m in [e["default_model"], *e["presets"]]:
            assert slug.match(m), m
    # and the dev secret_key + obvious secret markers appear nowhere in the payload
    blob = resp.text
    assert get_settings().secret_key.get_secret_value() not in blob
    for needle in ("api_key", "secret", "sk-", "private_key", "BEGIN"):
        assert needle not in blob, needle


# ---- REPRODUCTION 3: the launch refusal names the offending NODES (keeps missing_providers) ----


def _fresh_account() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"m-runnable-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "m-runnable-pass"})
    assert resp.status_code == 200, resp.text
    return c


def test_launch_refusal_names_the_offending_nodes(monkeypatch):
    # No provider keys → the review_loop template's model nodes default to the legacy slugs, so the
    # launch is refused. The detail must name WHICH nodes need the missing provider(s). Robust to
    # whatever the legacy defaults resolve to in this env: the expected sets are derived from the
    # created team's node models (the account holds nothing, so EVERY model node is offending).
    monkeypatch.delenv("TVASHTR_AGENT_MODEL", raising=False)
    c = _fresh_account()
    team_id = c.post("/api/teams", json={"template": "review_loop", "name": "norun"}).json()[
        "team_graph_id"
    ]
    node_providers = {rn: provider_for_model(m) for rn, m in _node_rows(team_id) if m}
    resp = c.post("/api/runs", json={"team_graph_id": team_id})
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["missing_providers"] == sorted(set(node_providers.values()))  # existing contract
    assert set(detail["missing_nodes"]) == set(node_providers)  # NEW: names every offending node
    assert set(detail["missing_nodes"]) == {"pm", "engineer", "reviewer"}, detail["missing_nodes"]
    # the FE launch banner renders detail.message verbatim (M-legible) → the names must be IN it
    assert all(n in detail["message"] for n in detail["missing_nodes"]), detail["message"]


def test_deepseek_account_template_team_needs_only_deepseek(monkeypatch):
    monkeypatch.delenv("TVASHTR_AGENT_MODEL", raising=False)
    c = _fresh_account()
    c.post("/api/providers", json={"provider": "deepseek", "api_key": "sk-deepseek-dummy"})
    team_id = c.post("/api/teams", json={"template": "review_loop", "name": "ds"}).json()[
        "team_graph_id"
    ]
    assert set(_model_providers(team_id)) <= {"deepseek"}, _model_providers(team_id)
    # RUNNABLE without launching a workflow: the launch pre-flight finds nothing missing.
    from tvashtr.routers import _missing_provider_credentials

    owner_id = uuid.UUID(c.get("/api/auth/me").json()["id"])
    providers, _nodes = _missing_provider_credentials(owner_id, team_id)
    assert providers == [], providers


# ---- held_provider_slugs: the ONE held-provider rule (builders + the launch pre-flight) ----


def test_held_provider_slugs_is_the_owner_held_set():
    from tvashtr.control_plane.credentials import held_provider_slugs

    c = _fresh_account()
    me = c.get("/api/auth/me").json()
    owner_id = uuid.UUID(me["id"])
    assert held_provider_slugs(owner_id) == set()  # fresh account holds nothing
    c.post("/api/providers", json={"provider": "deepseek", "api_key": "sk-deepseek-dummy"})
    c.post("/api/providers", json={"provider": "groq", "api_key": "gsk-dummy"})
    assert held_provider_slugs(owner_id) == {"deepseek", "groq"}
