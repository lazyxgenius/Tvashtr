"""M-seat — a node's default model is chosen for its SEAT, not just for its provider.

``PROVIDER_CATALOGUE`` declared ONE ``default_model`` per provider and ``_node_default_model``
handed it to every model-bearing node, so the walk over ``_PROVIDER_DEFAULT_ORDER`` could only ever
answer "which provider?" — never "can that provider's model do this job?". The two seats are not
interchangeable:

* a THINKER makes one completion and returns a deliverable;
* a WORKER drives the OpenHands agent loop — tool calls, content blocks, a long transcript.

A model can be excellent at the first and unable to do the second. M-live proved it live: the
nvidia_nim default drove the PM node to a real PRD and a UI-approved gate, then died at the Engineer
on an empty-bodied provider 400. The catalogue now declares ``thinker_default`` and
``worker_default`` separately, ``None`` is a legal worker answer meaning "this provider cannot serve
a worker seat", and the walk YIELDS that seat to the next held provider.

These tests are seat logic, not slug lore: the ones that matter monkeypatch a synthetic catalogue so
they keep pinning the behaviour whatever a vendor retires next. The live-catalogue tests below assert
only the invariants the catalogue must satisfy, never a particular slug.
"""

import pytest

from tvashtr.control_plane import teams as teams_mod
from tvashtr.control_plane.credentials import provider_for_model
from tvashtr.control_plane.teams import (
    PROVIDER_CATALOGUE,
    account_default_model,
    account_fallback_model,
    catalogue_default,
    catalogue_presets,
    public_provider_catalogue,
)

# A provider that is a fine thinker and CANNOT serve a worker seat, ahead of one that can do both.
# This is the exact shape M-live hit, reduced to two providers and no network.
_SYNTHETIC = {
    "thinkeronly": {
        "thinker_default": "thinkeronly/talker",
        "worker_default": None,
        "thinker_presets": ["thinkeronly/talker"],
        "worker_presets": [],
    },
    "bothseats": {
        "thinker_default": "bothseats/talker",
        "worker_default": "bothseats/builder",
        "thinker_presets": ["bothseats/talker"],
        "worker_presets": ["bothseats/builder"],
    },
    "unheld": {
        "thinker_default": "unheld/talker",
        "worker_default": "unheld/builder",
        "thinker_presets": ["unheld/talker"],
        "worker_presets": ["unheld/builder"],
    },
}


@pytest.fixture
def synthetic_catalogue(monkeypatch):
    """Swap in the two-provider catalogue above, with the thinker-only provider FIRST."""
    monkeypatch.setattr(teams_mod, "PROVIDER_CATALOGUE", _SYNTHETIC)
    monkeypatch.setattr(
        teams_mod, "_PROVIDER_DEFAULT_ORDER", ("thinkeronly", "bothseats", "unheld")
    )
    return _SYNTHETIC


# --------------------------------------------------------------------------- the regression ----


def test_worker_seat_is_never_stamped_with_a_thinker_only_default(synthetic_catalogue):
    """THE M-seat REGRESSION. The account holds the thinker-only provider FIRST, so the old
    provider-only walk stamped its model on every seat — including the worker that cannot run it."""
    held = {"thinkeronly", "bothseats"}
    assert account_default_model(held, "thinker") == "thinkeronly/talker"
    assert account_default_model(held, "worker") == "bothseats/builder"


def test_a_worker_node_built_for_that_account_gets_the_worker_model(synthetic_catalogue):
    """The same regression at the seat the user actually sees: the builder's stamp."""
    held = {"thinkeronly", "bothseats"}
    assert teams_mod._node_default_model(held, "legacy/fallback", "worker") == "bothseats/builder"
    assert teams_mod._node_default_model(held, "legacy/fallback", "thinker") == "thinkeronly/talker"


def test_a_capability_with_no_live_model_anywhere_falls_back_to_the_legacy_default(
    synthetic_catalogue,
):
    """Holding ONLY the thinker-only provider leaves the worker seat with no catalogued answer.
    That must reach the caller's legacy default, never ``None`` (the column is NOT NULL) and never
    the thinker slug."""
    held = {"thinkeronly"}
    assert account_default_model(held, "worker") is None
    assert teams_mod._node_default_model(held, "legacy/fallback", "worker") == "legacy/fallback"


def test_fallback_model_is_also_seat_aware(synthetic_catalogue):
    """The fallback is the SECOND provider of the same walk — so it has to walk the same capability.
    A worker's failover target that only serves thinkers is a safety net tied to nothing, and a
    capability-blind walk would hand the worker seat its OWN primary provider back."""
    held = {"thinkeronly", "bothseats", "unheld"}
    # thinker: thinkeronly is first, bothseats second.
    assert account_fallback_model(held, "thinker") == "bothseats/talker"
    # worker: thinkeronly declares no worker model, so bothseats is FIRST and unheld is second.
    assert account_fallback_model(held, "worker") == "unheld/builder"
    # ...and primary and fallback still name different providers, the property that makes failover
    # cross a real vendor boundary.
    primary = account_default_model(held, "worker")
    assert provider_for_model(primary) != provider_for_model(account_fallback_model(held, "worker"))


def test_one_worker_capable_provider_gets_no_worker_fallback(synthetic_catalogue):
    """Only ONE held provider can serve a worker, so there is nowhere to fail over TO."""
    held = {"thinkeronly", "bothseats"}
    assert account_fallback_model(held, "worker") is None
    assert account_fallback_model(held, "thinker") == "bothseats/talker"


def test_unknown_capability_is_refused(synthetic_catalogue):
    """A typo'd capability must not silently resolve to a seat."""
    with pytest.raises(ValueError):
        account_default_model({"bothseats"}, "reviewer")


# ------------------------------------------------------------------- the live catalogue ----


@pytest.mark.parametrize("provider", sorted(PROVIDER_CATALOGUE))
def test_every_catalogue_slug_canonicalizes_to_its_provider(provider):
    """The invariant M-runnable pinned, now across both seats: a slug filed under a provider must
    actually BE that provider's (otherwise the key resolution at run time picks the wrong secret)."""
    for capability in ("thinker", "worker"):
        for slug in catalogue_presets(provider, capability):
            assert provider_for_model(slug) == provider, f"{slug} filed under {provider}"
        default = catalogue_default(provider, capability)
        if default is not None:
            assert provider_for_model(default) == provider


@pytest.mark.parametrize("provider", sorted(PROVIDER_CATALOGUE))
def test_every_catalogue_default_is_one_of_its_own_presets(provider):
    """A default the picker does not offer is a default nobody can get back to after editing."""
    for capability in ("thinker", "worker"):
        default = catalogue_default(provider, capability)
        if default is not None:
            assert default in catalogue_presets(provider, capability)


@pytest.mark.parametrize("provider", sorted(PROVIDER_CATALOGUE))
def test_a_capability_with_no_default_offers_no_presets(provider):
    """``worker_default: None`` means "cannot serve a worker seat" — so the picker must not offer
    that provider's models for a worker node either. The two have to agree or the UI invites the
    exact failure the default avoids."""
    for capability in ("thinker", "worker"):
        if catalogue_default(provider, capability) is None:
            assert catalogue_presets(provider, capability) == []


def test_the_public_catalogue_serves_both_seats():
    """``GET /api/config`` carries the split, or the FE picker cannot honour it."""
    served = public_provider_catalogue()
    assert served, "the public catalogue must not be empty"
    for entry in served:
        assert set(entry) == {
            "provider",
            "thinker_default",
            "worker_default",
            "thinker_presets",
            "worker_presets",
        }
        provider = entry["provider"]
        assert entry["thinker_default"] == catalogue_default(provider, "thinker")
        assert entry["worker_default"] == catalogue_default(provider, "worker")
    # ...and it stays PUBLIC: slugs only, never key material.
    assert not any("key" in k for entry in served for k in entry)
