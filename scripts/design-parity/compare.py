"""Side-by-side + difference view of a design PNG and an app PNG of the same screen.

Usage: imgenv/bin/python compare.py <design.png> <app.png> <out.png>
Prints the share of pixels that differ noticeably, so a size drift (bigger fonts/buttons shift
everything below them) shows up as a large number even when the screens "look alike".
"""

import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

design_path, app_path, out_path = sys.argv[1:4]
d = Image.open(design_path).convert("RGB")
a = Image.open(app_path).convert("RGB")
w, h = max(d.width, a.width), max(d.height, a.height)
pad = lambda im: (lambda c: (c.paste(im, (0, 0)), c)[1])(Image.new("RGB", (w, h), (255, 255, 255)))
d2, a2 = pad(d), pad(a)
da, aa = np.asarray(d2).astype(int), np.asarray(a2).astype(int)
delta = np.abs(da - aa).sum(axis=2)
mask = delta > 60
share = mask.mean() * 100
# Difference view: app dimmed, differing pixels in coral.
diff = (aa * 0.35 + 255 * 0.65).astype(np.uint8)
diff[mask] = [217, 119, 87]
diff_im = Image.fromarray(diff)
scale = 0.5
tile_w, tile_h = int(w * scale), int(h * scale)
out = Image.new("RGB", (tile_w * 3 + 40, tile_h + 30), (250, 249, 245))
draw = ImageDraw.Draw(out)
for i, (label, im) in enumerate((("DESIGN", d2), ("APP", a2), (f"DIFF {share:.1f}%", diff_im))):
    x = i * (tile_w + 20)
    out.paste(im.resize((tile_w, tile_h)), (x, 30))
    draw.text((x + 4, 8), label, fill=(20, 20, 19))
out.save(out_path)
print(f"{share:.2f}% pixels differ")
