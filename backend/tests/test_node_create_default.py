"""M-accounts Slice C: the account-aware node-create default.

Discriminating (not smoke): the pure ``account_default_model`` returns the EXACT slug per
provider-set (and the preference order is pinned), and the ``POST /api/teams/{id}/nodes`` endpoint
applies it — a node dropped by an account holding only nvidia_nim gets the nvidia slug, an account
holding NO providers gets the legacy hardcoded default, and an explicit ``model`` is preserved. A
test that would pass with the logic inverted is not acceptable; each case asserts the exact value.
"""

import uuid

from fastapi.testclient import TestClient

from tvashtr.config import get_settings
from tvashtr.control_plane.teams import (
    _PROVIDER_DEFAULT_ORDER,
    PROVIDER_DEFAULT_MODEL,
    account_default_model,
    engineer_model,
)
from tvashtr.main import app

# ---- the pure helper (no DB, no env, no registry) ----


def test_account_default_model_picks_the_held_providers_slug():
    assert (
        account_default_model({"nvidia_nim"}) == "nvidia_nim/openai/gpt-oss-20b"
    )  # exact slug, not "something is set"
    assert account_default_model({"groq"}) == "groq/llama-3.3-70b-versatile"


def test_account_default_model_none_when_no_mapped_provider():
    assert account_default_model(set()) is None
    assert account_default_model({"not-a-provider"}) is None


def test_account_default_model_preference_order_is_deterministic():
    # M-thrift REORDERED the walk: nvidia_nim FIRST, openrouter LAST. openrouter's free tier is
    # credit-metered, so a low-balance key is refused outright (402) where NIM's request-metered
    # tier only throttles — and the tie-break's job is to maximise the chance a new account's first
    # run succeeds. Was: openrouter won this pair.
    assert account_default_model({"nvidia_nim", "openrouter"}) == ("nvidia_nim/openai/gpt-oss-20b")
    # The relative order of everything between the two moved entries is UNCHANGED.
    assert _PROVIDER_DEFAULT_ORDER == (
        "nvidia_nim",
        "openai",
        "gemini",
        "groq",
        "deepseek",
        "openrouter",
    )


def test_provider_default_map_slugs_canonicalize_to_their_own_key():
    # Each map value's leading slug segment must equal its key (the one canonicalization rule).
    for provider, model in PROVIDER_DEFAULT_MODEL.items():
        assert model.split("/", 1)[0] == provider


# ---- the endpoint wiring (the held providers reach _build_node + the default is applied) ----


def _fresh_account() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"node-default-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "node-default-pass"})
    assert resp.status_code == 200, resp.text
    return c


def _blank_team(c: TestClient) -> str:
    resp = c.post("/api/teams", json={"template": "blank", "name": "default probe"})
    assert resp.status_code == 200, resp.text
    return resp.json()["team_graph_id"]


def test_create_node_defaults_to_a_held_providers_model(monkeypatch):
    # Pin engineer_model() to the openrouter legacy so the nvidia account-aware default is DISTINCT.
    monkeypatch.delenv("TVASHTR_AGENT_MODEL", raising=False)
    c = _fresh_account()
    c.post("/api/providers", json={"provider": "nvidia_nim", "api_key": "nv-dummy-key"})
    team_id = _blank_team(c)
    node = c.post(f"/api/teams/{team_id}/nodes", json={"node_kind": "worker"}).json()
    # the nvidia default, exactly (M-live: was meta/llama-3.3-70b-instruct until NVIDIA retired it)
    assert node["model"] == "nvidia_nim/openai/gpt-oss-20b"


def test_create_node_falls_back_to_legacy_default_when_no_providers(monkeypatch):
    monkeypatch.delenv("TVASHTR_AGENT_MODEL", raising=False)
    c = _fresh_account()  # ZERO providers
    team_id = _blank_team(c)
    worker = c.post(f"/api/teams/{team_id}/nodes", json={"node_kind": "worker"}).json()
    assert worker["model"] == engineer_model()  # the legacy hardcoded worker default
    thinker = c.post(f"/api/teams/{team_id}/nodes", json={"node_kind": "thinker"}).json()
    assert thinker["model"] == get_settings().default_model  # the legacy thinker default


def test_create_node_preserves_an_explicit_model():
    c = _fresh_account()
    c.post("/api/providers", json={"provider": "nvidia_nim", "api_key": "nv-dummy-key"})
    team_id = _blank_team(c)
    node = c.post(
        f"/api/teams/{team_id}/nodes",
        json={"node_kind": "worker", "model": "openrouter/some/explicit-choice"},
    ).json()
    assert (
        node["model"] == "openrouter/some/explicit-choice"
    )  # explicit wins over the account default
