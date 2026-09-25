"""Per-account UI preferences (revamp G-10), stored in ``users.preferences`` (JSONB).

A WHITELIST: only the keys in :data:`PREFERENCE_DEFAULTS` can be stored, each with a fixed type, so
the column never collects arbitrary client state. Reads merge the defaults server-side, so a key
the account never set reads as its default (and a stale stored key no longer in the whitelist is
never returned).
"""

import uuid

from tvashtr.db import session_scope
from tvashtr.models import User

# key -> default. ``get_started_hidden``: the account hid Home's get-started checklist.
PREFERENCE_DEFAULTS: dict[str, bool] = {"get_started_hidden": False}


class PreferenceError(ValueError):
    """A preference patch the whitelist rejects (the endpoint's 422, ``str(exc)`` is the copy)."""


def _merged(stored: dict | None) -> dict:
    stored = stored or {}
    return {key: stored.get(key, default) for key, default in PREFERENCE_DEFAULTS.items()}


def validate_patch(patch: dict) -> dict:
    """Return ``patch`` if every key is known and every value has the key's type, else raise
    :class:`PreferenceError` naming the first problem (keys checked in sorted order)."""
    for key in sorted(patch):
        if key not in PREFERENCE_DEFAULTS:
            raise PreferenceError(f"Unknown preference: {key}.")
        expected = type(PREFERENCE_DEFAULTS[key])
        if type(patch[key]) is not expected:  # exact: True is an int, 1 is not a bool
            raise PreferenceError(f"{key} must be true or false.")
    return patch


def get_preferences(owner_id: uuid.UUID) -> dict | None:
    """The account's preferences with defaults merged in; ``None`` if the user no longer exists."""
    with session_scope() as session:
        user = session.get(User, owner_id)
        if user is None:
            return None
        return _merged(user.preferences)


def update_preferences(owner_id: uuid.UUID, patch: dict) -> dict | None:
    """Merge a validated ``patch`` into the account's stored preferences and return the full merged
    object (``None`` if the user no longer exists). Raises :class:`PreferenceError` first."""
    validate_patch(patch)
    with session_scope() as session:
        user = session.get(User, owner_id)
        if user is None:
            return None
        # A NEW dict, so SQLAlchemy sees the JSONB column change.
        user.preferences = {**(user.preferences or {}), **patch}
        return _merged(user.preferences)
