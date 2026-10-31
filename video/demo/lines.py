"""Demo D1: the two new lines' gates beyond the transcript (brief film-demo §3).

    . video/env.sh && video/voice-venv/bin/python video/demo/lines.py

Prints, for the 11 passed V3 lines the demo reuses and the 2 new ones: integrated loudness, and whether
the ending is intact (the last word ends before the file does, and the file's last 60 ms is silent, so
nothing is cut mid-word). A new line more than 1 LU from the old lines' median gets a plain gain, written
beside the render (the raw render stays in lines/renders/); the old files are only read.
"""

import json
import re
import statistics
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
OLD = ["0.1", "0.2", "2.1", "2.2", "2.4", "3.3", "3.4", "3.4-verdict", "3.6", "8.1-web", "8.2"]
NEW = ROOT / "video" / "out" / "demo" / "lines"
TOL_LU = 1.0


def lufs(path):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])


def ending(path, last_word_end):
    wav, sr = sf.read(path)
    tail = wav[-int(0.06 * sr):]
    rms = 20 * np.log10(max(float(np.sqrt(np.mean(tail**2))), 1e-9))
    return len(wav) / sr - last_word_end, rms


def main():
    timing = {r["scene"]: r for r in json.loads((ROOT / "video/v3/narration-timing.json").read_text())["lines"]}
    old = {}
    for s in OLD:
        r = timing[s]
        old[s] = (lufs(ROOT / r["file"]), *ending(ROOT / r["file"], r["words"][-1]["end"]))
        print(f"OLD {s:12s} {old[s][0]:6.1f} LUFS  last word ends {old[s][1]:.2f} s before the file's end, tail {old[s][2]:.0f} dBFS")
    med = statistics.median(v[0] for v in old.values())
    print(f"OLD median {med:.2f} LUFS (range {min(v[0] for v in old.values()):.1f} … {max(v[0] for v in old.values()):.1f})")
    manifest = json.loads((ROOT / "video/demo/voice-manifest.json").read_text())
    for s, e in manifest["lines"].items():
        render = next(r for r in e["renders"] if r["n"] == e["render"])
        final = ROOT / e["file"]
        raw = ROOT / render["file"]
        i = lufs(raw)
        gap, tail = ending(raw, render["words"][-1]["end"])
        gain = 0.0 if abs(i - med) <= TOL_LU else med - i
        if gain:
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-af", f"volume={gain:.2f}dB", "-c:a", "pcm_s24le", str(final)],
                           check=True)
        print(f"NEW {s:12s} {i:6.1f} LUFS (old median {med:.1f}; Δ {i - med:+.1f}) → gain {gain:+.2f} dB → {lufs(final):.1f} LUFS; "
              f"ending: last word ends {gap:.2f} s before the file's end, tail {tail:.0f} dBFS → "
              f"{'INTACT' if gap >= 0.08 and tail < -45 else 'CHECK'}")


if __name__ == "__main__":
    main()
