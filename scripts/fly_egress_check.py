#!/usr/bin/env python
"""M-h3 LIVE gate: prove the per-run EGRESS fence, by A/B against the real thing.

M-h2 fenced what reaches **in**. This proves what reaches **out** — and proves it the only way a
firewall can honestly be proven: by showing the same packet succeed and then fail.

WHY AN A/B AND NOT A SINGLE ASSERTION. "Port 25 did not connect from inside the microVM" is, on its
own, worth almost nothing. It is equally consistent with: the policy working; Fly blocking outbound
:25 org-wide the way most hosts do; the destination being down; the guest having no egress at all;
or a typo in the probe. Every one of those produces the identical green tick. So this script boots
**TWO** machines:

  LEG A — REPRODUCE-FIRST, policy ABSENT. Every primitive of ``start_run_sandbox`` *except*
          ``create_egress_policy``. Whatever connects here is the control: it establishes that the
          probe works, the destination is up, and the route exists.
  LEG B — the real composed ``start_run_sandbox``, policy PRESENT.

The evidence is the DELTA between them, on identical destinations, minutes apart.

WHY EVERY TARGET IS A LITERAL IP. Fly's own troubleshooting note says to "use direct IP addresses
(not hostnames) to test blocked traffic to avoid DNS masking" — with the fence up, a hostname test
would fail at *resolution* and tell you nothing about the port. Names are resolved on the HOST
before either machine boots, so the in-guest probe is pure TCP.

READING THE FAILURE MODE MATTERS AS MUCH AS THE RESULT. The probe distinguishes:
  OPEN     — the connection completed.
  REFUSED  — an RST came back: the packet REACHED the destination and nothing was listening. This
             is emphatically NOT a firewall result, and counting it as one is the easiest way to
             fake a passing egress gate.
  TIMEOUT  — packets went into a hole. That is what a drop-based fence looks like.
So a port that goes OPEN -> TIMEOUT was fenced; one that was REFUSED all along was never a test.

Also asserts the fence does not cost us the things the run actually needs: :443 and :53 still
connect in LEG B (the allowlist), and the agent server still answers over Flycast (Fly-Proxy
traffic is exempt from network policies, which is what keeps the D2 door open).

No agent and no model call — minutes and cents. The DNS+443 end-to-end proof (inference actually
working through the fence) is ``make github-pr-fly-e2e``, which since M-h3 boots every machine
fenced. Skips cleanly without ``TVASHTR_FLY_API_TOKEN``. Needs an ACTIVE WireGuard tunnel.
NOT in ``make test``.
"""

import base64
import json
import os
import re
import socket
import sys
import time
import traceback
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Probed from INSIDE the guest, by literal IP. Each entry is (label, hostname_to_resolve, port,
# in_allowlist). The hostnames are resolved on the host; the guest only ever sees an address.
#
# The two "should be fenced" targets are chosen to have a REAL LISTENER, which is the whole trick:
# a port nobody serves would be REFUSED rather than dropped and would prove nothing at all.
#   github.com:22  — the busiest SSH endpoint on the internet; certainly listening.
#   gmail MX  :25  — an internet-facing SMTP server; certainly listening (unless Fly blocks :25
#                    org-wide, which LEG A is exactly how we find out rather than assume).
#   1.1.1.1:3333   — named in the milestone; NOTHING listens there, so it is kept as a deliberate
#                    control for the REFUSED-vs-TIMEOUT distinction, not as fence evidence.
TARGETS = [
    ("cloudflare-dns  :443", "one.one.one.one", 443, True),
    ("cloudflare-dns  :53 ", "one.one.one.one", 53, True),
    ("github ssh      :22 ", "github.com", 22, False),
    ("gmail smtp      :25 ", "gmail-smtp-in.l.google.com", 25, False),
    ("cloudflare      :3333", "one.one.one.one", 3333, False),
]

# Run inside the microVM. Emits one JSON line so the host parses a result, not prose.
GUEST_PROBE = r"""
import json, socket, sys
out = []
for label, ip, port in json.loads(sys.argv[1]):
    t0 = __import__("time").monotonic()
    try:
        s = socket.create_connection((ip, int(port)), timeout=8.0)
        s.close()
        verdict = "OPEN"
        detail = ""
    except socket.timeout:
        verdict, detail = "TIMEOUT", "no answer (packets dropped)"
    except ConnectionRefusedError:
        verdict, detail = "REFUSED", "RST — reached the host, nothing listening"
    except OSError as exc:
        verdict, detail = "ERROR", f"{type(exc).__name__}: {exc}"
    out.append(
        {"label": label, "ip": ip, "port": port, "verdict": verdict,
         "detail": detail, "seconds": round(__import__("time").monotonic() - t0, 1)}
    )
print("EGRESS_PROBE_JSON=" + json.dumps(out))
"""


def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        os.environ.setdefault(key, val.strip())


def _resolve_targets() -> list[tuple[str, str, int, bool]]:
    """Resolve every hostname ON THE HOST, so the in-guest probe is pure TCP to a literal IP."""
    resolved = []
    for label, host, port, allowed in TARGETS:
        ip = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
        print(f"[egress]   {label} -> {host} = {ip}")
        resolved.append((label, ip, port, allowed))
    return resolved


def _probe_from_guest(flycast_host: str, session_key: str, targets) -> dict[str, dict]:
    """Run the socket probe INSIDE the microVM over the D2 Flycast door."""
    from openhands.sdk.workspace import RemoteWorkspace

    ws = RemoteWorkspace(host=flycast_host, working_dir="/tmp", api_key=session_key)
    payload = json.dumps([[label, ip, port] for label, ip, port, _a in targets])
    b64 = base64.b64encode(GUEST_PROBE.encode()).decode()
    # base64 so nothing in the script has to survive two layers of shell quoting.
    cmd = (
        f"echo {b64} | base64 -d > /tmp/egress_probe.py && "
        f"python3 /tmp/egress_probe.py {json.dumps(payload)}"
    )
    result = ws.execute_command(cmd, cwd="/tmp", timeout=180.0)
    for line in (result.stdout or "").splitlines():
        if line.startswith("EGRESS_PROBE_JSON="):
            rows = json.loads(line.split("=", 1)[1])
            return {r["label"]: r for r in rows}
    raise RuntimeError(
        f"probe produced no JSON (exit={result.exit_code})\n"
        f"stdout: {(result.stdout or '')[:800]}\nstderr: {(result.stderr or '')[:800]}"
    )


def _print_table(title: str, rows: dict[str, dict], targets) -> None:
    print(f"\n[egress] ---- {title} ----")
    print(f"[egress]   {'target':22} {'allowlisted':12} {'verdict':9} detail")
    for label, _ip, _port, allowed in targets:
        r = rows.get(label, {})
        print(
            f"[egress]   {label:22} {'YES' if allowed else 'no':12} "
            f"{r.get('verdict', '?'):9} {r.get('detail', '')} ({r.get('seconds', '?')}s)"
        )


def main() -> int:
    _load_dotenv()
    if not os.environ.get("TVASHTR_FLY_API_TOKEN"):
        print("[egress] TVASHTR_FLY_API_TOKEN not set — skipping. (Not a failure.)")
        return 0
    os.environ["TVASHTR_AGENT_SANDBOX"] = "fly"

    from tvashtr.engines import openhands_fly_adapter as mod
    from tvashtr.engines.fly_machines import (
        AGENT_SERVER_PORT,
        app_name_for_run,
        derive_session_key,
        network_name_for_owner,
    )

    print("[egress] resolving probe targets on the HOST (the guest only sees literal IPs)…")
    targets = _resolve_targets()

    owner_id = str(uuid.uuid4())
    run_a, run_b = str(uuid.uuid4()), str(uuid.uuid4())
    app_a, app_b = app_name_for_run(run_a), app_name_for_run(run_b)
    fly = mod._new_fly_client()
    print(f"[egress] egress allowlist under test: {list(fly.egress_ports)} (+udp/53)")

    before: dict[str, dict] = {}
    after: dict[str, dict] = {}
    boot_a = boot_b = ready_b = 0.0
    ok = False

    try:
        # ---- LEG A: REPRODUCE-FIRST. Every step of start_run_sandbox EXCEPT the policy. ----
        print(f"\n[egress] LEG A — policy ABSENT (the control). app={app_a}")
        key_a = derive_session_key(run_a)
        t0 = time.monotonic()
        fly.create_app(app_a, network_name_for_owner(owner_id))
        fly.allocate_flycast(app_a)
        mid_a, ip_a = fly.create_machine(app_a, key_a)
        fly.wait_started(app_a, mid_a)
        boot_a = time.monotonic() - t0
        fly.wait_healthy(f"http://{app_a}.flycast:{AGENT_SERVER_PORT}")
        print(f"[egress]   booted machine={mid_a} ip={ip_a} boot={boot_a:.1f}s (NO egress policy)")
        before = _probe_from_guest(f"http://{app_a}.flycast:{AGENT_SERVER_PORT}", key_a, targets)
        _print_table("LEG A — POLICY ABSENT", before, targets)

        # ---- LEG B: the real composed path, fence up. ----
        print(f"\n[egress] LEG B — policy PRESENT (start_run_sandbox). app={app_b}")
        key_b = derive_session_key(run_b)
        machine = fly.start_run_sandbox(run_id=run_b, owner_id=owner_id, session_api_key=key_b)
        boot_b, ready_b = machine.boot_seconds, machine.ready_seconds
        print(
            f"[egress]   booted machine={machine.machine_id} ip={machine.private_ip} "
            f"boot={boot_b:.1f}s ready={ready_b:.1f}s (fenced BEFORE first boot, no restart)"
        )
        policies = fly._client.request(
            "GET",
            f"https://api.machines.dev/v1/apps/{app_b}/network_policies",
            headers=fly._headers(),
        ).json()
        print(f"[egress]   policy on Fly: {json.dumps(policies)}")
        after = _probe_from_guest(machine.flycast_host, key_b, targets)
        _print_table("LEG B — POLICY PRESENT", after, targets)

        # ---- the verdict ----
        print("\n[egress] ==================== THE DELTA ====================")
        allowed_ok, fenced_ok, reproduced = True, True, False
        for label, _ip, _port, allowed in targets:
            b_v = before.get(label, {}).get("verdict", "?")
            a_v = after.get(label, {}).get("verdict", "?")
            arrow = f"{b_v:9} ->  {a_v:9}"
            if allowed:
                good = a_v == "OPEN"
                allowed_ok &= good
                print(f"[egress]   {label:22} {arrow}  ALLOWLISTED, must stay OPEN : {good}")
            else:
                # Fence evidence requires the control to have been genuinely OPEN first.
                if b_v == "OPEN":
                    reproduced = True
                    good = a_v in ("TIMEOUT", "ERROR")
                    fenced_ok &= good
                    print(f"[egress]   {label:22} {arrow}  FENCED (was open, now dropped): {good}")
                else:
                    print(
                        f"[egress]   {label:22} {arrow}  not fence evidence — the control was "
                        f"{b_v}, not OPEN"
                    )

        print("\n[egress] ---- measurements ----")
        print(f"[egress]   LEG A boot (image pull + microVM boot), unfenced : {boot_a:.1f}s")
        print(f"[egress]   LEG B boot (image pull + microVM boot), fenced   : {boot_b:.1f}s")
        print(f"[egress]   LEG B ready (boot + agent server serving)        : {ready_b:.1f}s")
        print(f"[egress]   fence cost on boot                          : {boot_b - boot_a:+.1f}s")

        # Flycast still worked in LEG B — every probe above rode through it — which is the
        # Fly-Proxy exemption holding and the D2 door surviving the new fence.
        flycast_ok = bool(after)
        print(f"[egress]   agent server reachable over Flycast, fenced      : {flycast_ok}")

        ok = reproduced and allowed_ok and fenced_ok and flycast_ok
        if not reproduced:
            print(
                "\n[egress] NO FENCE EVIDENCE: no non-allowlisted port was OPEN in LEG A, so "
                "nothing was proven. (Fly may block these ports org-wide.)"
            )
    except Exception:
        print("[egress] EXCEPTION:")
        traceback.print_exc()
    finally:
        for app in (app_a, app_b):
            try:
                fly.delete_app(app)
                print(f"[egress] torn down {app}")
            except Exception:
                print(f"[egress] WARNING: teardown failed for {app}")

    print(f"\n[egress] {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
