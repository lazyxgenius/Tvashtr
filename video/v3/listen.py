"""V3's listen-through (brief video-v3 D6): chapter 3 with its narration laid on its takes.

    . video/env.sh && video/voice-venv/bin/python video/v3/listen.py   # → video/out/v3/ch3-narrated.mp4

Chapter 3 = 3.1 up to Launch, 3.2, 3.3, 3.4, 3.4-verdict, 3.6, 3.7 (V3's re-shoots; 3.1 and 3.7's
Memory beat are V2b's takes). Each line starts 0.4 s into its scene; a scene lasts its line + 1.5 s. A
take longer than that is sped up where the script badges "sped up" (the badge drawn in the corner),
else trimmed to its last line + 1.5 s before its end point (the payoff lands with the line's last
words); a shorter take holds its last frame. 1920×1080, 30 fps, no music, narration at −16 LUFS
(two-pass loudnorm, dynamic).
3.7 is three beats (Changes · the Ask · Memory), cut at the line's sentence ends.
"""

import json
import re
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
TAKES = ROOT / "video" / "takes"
OUT = ROOT / "video" / "out" / "v3"
SCRIPT = ROOT / "video" / "v3" / "script.json"
TIMING = ROOT / "video" / "v3" / "narration-timing.json"
LEAD, TAIL = 0.4, 1.5
FPS, W, H = 30, 1920, 1080
BADGE_FONT = "/System/Library/Fonts/Helvetica.ttc"


def take(version, name):
    t = TAKES / version / name
    j = json.loads((t / "take.json").read_text())
    if j["status"] != "ok":
        raise SystemExit(f"{version}/{name} is {j['status']}: {j.get('error')}")
    return t / "take.mp4", j


def at(j, label, kind=None, last=False, default=None):
    """Seconds into the take of a step (by label) or a shot (by name)."""
    hits = [s["t"] for s in j["steps"] if s.get("label") == label and (not kind or s.get("kind") == kind)]
    hits += [s["t"] for s in j["shots"] if s.get("name") == label]  # take.json times are seconds
    if not hits:
        if default is not None:
            return default
        raise SystemExit(f"{j['take']}: no step or shot {label!r}")
    return hits[-1] if last else hits[0]


def frames(seconds):
    """Seconds rounded to whole frames, so every piece and the narration clock stay frame-exact."""
    return round(seconds * FPS) / FPS


def sources(scene):
    """[(take.mp4, window start, window end)] for a scene — one, or 3.7's three beats."""
    if scene == "3.1":
        mp4, j = take("v2b", "3.1")
        return [(mp4, 0.0, at(j, "Launch", "click") + 1.0)]
    if scene == "3.7":
        mem, m = take("v2b", "3.7")
        ask, a = take("v3", "3.7-ask")
        if any("GROK_CAP" in n for n in a["notes"]):  # brief D3: a capped Ask keeps V2b's 3.7 Ask
            ask, a = mem, m
        send = at(a, "Send", "click")
        return [
            (ask, at(a, "Changes", "click") - 0.3, at(a, "cost per round", default=send)),
            (ask, send - 0.5, at(a, "ask") + 0.5),
            (mem, at(m, "Memory", "click") - 0.5, m["duration_s"]),
        ]
    mp4, j = take("v3", scene)
    return [(mp4, 0.0, j["duration_s"])]


def sentence_ends(words):
    """Line times at which each sentence's last word ends (3.7's beat cuts)."""
    return [w["end"] for w in words if re.search(r"[.!?]$", w["word"])]


def integrated_lufs(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", out)[-1])


def run(cmd):
    subprocess.run(cmd, check=True, capture_output=True)


def segment(src, a, b, length, sped, out):
    """One piece of picture, exactly `length` s: sped up to fit, or end-trimmed, or held."""
    span = b - a
    fit = f"scale=1728:{H},pad={W}:{H}:(ow-iw)/2:0:color=0xF7F4EE,fps={FPS}"  # 2880×1800 (16:10) in 16:9
    if sped and span > length:
        vf = f"setpts=PTS/{span / length:.6f},{fit},drawtext=fontfile={BADGE_FONT}:text='sped up':fontsize=30:" \
             "fontcolor=0x2B2622:box=1:boxcolor=0xF7F4EE@0.92:boxborderw=12:x=w-tw-56:y=44"
        start = a
    else:
        start = max(a, b - length)  # end-aligned: the window's payoff with the line's last words
        vf = f"{fit},tpad=stop_mode=clone:stop_duration={length}"
    run(["ffmpeg", "-y", "-ss", f"{start:.3f}", "-to", f"{b:.3f}", "-i", str(src), "-vf", vf, "-frames:v", str(round(length * FPS)),
         "-an", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", str(FPS), str(out)])
    return {"take": str(src.relative_to(ROOT)), "from_s": round(start, 2), "to_s": round(b, 2),
            "length_s": round(length, 3), "sped_up": bool(sped and span > length),
            "speed": round(span / length, 2) if sped and span > length else None,
            "held_s": round(max(0.0, length - (b - start)), 2)}


def main():
    script = {l["scene"]: l for l in json.loads(SCRIPT.read_text())["lines"]}
    timing = {r["scene"]: r for r in json.loads(TIMING.read_text())["lines"]}
    scenes = ["3.1", "3.2", "3.3", "3.4", "3.4-verdict", "3.6", "3.7"]
    work = OUT / "ch3"
    work.mkdir(parents=True, exist_ok=True)
    parts, plan, voice, sr, clock = [], [], [], None, 0.0
    for scene in scenes:
        line = timing[scene]
        wav, sr = sf.read(ROOT / line["file"])
        dur = len(wav) / sr
        length = frames(dur + TAIL)  # the line starts LEAD in and ends ≥ TAIL − LEAD before the cut
        sped = script[scene].get("badge") == "sped up"
        srcs = sources(scene)
        if len(srcs) == 1:
            cuts = [length]
        else:  # beats cut just after each sentence ends (scene time), the last takes the rest
            ends = [frames(LEAD + e + 0.15) for e in sentence_ends(line["words"])][: len(srcs) - 1]
            if len(ends) != len(srcs) - 1:
                raise SystemExit(f"{scene}: {len(srcs)} beats but {len(ends)} sentence ends in its words")
            cuts = [b - a for a, b in zip([0.0, *ends], [*ends, length])]
        info = []
        for i, ((src, a, b), n) in enumerate(zip(srcs, cuts)):
            out = work / f"{scene}-{i}.mp4"
            info.append(segment(src, a, b, n, sped, out))
            parts.append(out)
        voice.append((clock + LEAD, wav))
        plan.append({"scene": scene, "start_s": round(clock, 3), "length_s": round(length, 3),
                     "line": line["file"], "line_s": round(dur, 3), "pieces": info})
        clock += length
    # Narration: each line LEAD into its scene, then −16 LUFS (two-pass loudnorm; dynamic, since a
    # linear gain from the lines' ~−25 LUFS would pass the −1.5 dBTP ceiling and stop short).
    track = np.zeros(int(round(clock * sr)))
    for start, wav in voice:
        i = int(round(start * sr))
        track[i : i + len(wav)] += wav
    raw = work / "narration.wav"
    sf.write(raw, track, sr, subtype="PCM_24")
    measured = subprocess.run(["ffmpeg", "-i", str(raw), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
                               "-f", "null", "-"], capture_output=True, text=True).stderr
    m = json.loads(measured[measured.rindex("{"):measured.rindex("}") + 1])
    norm = work / "narration-16.wav"
    run(["ffmpeg", "-y", "-i", str(raw), "-af",
         f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
         f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=false",
         "-ar", str(sr), str(norm)])
    # loudnorm stops short of the target under its true-peak ceiling (−16.5 here): close the rest with
    # a plain gain (a few tenths of a dB, so the peaks stay under −1 dBTP).
    short = -16 - integrated_lufs(norm)
    if abs(short) > 0.05:
        trimmed = work / "narration-16-trim.wav"
        run(["ffmpeg", "-y", "-i", str(norm), "-af", f"volume={short:.2f}dB", "-ar", str(sr), "-c:a", "pcm_s24le", str(trimmed)])
        norm = trimmed
    (work / "list.txt").write_text("".join(f"file '{p.name}'\n" for p in parts))
    film = OUT / "ch3-narrated.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(work / "list.txt"), "-i", str(norm),
         "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
         "-movflags", "+faststart", str(film)])
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(film)],
                           capture_output=True, text=True).stdout.strip()
    integrated = f"{integrated_lufs(film):.1f}"
    (work / "plan.json").write_text(json.dumps({"film": str(film.relative_to(ROOT)), "duration_s": float(probe),
                                                "lufs": float(integrated), "scenes": plan}, indent=1) + "\n")
    print(f"CH3_NARRATED: {film.relative_to(ROOT)} {float(probe):.1f}s {integrated} LUFS")


if __name__ == "__main__":
    main()
