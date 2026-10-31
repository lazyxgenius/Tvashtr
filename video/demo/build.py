"""Demo D1: "Tvashtr in 2 minutes" from the film's existing takes and voice lines (brief film-demo).

    . video/env.sh && video/voice-venv/bin/python video/demo/build.py          # → video/out/demo/
    video/voice-venv/bin/python video/demo/build.py --only-captions            # captions + cuts.json only

shots.json is the shot list. Each take shot is framed as the film frames a take (cream #F7F4EE ground, the
window with rounded corners, a soft shadow and a coral ring), its label in the film's badge below the window;
the 0.2 / 8.2 cards are V3's, as built (8.2 holds its last full frame ~2 s after its line, then fades).
Narration: each passed line as it is, mixed at its shot's start + lead, then one compressor, a gain and a
limiter to -14 LUFS with the true peak under the -1.5 dBTP bar (no music, no cut sounds: the film uses none).
Captions come from the script's own words, aligned to the voice.
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "video" / "v3"))
OUT = ROOT / "video" / "out" / "demo"
WORK = OUT / "work"
FPS, W, H = 30, 1920, 1080
WIN = {"x": 160, "y": 14, "w": 1600, "h": 1000, "r": 20, "ring": 3}  # the take's window on the 1920×1080 canvas
FONT = "/System/Library/Fonts/Helvetica.ttc"
INK, BADGE = "0x2B2622", "0xEFEBE0"
LUFS_TARGET, LIMIT_DB = -14.0, -3.0  # the limiter sits under the -1.5 dBTP bar: AAC adds a little on top
SR = 48000
LOOK = 1  # bump when frame_png / the badge change: it invalidates the cached pieces


def frames(s):
    return round(s * FPS) / FPS


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{' '.join(map(str, cmd[:4]))} … failed:\n{r.stderr[-1500:]}")
    return r.stderr


# ---- the film's frame ------------------------------------------------------------------------------


def frame_png(path):
    """1920×1080 RGBA: cream ground, soft shadow, coral ring, the window's rounded hole transparent."""
    from PIL import Image, ImageDraw, ImageFilter

    S = 4

    def rr(x0, y0, x1, y1, r):
        m = Image.new("L", (W * S, H * S), 0)
        ImageDraw.Draw(m).rounded_rectangle([x0 * S, y0 * S, x1 * S - 1, y1 * S - 1], r * S, fill=255)
        return m.resize((W, H), Image.LANCZOS)

    x, y, w, h, r, k = (WIN[c] for c in ("x", "y", "w", "h", "r", "ring"))
    shadow = rr(x, y + 14, x + w, y + h + 14, r).filter(ImageFilter.GaussianBlur(14)).point(lambda v: v * 70 // 255)
    img = Image.new("RGB", (W, H), (0xF7, 0xF4, 0xEE))
    img.paste(Image.new("RGB", (W, H), (0x3D, 0x34, 0x27)), mask=shadow)
    img.paste(Image.new("RGB", (W, H), (0xD9, 0x77, 0x57)), mask=rr(x - k, y - k, x + w + k, y + h + k, r + k))
    img.putalpha(rr(x, y, x + w, y + h, r).point(lambda v: 255 - v))
    img.save(path)


def encode(inputs, graph, n, out):
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", graph, "-map", "[v]", "-frames:v", str(n), "-an",
         "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", str(FPS), str(out)])


def cached(spec, out, make):
    """Re-encode a piece only when its spec changed (the spec is kept beside it)."""
    key = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
    mark = out.with_suffix(".key")
    if not (out.exists() and mark.exists() and mark.read_text() == key):
        make()
        mark.write_text(key)


def take_piece(frame, take, a, b, speed, n_frames, label, out):
    mp4 = ROOT / "video" / "takes" / take / "take.mp4"
    text = out.with_suffix(".txt")
    badge = "null"
    if label:
        text.write_text(label, encoding="utf-8")
        badge = (f"drawtext=fontfile={FONT}:textfile={text}:fontsize=26:fontcolor={INK}:box=1:boxcolor={BADGE}:"
                 f"boxborderw=10:x={WIN['x'] + WIN['w'] - 10}-tw:y=1032")

    def make():
        graph = (f"[0:v]setpts=(PTS-STARTPTS)/{speed:.6f},fps={FPS},scale={WIN['w']}:{WIN['h']}:flags=lanczos,"
                 f"pad={W}:{H}:{WIN['x']}:{WIN['y']}:color=0xF7F4EE,tpad=stop_mode=clone:stop_duration=3[p];"
                 f"[p][1:v]overlay=0:0:shortest=1:format=auto,{badge},format=yuv420p[v]")
        encode(["-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", str(mp4), "-loop", "1", "-framerate", str(FPS), "-i", str(frame)],
               graph, n_frames, out)

    cached({"take": take, "a": a, "b": b, "speed": speed, "n": n_frames, "label": label, "win": WIN, "look": LOOK}, out, make)


def card_piece(src, a, b, n_frames, out, still=False):
    def make():
        if still:  # the frame at `a`, held
            png = out.with_suffix(".png")
            run(["ffmpeg", "-y", "-v", "error", "-ss", f"{a:.3f}", "-i", str(src), "-frames:v", "1", str(png)])
            encode(["-loop", "1", "-framerate", str(FPS), "-i", str(png)], f"[0:v]format=yuv420p[v]", n_frames, out)
        else:
            encode(["-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", str(src)], f"[0:v]fps={FPS},format=yuv420p[v]", n_frames, out)

    cached({"src": str(src), "a": a, "b": b, "n": n_frames, "still": still}, out, make)


# ---- lines ------------------------------------------------------------------------------------------


def load_lines():
    timing = {r["scene"]: r for r in json.loads((ROOT / "video/v3/narration-timing.json").read_text())["lines"]}
    out = {k: {"file": ROOT / r["file"], "text": r["text"], "words": r["words"], "onset": r["onset_s"]} for k, r in timing.items()
           if r.get("file")}
    manifest = json.loads((ROOT / "video/demo/voice-manifest.json").read_text())
    for k, e in manifest["lines"].items():
        render = next(r for r in e["renders"] if r["n"] == e["render"])
        out[k] = {"file": ROOT / e["file"], "text": e["text"], "words": render["words"], "onset": 0.12}
    return out


# ---- the cut ----------------------------------------------------------------------------------------


def plan(shots, lines):
    """Every shot's timing and pieces: [{n, line, start, length, audio_at, label, pieces: [...]}]."""
    lead, tail = shots["lead"], shots["tail"]
    clock, out = 0.0, []
    for s in shots["shots"]:
        line = lines[s["line"]]
        dur = sf.info(line["file"]).duration
        ld = s.get("lead", lead)
        if "card" in s:
            length = frames(s["length"]) if "length" in s else frames(ld + dur + s["hold_after_line"])
        else:
            length = frames(ld + dur + tail)
        out.append({"n": s["n"], "line": s["line"], "start": clock, "length": length, "audio_at": clock + ld, "spec": s,
                    "dur": dur})
        clock += length
    return out


def pieces_of(shot):
    """The shot's pieces: dicts with take/in/out/speed/length, in order."""
    s, length = shot["spec"], shot["length"]
    if "card" in s:
        card = ROOT / s["card"]
        if "fade_from" not in s:
            return [{"kind": "card", "src": card, "in": 0.0, "out": 4.0, "speed": 1.0, "length": length}]
        a = s["fade_from"]
        hold = length - 4.0
        return [{"kind": "card", "src": card, "in": 0.0, "out": a, "speed": 1.0, "length": frames(a)},
                {"kind": "hold", "src": card, "in": a, "out": a, "speed": 0.0, "length": frames(hold)},
                {"kind": "card", "src": card, "in": a, "out": 4.0, "speed": 1.0, "length": frames(4.0 - a)}]
    segs = s["segs"]
    if s.get("fit"):  # one speed for every segment, so the shot is exactly as long as its line
        speed = sum(g[2] - g[1] for g in segs) / length
        out, used = [], 0.0
        for i, (take, a, b) in enumerate(g[:3] for g in segs):
            ln = frames(length - used) if i == len(segs) - 1 else frames((b - a) / speed)
            out.append({"kind": "take", "take": take, "in": a, "out": b, "speed": speed, "length": ln})
            used += ln
        return out
    out, used = [], 0.0
    for i, seg in enumerate(segs):
        take, a, b = seg[:3]
        speed = seg[3] if len(seg) > 3 else 1.0
        last = i == len(segs) - 1
        ln = frames(length - used) if last else frames((b - a) / speed)
        if last:
            b = a + ln * speed
        out.append({"kind": "take", "take": take, "in": a, "out": b, "speed": speed, "length": ln})
        used += ln
    return out


def take_duration(take):
    return json.loads((ROOT / "video" / "takes" / take / "take.json").read_text())["duration_s"]


def build_video(plans):
    WORK.mkdir(parents=True, exist_ok=True)
    frame = WORK / "frame.png"
    frame_png(frame)
    parts, cuts = [], []
    for sh in plans:
        spec, shot_cuts = sh["spec"], []
        label_t = spec.get("label")
        for i, p in enumerate(pieces_of(sh)):
            out = WORK / f"shot{sh['n']:02d}-{i}.mp4"
            n = round(p["length"] * FPS)
            if p["kind"] == "take":
                label = label_t.replace("{x}", f"{p['speed']:.1f}") if label_t else None
                avail = take_duration(p["take"])
                held = max(0.0, p["out"] - avail) / p["speed"]
                take_piece(frame, p["take"], p["in"], min(p["out"], avail), p["speed"], n, label, out)
                shot_cuts.append({"take": f"video/takes/{p['take']}/take.mp4", "in": round(p["in"], 2), "out": round(min(p["out"], avail), 2),
                                  "speed": round(p["speed"], 2), "length_s": round(p["length"], 3), "held_s": round(held, 2),
                                  "label": label})
            else:
                card_piece(p["src"], p["in"], p["out"], n, out, still=p["kind"] == "hold")
                shot_cuts.append({"take": str(p["src"].relative_to(ROOT)), "in": round(p["in"], 2), "out": round(p["out"], 2),
                                  "speed": 1.0 if p["kind"] == "card" else 0.0, "length_s": round(p["length"], 3),
                                  "held_s": round(p["length"], 3) if p["kind"] == "hold" else 0.0, "label": None})
            parts.append(out)
        cuts.append({"n": sh["n"], "line": sh["line"], "start_s": round(sh["start"], 3), "length_s": round(sh["length"], 3),
                     "audio_start_s": round(sh["audio_at"], 3), "label": shot_cuts[0]["label"], "pieces": shot_cuts})
    (WORK / "list.txt").write_text("".join(f"file '{p.name}'\n" for p in parts))
    silent = WORK / "picture.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(WORK / "list.txt"), "-c", "copy", str(silent)])
    return silent, cuts


# ---- the sound --------------------------------------------------------------------------------------


def chain(g):
    return (f"acompressor=threshold=-24dB:ratio=3:attack=8:release=120:makeup=1,volume={g:.2f}dB,"
            f"alimiter=limit={10 ** (LIMIT_DB / 20):.4f}:attack=2:release=40:level=disabled,pan=stereo|c0=c0|c1=c0")


def loudness(path, af=""):
    err = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", (af + "," if af else "") + "ebur128=peak=true", "-f", "null", "-"])
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1]), float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", err)[-1])


def build_audio(plans, lines, total):
    track = np.zeros(int(round(total * SR)))
    for sh in plans:
        wav, sr = sf.read(lines[sh["line"]]["file"])
        assert sr == SR, (sh["line"], sr)
        i = int(round(sh["audio_at"] * SR))
        track[i : i + len(wav)] += wav
    raw = WORK / "narration.wav"
    sf.write(raw, track, SR, subtype="PCM_24")
    g = 12.0
    for _ in range(8):  # the limiter bends the gain: walk it onto the target
        i, tp = loudness(raw, chain(g))
        if abs(LUFS_TARGET - i) <= 0.15:
            break
        g += LUFS_TARGET - i
    mastered = WORK / "narration-mastered.wav"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-af", chain(g), "-ar", str(SR), "-c:a", "pcm_s24le", str(mastered)])
    print(f"AUDIO: compressor + {g:.1f} dB + limiter → {i:.1f} LUFS, true peak {tp:.1f} dBFS (before AAC)")
    return mastered


# ---- captions ---------------------------------------------------------------------------------------


def align(words, heard, with_match=False):
    """[(start, end)] for each of the script's words, from the transcriber's: words matched by sound-alike
    tokens (digits and the name differ), the rest spread over the gap between their matched neighbours.
    with_match: also [bool] — the word's tokens were all heard as written."""
    from voice import norm

    s_tok = [(i, t) for i, w in enumerate(words) for t in norm(w).split()]
    h_tok = [(j, t) for j, h in enumerate(heard) for t in norm(h["word"]).split()]
    ops = SequenceMatcher(None, [t for _, t in s_tok], [t for _, t in h_tok], autojunk=False).get_opcodes()
    pick, equal = {}, set()
    for tag, i1, i2, j1, j2 in ops:
        for k in range(i1, i2):
            if tag == "equal":
                pick[k] = j1 + (k - i1)
                equal.add(k)
            elif tag == "replace":
                pick[k] = j1 + min(j2 - j1 - 1, (k - i1) * (j2 - j1) // (i2 - i1))
    times = []
    for i in range(len(words)):
        ks = [k for k, (wi, _) in enumerate(s_tok) if wi == i]
        js = [h_tok[pick[k]][0] for k in ks if k in pick]
        times.append((heard[min(js)]["start"], heard[max(js)]["end"]) if js else None)
    for i, t in enumerate(times):  # unmatched words: between the neighbours
        if t is None:
            prev = next((times[j][1] for j in range(i - 1, -1, -1) if times[j]), heard[0]["start"])
            nxt = next((times[j][0] for j in range(i + 1, len(words)) if times[j]), heard[-1]["end"])
            times[i] = (prev, max(prev, nxt))
    if with_match:
        return times, [all(k in equal for k, (wi, _) in enumerate(s_tok) if wi == i) for i in range(len(words))]
    return times


def wrap(text, width=42):
    """The text as one line, or two balanced lines ≤ width; None if it can't."""
    if len(text) <= width:
        return [text]
    cuts = [i for i, c in enumerate(text) if c == " " and i <= width and len(text) - i - 1 <= width]
    if not cuts:
        return None
    i = min(cuts, key=lambda i: abs(i - (len(text) - i - 1)))
    return [text[:i], text[i + 1 :]]


def cues_of(words, times, at):
    """Cues (start, end, [lines]) for one line: whole sentences while they fit two lines of 42 characters."""
    sentences, cur = [], []
    for i, w in enumerate(words):
        cur.append(i)
        if re.search(r"[.!?]$", w):
            sentences.append(cur)
            cur = []
    if cur:
        sentences.append(cur)
    cues, group = [], []

    def flush():
        if group:
            idx = [i for s in group for i in s]
            cues.append((idx, " ".join(words[i] for i in idx)))

    for s in sentences:
        trial = [i for g in group for i in g] + s
        if group and wrap(" ".join(words[i] for i in trial)) is None:
            flush()
            group = []
        group.append(s)
    flush()
    out = []
    for idx, text in cues:
        lines = wrap(text)
        if lines is None:
            raise SystemExit(f"caption does not fit two lines of 42: {text!r}")
        out.append((at + times[idx[0]][0], at + times[idx[-1]][1], lines, idx[0], idx[-1]))
    return out


def stamp(t, comma):
    ms = round(t * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}{',' if comma else '.'}{ms % 1000:03d}"


def edges(samples, sr, db=-40.0):
    """Where the voice starts and stops: ([onset s], [offset s]) — a loud 10 ms frame after ≥ 100 ms of quiet, and the
    first of ≥ 120 ms of quiet after a loud one. (The transcriber's word starts run early after a pause.)"""
    if samples.ndim > 1:
        samples = np.abs(samples).max(axis=1)
    frame = int(0.01 * sr)
    n = len(samples) // frame
    loud = np.abs(samples[: n * frame]).reshape(n, frame).max(axis=1) > 10 ** (db / 20)
    on = [j / 100 for j in range(10, n) if loud[j] and not loud[j - 10 : j].any()]
    off = [j / 100 for j in range(1, n - 12) if loud[j - 1] and not loud[j : j + 12].any()]
    return on, off


def nearest(t, edge, tol):
    near = min(edge, key=lambda e: abs(e - t), default=None)
    return near if near is not None and abs(near - t) <= tol else t


def build_captions(plans, lines, mastered):
    samples, sr = sf.read(mastered)
    on, off = edges(samples, sr)
    cues = []
    for sh in plans:
        line = lines[sh["line"]]
        words = line["text"].split()
        times = align(words, line["words"])
        times[0] = (max(times[0][0], line["onset"]), times[0][1])  # the transcriber snaps a first word to 0.0
        cues += [(nearest(a, on, 0.6), nearest(b, off, 0.4), t) for a, b, t in (c[:3] for c in cues_of(words, times, sh["audio_at"]))]
    vtt = "WEBVTT\n\n" + "".join(f"{stamp(a, False)} --> {stamp(b, False)}\n" + "\n".join(t) + "\n\n" for a, b, t in cues)
    srt = "".join(f"{i}\n{stamp(a, True)} --> {stamp(b, True)}\n" + "\n".join(t) + "\n\n" for i, (a, b, t) in enumerate(cues, 1))
    (OUT / "demo-2min.en.vtt").write_text(vtt, encoding="utf-8")
    (OUT / "demo-2min.en.srt").write_text(srt, encoding="utf-8")
    print(f"CAPTIONS: {len(cues)} cues")
    return cues


# ---- main -------------------------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only-captions", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    shots = json.loads((ROOT / "video/demo/shots.json").read_text())
    lines = load_lines()
    plans = plan(shots, lines)
    total = sum(p["length"] for p in plans)
    mastered = WORK / "narration-mastered.wav"
    if not args.only_captions:
        silent, cuts = build_video(plans)
        mastered = build_audio(plans, lines, total)
    build_captions(plans, lines, mastered)
    if args.only_captions:
        return
    film = OUT / "demo-2min.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(silent), "-i", str(mastered), "-map", "0:v", "-map", "1:a", "-c:v", "copy",
         "-c:a", "aac", "-b:a", "256k", "-ar", str(SR), "-shortest", "-movflags", "+faststart", str(film)])
    (OUT / "demo-2min.cuts.json").write_text(json.dumps({
        "film": "video/out/demo/demo-2min.mp4", "fps": FPS, "size": [W, H], "duration_s": round(total, 3), "shots": cuts,
        "lines": [{"id": p["line"], "audio_start_s": round(p["audio_at"], 3), "length_s": round(p["dur"], 3),
                   "file": str(lines[p["line"]]["file"].relative_to(ROOT)), "text": lines[p["line"]]["text"]} for p in plans]},
        indent=1, ensure_ascii=False) + "\n")
    run(["ffmpeg", "-y", "-v", "error", "-i", str(film), "-vf",
         f"fps=1,scale=192:108,drawtext=fontfile={FONT}:text='%{{pts\\:hms}}':x=3:y=3:fontsize=14:fontcolor=white:box=1:boxcolor=black@0.55,"
         f"tile=10x{int(np.ceil(total / 10))}", "-frames:v", "1", str(OUT / "demo-2min-sheet.png")])
    print(f"FILM: {film.relative_to(ROOT)} {total:.2f} s, {len(plans)} shots")


if __name__ == "__main__":
    main()
