"""M-accounts Slice B seed: import the operator's .env provider keys ONCE + backfill owner_id-NULL
rows — idempotently.

Env vars are monkeypatched (set/unset) so the assertions don't depend on the operator's real .env:
a SET var imports an encrypted, decryptable credential; an unset one is skipped; a re-import upserts
(no duplicates); and the backfill claims owner-less runs + library teams (but not ephemeral
non-library graphs), and is a no-op the second time.
"""

import uuid

from sqlalchemy import select

from tvashtr.control_plane.credentials import decrypt_secret
from tvashtr.db import session_scope
from tvashtr.models import ProviderCredential, Run, TeamGraph, User
from tvashtr.seed import backfill_owner, import_env_provider_keys

# Every provider env var the seed reads — cleared per test so only what we set is seen. (Includes
# DEEPSEEK_API_KEY so the count assertions below stay deterministic: `make test` exports the real
# .env DEEPSEEK_API_KEY into os.environ, and once the seed maps deepseek an uncleared value would be
# imported and skew the exact-count tests.)
_ALL_ENV = [
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GROQ_CLOUD_API_KEY",
    "GROQ_API_KEY",
    "NVIDIA_BUILD_API_KEY",
    "NVIDIA_NIM_API_KEY",
    "DEEPSEEK_API_KEY",
]


def _operator() -> uuid.UUID:
    uid = uuid.uuid4()
    with session_scope() as session:
        session.add(User(id=uid, email=f"seed-op-{uid.hex}@tvashtr.local", password_hash="x"))
    return uid


def _clear_env(monkeypatch):
    for name in _ALL_ENV:
        monkeypatch.delenv(name, raising=False)


def _creds(owner_id: uuid.UUID) -> dict[str, ProviderCredential]:
    with session_scope() as session:
        rows = (
            session.execute(
                select(ProviderCredential).where(ProviderCredential.owner_id == owner_id)
            )
            .scalars()
            .all()
        )
        return {r.provider: r for r in rows}


def test_import_creates_encrypted_creds_for_set_env_vars(client, monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-real-1111")
    monkeypatch.setenv("NVIDIA_BUILD_API_KEY", "nvapi-real-2222")  # NIM via the repo var name
    op = _operator()

    assert import_env_provider_keys(op) == 2  # only the two SET providers
    creds = _creds(op)
    assert set(creds) == {"openrouter", "nvidia_nim"}  # gemini/openai/groq unset → skipped
    assert decrypt_secret(creds["openrouter"].secret_encrypted) == "sk-or-real-1111"
    assert creds["openrouter"].key_last4 == "1111"
    assert decrypt_secret(creds["nvidia_nim"].secret_encrypted) == "nvapi-real-2222"


def test_import_creates_deepseek_credential_from_env(client, monkeypatch):
    """M-rung2 blocker A (reproduce-first): the DeepSeek go-forward agent model
    (`deepseek/deepseek-chat`) resolves to provider `deepseek`, so `make seed` MUST import
    DEEPSEEK_API_KEY into the operator's provider_credentials — else every review_loop node's launch
    pre-flight refuses with 422 missing_providers=["deepseek"]. RED before `ENV_PROVIDER_MAP` gains
    the deepseek entry (the seed silently drops the key); GREEN after. Not vacuous: DEEPSEEK_API_KEY
    is set explicitly here, so the RED proves the MAP drops it, not that the env var is absent."""
    _clear_env(monkeypatch)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-deepseek-real-9999")
    op = _operator()

    assert import_env_provider_keys(op) == 1  # deepseek is the only SET provider
    creds = _creds(op)
    assert "deepseek" in creds, "seed dropped DEEPSEEK_API_KEY — no deepseek provider credential"
    assert decrypt_secret(creds["deepseek"].secret_encrypted) == "sk-deepseek-real-9999"
    assert creds["deepseek"].key_last4 == "9999"


def test_import_uses_groq_cloud_then_falls_back_to_groq(client, monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("GROQ_API_KEY", "gsk-fallback-3333")  # only the litellm-standard name set
    op = _operator()
    import_env_provider_keys(op)
    assert decrypt_secret(_creds(op)["groq"].secret_encrypted) == "gsk-fallback-3333"


def test_import_is_idempotent_upsert(client, monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-aaaa")
    op = _operator()
    import_env_provider_keys(op)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-bbbb")  # the key changed in .env
    assert import_env_provider_keys(op) == 1
    creds = _creds(op)
    assert len(creds) == 1  # upsert, NOT a duplicate row
    assert decrypt_secret(creds["openai"].secret_encrypted) == "sk-openai-bbbb"  # replaced


def test_import_skips_all_when_no_env_keys(client, monkeypatch):
    _clear_env(monkeypatch)
    op = _operator()
    assert import_env_provider_keys(op) == 0
    assert _creds(op) == {}


def test_backfill_claims_owner_less_runs_and_library_teams_only(client, monkeypatch):
    op = _operator()
    # An owner-less library team, an owner-less ephemeral (non-library) graph, + an owner-less run.
    with session_scope() as session:
        lib = TeamGraph(name="orphan library", is_library=True)
        ephem = TeamGraph(name="orphan snapshot", is_library=False)
        session.add_all([lib, ephem])
        session.flush()
        lib_id, ephem_id = lib.id, ephem.id
        run = Run(
            id=uuid.uuid4(),
            team_graph_id=ephem_id,
            idea="orphan run",
            workflow_id=str(uuid.uuid4()),
            status="completed",
        )
        session.add(run)
        run_id = run.id

    runs_n, teams_n = backfill_owner(op)
    assert runs_n >= 1 and teams_n >= 1
    with session_scope() as session:
        assert session.get(Run, run_id).owner_id == op  # the run is claimed
        assert session.get(TeamGraph, lib_id).owner_id == op  # the library team is claimed
        assert session.get(TeamGraph, ephem_id).owner_id is None  # the ephemeral graph stays NULL

    # Idempotent: a second backfill finds nothing this run/team left NULL (0 from THIS pair).
    with session_scope() as session:
        remaining_runs = session.execute(select(Run).where(Run.owner_id.is_(None))).scalars().all()
    # (other tests may leave their own owner-less rows; just assert ours are no longer among them)
    assert all(r.id != run_id for r in remaining_runs)
