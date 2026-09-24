"""Engine registry — resolves an engine name to an ``EngineAdapter``.

Engine SDKs are imported **lazily, inside the function**, so naming an engine (and
importing this module) never pulls a heavy SDK: ``openhands.*`` is loaded only
when an OpenHands run is actually resolved. This keeps app startup and the offline
test suite free of ``openhands.*`` (only the live scripts load it), and lets tests
substitute a fake adapter.
"""

from tvashtr.engines.base import EngineAdapter


def resolve_adapter(engine_name: str) -> EngineAdapter:
    """Return the adapter for ``engine_name``. Raises ValueError if unknown.

    Both adapters import ``openhands.*`` at their module top, so the import stays
    lazy via *this* function — naming an engine never pulls a heavy SDK; only
    resolving one does. ``openhands-docker`` adds the containerized path (P1.3a).
    """
    if engine_name == "openhands":
        from tvashtr.engines.openhands_adapter import OpenHandsAdapter  # lazy import

        return OpenHandsAdapter()
    if engine_name == "openhands-docker":
        from tvashtr.engines.openhands_docker_adapter import (  # lazy import
            OpenHandsDockerAdapter,
        )

        return OpenHandsDockerAdapter()
    if engine_name == "openhands-fly":
        from tvashtr.engines.openhands_fly_adapter import (  # lazy import
            OpenHandsFlyAdapter,
        )

        return OpenHandsFlyAdapter()
    if engine_name == "desktop-runner":
        # M-subs-desktop: a subscription node of a desktop-targeted run — queued for the owner's
        # Tvashtr Desktop, which runs it with the owner's own CLI sign-in (no SDK import at all).
        from tvashtr.engines.desktop_runner_adapter import DesktopRunnerAdapter  # lazy import

        return DesktopRunnerAdapter()
    raise ValueError(f"unknown engine: {engine_name!r}")
