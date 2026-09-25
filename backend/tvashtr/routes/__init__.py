"""API routers added by the frontend revamp — one module per area (spec §3.4).

Each module exposes ``router``; ``main.py`` includes every one behind ``get_current_user``. New
endpoints for an area go in its module so parallel work never collides in ``routers.py``.
"""
