"""``scripts/connector_probe.py`` (build plan B2.7): the operator's live probe of the Featured
connectors' sign-in. Here its plumbing runs against the fake; the live run is the operator's."""

import importlib.util
from pathlib import Path

import httpx
from connector_oauth_helpers import paths, wire
from fake_connector_server import FakeConnectorServer

from tvashtr.control_plane import connector_catalog

_PROBE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "connector_probe.py"
BASE = "https://mcp.fake.test"
ENTRY = {"key": "fake", "name": "Fake", "url": f"{BASE}/mcp", "featured": True}


def _load():
    spec = importlib.util.spec_from_file_location("connector_probe_under_test", _PROBE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_probe_row_says_how_tvashtr_would_sign_in_and_registers_nothing(monkeypatch):
    probe = _load()
    fake = FakeConnectorServer(BASE, cimd=True)
    wire(monkeypatch, fake.handle)

    assert probe.probe(ENTRY) == {
        "key": "fake",
        "ok": True,
        "issuer": BASE,
        "client": "cimd",
        "authorize_host": "mcp.fake.test",
        "endpoint_hosts": "token=mcp.fake.test registration=mcp.fake.test revocation=mcp.fake.test",
        "scope": "read",
        "note": "",
    }
    assert "/register" not in paths(fake) and all(r.method == "GET" for r in fake.requests)

    # Asked to, it registers where registration is how Tvashtr would get a client.
    fake = FakeConnectorServer(BASE)
    wire(monkeypatch, fake.handle)
    assert probe.probe(ENTRY)["client"] == "dcr"
    assert "/register" not in paths(fake)
    assert probe.probe(ENTRY, register=True)["client"] == "dcr (registered client-1)"
    assert paths(fake).count("/register") == 1


def test_a_probe_row_says_why_an_entry_cant_be_signed_in_to(monkeypatch):
    probe = _load()

    wire(monkeypatch, FakeConnectorServer(BASE, mixup="token_endpoint").handle)
    row = probe.probe(ENTRY)
    assert row["ok"] is False
    # The host that would need pinning in ``oauth_hosts`` is named.
    assert "token_endpoint" in row["note"] and "login.other-site.test" in row["note"]

    wire(monkeypatch, FakeConnectorServer(BASE, dcr=False).handle)
    row = probe.probe(ENTRY)
    assert (row["ok"], row["issuer"], row["client"]) == (False, BASE, "")
    assert row["note"].startswith("cannot register")

    wire(monkeypatch, lambda request: httpx.Response(404))
    assert probe.probe(ENTRY)["note"] == "no sign-in offered"
    wire(monkeypatch, lambda request: httpx.Response(503))
    assert probe.probe(ENTRY)["note"].startswith("unreachable")


def test_the_probe_covers_the_available_featured_entries_and_fails_when_one_does(
    monkeypatch, capsys
):
    probe = _load()
    wire(monkeypatch, lambda request: httpx.Response(404))
    available = [
        key
        for key, entry in connector_catalog.FEATURED.items()
        if connector_catalog.available(entry)
    ]

    assert probe.main([]) == 1  # none of them offers a sign-in here
    printed = capsys.readouterr().out
    for key in connector_catalog.FEATURED:
        assert (f"| {key} |" in printed) == (key in available)

    # ``--all`` also looks at the ones that can't be connected yet, and doesn't count them.
    assert probe.main(["--all", "hubspot"]) == 0
    printed = capsys.readouterr().out
    assert "| hubspot |" in printed and "| supabase |" not in printed
