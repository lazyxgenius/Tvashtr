"""Connectors: the registry snapshot generator (``scripts/refresh_connector_registry.py``) and the
snapshot it committed. No network: the crawl is replaced by a list of pages."""

import importlib.util
import json
import re
from collections import Counter
from pathlib import Path

import pytest

from tvashtr.control_plane import connector_catalog

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "refresh_connector_registry.py"
OFFICIAL = "io.modelcontextprotocol.registry/official"
_PAYS = re.compile(r"payment|wallet|private[-_]?key|pay[-_]?id", re.IGNORECASE)


@pytest.fixture(scope="module")
def refresh():
    """``scripts/`` is not a package, so the script is loaded by file path."""
    spec = importlib.util.spec_from_file_location("refresh_connector_registry", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _item(name: str, url: str | None = None, status: str = "active") -> dict:
    url = url or f"https://{name.replace('/', '.')}.example/mcp"
    return {
        "server": {
            "name": name,
            "description": f"{name} things.",
            "remotes": [{"type": "streamable-http", "url": url}],
        },
        "_meta": {OFFICIAL: {"status": status, "isLatest": True}},
    }


def test_build_filters_sorts_by_key_and_drops_link_farm_namespaces(refresh):
    farm = [_item(f"io.github.farm/s{i:02}") for i in range(21)]
    small = [_item(f"dev.small/s{i:02}") for i in range(20)]  # exactly 20 is still kept
    items = [
        _item("dev.zeta/mcp"),
        *farm,
        _item("dev.alpha/mcp"),
        _item("dev.gone/mcp", status="deprecated"),
        *small,
        _item("dev.alpha/mcp", url="https://newer.example/mcp"),  # the same name again
        _item("ai.smithery/acme"),
    ]
    built = refresh.build(items)
    keys = [e["key"] for e in built]
    assert keys == sorted(
        ["dev.alpha/mcp", "dev.zeta/mcp", *[f"dev.small/s{i:02}" for i in range(20)]]
    )
    assert built[0]["url"] == "https://newer.example/mcp"  # one line per key, the last one seen
    assert built[-1] == connector_catalog.slim_registry_entry(items[0])  # the catalog's filter


def test_render_is_one_compact_json_object_per_line_and_reads_back(refresh):
    built = refresh.build([_item("dev.beta/mcp"), _item("dev.alpha/mcp")])
    text = refresh.render(built)
    assert text.endswith("\n") and text.count("\n") == 2
    assert [json.loads(line) for line in text.splitlines()] == built
    assert ", " not in text.splitlines()[0] and '": ' not in text  # compact separators
    assert refresh.read_snapshot_text(text) == {e["key"]: e for e in built}


def test_a_unicode_line_separator_in_a_description_stays_inside_its_line(
    refresh, tmp_path, monkeypatch
):
    """U+2028, U+2029 and U+0085 are line breaks to ``str.splitlines`` and plain characters to
    JSON Lines: a snapshot that carries one still reads back, in the script and in the catalog."""
    description = "Acme\u2028things\u2029and\x85more"
    items = [_item("dev.alpha/mcp"), _item("dev.beta/mcp")]
    items[0]["server"]["description"] = description
    built = refresh.build(items)
    text = refresh.render(built)
    assert text.count("\n") == 2
    assert refresh.read_snapshot_text(text) == {e["key"]: e for e in built}

    path = tmp_path / "connector_registry.jsonl"
    path.write_text(text, encoding="utf-8")
    monkeypatch.setattr(connector_catalog, "REGISTRY_PATH", path)
    connector_catalog.registry.cache_clear()
    try:
        assert connector_catalog.resolve("dev.alpha/mcp")["description"] == description
        assert connector_catalog.resolve("dev.beta/mcp") is not None
    finally:
        monkeypatch.undo()  # the real path back before the cache is dropped
        connector_catalog.registry.cache_clear()


def test_summary_names_added_removed_and_changed_keys_and_is_empty_for_the_same_file(refresh):
    old = {
        e["key"]: e
        for e in refresh.build([_item("dev.a/mcp"), _item("dev.b/mcp"), _item("dev.c/mcp")])
    }
    new = {
        e["key"]: e
        for e in refresh.build(
            [
                _item("dev.b/mcp", url="https://moved.example/mcp"),
                _item("dev.c/mcp"),
                _item("dev.d/mcp"),
            ]
        )
    }
    text = refresh.summary(old, new)
    assert "added 1" in text and "removed 1" in text and "changed 1" in text
    assert "+ dev.d/mcp" in text and "- dev.a/mcp" in text and "~ dev.b/mcp" in text
    assert "dev.c/mcp" not in text

    assert refresh.summary(new, new) == "added 0, removed 0, changed 0"


def test_the_caps_refuse_a_snapshot_that_is_too_big(refresh):
    assert (refresh.MAX_BYTES, refresh.MAX_ENTRIES) == (6 * 1024 * 1024, 20_000)
    built = refresh.build([_item("dev.alpha/mcp")])
    refresh.check_caps(built, refresh.render(built))  # fine
    with pytest.raises(SystemExit) as too_many:
        refresh.check_caps(built * 20_001, "x")
    assert too_many.value.code not in (0, None)
    with pytest.raises(SystemExit) as too_big:
        refresh.check_caps(built, "x" * (6 * 1024 * 1024 + 1))
    assert too_big.value.code not in (0, None)


def test_crawl_follows_the_cursor_to_the_last_page(refresh):
    pages = {
        None: {"servers": [_item("dev.a/mcp")], "metadata": {"nextCursor": "c1", "count": 1}},
        "c1": {"servers": [_item("dev.b/mcp")], "metadata": {"nextCursor": "c2", "count": 1}},
        "c2": {"servers": [_item("dev.c/mcp")], "metadata": {"count": 1}},
    }
    asked: list[str | None] = []

    def fetch(cursor):
        asked.append(cursor)
        return pages[cursor]

    names = [i["server"]["name"] for i in refresh.crawl(fetch, log=lambda *_: None)]
    assert names == ["dev.a/mcp", "dev.b/mcp", "dev.c/mcp"] and asked == [None, "c1", "c2"]


def test_the_page_address_asks_for_the_latest_versions_a_hundred_at_a_time(refresh):
    assert refresh.page_url(None) == (
        "https://registry.modelcontextprotocol.io/v0.1/servers?version=latest&limit=100"
    )
    assert refresh.page_url("a b/c:1.0") == (
        "https://registry.modelcontextprotocol.io/v0.1/servers?version=latest&limit=100"
        "&cursor=a+b%2Fc%3A1.0"
    )


# ---- the committed snapshot ----


def test_snapshot_loads(refresh):
    path = connector_catalog.REGISTRY_PATH
    assert path == refresh.SNAPSHOT
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    assert text.endswith("\n")
    lines = text[:-1].split("\n")  # JSON Lines: only a line feed ends a line
    assert 1_000 < len(lines) <= refresh.MAX_ENTRIES and len(raw) <= refresh.MAX_BYTES
    keys = []
    for line in lines:
        entry = json.loads(line)
        assert set(entry) == {
            "key",
            "title",
            "description",
            "website",
            "url",
            "transport",
            "headers",
        }
        assert entry["key"] and entry["url"].startswith("https://"), line
        assert entry["transport"] in ("streamable-http", "sse")
        assert len(entry["description"]) <= 200
        assert entry["website"] is None or entry["website"].startswith("https://")
        # No server whose key form would ask for a wallet, a private key or a pay-per-call token.
        for declared in entry["headers"]:
            assert not _PAYS.search(declared["name"]), line
        keys.append(entry["key"])
    assert keys == sorted(keys) and len(set(keys)) == len(keys)  # sorted, one line per key
    # No namespace is a link farm, and the catalog reads the whole file.
    namespaces = [k.split("/")[0] for k in keys]
    assert max(namespaces.count(n) for n in set(namespaces)) <= refresh.FARM_SIZE
    connector_catalog.registry.cache_clear()
    loaded = connector_catalog.registry()
    assert 1_000 < len(loaded) <= len(keys)  # minus the entries on a Featured host
    # No wall of cards with one name (521 were once all called "Site").
    names = Counter(entry["name"] for entry, _text in loaded.values())
    assert names.most_common(1)[0][1] <= 3, names.most_common(5)
    for known in ("com.apify/apify-mcp-server", "com.stripe/mcp"):
        assert connector_catalog.resolve(known)["featured"] is False
    # The vendors' own registry entries are hidden behind their Featured cards.
    for hidden in ("com.supabase/mcp", "com.notion/mcp", "app.linear/linear"):
        assert hidden in keys and connector_catalog.resolve(hidden) is None
