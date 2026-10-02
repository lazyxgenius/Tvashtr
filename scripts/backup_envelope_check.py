"""MA ruling R17 — live proof on the LOCAL sandbox: an agent node whose primary model NEVER answers,
with a usable backup, reaches the backup switch well before R1's stall ceiling, and the run carries
on on the backup.

The primary is real OpenAI routing pointed (``OPENAI_BASE_URL``) at a local black-hole server that
accepts every connection and never answers, so the OpenHands SDK runs its REAL retry envelope:
each attempt times out at ``TVASHTR_AGENT_REQUEST_TIMEOUT``, then waits ``wait_exponential``. The
Engineer's backup is ``deepseek/deepseek-chat`` (another provider; the operator holds its key). The
R1 numbers are shrunk so the proof takes minutes: per-request timeout 10 s, stall ceiling 180 s.
With R17's 3 tries the switch is due at ~3 × (timeout + the client's own retries) + waits; with
today's 8 tries it would be past the ceiling.

Run on an ISOLATED, migrated database (a concurrent app process would recover this run):

    make backup-envelope-check DATABASE_URL=postgresql://…/tvashtr_ma_live

Exits non-zero unless the Activity feed shows the switch before the ceiling and the run continues
on the backup (the Engineer's round finishes on it).
"""

import os
import socket
import sys
import threading
import time

PRIMARY = "openai/gpt-4.1-mini"
BACKUP = "deepseek/deepseek-chat"
CEILING_S = 180


def _black_hole() -> int:
    """A TCP server that accepts and reads forever, never answering. Returns its port."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(64)
    held: list[socket.socket] = []

    def _serve() -> None:
        while True:
            conn, _ = srv.accept()
            held.append(conn)  # keep it open; read and drop whatever arrives

            def _drain(c: socket.socket) -> None:
                try:
                    while c.recv(65536):
                        pass
                except OSError:
                    pass

            threading.Thread(target=_drain, args=(conn,), daemon=True).start()

    threading.Thread(target=_serve, daemon=True).start()
    return srv.getsockname()[1]


PORT = _black_hole()
os.environ.update(
    {
        "TVASHTR_AGENT_SANDBOX": "local",
        "TVASHTR_HOSTED_MODE": "false",
        "TVASHTR_AUTO_APPROVE_GATES": "1",
        "TVASHTR_FORCE_REVISIONS": "0",
        "OPENAI_BASE_URL": f"http://127.0.0.1:{PORT}/v1",
        "TVASHTR_AGENT_REQUEST_TIMEOUT": "10",
        "TVASHTR_QUIET_AFTER_S": "15",
        "TVASHTR_STALLED_AFTER_S": "60",
        "TVASHTR_STALL_FAIL_AFTER_S": str(CEILING_S),
        "TVASHTR_STALL_SWEEP": "1",
        "TVASHTR_STALL_SWEEP_CRON": "*/5 * * * * *",
    }
)
sys.path.insert(0, os.path.dirname(__file__))

TIMEOUT_S = 900


def _set_models(team_id: str) -> None:
    import uuid

    from sqlalchemy import select

    from tvashtr.db import session_scope
    from tvashtr.models import AgentNode

    with session_scope() as session:
        for node in session.execute(
            select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team_id))
        ).scalars():
            if node.role_name == "engineer":
                node.model = PRIMARY
                node.config = {**(node.config or {}), "fallback_model": BACKUP}
            elif node.kind in ("agent", "completion"):
                node.model = BACKUP


def main() -> int:
    from fastapi.testclient import TestClient
    from operator_session import login_operator

    from tvashtr.main import app

    print(f"[backup-envelope] black hole on 127.0.0.1:{PORT}; ceiling {CEILING_S}s")
    with TestClient(app) as client:
        login_operator(client)
        team = client.post(
            "/api/teams",
            json={"template": "review_loop", "name": f"backup-envelope-{int(time.time())}"},
        ).json()["team_graph_id"]
        _set_models(team)
        created = client.post("/api/runs", json={"team_graph_id": team})
        if created.status_code != 200:
            print(f"[backup-envelope] FAILED: POST /api/runs -> {created.status_code}")
            print(created.text)
            return 1
        run_id = created.json()["run_id"]
        print(f"[backup-envelope] run {run_id}: Engineer on {PRIMARY} (never answers)")
        print(f"[backup-envelope] its backup: {BACKUP}")

        started = time.time()
        engineer_started = switched_at = None
        states: list[str] = []
        final = None
        while time.time() - started < TIMEOUT_S:
            act = client.get(f"/api/runs/{run_id}/activity").json()
            eng = next(a for a in act["agents"] if a["label"] == "Engineer")
            if eng["live_state"] not in ("waiting", "not_reached") and engineer_started is None:
                engineer_started = time.time()
                print(f"  t+{engineer_started - started:6.1f}s  the Engineer started")
            if not states or states[-1] != eng["live_state"]:
                states.append(eng["live_state"])
                print(f"  t+{time.time() - started:6.1f}s  Engineer={eng['live_state']}")
            for ln in act["lines"]:
                if ln["kind"] == "backup" and switched_at is None:
                    switched_at = time.time()
                    print(f"  t+{switched_at - started:6.1f}s  Activity: {ln['text']!r}")
            run = client.get(f"/api/runs/{run_id}").json()["run"]
            if run["status"] in ("failed", "completed", "cancelled", "rejected"):
                final = run
                break
            time.sleep(2)

        if final is None:
            print(f"[backup-envelope] FAILED: the run did not end within {TIMEOUT_S}s")
            return 1
        from sqlalchemy import select

        from tvashtr.db import session_scope
        from tvashtr.models import AgentInvocation, CostRecord

        with session_scope() as session:
            models_billed = {
                m
                for (m,) in session.execute(
                    select(CostRecord.model_used).where(CostRecord.workflow_id == run_id)
                )
            }
            eng_status = [
                i.status
                for i in session.execute(
                    select(AgentInvocation).where(AgentInvocation.run_id == run_id)
                ).scalars()
            ]
        to_switch = (switched_at - engineer_started) if switched_at and engineer_started else None
        print(
            f"[backup-envelope] run ended: status={final['status']}"
            f" failure={final.get('failure')} switch after {to_switch and round(to_switch, 1)}s"
            f" models billed={sorted(m for m in models_billed if m)} steps={eng_status}"
        )
        checks = {
            "Activity shows the switch": switched_at is not None,
            f"the switch came before the {CEILING_S}s stall ceiling": to_switch is not None
            and to_switch < CEILING_S,
            "the step was never swept as stalled": (final.get("failure") or {}).get("code")
            != "stalled",
            "the run carried on to the end": final["status"] == "completed",
            "the backup did the work": any(
                BACKUP.split("/", 1)[1] in (m or "") for m in models_billed
            ),
        }
        for name, ok in checks.items():
            print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
        ok = all(checks.values())
        print(f"backup-envelope-check: {'PASSED' if ok else 'FAILED'}")
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
