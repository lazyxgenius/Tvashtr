"""Demo D1 checks (brief film-demo §6). Every result is printed with its numbers.

    . video/env.sh && PY=video/voice-venv/bin/python; export HF_HUB_OFFLINE=1
    $PY video/demo/qa.py cuts        # the frames either side of every cut → video/out/demo/work/cuts-N.png
    $PY video/demo/qa.py film        # checks 1–4, 6 and the film's part of 7
    $PY video/demo/qa.py files       # check 7 for every other file, and check 8's hashes
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "video" / "v3"))
sys.path.insert(0, str(ROOT / "video" / "demo"))
OUT = ROOT / "video" / "out" / "demo"
WORK = OUT / "work"
FILM = OUT / "demo-2min.mp4"
FONT = "/System/Library/Fonts/Helvetica.ttc"


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stdout + r.stderr


def probe(path, entries, stream=None):
    cmd = ["ffprobe", "-v", "error", *(["-select_streams", stream] if stream else []), "-show_entries", entries, "-of", "default=nw=1", str(path)]
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip().replace("\n", " ")


def cuts_sheets():
    cuts = json.loads((OUT / "demo-2min.cuts.json").read_text())
    times = []
    for s in cuts["shots"]:
        t = s["start_s"]
        for p in s["pieces"]:
            if t > 0:
                times.append(t)
            t += p["length_s"]
    WORK.mkdir(exist_ok=True)
    per, sheets = 15, []
    for k in range(0, len(times), per):
        chunk = times[k : k + per]
        files = []
        for j, t in enumerate(chunk):
            for side, dt in (("a", -1 / 30), ("b", 0.0)):  # the last frame before the cut, the first after
                f = WORK / f"cut-{k + j:02d}{side}.png"
                sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{max(0, t + dt - 0.0005):.4f}", "-i", str(FILM), "-frames:v", "1",
                    "-vf", f"scale=384:-1,drawtext=fontfile={FONT}:text='{t:.2f}{'-' if side == 'a' else '+'}':x=4:y=4:fontsize=20:"
                            "fontcolor=white:box=1:boxcolor=black@0.6", str(f)])
                files.append(f)
        out = WORK / f"cuts-{k // per + 1}.png"
        args = ["ffmpeg", "-y", "-v", "error"]
        for f in files:
            args += ["-i", str(f)]
        args += ["-filter_complex", "".join(f"[{i}:v]" for i in range(len(files))) + f"xstack=inputs={len(files)}:layout="
                 + "|".join(f"{(i % 5) * 384}_{(i // 5) * 216}" for i in range(len(files))), str(out)]
        sh(args)
        sheets.append(out)
    print("CUTS:", len(times), "cuts →", ", ".join(str(s.relative_to(ROOT)) for s in sheets), "(each cut: the frame before | after)")


def loud(path):
    err = sh(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"])
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1]), float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", err)[-1])


def film_checks():
    from build import align, edges
    from voice import transcribe

    cuts = json.loads((OUT / "demo-2min.cuts.json").read_text())
    lines = cuts["lines"]
    shots = {s["line"]: s for s in cuts["shots"]}
    ok = True

    # 1 — duration, first word, last words, no clipped line
    dur = float(probe(FILM, "format=duration").split("=")[1])
    wav = WORK / "film-16k.wav"
    sh(["ffmpeg", "-y", "-v", "error", "-i", str(FILM), "-ac", "1", "-ar", "16000", str(wav)])
    text, heard = transcribe(str(wav))
    import numpy as np
    import soundfile as sf
    samples, sr = sf.read(wav)
    first = float(np.argmax(np.abs(samples) > 10 ** (-50 / 20))) / sr  # the voice's first sound (the transcriber snaps a first word to 0.0)
    script = [w for l in lines for w in l["text"].split()]
    times, matched = align(script, heard, with_match=True)
    missing, clipped, k = [], [], 0
    for l in lines:
        words = l["text"].split()
        last = k + len(words) - 1
        end = times[last][1]
        k += len(words)
        s = shots[l["id"]]
        shot_end = s["start_s"] + s["length_s"]
        name = words[-1].lower().startswith("tvashtr")  # the transcriber spells the name its own way
        if not (matched[last] or name):
            missing.append((l["id"], words[-1]))
        if not (s["start_s"] <= l["audio_start_s"] and l["audio_start_s"] + l["length_s"] <= shot_end + 1e-6) or end > shot_end:
            clipped.append(l["id"])
    c1 = 110 <= dur <= 130 and first <= 1.3 and not missing and not clipped
    ok &= c1
    print(f"CHECK 1 {'PASS' if c1 else 'FAIL'}: duration {dur:.2f} s ({int(dur // 60)}:{dur % 60:05.2f}; bar 1:50–2:10) · first sound of the voice at {first:.2f} s "
          f"(bar 1.3; the transcriber says {heard[0]['start']:.2f}) · last words not matched {missing or 'none'} · lines clipped by a cut {clipped or 'none'}")

    # 2 — loudness of the file itself
    i, tp = loud(FILM)
    c2 = abs(i + 14) <= 1 and tp <= -1.5
    ok &= c2
    print(f"CHECK 2 {'PASS' if c2 else 'FAIL'}: integrated {i:.1f} LUFS (bar -14 ±1) · true peak {tp:.1f} dBTP (bar ≤ -1.5)")

    # 3 — black and frozen stretches
    black = sh(["ffmpeg", "-hide_banner", "-nostats", "-i", str(FILM), "-vf", "blackdetect=d=0.1:pix_th=0.1", "-an", "-f", "null", "-"])
    frozen = sh(["ffmpeg", "-hide_banner", "-nostats", "-i", str(FILM), "-vf", "freezedetect=n=-90dB:d=1.0", "-an", "-f", "null", "-"])
    b = re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", black)
    fs = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", frozen)]
    fd = [float(x) for x in re.findall(r"freeze_duration: ([\d.]+)", frozen)]

    def shot_at(t):
        return [s["n"] for s in cuts["shots"] if s["start_s"] <= t + 1e-6][-1]

    cards = {s["n"] for s in cuts["shots"] if "out/v3/" in s["pieces"][0]["take"]}
    hold = [(round(p_start, 2), round(p_start + p["length_s"], 2)) for s in cuts["shots"] for p_start, p in
            zip([s["start_s"] + sum(q["length_s"] for q in s["pieces"][:i]) for i in range(len(s["pieces"]))], s["pieces"]) if p["speed"] == 0.0]
    planned = [(a_, d_, shot_at(a_)) for a_, d_ in zip(fs, fd) if shot_at(a_) in cards]
    idle = [(a_, d_, shot_at(a_)) for a_, d_ in zip(fs, fd) if shot_at(a_) not in cards]
    print(f"CHECK 3: blackdetect (≥ 0.1 s) → {b or 'none'}")
    print(f"  freezedetect, exact duplicate frames ≥ 1 s: {len(fs)} stretches · planned (the cards, incl. the 8.2 hold {hold}): "
          + (", ".join(f"{a_:.1f}–{a_ + d_:.1f} s (shot {n}, {d_:.1f} s)" for a_, d_, n in planned) or "none"))
    print("  · the app idle in the recorded take (cursor parked, nothing on screen changes): "
          + (", ".join(f"{a_:.1f}–{a_ + d_:.1f} s (shot {n}, {d_:.1f} s)" for a_, d_, n in idle) or "none")
          + f" · longest {max(fd):.1f} s at {fs[fd.index(max(fd))]:.1f} s")

    # 4 — captions
    vtt = (OUT / "demo-2min.en.vtt").read_text().split("\n\n")[1:]
    cues = []
    for block in vtt:
        if not block.strip():
            continue
        t, *rows = block.strip().split("\n")
        a, b2 = re.findall(r"(\d+):(\d+):(\d+)\.(\d+)", t)
        sec = lambda g: int(g[0]) * 3600 + int(g[1]) * 60 + int(g[2]) + int(g[3]) / 1000  # noqa: E731
        cues.append((sec(a), sec(b2), rows))
    flat = [w for _, _, rows in cues for w in " ".join(rows).split()]
    same = flat == script
    shape = all(len(rows) <= 2 and all(len(r) <= 42 for r in rows) for _, _, rows in cues)
    # the voice's own sound is the truth: every cue starts within 0.3 s of a voice onset and ends within 0.3 s of a voice offset
    # (read from the final file's own audio, not from the transcriber)
    on, off = edges(samples, sr)
    worst, worst_at = 0.0, None
    for a, b2, rows in cues:
        d = max(min(abs(a - e) for e in on), min(abs(b2 - e) for e in off))
        if d > worst:
            worst, worst_at = d, (round(a, 2), " ".join(rows)[:40])
    c4 = same and shape and worst <= 0.3
    ok &= c4
    print(f"CHECK 4 {'PASS' if c4 else 'FAIL'}: {len(cues)} cues · words = the script's words {same} · ≤ 2 lines of ≤ 42 chars {shape} · "
          f"worst cue start/end vs the voice's own first/last sound {worst:.2f} s at {worst_at} (bar 0.3)")

    # 6 — labels and speeds
    bad = []
    for s in cuts["shots"]:
        for p in s["pieces"]:
            if p["speed"] > 4 or (p["speed"] > 1.05 and not (p["label"] and f"{p['speed']:.1f}×" in p["label"])):
                bad.append((s["n"], p["speed"], p["label"]))
    c6 = not bad
    ok &= c6
    sped = [(s["n"], p["speed"], p["label"]) for s in cuts["shots"] for p in s["pieces"] if p["speed"] > 1.05]
    print(f"CHECK 6 {'PASS' if c6 else 'FAIL'}: every speed-up labelled with its factor and ≤ 4×: {sped} · mismatches {bad or 'none'}")

    # 7 — the film's specs
    print("CHECK 7 (film):", probe(FILM, "stream=codec_name,width,height,r_frame_rate,pix_fmt", "v:0"), "|", probe(FILM, "stream=codec_name,sample_rate,channels", "a:0"),
          "|", probe(FILM, "format=duration,size"))
    print("ALL FILM CHECKS", "PASS" if ok else "FAIL")


def streams(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,duration",
                          "-of", "json", str(path)], capture_output=True, text=True).stdout
    return json.loads(out)["streams"]


def psnr(a, b):
    err = sh(["ffmpeg", "-hide_banner", "-i", str(a), "-i", str(b), "-lavfi", "psnr", "-f", "null", "-"])
    return float(re.findall(r"average:([\d.]+|inf)", err)[-1])


def file_checks():
    ok = True

    def line(name, cond, text):
        nonlocal ok
        ok &= bool(cond)
        print(f"CHECK 7 {name}: {'PASS' if cond else 'FAIL'} — {text}")

    mb = lambda p: p.stat().st_size / 1e6  # noqa: E731
    v = streams(OUT / "demo-2min.mp4")
    line("demo-2min.mp4", v[0]["width"] == 1920 and v[0]["height"] == 1080 and v[0]["r_frame_rate"] == "30/1" and v[0]["codec_name"] == "h264"
         and v[1]["codec_name"] == "aac", f"{mb(OUT / 'demo-2min.mp4'):.1f} MB · {v[0]['codec_name']} {v[0]['width']}×{v[0]['height']} {v[0]['r_frame_rate']} fps · "
         f"{v[1]['codec_name']} · {probe(OUT / 'demo-2min.mp4', 'stream=sample_rate', 'a:0')}")
    th = streams(OUT / "youtube-thumbnail.jpg")[0]
    line("youtube-thumbnail.jpg", th["width"] == 1280 and th["height"] == 720 and mb(OUT / "youtube-thumbnail.jpg") < 2,
         f"{th['width']}×{th['height']} {th['codec_name']} · {mb(OUT / 'youtube-thumbnail.jpg') * 1000:.0f} KB (bar < 2 MB)")
    for name, codec in (("hero-loop.webm", "vp9"), ("hero-loop.mp4", "h264")):
        s = streams(OUT / name)
        d = float(probe(OUT / name, "format=duration").split("=")[1])
        line(name, len(s) == 1 and s[0]["codec_name"] == codec and 8 <= d <= 12 and mb(OUT / name) <= 2 and s[0]["width"] >= 1440,
             f"{s[0]['codec_name']} {s[0]['width']}×{s[0]['height']} · {d:.2f} s (bar 8–12) · {mb(OUT / name) * 1000:.0f} KB (bar ≤ 2000) · "
             f"streams: {[x['codec_type'] for x in s]} (no audio)")
    hp, dp = streams(OUT / "hero-poster.webp")[0], streams(OUT / "demo-poster.webp")[0]
    hv = streams(OUT / "hero-loop.mp4")[0]
    line("hero-poster.webp", (hp["width"], hp["height"]) == (hv["width"], hv["height"]) and mb(OUT / "hero-poster.webp") < 0.2,
         f"{hp['width']}×{hp['height']} (the loop's {hv['width']}×{hv['height']}) · {mb(OUT / 'hero-poster.webp') * 1000:.0f} KB (bar < 200)")
    line("demo-poster.webp", (dp["width"], dp["height"]) == (1920, 1080) and mb(OUT / "demo-poster.webp") < 0.3,
         f"{dp['width']}×{dp['height']} · {mb(OUT / 'demo-poster.webp') * 1000:.0f} KB (bar < 300)")
    # the loop's seam: the last frame against the first, next to two ordinary neighbouring frames
    d = float(probe(OUT / "hero-loop.mp4", "format=duration").split("=")[1])
    frames = {}
    for k, tt in (("first", 0.0), ("last", d - 1 / 30 - 0.0005), ("a", 5.0), ("b", 5.0 + 1 / 30)):
        frames[k] = WORK / f"seam-{k}.png"
        sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{tt:.4f}", "-i", str(OUT / "hero-loop.mp4"), "-frames:v", "1", str(frames[k])])
    seam, plain = psnr(frames["last"], frames["first"]), psnr(frames["a"], frames["b"])
    first_vs_poster = psnr(frames["first"], OUT / "hero-poster.webp")
    line("hero loop seam", seam >= 30, f"last frame → first frame PSNR {seam:.1f} dB (two ordinary neighbours inside the loop: {plain:.1f} dB; ≥ 30 dB is no visible jump); "
         f"the poster matches the first frame at {first_vs_poster:.1f} dB")
    j = json.loads((OUT / "hero-loop.json").read_text())
    line("hero-loop.json", set(j) == {"take", "in", "out", "speed", "what"} and (ROOT / j["take"]).exists() and j["speed"] <= 4,
         json.dumps(j, ensure_ascii=False))
    desc = (OUT / "youtube-description.txt").read_text()
    ch = [(int(m), int(s_)) for m, s_ in re.findall(r"^(\d+):(\d\d) ", desc, re.M)]
    secs = [m * 60 + s_ for m, s_ in ch]
    film = float(probe(FILM, "format=duration").split("=")[1])
    spans = [b - a for a, b in zip(secs, secs[1:] + [film])]
    first_para = desc.split("\n\n")[0]
    sentences = len(re.findall(r"[.!?](?:\s|$)", first_para))
    line("youtube-description.txt", secs[0] == 0 and len(secs) >= 3 and min(spans) >= 10 and 2 <= sentences <= 3
         and "https://tvashtr.fly.dev" in desc and "https://github.com/lazyxgenius/Tvashtr" in desc,
         f"{sentences} sentences · chapters {[f'{a // 60}:{a % 60:02d}' for a in secs]} (first 0:00, ≥ 3; spans {[round(x) for x in spans]} s, each ≥ 10) · both links present")
    cuts = json.loads((OUT / "demo-2min.cuts.json").read_text())
    line("demo-2min.cuts.json", len(cuts["shots"]) == 13 and all(p["take"] and "in" in p and "out" in p and "speed" in p for s in cuts["shots"] for p in s["pieces"]),
         f"{len(cuts['shots'])} shots, {sum(len(s['pieces']) for s in cuts['shots'])} pieces, each with take / in / out / speed / label")
    for name in ("demo-2min.en.vtt", "demo-2min.en.srt", "demo-2min-sheet.png"):
        s = streams(OUT / name)[0] if name.endswith(".png") else None
        line(name, (OUT / name).exists(), f"{(OUT / name).stat().st_size} bytes" + (f" · {s['width']}×{s['height']}" if s else ""))
    # 8 — the invariants' hashes
    before = dict(reversed(l.split("  ", 1)) for l in (OUT / "sha256-before.txt").read_text().splitlines())
    names = sorted(before)
    after = sh(["shasum", "-a", "256", *names]).splitlines()
    now = dict(reversed(l.split("  ", 1)) for l in after)
    same = [n for n in names if now.get(n) == before[n]]
    line("sha256 (check 8)", len(same) == len(names), f"{len(same)} of {len(names)} files byte-identical before and after (video/out/v3/lines/*.wav: "
         f"{sum(1 for n in names if n.endswith('.wav'))}, video/v3/script.json, video/v3/narration-timing.json)")
    print("ALL FILE CHECKS", "PASS" if ok else "FAIL")


if __name__ == "__main__":
    {"cuts": cuts_sheets, "film": film_checks, "files": file_checks}[sys.argv[1]]()
