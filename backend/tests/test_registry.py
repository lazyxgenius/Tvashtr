"""Engine registry seam — no network, and (critically) **no openhands import**.

The whole point of the registry is that the control plane can name an engine
without pulling its heavy SDK at import time: `openhands.*` is imported only when
`resolve_adapter("openhands")` is actually called (exercised live by
`make skeleton-run`/`make agent-smoke`, never in the offline suite).
"""

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


def test_importing_team_run_does_not_import_openhands():
    # The workflow module selects local-vs-docker by name but resolves adapters
    # lazily — importing it (as app startup does) must not pull openhands.*.
    # (That resolving "openhands-docker" returns the right adapter is asserted in
    # test_docker_adapter, which legitimately imports openhands for its mocked-
    # workspace tests — keeping THIS purity file openhands-free.)
    _assert_no_openhands("tvashtr.control_plane.team_run")
