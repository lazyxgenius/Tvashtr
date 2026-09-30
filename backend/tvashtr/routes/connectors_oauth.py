"""Connectors — the OAuth sign-in routes.

``router`` needs a session (``POST /api/connectors/{id}/oauth/start``). ``public_router`` does not:
the browser that finishes a sign-in may hold no Tvashtr session (Desktop opens the system
browser), so the callback, its confirm step and the client metadata document are public, and the
owner comes from the row found by the ``state``. Contract:
``docs/superpowers/plans/api/connectors.md`` (OAuth). Phase 0 registers the two empty routers;
stream B2 adds the routes (build plan B2.3, B2.4, B2.6).
"""

from fastapi import APIRouter

router = APIRouter()
public_router = APIRouter()
