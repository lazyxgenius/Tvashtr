"""Compare measured text/controls between a design render and an app render of the same screen.

Usage: python parity.py <design.json> <app.json> [--all]
Matches entries by (kind, text). Reports font-size / weight / family differences and, for
controls, height differences > 1px and width differences > 6px. Exit summary line first.
"""
import json, sys
from collections import defaultdict

d = json.load(open(sys.argv[1])); a = json.load(open(sys.argv[2]))
show_all = "--all" in sys.argv
by = defaultdict(list)
for e in a: by[e["key"]].append(e)
# looser match on text alone (tag/kind can differ between design markup and real components)
by_text = defaultdict(list)
for e in a: by_text[e["text"].lower()].append(e)
issues, matched, unmatched = [], 0, []
for e in d:
    cands = by.get(e["key"]) or by_text.get(e["text"].lower())
    if not cands:
        unmatched.append(e); continue
    m = min(cands, key=lambda c: abs(c["y"] - e["y"]) + abs(c["x"] - e["x"]))
    matched += 1
    probs = []
    if abs(m["fs"] - e["fs"]) >= 0.5: probs.append(f"font {e['fs']}→{m['fs']}px")
    if abs(m["fw"] - e["fw"]) >= 100: probs.append(f"weight {e['fw']}→{m['fw']}")
    if m["ff"] != e["ff"]: probs.append(f"family {e['ff']}→{m['ff']}")
    if e["kind"] == "ctl" and abs(m["h"] - e["h"]) > 1: probs.append(f"height {e['h']}→{m['h']}")
    if e["kind"] == "ctl" and abs(m["w"] - e["w"]) > 6: probs.append(f"width {e['w']}→{m['w']}")
    if abs(m["y"] - e["y"]) > 12 or abs(m["x"] - e["x"]) > 12: probs.append(f"pos ({e['x']},{e['y']})→({m['x']},{m['y']})")
    if probs: issues.append((e, probs))
size_issues = [i for i in issues if any(not p.startswith("pos") for p in i[1])]
print(f"matched {matched}/{len(d)} design items · {len(size_issues)} with size/type drift · {len(issues)-len(size_issues)} only moved · {len(unmatched)} not found in app")
for e, probs in (issues if show_all else size_issues)[:80]:
    print(f"  [{e['kind']}] {e['text'][:48]!r}: {', '.join(probs)}")
if show_all:
    for e in unmatched[:60]: print(f"  MISSING [{e['kind']}] {e['text'][:60]!r}")
