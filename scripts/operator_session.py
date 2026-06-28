"""M-accounts: log a live script's in-process TestClient in as the seeded operator.

The product API now requires login, and every run is OWNED + key-checked at launch. Each live
run-driving script calls ``login_operator(client)`` right after opening its ``TestClient``: it
ensures the operator account + its imported ``.env`` provider credentials exist (via the idempotent
seed) and logs the client's cookie jar in as the operator — so the script's ``POST /api/runs`` is
authenticated, the run is owned by the operator, and the launch pre-flight finds the operator's keys
(the same path the post-merge manual check exercises through the UI). Idempotent + cheap.
"""

import os


def login_operator(client) -> str:
    """Ensure the seeded operator (+ its imported ``.env`` keys) and log ``client`` in as it; return
    the operator's email. ``client`` is an in-process ``fastapi.testclient.TestClient``."""
    from tvashtr import seed

    seed.main()  # idempotent: ensure operator + import .env provider keys + backfill owners
    email = os.environ.get("TVASHTR_SEED_EMAIL", seed.DEFAULT_SEED_EMAIL)
    password = os.environ.get("TVASHTR_SEED_PASSWORD", seed.DEFAULT_SEED_PASSWORD)
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    resp.raise_for_status()
    print(f"[operator-session] logged in as the seeded operator {email}")
    return email
