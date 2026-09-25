# design-parity

Checks that a rebuilt screen matches its design artboard at the **same size** — fonts, weights,
control heights and widths — not just "looks similar". The previous revamp matched the design by
eye but shipped larger text and buttons; this harness turns that into a measured gate.

## What it does

1. `shoot-design.mjs` renders design artboards (the design canvas export) at their native size with
   the real web fonts, saving a PNG and a measurement JSON per artboard.
2. `shoot-app.mjs` renders the real frontend at the same viewport, answering every `/api` call from
   a scenario's fixtures (no backend needed), in website or Desktop mode, and saves the same pair.
3. `parity.py` matches every visible text and control between the two by its label and reports font
   size / weight / family drift, control height (>1px) and width (>6px) drift, moved items (>12px)
   and design items missing from the app. **Gate: zero size/type drift on matched items.**
4. `compare.py` (optional) writes a side-by-side DESIGN | APP | DIFF image.

## Run it

```bash
# 1. Design references (once): DESIGN_DIR = the design canvas's project/ folder, with the canvas
#    runtime saved beside the artboards as support.js.
DESIGN_DIR=/path/to/export/project node scripts/design-parity/shoot-design.mjs /tmp/parity/design Home-Main

# 2. The app (no backend needed):
(cd frontend && npx vite --port 5199) &
node scripts/design-parity/shoot-app.mjs /tmp/parity/app scripts/design-parity/scenarios/home.mjs home-web

# 3. Compare:
python3 scripts/design-parity/parity.py /tmp/parity/design/Home-Main.json /tmp/parity/app/home-web.json
uv run --with pillow --with numpy python scripts/design-parity/compare.py \
  /tmp/parity/design/Home-Main.png /tmp/parity/app/home-web.png /tmp/parity/home.png
```

Fonts come from Google Fonts. `fonts-route.mjs` fetches them with `curl` and caches them
(`FONT_CACHE_DIR`), because a fallback font silently makes every screen look bigger.
Scenario files live in `scenarios/` — one per area, mirroring the design's sample data.
