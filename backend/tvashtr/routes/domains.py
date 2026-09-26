"""Domains (revamp round 2): the endpoints the redesigned Domains screens add.

The original ``/api/domains*`` endpoints stay in ``routers.py`` and change there in place,
additively; every NEW Domains endpoint goes here (the contract is
``docs/superpowers/plans/api/domains.md``). Logic lives in ``control_plane/domain_*`` modules.
Every route is owner-scoped: another account's domain answers 404 ``"domain not found"``.
"""

from fastapi import APIRouter

router = APIRouter()
