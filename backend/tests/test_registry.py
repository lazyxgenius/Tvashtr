"""Engine registry seam — no network, and (critically) **no openhands import**.

The whole point of the registry is that the control plane can name an engine
without pulling its heavy SDK at import time: `openhands.*` is imported only when
`resolve_adapter("openhands")` is actually called (exercised live by
`make skeleton-run`/`make agent-smoke`, never in the offline suite).
"""

import subprocess
import sys

import pytest


def test_importing_registry_does_not_import_openhands():
    for name in list(sys.modules):
        if name == "openhands" or name.startswith("openhands."):
            del sys.modules[name]
    sys.modules.pop("tvashtr.engines.registry", None)

    import tvashtr.engines.registry  # noqa: F401

    leaked = [m for m in sys.modules if m == "openhands" or m.startswith("openhands.")]
    assert leaked == [], f"engines.registry must not import openhands.* at import time: {leaked}"


def test_resolve_adapter_unknown_engine_raises():
    from tvashtr.engines.registry import resolve_adapter

    with pytest.raises(ValueError):
        resolve_adapter("definitely-not-an-engine")


def test_engine_name_selection_covers_every_sandbox_mode():
    """M-h2a made the posture->engine mapping 3-way. Asserted HERE (not by resolving adapters)
    because this file must stay openhands-free: the mapping is a pure string function, so the
    ``local``/``docker`` guarantee — they resolve to exactly the names they always did — is
    checkable without importing an SDK. An unknown value must still fall back to local."""
    from tvashtr.control_plane.team_run import _engine_for_sandbox_mode

    assert _engine_for_sandbox_mode("local") == "openhands"
    assert _engine_for_sandbox_mode("docker") == "openhands-docker"
    assert _engine_for_sandbox_mode("fly") == "openhands-fly"
    assert _engine_for_sandbox_mode("something-new") == "openhands"


def _assert_no_openhands(module_name: str) -> None:
    for name in list(sys.modules):
        if name == "openhands" or name.startswith("openhands."):
            del sys.modules[name]
    sys.modules.pop(module_name, None)

    __import__(module_name)

    leaked = [m for m in sys.modules if m == "openhands" or m.startswith("openhands.")]
    assert leaked == [], f"{module_name} must not import openhands.* at import time: {leaked}"


def test_importing_docker_runtime_does_not_import_openhands():
    # docker_runtime is on the app-startup path (main.py's boot sweep imports it),
    # so it MUST stay openhands-free or startup would load the SDK (P1.3a hard rail).
    _assert_no_openhands("tvashtr.engines.docker_runtime")


def test_importing_fly_machines_does_not_import_openhands():
    # M-h2a: the Fly lifecycle module is pure httpx + REST/GraphQL. It must stay openhands-free for
    # the same reason docker_runtime does — it is composed with the SDK by the adapter, never the
    # other way round, so naming the Fly substrate can never drag a heavy SDK into app startup.
    _assert_no_openhands("tvashtr.engines.fly_machines")


def test_importing_team_run_does_not_import_openhands():
    # The workflow module selects local-vs-docker by name but resolves adapters
    # lazily — importing it (as app startup does) must not pull openhands.*.
    # (That resolving "openhands-docker" returns the right adapter is asserted in
    # test_docker_adapter, which legitimately imports openhands for its mocked-
    # workspace tests — keeping THIS purity file openhands-free.)
    _assert_no_openhands("tvashtr.control_plane.team_run")


def test_importing_invocations_does_not_import_openhands():
    # The per-node run-state module (P1.5a) is control-plane-only (dbos/sqlalchemy/
    # tvashtr.{db,models}); it must never pull openhands.* at import.
    _assert_no_openhands("tvashtr.control_plane.invocations")


def test_importing_main_does_not_import_openhands():
    # App startup (``import tvashtr.main``) must stay openhands-free (the P1.3a hard
    # rail). Checked in a CLEAN SUBPROCESS — re-importing main in-process would re-run
    # ``DBOS(fastapi=app, ...)`` and disturb the session's DBOS singleton, and other
    # tests legitimately import openhands, so the in-process sys.modules is polluted.
    code = (
        "import sys, tvashtr.main; "
        "leaked = [m for m in sys.modules if m == 'openhands' or m.startswith('openhands.')]; "
        "assert not leaked, leaked; "
        "print('OK')"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, (
        f"import tvashtr.main failed or leaked openhands:\n{result.stderr}"
    )
    assert "OK" in result.stdout
