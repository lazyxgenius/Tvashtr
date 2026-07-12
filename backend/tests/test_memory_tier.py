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


def test_invalid_tier_node_without_repo_raises():
    with pytest.raises(InvalidTierError):
        memory_tier(None, _NODE)


def test_is_valid_tier_matrix():
    assert is_valid_tier(None, None) is True
    assert is_valid_tier("/r", None) is True
    assert is_valid_tier("/r", _NODE) is True
    assert is_valid_tier(None, _NODE) is False  # the one invalid combination


def test_tier_is_exact_not_loose():
    # Non-vacuity: a repo-scoped fact is EXACTLY "repo" — not "node"/"account". A bug that keyed
    # the tier off node_id's presence loosely (or defaulted wrong) fails here.
    assert memory_tier("/repo", None) == "repo"
    assert memory_tier("/repo", None) != "node"
    assert memory_tier(None, None) != "repo"
