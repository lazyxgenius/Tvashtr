"""Split a composite design board (a grid of <figure> screens) into one standalone artboard each.

Usage: python3 split-composite.py <src project/> <out project/> <Board> [<Board> ...]
Each <figure> (a <figcaption> step name + a framed 1440x900 screen) becomes <Board>-<n>.dc.html,
numbered in document order, keeping the composite's <head>, <helmet> and data-dc-script block so
{{holes}} still resolve. Writes out/canvas.json listing every artboard (w/h from the screen div)
and prints "<name>  <section> · <caption>" per artboard. Copy support.js, tokens and ds/ yourself.
"""

import json
import re
import sys
from pathlib import Path


def figures(html):
    """(caption, screen-markup) per <figure>; figures don't nest."""
    for m in re.finditer(r"<figure\b.*?</figure>", html, re.S):
        fig = m.group(0)
        cap = re.search(r"<figcaption[^>]*>(.*?)</figcaption>", fig, re.S)
        frame = fig[cap.end() : fig.rindex("</figure>")].strip()
        # The frame is a rounded/outlined wrapper div around the screen div: unwrap it.
        screen = frame[frame.index(">") + 1 : frame.rindex("</div>")]
        yield re.sub(r"<[^>]+>", "", cap.group(1)).strip(), screen, m.start()


def split(src, out, board):
    html = (src / f"{board}.dc.html").read_text()
    head, rest = html.split("</helmet>", 1)
    tail = rest[rest.index("</x-dc>") :]
    sections = [
        (m.start(), re.sub(r"<[^>]+>", "", m.group(1)))
        for m in re.finditer(r"<h2[^>]*>(.*?)</h2>", html, re.S)
    ]
    boards = {}
    for n, (cap, screen, at) in enumerate(figures(html), 1):
        w, h = (
            int(v) for v in re.search(r"width:\s*(\d+)px;\s*height:\s*(\d+)px", screen).groups()
        )
        t = re.sub(
            r'"\$preview":\s*\{[^}]*\}', f'"$preview": {{"width": {w}, "height": {h}}}', tail
        )
        name = f"{board}-{n}"
        (out / f"{name}.dc.html").write_text(f"{head}</helmet>\n{screen}\n{t}")
        boards[f"{name}.dc.html"] = {"w": w, "h": h}
        sec = next((s for p, s in reversed(sections) if p < at), "")
        print(f"{name}  {sec} · {cap}")
    return boards


if __name__ == "__main__":
    src, out, *names = sys.argv[1:]
    src, out = Path(src), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    canvas = out / "canvas.json"
    boards = json.loads(canvas.read_text())["boards"] if canvas.exists() else {}
    for b in names:
        boards.update(split(src, out, b))
    canvas.write_text(json.dumps({"boards": boards}, indent=1))
