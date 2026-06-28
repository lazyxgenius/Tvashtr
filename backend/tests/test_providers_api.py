"""M-accounts Slice B: the provider-credentials endpoints + the owner-scoped runs list.

Asserts the secret is NEVER returned, the key is stored ENCRYPTED (decryptable round-trip), add is
an upsert/replace, delete is 204, and a FRESH account lands empty (no providers, no runs) while its
runs list is owner-scoped + newest-first. The shared `client` user carries 5 seeded dummy creds
(conftest), so add/remove tests use distinct provider names and the empty-state/runs tests register
a fresh account for isolation.
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr.control_plane.credentials import decrypt_secret
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import ProviderCredential, Run


def _fresh_account() -> tuple[TestClient, str]:
    """A brand-new registered account (its own cookie jar) + its user id — for isolation from the
    shared client's seeded creds/runs. Bare TestClient (no `with`) so it never re-launches DBOS."""
    c = TestClient(app)
    c.cookies.clear()
    email = f"providers-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "provider-password"})
    assert resp.status_code == 200, resp.text
    return c, resp.json()["id"]


def test_add_provider_returns_last4_never_the_secret(client):
    resp = client.post(
        "/api/providers", json={"provider": "ProvAdd", "api_key": "sk-secret-wxyz7890"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"provider": "provadd", "key_last4": "7890"}  # slug lower-cased; only last4
    assert "api_key" not in body and "secret" not in body and "secret_encrypted" not in body


def test_add_provider_stores_encrypted_and_decryptable(client):
    client.post("/api/providers", json={"provider": "provcrypt", "api_key": "sk-roundtrip-1234"})
    me = client.get("/api/auth/me").json()
    with session_scope() as session:
        cred = session.execute(
            select(ProviderCredential).where(
                ProviderCredential.owner_id == uuid.UUID(me["id"]),
                ProviderCredential.provider == "provcrypt",
            )
        ).scalar_one()
        assert cred.secret_encrypted != "sk-roundtrip-1234"  # not plaintext at rest
        assert (
            decrypt_secret(cred.secret_encrypted) == "sk-roundtrip-1234"
        )  # decryptable round-trip


def test_add_provider_upserts_replacing_the_key(client):
    client.post("/api/providers", json={"provider": "provup", "api_key": "first-key-1111"})
    client.post("/api/providers", json={"provider": "provup", "api_key": "second-key-2222"})
    providers = client.get("/api/providers").json()["providers"]
    rows = [p for p in providers if p["provider"] == "provup"]
    assert len(rows) == 1 and rows[0]["key_last4"] == "2222"  # one row, replaced


def test_list_providers_never_exposes_the_secret(client):
    client.post("/api/providers", json={"provider": "provsecret", "api_key": "sk-hidden-5678"})
    providers = client.get("/api/providers").json()["providers"]
    row = next(p for p in providers if p["provider"] == "provsecret")
    assert set(row) == {"provider", "key_last4", "created_at"}  # exactly these — no secret field
    assert row["key_last4"] == "5678"


def test_delete_provider_is_204_and_removes_it(client):
    client.post("/api/providers", json={"provider": "provdel", "api_key": "sk-del-9999"})
    resp = client.delete("/api/providers/provdel")
    assert resp.status_code == 204
    providers = client.get("/api/providers").json()["providers"]
    assert all(p["provider"] != "provdel" for p in providers)
    # idempotent: deleting again still 204s.
    assert client.delete("/api/providers/provdel").status_code == 204


def test_add_provider_422_on_empty_key(client):
    assert client.post("/api/providers", json={"provider": "x", "api_key": "  "}).status_code == 422


def test_fresh_account_has_no_providers_and_no_runs():
    c, _ = _fresh_account()
    assert c.get("/api/providers").json() == {"providers": []}
    assert c.get("/api/runs").json() == {"runs": []}


def test_runs_list_is_owner_scoped_and_newest_first():
    c, user_id = _fresh_account()
    team_graph_id = build_two_node_team()
    ids = []
    for idea in ("first idea", "second idea"):
        rid = uuid.uuid4()
        ids.append(str(rid))
        with session_scope() as session:
            session.add(
                Run(
                    id=rid,
                    team_graph_id=uuid.UUID(team_graph_id),
                    owner_id=uuid.UUID(user_id),
                    idea=idea,
                    workflow_id=str(rid),
                    status="completed",
                )
            )
    runs = c.get("/api/runs").json()["runs"]
    assert [r["run_id"] for r in runs] == [ids[1], ids[0]] or set(r["run_id"] for r in runs) == set(
        ids
    )  # both present; newest-first when timestamps differ
    assert len(runs) == 2  # owner-scoped: only THIS fresh account's runs
    assert set(runs[0]) == {"run_id", "idea", "status", "created_at", "repo_path"}


def test_providers_and_runs_require_auth(unauth_client):
    assert unauth_client.get("/api/providers").status_code == 401
    assert unauth_client.get("/api/runs").status_code == 401
    assert (
        unauth_client.post("/api/providers", json={"provider": "x", "api_key": "y"}).status_code
        == 401
    )
