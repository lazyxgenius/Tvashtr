"""Reproduce-first (brief §5a): per-owner key resolution returns the OWNER's key — never another
owner's, never an ``.env`` value.

On the pre-Slice-B code there is no ``resolve_owner_api_key`` and the key came from ``.env``
regardless of owner, so per-owner resolution could not even be expressed. These assert the new
behavior: ownerA resolves ownerA's stored key, ownerB resolves ownerB's, an env var of the same
provider is IGNORED, and an owner with no credential for the provider raises ``NoCredentialError``.
"""

import uuid

import pytest

from tvashtr.control_plane.credentials import (
    NoCredentialError,
    encrypt_secret,
    provider_for_model,
    resolve_owner_api_key,
)
from tvashtr.db import session_scope
from tvashtr.models import ProviderCredential, User


def _make_user() -> uuid.UUID:
    uid = uuid.uuid4()
    with session_scope() as session:
        session.add(User(id=uid, email=f"resolve-{uid.hex}@tvashtr.local", password_hash="x"))
    return uid


def _add_cred(owner_id: uuid.UUID, provider: str, plaintext: str) -> None:
    with session_scope() as session:
        session.add(
            ProviderCredential(
                owner_id=owner_id,
                provider=provider,
                secret_encrypted=encrypt_secret(plaintext),
                key_last4=plaintext[-4:],
            )
        )


def test_resolve_returns_this_owners_key_not_anothers(client, monkeypatch):
    owner_a = _make_user()
    owner_b = _make_user()
    _add_cred(owner_a, "openrouter", "A-KEY-aaaa")
    _add_cred(owner_b, "openrouter", "B-KEY-bbbb")

    # An .env value of the SAME provider must be ignored — the DB key wins, per owner.
    monkeypatch.setenv("OPENROUTER_API_KEY", "ENV-KEY-should-not-be-used")

    assert (
        resolve_owner_api_key(owner_a, "openrouter/meta-llama/llama-3.1-8b-instruct")
        == "A-KEY-aaaa"
    )
    assert (
        resolve_owner_api_key(owner_b, "openrouter/meta-llama/llama-3.1-8b-instruct")
        == "B-KEY-bbbb"
    )


def test_resolve_maps_model_slug_to_provider(client):
    owner = _make_user()
    _add_cred(owner, "nvidia_nim", "NIM-KEY-1234")
    # The leading slug segment is the provider — nvidia_nim/<model> resolves the nvidia_nim cred.
    assert resolve_owner_api_key(owner, "nvidia_nim/meta/llama-3.3-70b-instruct") == "NIM-KEY-1234"


def test_resolve_raises_when_owner_lacks_the_provider(client):
    owner = _make_user()
    _add_cred(owner, "openrouter", "only-openrouter")
    # The owner has openrouter but NOT openai → a typed error (no .env fallback).
    with pytest.raises(NoCredentialError) as exc:
        resolve_owner_api_key(owner, "openai/gpt-4o-mini")
    assert exc.value.provider == "openai"


def test_provider_for_model_is_lowercased_leading_segment():
    assert provider_for_model("OpenRouter/Foo/Bar") == "openrouter"
    assert provider_for_model("nvidia_nim/meta/llama-3.3-70b-instruct") == "nvidia_nim"
    assert provider_for_model("gpt-4o-mini") == "gpt-4o-mini"  # no slash → the whole slug
