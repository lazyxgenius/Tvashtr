"""Refresh the bundled snapshot of the public MCP Registry (Toolkit › Connectors, Browse).

    cd backend && uv run python ../scripts/refresh_connector_registry.py

Pages the registry's latest server versions (about 380 pages, ten minutes), keeps what
``connector_catalog.slim_registry_entry`` keeps, drops every namespace with more than 20 kept
servers (link farms), and writes ``backend/tvashtr/control_plane/data/connector_registry.jsonl``:
one server per line, sorted by key, so a refresh is a readable diff. Prints the added, removed and
changed keys against the file that was there. Exits non-zero, and writes nothing, above 6 MB or
20,000 entries. Operator-run; the app never calls the registry.
"""

import json
import sys
import time
import urllib.request
from collections import Counter
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path
from urllib.parse import urlencode

from tvashtr.control_plane.connector_catalog import REGISTRY_PATH, slim_registry_entry

REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0.1/servers"
SNAPSHOT = REGISTRY_PATH
MAX_BYTES = 6 * 1024 * 1024
MAX_ENTRIES = 20_000
FARM_SIZE = 20  # a namespace with more kept servers than this is left out whole
MAX_PAGES = 2_000  # the registry has about 380; a cursor that never ends stops here
LISTED = 40  # keys printed per section of the summary
PAGE_TIMEOUT = 15  # seconds
ATTEMPTS = 8


def page_url(cursor: str | None) -> str:
    # ``limit=100`` is the registry's maximum. (Small limits with ``version=latest`` time out.)
    query = {"version": "latest", "limit": 100} | ({"cursor": cursor} if cursor else {})
    return f"{REGISTRY_URL}?{urlencode(query)}"


def fetch_page(cursor: str | None) -> dict:
    """One page of the registry. About one request in ten never answers (a normal page takes
    under two seconds), and a page can stay that way for a minute or two, so the wait is short
    and a page is tried several times with a growing pause."""
    request = urllib.request.Request(page_url(cursor), headers={"Accept": "application/json"})
    for attempt in range(1, ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(request, timeout=PAGE_TIMEOUT) as reply:
                return json.load(reply)
        except (OSError, ValueError) as exc:  # URLError and a timeout are OSErrors
            if attempt == ATTEMPTS:
                raise SystemExit(f"the registry didn't answer ({exc}); nothing written") from exc
            time.sleep(5 * attempt)
    raise AssertionError("unreachable")


def crawl(fetch: Callable[[str | None], dict] = fetch_page, log=print) -> Iterator[dict]:
    """Every item of the registry's server list, following ``metadata.nextCursor``."""
    cursor = None
    for page in range(1, MAX_PAGES + 1):
        body = fetch(cursor)
        yield from body.get("servers") or []
        cursor = (body.get("metadata") or {}).get("nextCursor")
        if page % 25 == 0:
            log(f"  page {page}…")
        if not cursor:
            return
    raise SystemExit(f"the registry's list didn't end after {MAX_PAGES} pages; nothing written")


def build(items: Iterable[dict]) -> list[dict]:
    """The snapshot's entries, sorted by key: the catalog's filter, one entry per key (the last
    one seen), and no namespace with more than ``FARM_SIZE`` kept servers."""
    kept = {slim["key"]: slim for item in items if (slim := slim_registry_entry(item))}
    sizes = Counter(key.split("/")[0] for key in kept)
    return [kept[key] for key in sorted(kept) if sizes[key.split("/")[0]] <= FARM_SIZE]


def render(entries: list[dict]) -> str:
    return "".join(
        json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n" for entry in entries
    )


def read_snapshot_text(text: str) -> dict[str, dict]:
    # Only a line feed ends a JSON Lines line: ``splitlines`` would also cut at a U+2028 that a
    # description carries (``render`` writes it as it is).
    lines = filter(str.strip, text.split("\n"))
    return {entry["key"]: entry for entry in map(json.loads, lines)}


def check_caps(entries: list[dict], text: str) -> None:
    size = len(text.encode("utf-8"))
    if len(entries) > MAX_ENTRIES or size > MAX_BYTES:
        raise SystemExit(
            f"snapshot too big: {len(entries)} entries, {size / 1e6:.2f} MB "
            f"(caps: {MAX_ENTRIES} entries, {MAX_BYTES / 1e6:.2f} MB); nothing written"
        )


def summary(old: dict[str, dict], new: dict[str, dict]) -> str:
    """Added, removed and changed keys, new against old."""
    sections = [
        ("added", "+", sorted(new.keys() - old.keys())),
        ("removed", "-", sorted(old.keys() - new.keys())),
        ("changed", "~", sorted(k for k in new.keys() & old.keys() if new[k] != old[k])),
    ]
    lines = [", ".join(f"{title} {len(keys)}" for title, _, keys in sections)]
    for _title, mark, keys in sections:
        lines += [f"  {mark} {key}" for key in keys[:LISTED]]
        if len(keys) > LISTED:
            lines.append(f"  {mark} … and {len(keys) - LISTED} more")
    return "\n".join(lines)


def main() -> None:
    path = Path(SNAPSHOT)
    old = read_snapshot_text(path.read_text(encoding="utf-8")) if path.exists() else {}
    print(f"Reading {REGISTRY_URL} …")
    items = list(crawl())
    entries = build(items)
    text = render(entries)
    check_caps(entries, text)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print(f"{len(items)} servers read, {len(entries)} kept, {len(text.encode()) / 1e6:.2f} MB")
    print(f"Wrote {path}")
    print(summary(old, {entry["key"]: entry for entry in entries}))


if __name__ == "__main__":
    sys.exit(main())
