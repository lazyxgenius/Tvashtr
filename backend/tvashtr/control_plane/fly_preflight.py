"""The hosted-sandbox launch pre-flight — refuse a run whose agent sandbox could never have been
created, while the user is still holding the launch button.

WHY THIS EXISTS. In ``fly`` sandbox mode every agent node runs inside a per-run Firecracker microVM,
and the app that hosts it is created LAZILY, by the first node that actually needs a sandbox — the
entry (PM) node, down::

    agent_run_step -> OpenHandsFlyAdapter.run -> _ensure_run_sandbox
                   -> FlyMachines.start_run_sandbox -> create_app   (POST /v1/apps)

So a dead ``TVASHTR_FLY_API_TOKEN`` never surfaces as "the sandbox credential is broken". It
surfaces as *the entry node failed having written no spec*, which the run view renders as "The
product manager didn't finish the spec for this run." — a sentence about the agent's writing,
describing an authorization failure four layers underneath it. By the time it is said, the launch
has already spent a Run row, a DBOS workflow and a server-side clone of the user's repository.

This module moves that verdict to the launch request, where the reason can still be *named*.

WHAT IT REFUSES ON, AND WHAT IT DELIBERATELY DOES NOT. Only an unambiguous *authorization* verdict
refuses a launch: no token configured at all, or Fly itself answering 401/403
(:func:`~tvashtr.engines.fly_machines.is_authorization_error`). Every other outcome — a timeout, a
5xx, DNS failure, a malformed region/port knob — is logged and ALLOWED THROUGH, landing the run
exactly where it lands today.

That asymmetry is the whole design, and it is not timidity. Being wrong in the permissive direction
costs one run that was going to fail anyway. Being wrong in the strict direction turns a
thirty-second Fly blip into a total product outage — every launch refused, for a check that exists
only to improve an error message. A pre-flight must never become a new hard dependency.

NO CACHING, deliberately. This costs one ``GET /v1/apps`` per launch, and launches are already
rate-limited per owner (M-h3's ceilings) — so the call volume is negligible, while a cached OK
verdict would keep waving runs through for the whole TTL after a token is revoked, which is
precisely the window this module exists to close.

``openhands``-free (``routers`` imports it at module scope) and it NEVER raises: the caller reads a
reason string, so a bug in here can fail to refuse but can never itself fail a launch.
"""

from __future__ import annotations

import logging

from tvashtr.config import get_settings
from tvashtr.engines.fly_machines import FlyApiError, FlyMachines, is_authorization_error

logger = logging.getLogger("tvashtr.control_plane.fly_preflight")

# Short on purpose. This sits in front of a user-facing POST, so the pre-flight's worst case is part
# of the launch button's latency — and a Fly API too slow to answer in this window is exactly the
# "did not answer" case the module docstring allows THROUGH rather than refusing on.
_PROBE_TIMEOUT_S = 10.0

# The scope the run path actually needs, in the words the operator must act on. Every one of these
# is an ORG-level operation, which is why an app-scoped deploy token (``fly tokens create deploy``)
# cannot serve a hosted run no matter how healthy it is: it is scoped to ONE existing app, and the
# run path's very first call creates a NEW one.
REQUIRED_SCOPE = (
    "an org-scoped Fly deploy token (`fly tokens create org`) for org {org!r}, with permission to "
    "create and destroy apps and machines in it"
)


def _probe(token: str, settings) -> str | None:
    """Ask Fly whether it accepts this token for this org. ``None`` ⇒ go ahead.

    ``GET /v1/apps?org_slug=<org>`` is the probe because it is the cheapest call that exercises the
    SAME org-level authorization the run path's ``create_app`` needs, while mutating nothing. No
    region argument, for the reason ``fly_reaper`` gives: this client only lists, so a region is
    meaningless to it and a malformed ``TVASHTR_FLY_REGION`` must not be able to fail the probe."""
    fly = None
    try:
        fly = FlyMachines(
            token=token,
            org=settings.fly_org,
            image=settings.fly_agent_image,
            timeout=_PROBE_TIMEOUT_S,
        )
        fly.list_apps()
        return None
    except FlyApiError as exc:
        if not is_authorization_error(exc):
            # Fly did not answer (or answered something that is not a verdict on the credential).
            # Allow the launch: see the module docstring's asymmetry.
            logger.warning("fly pre-flight: probe inconclusive; allowing the launch: %s", exc)
            return None
        # ``str(exc)`` is already SCRUBBED of the token by ``FlyMachines._scrub`` — this is the one
        # place a Fly error body reaches a user-facing response, so that guarantee is load-bearing.
        logger.error("fly pre-flight: Fly rejected the API token: %s", exc)
        return (
            f"Fly rejected TVASHTR_FLY_API_TOKEN for org {settings.fly_org!r} ({exc}). "
            "The token is revoked, expired, or was minted against something that no longer "
            "exists. Replace it with " + REQUIRED_SCOPE.format(org=settings.fly_org) + "."
        )
    except Exception:  # noqa: BLE001 — a pre-flight must never take down the launch path
        logger.warning("fly pre-flight: probe raised; allowing the launch", exc_info=True)
        return None
    finally:
        if fly is not None:
            try:
                fly.close()
            except Exception:  # noqa: BLE001
                pass


def fly_launch_blocker() -> str | None:
    """The reason a hosted run cannot start, or ``None`` when it can.

    A no-op returning ``None`` outside ``fly`` sandbox mode: a ``docker``/``local`` install runs the
    agent on its own machine and has no Fly credential to be wrong about, so it must not pay a Fly
    API call — nor be refusable — for a feature it does not use. Same gate, same reason, as
    ``fly_reaper.sweep_orphaned_fly_apps``."""
    settings = get_settings()
    if settings.agent_sandbox_mode != "fly":
        return None

    # Unwrapped BEFORE the guard so "unconfigured" is read off the plaintext, matching
    # ``fly_reaper``'s handling of the same field.
    token = settings.fly_api_token.get_secret_value()
    if not token:
        return (
            "TVASHTR_FLY_API_TOKEN is not set, and this deployment runs agents in per-run Fly "
            "microVMs (TVASHTR_AGENT_SANDBOX=fly). Set it to "
            + REQUIRED_SCOPE.format(org=settings.fly_org)
            + "."
        )
    return _probe(token, settings)
