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
    CAPABILITIES,
    PROVIDER_CATALOGUE,
    account_default_model,
    catalogue_default,
    catalogue_presets,
    engineer_model,
)
from tvashtr.main import app

# ---- the pure helper (no DB, no env, no registry) ----


def test_account_default_model_picks_the_held_providers_slug():
    # M-seat: the walk now takes a SEAT. Exact slugs, not "something is set" — and openai is here
    # because it is the one held provider whose two seats resolve to DIFFERENT models, so a
    # capability-blind regression cannot hide behind a provider that answers both the same.
    assert account_default_model({"nvidia_nim"}, "worker") == "nvidia_nim/openai/gpt-oss-20b"
    assert account_default_model({"nvidia_nim"}, "thinker") == "nvidia_nim/openai/gpt-oss-20b"
    assert account_default_model({"groq"}, "worker") == "groq/openai/gpt-oss-120b"
    assert account_default_model({"openai"}, "worker") == "openai/gpt-4.1-mini"
    assert account_default_model({"openai"}, "thinker") == "openai/gpt-4o-mini"


def test_account_default_model_none_when_no_mapped_provider():
    for capability in CAPABILITIES:
        assert account_default_model(set(), capability) is None
        assert account_default_model({"not-a-provider"}, capability) is None


def test_a_provider_that_cannot_serve_a_seat_yields_it_to_the_next_held_provider():
    """THE M-seat REGRESSION, asserted against the REAL catalogue rather than a fixture.

    Probed 2026-09-08: `gemini` drives the agent loop (all four worker gates) and cannot produce a
    deliverable under the output ceiling, so it declares `thinker_default: None`. Before the split
    one `default_model` answered for both seats, so whichever provider led the order decided every
    node — which is how M-live stamped a thinker-proven slug on the Engineer and lost the run.
    """
    assert catalogue_default("gemini", "thinker") is None  # the premise this rests on
    # gemini leads groq in `_PROVIDER_DEFAULT_ORDER`, so a capability-blind walk would return
    # gemini's model — or None — for BOTH seats. It keeps the seat it can serve and yields the
    # other.
    held = {"gemini", "groq"}
    assert account_default_model(held, "worker") == "gemini/gemini-2.5-flash"
    assert account_default_model(held, "thinker") == "groq/openai/gpt-oss-120b"


def test_a_seat_no_held_provider_can_serve_is_none_not_the_other_seats_model():
    """The yield has to bottom out honestly: an account holding ONLY gemini has no thinker at all,
    and must be told so. Substituting the worker slug is the exact failure mode being removed."""
    assert account_default_model({"gemini"}, "thinker") is None
    assert account_default_model({"gemini"}, "worker") == "gemini/gemini-2.5-flash"


def test_account_default_model_preference_order_is_deterministic():
    # M-thrift REORDERED the walk: nvidia_nim FIRST, openrouter LAST. openrouter's free tier is
    # credit-metered, so a low-balance key is refused outright (402) where NIM's request-metered
    # tier only throttles — and the tie-break's job is to maximise the chance a new account's first
    # run succeeds. Was: openrouter won this pair.
    for capability in CAPABILITIES:
        assert (
            account_default_model({"nvidia_nim", "openrouter"}, capability)
            == "nvidia_nim/openai/gpt-oss-20b"
        ), capability
    # The relative order of everything between the two moved entries is UNCHANGED.
    assert _PROVIDER_DEFAULT_ORDER == (
        "nvidia_nim",
        "openai",
        "gemini",
        "groq",
        "deepseek",
        "openrouter",
    )


def test_catalogue_slugs_canonicalize_to_their_own_key_in_both_seats():
    # Each declared value's leading slug segment must equal its key (the one canonicalization rule).
    # `PROVIDER_DEFAULT_MODEL` was a single derived map; with two seats there are two to check, and
    # a `None` seat declares nothing to check rather than a slug to get wrong.
    for provider in PROVIDER_CATALOGUE:
        for capability in CAPABILITIES:
            for model in [
                catalogue_default(provider, capability),
                *catalogue_presets(provider, capability),
            ]:
                if model is not None:
                    assert model.split("/", 1)[0] == provider, (provider, capability, model)


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
