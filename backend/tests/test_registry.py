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
