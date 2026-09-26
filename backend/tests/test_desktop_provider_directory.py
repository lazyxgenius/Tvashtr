"""``provider_directory[].serves_models`` (desktop-app.md §3, DT-26 / OQ-38).

A provider the catalogue declares no seat model for, and that no Domains embedding uses, serves
nothing Tvashtr can run: ``serves_models`` is false and its hint says so, so no Desktop setup
screen invites a key for it (NVIDIA NIM today). Additive: every other key is unchanged.
"""

from tvashtr.control_plane.domain_embedding import EMBEDDING_CATALOGUE
from tvashtr.control_plane.provider_directory import public_provider_directory
from tvashtr.control_plane.teams import PROVIDER_CATALOGUE


def test_every_entry_says_whether_it_serves_a_model():
    embedding = {str(e["provider"]) for e in EMBEDDING_CATALOGUE.values()}
    for entry in public_provider_directory():
        cat = PROVIDER_CATALOGUE.get(entry["provider"]) or {}
        expected = (
            cat.get("thinker_default") is not None
            or cat.get("worker_default") is not None
            or entry["provider"] in embedding
        )
        assert entry["serves_models"] is expected, entry["provider"]
        if not expected:
            assert entry["hint"] == f"{entry['name']} serves no model Tvashtr can run right now."


def test_nvidia_nim_serves_no_model():
    nim = next(e for e in public_provider_directory() if e["provider"] == "nvidia_nim")
    assert nim["serves_models"] is False
    assert nim["hint"] == "NVIDIA NIM serves no model Tvashtr can run right now."


def test_config_serves_the_new_key_additively(unauth_client):
    body = unauth_client.get("/api/config").json()
    by = {e["provider"]: e for e in body["provider_directory"]}
    assert by["anthropic"]["serves_models"] is True
    assert by["huggingface"]["serves_models"] is True, "embeddings count"
    assert by["nvidia_nim"]["serves_models"] is False
    assert set(by["anthropic"]) == {
        "provider",
        "monogram",
        "name",
        "label",
        "example_model",
        "subscription",
        "embeddings",
        "hint",
        "serves_models",
    }
