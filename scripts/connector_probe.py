#!/usr/bin/env python
"""Live probe of the Featured connectors' sign-in (connectors build plan, B2.7).

Operator-run; it needs the network and is not part of ``make test``. For every Featured entry
that can be connected it runs the discovery and the client choice the backend runs at
``oauth/start``, against the real server, and prints one row: the issuer, the kind of client
Tvashtr would sign in as, the host the browser is sent to, the host of every other sign-in
endpoint (an endpoint off its issuer's site needs the entry's ``oauth_hosts``: the note names the
host), and the scope that would be asked for.

    cd backend && uv run python ../scripts/connector_probe.py --base-url https://tvashtr.fly.dev

``--base-url`` is the ``TVASHTR_PUBLIC_BASE_URL`` to probe for (default: the configured one). It
decides the client: a client metadata document needs an ``https://`` base.
``--all`` also probes the entries that can't be connected yet (Google without its client,
"Coming soon" ones); they never fail the run.
``key …`` limits the run to those entries.

Without ``--register`` it only reads public metadata (unauthenticated GETs). ``--register`` also
performs the dynamic client registration where that is how Tvashtr would get a client. That
creates a real client at the provider: run it on purpose.

Exit status 1 when an available entry doesn't reach an authorize address. Such an entry is
switched to "Coming soon" before release.
"""

import argparse
import sys
from urllib.parse import urlsplit

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_catalog, connector_oauth

_COLUMNS = ("key", "ok", "issuer", "client", "authorize_host", "endpoint_hosts", "scope", "note")


def _short(scope: str) -> str:
    """A scope list that fits a table cell (PostHog lists about 190)."""
    scopes = scope.split()
    return scope if len(scopes) <= 6 else f"{' '.join(scopes[:3])} … ({len(scopes)} scopes)"


def probe(entry: dict, *, register: bool = False) -> dict:
    """One row for ``entry``: what discovery found and the client Tvashtr would use."""
    url = entry["url"]
    row = dict.fromkeys(_COLUMNS, "") | {"key": entry["key"], "ok": False}
    try:
        found = connector_oauth.discover(url, entry)
        if found is None:
            return row | {"note": "no sign-in offered"}
        endpoints = {
            "token": found.token_endpoint,
            "registration": found.registration_endpoint,
            "revocation": found.revocation_endpoint,
        }
        row |= {
            "issuer": found.issuer,
            "authorize_host": found.signin_host,
            "endpoint_hosts": " ".join(
                f"{name}={urlsplit(address).hostname}"
                for name, address in endpoints.items()
                if address
            ),
            "scope": _short(entry.get("scope") or found.scope or ""),
        }
        row["client"] = connector_oauth.client_kind(found, entry, url)
        if register and row["client"] == "dcr":
            client = connector_oauth.choose_client(found, entry, url)
            row["client"] = f"dcr (registered {client['client_id']})"
        row["ok"] = True
    except connector_oauth.CannotRegister as exc:
        row["note"] = f"cannot register: {exc}"
    except connector_oauth.Unreachable as exc:
        row["note"] = f"unreachable: {exc}"
    return row


def table(rows: list[dict]) -> str:
    lines = ["| " + " | ".join(_COLUMNS) + " |", "|" + "---|" * len(_COLUMNS)]
    for row in rows:
        cells = {**row, "ok": "yes" if row["ok"] else "NO"}
        lines.append("| " + " | ".join(str(cells[column]) for column in _COLUMNS) + " |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("keys", nargs="*", help="Featured keys to probe (default: all)")
    parser.add_argument("--base-url", help="the TVASHTR_PUBLIC_BASE_URL to probe for")
    parser.add_argument("--all", action="store_true", help="also entries that can't be connected")
    parser.add_argument("--register", action="store_true", help="perform dynamic registration")
    args = parser.parse_args(argv)
    if args.base_url:
        get_settings().public_base_url = args.base_url

    rows, failed = [], False
    for key, entry in connector_catalog.FEATURED.items():
        available = connector_catalog.available(entry)
        if (args.keys and key not in args.keys) or not (available or args.all):
            continue
        row = probe(entry, register=args.register and available)
        if not available:
            row["note"] = "not available yet. " + row["note"]
        failed = failed or (available and not row["ok"])
        rows.append(row)
    print(f"public base URL: {get_settings().public_base_url}")
    print(table(rows))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
