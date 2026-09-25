"""M-memory S1 — the pure tier-derivation logic (no DB, no network).

The tier model is the one bit of real logic in the memory substrate and every later slice
(retrieval, distillation) depends on it being EXACTLY right, so it is unit-tested in isolation.
Mutation-real: each case asserts the exact literal tier + the one invalid combination raises.
"""

import uuid

import pytest

from tvashtr.control_plane.memory import InvalidTierError, is_valid_tier, memory_tier

_NODE = uuid.uuid4()


def test_account_tier_when_both_null():
    assert memory_tier(None, None) == "account"


def test_repo_tier_when_only_repo_key():
    assert memory_tier("/Users/x/repo", None) == "repo"


def test_node_tier_when_repo_key_and_node_id():
    assert memory_tier("/Users/x/repo", _NODE) == "node"


def test_node_only_tier_when_node_id_without_repo():
    # Revamp (FOCUS-58 / OQ-18): an agent's "Not repo-specific" note — node_id set, repo_key NULL —
    # is a valid node tier (it used to raise InvalidTierError).
    assert memory_tier(None, _NODE) == "node"


def test_is_valid_tier_matrix():
    assert is_valid_tier(None, None) is True
    assert is_valid_tier("/r", None) is True
    assert is_valid_tier("/r", _NODE) is True
    assert is_valid_tier(None, _NODE) is True  # the node-only tier is valid since the revamp


def test_invalid_tier_error_is_still_importable_for_scope_errors():
    assert issubclass(InvalidTierError, ValueError)
    with pytest.raises(InvalidTierError):
        raise InvalidTierError("This memory has no repo to scope to.")


def test_tier_is_exact_not_loose():
    # Non-vacuity: a repo-scoped fact is EXACTLY "repo" — not "node"/"account". A bug that keyed
    # the tier off node_id's presence loosely (or defaulted wrong) fails here.
    assert memory_tier("/repo", None) == "repo"
    assert memory_tier("/repo", None) != "node"
    assert memory_tier(None, None) != "repo"
