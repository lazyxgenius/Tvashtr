"""M-accounts Slice C: the account-aware node-create default.

Discriminating (not smoke): the pure ``account_default_model`` returns the EXACT slug per
provider-set (and the preference order is pinned), and the ``POST /api/teams/{id}/nodes`` endpoint
applies it — a node dropped by an account holding nvidia_nim + openai gets the openai slug (NIM
serves no seat since 2026-09-26), an account holding NO providers gets the legacy hardcoded default,
and an explicit ``model`` is preserved. A test that would pass with the logic inverted is not
acceptable; each case asserts the exact value.
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
    # M-seat: the walk now takes a SEAT. Exact slugs, not "something is set" — and openrouter is
    # here because it is the one provider whose two seats resolve to DIFFERENT models, so a
    # capability-blind regression cannot hide behind a provider that answers both the same. (That
    # was openai until 2026-09-26: its thinker moved from gpt-4o-mini to gpt-4.1-mini, the model
    # its worker already runs, because gpt-4o-mini failed the entry node's REPORT.md job 4/4 live.)
    # nvidia_nim serves NO seat (deliberate catalogue rulings, see the catalogue comment): no worker
    # since 2026-09-25 (minimax-m3 retired, HTTP 410; gpt-oss-20b breaks the real worker loop) and
    # no thinker since 2026-09-26 (gpt-oss-20b hangs, HTTP 000 on every probe). A NIM-only account
    # has no default in either seat — the walk answers None for both.
    assert account_default_model({"nvidia_nim"}, "worker") is None
    assert account_default_model({"nvidia_nim"}, "thinker") is None
    assert account_default_model({"groq"}, "worker") == "groq/openai/gpt-oss-120b"
    assert account_default_model({"openai"}, "worker") == "openai/gpt-4.1-mini"
    assert account_default_model({"openai"}, "thinker") == "openai/gpt-4.1-mini"
    assert account_default_model({"openrouter"}, "worker") == "openrouter/openai/gpt-4o-mini"
    assert account_default_model({"openrouter"}, "thinker") == "openrouter/openai/gpt-4.1-mini"


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
    # run succeeds. Was: openrouter won this pair. Since 2026-09-26 nvidia_nim declares NO seat
    # (worker 2026-09-25, thinker 2026-09-26), so it still leads the order but yields EVERY seat —
    # the NIM + openrouter pair now lands wholly on openrouter.
    for capability in CAPABILITIES:
        assert catalogue_default("nvidia_nim", capability) is None, capability
        assert account_default_model({"nvidia_nim", "openrouter"}, capability) == (
            catalogue_default("openrouter", capability)
        ), capability
        # openrouter stays LAST: a provider that serves the seat and sits between the two moved
        # entries still beats it (it won this pair before M-thrift too, so this discriminates).
        assert account_default_model({"openai", "openrouter"}, capability) == (
            catalogue_default("openai", capability)
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
    c.post("/api/providers", json={"provider": "openai", "api_key": "sk-dummy-key"})
    team_id = _blank_team(c)
    node = c.post(f"/api/teams/{team_id}/nodes", json={"node_kind": "worker"}).json()
    # nvidia_nim leads the order but declares no seat (worker 2026-09-25, thinker 2026-09-26), so
    # the WORKER default is the next held provider's, exactly — never the legacy default, never a
    # NIM slug.
    assert node["model"] == "openai/gpt-4.1-mini"


def test_nim_plus_openai_account_stamps_every_seat_on_openai():
    """The NIM seat rulings, end to end through the API: an account holding nvidia_nim + openai
    creates the PM -> Engineer <-> Reviewer template. NIM leads the preference order but serves no
    seat — no worker since 2026-09-25 (minimax-m3 retired; gpt-oss-20b breaks the loop), no thinker
    since 2026-09-26 (gpt-oss-20b hangs) — so it yields BOTH: the THINKER (PM) gets OpenAI's thinker
    default and both WORKERS (Engineer, Reviewer) get OpenAI's worker default. No node is stamped
    with a dead, loop-breaking or hanging NIM slug."""
    c = _fresh_account()
    c.post("/api/providers", json={"provider": "nvidia_nim", "api_key": "nv-dummy-key"})
    c.post("/api/providers", json={"provider": "openai", "api_key": "sk-dummy-key"})
    resp = c.post("/api/teams", json={"template": "review_loop", "name": "nim + openai"})
    assert resp.status_code == 200, resp.text
    team_id = resp.json()["team_graph_id"]
    graph = c.get(f"/api/teams/{team_id}/graph").json()
    by_role = {n["role_name"]: n for n in graph["nodes"]}

    assert catalogue_default("nvidia_nim", "thinker") is None
    assert catalogue_default("nvidia_nim", "worker") is None
    openai_thinker = catalogue_default("openai", "thinker")
    openai_worker = catalogue_default("openai", "worker")
    # 2026-09-26: OpenAI's thinker is gpt-4.1-mini (gpt-4o-mini failed the entry node's REPORT.md
    # job 4/4 live), so both seats now read the same slug — each is still asserted from ITS seat.
    assert openai_thinker == "openai/gpt-4.1-mini"
    assert openai_worker == "openai/gpt-4.1-mini"
    assert by_role["pm"]["model"] == openai_thinker
    assert by_role["engineer"]["model"] == openai_worker
    assert by_role["reviewer"]["model"] == openai_worker
    assert not any(str(n["model"] or "").startswith("nvidia_nim/") for n in graph["nodes"])


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
