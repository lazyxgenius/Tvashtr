"""Secret hardening: no ``Settings`` secret may surface in a repr, a log line, or a traceback.

THE INCIDENT THIS PINS: a pytest traceback rendered a frame whose locals held a ``Settings``
instance, and because the secret fields were plain ``str`` the repr carried their PLAINTEXT — so
the Fly API token, the GitHub App client secret and the GitHub App private key were dumped into a
transcript (and had to be rotated). This is not hypothetical for this suite specifically: the
Makefile does ``include .env`` + ``export``, so the operator's REAL secrets are ambient in
``make test`` (see ``test_config_sandbox._fly_clean``'s note) — any traceback that renders a
Settings local is a live credential disclosure.

The fix is ``pydantic.SecretStr``, whose repr is ``**********``. These tests are the proof, and
they are mutation-real: they FAIL on plain-``str`` fields (the plaintext is present) and pass only
once every secret field is wrapped. The behaviour pins below guard the other half of the bargain —
``.get_secret_value()`` returns the byte-identical string, so nothing downstream shifts.
"""

import base64
import hashlib
import hmac
import logging
import traceback

import pytest

import tvashtr.config as config_module
from tvashtr.config import Settings
from tvashtr.engines.fly_machines import derive_session_key

# Every secret-bearing field, keyed by the env var that sets it, with a DISTINCT canary value per
# field — distinct so a substring match can never pass by borrowing another field's value, and
# prefixed so a hit in rendered text is unambiguously ours and not incidental.
SECRET_ENV = {
    "TVASHTR_FLY_API_TOKEN": "leakcanary-fly-api-token-aaa",
    "TVASHTR_FLY_SESSION_SECRET": "leakcanary-fly-session-secret-bbb",
    "TVASHTR_SESSION_SECRET": "leakcanary-session-secret-ccc",
    "TVASHTR_SECRET_KEY": "leakcanary-secret-key-ddd",
    "GITHUB_APP_CLIENT_SECRET": "leakcanary-github-client-secret-eee",
    "GITHUB_APP_PRIVATE_KEY_B64": "leakcanary-github-private-key-b64-fff",
    "LITELLM_MASTER_KEY": "leakcanary-litellm-master-key-ggg",
}

# The attribute behind each env var, in the same order — the read side of the same seven fields.
SECRET_FIELDS = (
    "fly_api_token",
    "fly_session_secret",
    "session_secret",
    "secret_key",
    "github_app_client_secret",
    "github_app_private_key_b64",
    "litellm_master_key",
)

MASK = "**********"


@pytest.fixture
def canary_settings(monkeypatch) -> Settings:
    """A ``Settings`` whose every secret is a known canary, built through the REAL env path.

    ``_env_file=None`` keeps the operator's ``.env`` out of it, so the only values in play are the
    canaries — which makes "is this plaintext present?" a decidable question.
    """
    for name, value in SECRET_ENV.items():
        monkeypatch.setenv(name, value)
    return Settings(_env_file=None)


def _assert_no_canary_in(rendered: str, where: str) -> None:
    leaked = sorted(name for name, value in SECRET_ENV.items() if value in rendered)
    assert not leaked, f"{where} leaked the PLAINTEXT of: {', '.join(leaked)}"


# ---- The leak proofs (RED on plain-str fields) ----


def test_repr_masks_every_secret(canary_settings):
    """``repr(Settings)`` — what a logger, a debugger, or ``print`` emits — carries no plaintext."""
    rendered = repr(canary_settings)
    _assert_no_canary_in(rendered, "repr(Settings)")
    # Positive control: the masking must be VISIBLY present, so this test can never pass merely
    # because the repr went empty or the field vanished from it.
    assert rendered.count(MASK) >= len(SECRET_ENV), (
        f"expected >= {len(SECRET_ENV)} masked secrets in the repr, saw {rendered.count(MASK)}"
    )


def test_str_masks_every_secret(canary_settings):
    """``str(Settings)`` / f-string interpolation is the other half of the accidental-print path."""
    _assert_no_canary_in(str(canary_settings), "str(Settings)")
    _assert_no_canary_in(f"{canary_settings}", "f-string interpolation of Settings")


def test_formatted_traceback_masks_every_secret(canary_settings):
    """THE INCIDENT, reproduced: a full traceback string that carries the settings object.

    ``traceback.format_exc`` is the NON-TRUNCATING renderer — it is what ``logging`` calls for
    ``exc_info=True`` and what any crash handler prints. (Deliberately not pytest's
    ``getrepr(showlocals=True)``: that abbreviates a long repr to ~240 chars with an ellipsis in
    the middle, which can hide a canary by sheer field ORDER. Truncation is an accident of
    formatting, not a security control, so pinning against it would be a test that passes for the
    wrong reason.)
    """

    def a_frame_that_holds_settings(settings: Settings) -> None:
        raise RuntimeError(f"exploded while configured: {settings!r}")

    try:
        a_frame_that_holds_settings(canary_settings)
    except RuntimeError:
        rendered = traceback.format_exc()
    assert "a_frame_that_holds_settings" in rendered, "the traceback must actually be rendered"
    _assert_no_canary_in(rendered, "a formatted traceback carrying Settings")


def test_logged_exception_masks_every_secret(canary_settings, caplog):
    """The log path: ``logger.exception`` with the settings object in play writes no plaintext."""
    logger = logging.getLogger("tvashtr.test.secret_hardening")
    with caplog.at_level(logging.ERROR, logger=logger.name):
        try:
            raise RuntimeError(f"startup failed: {canary_settings!r}")
        except RuntimeError:
            logger.exception("configuration error, settings=%r", canary_settings)
    _assert_no_canary_in(caplog.text, "a logged exception carrying Settings")


def test_exception_message_containing_settings_masks_every_secret(canary_settings):
    """An error string built from the settings object — the other way one reaches a log."""
    with pytest.raises(RuntimeError) as excinfo:
        raise RuntimeError(f"startup failed with config: {canary_settings!r}")
    _assert_no_canary_in(str(excinfo.value), "an exception message interpolating Settings")


# ---- The behaviour pins: masking must not change a single downstream byte ----


def test_get_secret_value_returns_the_identical_plaintext(canary_settings):
    """The whole change is exposure-only: every secret still reads back byte-identical."""
    for field, expected in zip(SECRET_FIELDS, SECRET_ENV.values(), strict=True):
        actual = getattr(canary_settings, field).get_secret_value()
        assert actual == expected, f"{field} did not round-trip to its configured value"


def test_litellm_master_key_is_none_when_unset(monkeypatch):
    """The one optional secret keeps its ``None`` (not ``SecretStr("")``) unset signal — the
    truthiness every proxy call site branches on."""
    monkeypatch.delenv("LITELLM_MASTER_KEY", raising=False)
    assert Settings(_env_file=None).litellm_master_key is None


def test_unconfigured_fly_token_stays_falsy(monkeypatch):
    """``fly_api_token``'s empty default is a GUARD (``fly_reaper`` skips the sweep on it).

    Both halves are pinned deliberately. The unwrapped plaintext is what the production guard
    actually tests, and the bare object is pinned too because it is NOT obvious: pydantic's
    ``SecretStr`` defines ``__len__`` and no ``__bool__``, so an empty one is falsy by delegating
    to its length. Call sites here do not rely on that, but if a future pydantic added a
    ``__bool__`` — making ``SecretStr("")`` truthy — every "is it configured?" guard in the
    codebase would silently invert, and an unconfigured install would start calling the Fly API.
    This is the tripwire for that.
    """
    monkeypatch.delenv("TVASHTR_FLY_API_TOKEN", raising=False)
    token = Settings(_env_file=None).fly_api_token
    assert token.get_secret_value() == ""
    assert not token.get_secret_value(), "the unconfigured-install guard must stay falsy"
    assert not token, "an empty SecretStr must stay falsy (pydantic __len__, no __bool__)"


# The derived per-run agent-server key, pinned to the value the PRE-SecretStr code produced.
# Computed from ``derive_session_key("run-abc-123", "pinned-test-secret")`` on the plain-``str``
# build. It is the sharpest mutation detector in this file: HMAC over the MASKED text
# (``**********``) — i.e. a call site that forgot ``.get_secret_value()`` — yields a completely
# different key, which would strand every parked sandbox behind an unre-derivable credential.
PINNED_RUN_ID = "run-abc-123"
PINNED_SECRET = "pinned-test-secret"
PINNED_SESSION_KEY = "8zaBL7ujVB1PJPW-YyxRinjuIHa6fxuMpw3EqMVmMQk"


def test_derive_session_key_is_byte_identical_to_the_pre_secretstr_value():
    """The pure path: an explicitly-passed secret still HMACs to the historical key."""
    assert derive_session_key(PINNED_RUN_ID, PINNED_SECRET) == PINNED_SESSION_KEY


def test_settings_sourced_derivation_hmacs_the_plaintext_not_the_mask(monkeypatch):
    """The SETTINGS-sourced path (``secret=None``) must feed HMAC the PLAINTEXT bytes.

    This is the read site that changes type, so it gets its own pin: patch in a Settings carrying
    the known secret and require the historical key back. Forgetting ``.get_secret_value()`` here
    would HMAC ``"**********"`` and silently re-key every run.
    """
    pinned = Settings(_env_file=None, fly_session_secret=PINNED_SECRET)
    monkeypatch.setattr(config_module, "get_settings", lambda: pinned)
    assert derive_session_key(PINNED_RUN_ID) == PINNED_SESSION_KEY


def test_derived_key_matches_a_hand_computed_hmac_of_the_raw_secret(canary_settings, monkeypatch):
    """Independently recompute the HMAC from the canary plaintext — no constant to drift."""
    monkeypatch.setattr(config_module, "get_settings", lambda: canary_settings)
    raw = SECRET_ENV["TVASHTR_FLY_SESSION_SECRET"]
    expected_digest = hmac.new(
        raw.encode("utf-8"), b"run-independent-check", hashlib.sha256
    ).digest()
    expected = base64.urlsafe_b64encode(expected_digest).decode("ascii").rstrip("=")
    assert derive_session_key("run-independent-check") == expected
