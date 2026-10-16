"""The film's narrator (V3): VoxCPM2 on this Mac, every line cloned from the reference clip.

    PY=video/voice-venv/bin/python
    $PY video/v3/voice.py render            # one new render for every line that hasn't passed (≤ 3 a line)
    $PY video/v3/voice.py gate              # transcribe the new renders; pass, or leave for a re-render
    $PY video/v3/voice.py all               # render + gate, three rounds
    $PY video/v3/voice.py all --resume-minutes Seven   # also 4.2, its {resume_minutes} filled
    $PY video/v3/voice.py choose 3.1 2 --note "…"   # a flagged line's render for timing (stays flagged)
    $PY video/v3/voice.py sample            # video/out/v3/voice-sample.wav (0.1, 3.3, 4.1, 8.2)
    $PY video/v3/voice.py timing            # video/v3/narration-timing.json

Render and gate run as separate processes: VoxCPM2 runs in float32 on MPS (~9 GB) and the
transcriber never shares memory with it. State lives in video/v3/voice-manifest.json (settings,
every render with its seed, transcript and verdict); audio stays in video/out/v3/ (ignored).
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
V3 = ROOT / "video" / "v3"
OUT = ROOT / "video" / "out" / "v3"
LINES = OUT / "lines"
RENDERS = LINES / "renders"
SCRIPT = V3 / "script.json"
MANIFEST = V3 / "voice-manifest.json"
TIMING = V3 / "narration-timing.json"
REFERENCE = ROOT / "video" / "out" / "voice" / "reference.mp3"
REFERENCE_TXT = ROOT / "video" / "out" / "voice" / "reference.txt"
REFERENCE_SHA = "cd3db9f9af6be6dd5b0d1b451d7ef48640ce2c401a3eba9a9554a9f3cd6137df"

MAX_RENDERS = 3
PAD_S = 0.12  # leading/trailing silence kept around the speech
SETTINGS = {
    "model": "openbmb/VoxCPM2",
    "model_revision": "32279effe8c19989596f05d353d1447f51d9e915",
    "device": "mps",
    "dtype": "float32 (voxcpm picks it on MPS; bf16 drifts there)",
    "mode": "ultimate cloning: prompt_wav_path + prompt_text (the reference and its exact words), "
    "reference_wav_path = the same clip",
    "cfg_value": 2.0,
    "inference_timesteps": 10,
    "normalize": False,
    "denoise": False,
    "retry_badcase": True,  # voxcpm's own runaway guard inside one render (audio/text ratio)
    "retry_badcase_max_times": 3,
    "retry_badcase_ratio_threshold": 6.0,
    "seeds": [42, 43, 44],  # render n of a line uses seeds[n-1] (torch, numpy, random)
    "trim": "librosa.effects.trim top_db=40, then 120 ms of the render kept each side",
    "transcriber": "mlx-community/whisper-large-v3-turbo (language en, temperature 0, word timestamps)",
}
SAMPLE_SCENES = ["0.1", "3.3", "4.1", "8.2"]
NAME = "tvashtr"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def reference_text():
    lines = REFERENCE_TXT.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("Spoken text"))
    return next(line.strip() for line in lines[start + 1 :] if line.strip())


def script_lines(resume_minutes=None):
    out = []
    for line in json.loads(SCRIPT.read_text(encoding="utf-8"))["lines"]:
        text = line["narration"]
        if "{resume_minutes}" in text:
            if not resume_minutes:
                continue
            text = text.replace("{resume_minutes}", resume_minutes)
        out.append({**line, "text": text})
    return out


def load_manifest():
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {"settings": SETTINGS, "reference": {}, "lines": {}}


def save_manifest(manifest):
    MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def line_entry(manifest, line):
    entry = manifest["lines"].setdefault(line["scene"], {"renders": []})
    if entry.get("text") != line["text"]:  # a changed text (4.2 filled) starts the line over
        entry.clear()
        entry.update({"text": line["text"], "renders": []})
    entry.update({"chapter": line["chapter"], "text": line["text"]})
    return entry


def pending(manifest, lines):
    """Lines that need one more render: no pass yet, every render gated, fewer than three."""
    out = []
    for line in lines:
        entry = line_entry(manifest, line)
        renders = entry["renders"]
        if any(r.get("pass") for r in renders) or len(renders) >= MAX_RENDERS:
            continue
        if renders and "pass" not in renders[-1]:
            continue  # rendered, not gated yet
        out.append(line)
    return out


# ---- render (VoxCPM2) --------------------------------------------------------------------------


def trim(wav, sr):
    import librosa
    import numpy as np

    _, (start, end) = librosa.effects.trim(wav, top_db=40, frame_length=1024, hop_length=256)
    pad = int(PAD_S * sr)
    lead = wav[max(0, start - pad) : start]
    tail = wav[end : end + pad]
    lead = np.concatenate([np.zeros(pad - len(lead), dtype=wav.dtype), lead])
    tail = np.concatenate([tail, np.zeros(pad - len(tail), dtype=wav.dtype)])
    return np.concatenate([lead, wav[start:end], tail])


def cmd_render(args):
    import random

    import numpy as np
    import soundfile as sf
    import torch
    from voxcpm import VoxCPM

    assert sha256(REFERENCE) == REFERENCE_SHA, "reference.mp3 is not the operator's clip"
    manifest = load_manifest()
    lines = [line for line in pending(manifest, script_lines(args.resume_minutes))]
    if args.only:
        lines = [line for line in lines if line["scene"] in args.only]
    if not lines:
        print("RENDER: nothing pending")
        save_manifest(manifest)
        return
    prompt_text = reference_text()
    manifest["reference"] = {"file": str(REFERENCE.relative_to(ROOT)), "sha256": REFERENCE_SHA,
                             "text": prompt_text}
    import voxcpm
    from huggingface_hub import snapshot_download

    weights = snapshot_download(SETTINGS["model"], revision=SETTINGS["model_revision"])
    model = VoxCPM.from_pretrained(weights, load_denoiser=False, optimize=False,
                                   device=SETTINGS["device"])
    sr = model.tts_model.sample_rate
    manifest["settings"] = {**SETTINGS, "voxcpm": getattr(voxcpm, "__version__", None)
                            or _dist_version("voxcpm"), "torch": torch.__version__,
                            "sample_rate": sr}
    RENDERS.mkdir(parents=True, exist_ok=True)
    for line in lines:
        entry = line_entry(manifest, line)
        n = len(entry["renders"]) + 1
        seed = SETTINGS["seeds"][n - 1]
        torch.manual_seed(seed)
        np.random.seed(seed)
        random.seed(seed)
        wav = model.generate(
            text=line["text"],
            prompt_wav_path=str(REFERENCE),
            prompt_text=prompt_text,
            reference_wav_path=str(REFERENCE),
            cfg_value=SETTINGS["cfg_value"],
            inference_timesteps=SETTINGS["inference_timesteps"],
            normalize=SETTINGS["normalize"],
            denoise=SETTINGS["denoise"],
            retry_badcase=SETTINGS["retry_badcase"],
            retry_badcase_max_times=SETTINGS["retry_badcase_max_times"],
            retry_badcase_ratio_threshold=SETTINGS["retry_badcase_ratio_threshold"],
        )
        raw = len(wav) / sr
        wav = trim(wav, sr)
        path = RENDERS / f"{line['scene']}-r{n}.wav"
        sf.write(path, wav, sr, subtype="PCM_24")
        entry["renders"].append({"n": n, "seed": seed, "file": str(path.relative_to(ROOT)),
                                 "sha256": sha256(path), "raw_s": round(raw, 3),
                                 "duration_s": round(len(wav) / sr, 3)})
        save_manifest(manifest)
        print(f"RENDERED {line['scene']} r{n} seed {seed} {len(wav) / sr:.2f}s", flush=True)


def _dist_version(name):
    from importlib.metadata import version

    return version(name)


# ---- gate (transcript) ---------------------------------------------------------------------------


# Spellings of the same spoken words, applied to both sides (script and transcript) after the words
# are lowercased: a transcriber's choice of compound, symbol or brand spelling is not a misread.
SPELLINGS = [
    (r"\bcmd\b", "command"),
    (r"\btool kit\b", "toolkit"),
    (r"\bguard rails\b", "guardrails"),
    (r"\bteam mate\b", "teammate"),
    (r"\bback up\b", "backup"),
    (r"\bblind spots\b", "blindspots"),
    (r"\btask set\b", "taskset"),
    (r"\ba i\b", "ai"),
    (r"\b(groq|grock)\b", "grok"),
]


def norm(text):
    """Lowercase words for comparison: digits spelled out as the script spells them, no punctuation."""
    import inflect

    words = inflect.engine()
    text = text.lower().replace("’", "'").replace("'", "").replace("⌘", " command ")
    text = re.sub(r"\b(\d+)\s*/\s*(\d+)\b", r"\1 of \2", text)  # "3/4" said "three of four"
    text = re.sub(r"\d+", lambda m: words.number_to_words(m.group()), text)
    text = " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())
    for pattern, same in SPELLINGS:
        text = re.sub(pattern, same, text)
    return text


def gate(expected, heard):
    """Pass when the transcript equals the line; only the name may sound different (1–2 words)."""
    pattern = []
    for token in norm(expected).split():
        pattern.append(r"(\S+(?: \S+)?)" if token.startswith(NAME) else re.escape(token))
    match = re.fullmatch(" ".join(pattern), norm(heard))
    if not match:
        return False, []
    return True, list(match.groups())


def transcribe(path):
    import librosa
    import mlx_whisper

    audio, _ = librosa.load(path, sr=16000, mono=True)
    result = mlx_whisper.transcribe(
        audio, path_or_hf_repo="mlx-community/whisper-large-v3-turbo", language="en",
        temperature=0.0, word_timestamps=True, condition_on_previous_text=False,
    )
    words = [{"word": w["word"].strip(), "start": round(w["start"], 3), "end": round(w["end"], 3)}
             for seg in result["segments"] for w in seg.get("words", [])]
    return result["text"].strip(), words


def cmd_gate(args):
    import shutil

    manifest = load_manifest()
    for scene, entry in manifest["lines"].items():
        for render in entry["renders"]:
            if "pass" in render:
                continue
            path = ROOT / render["file"]
            text, words = transcribe(path)
            ok, heard_name = gate(entry["text"], text)
            render.update({"transcript": text, "words": words, "pass": ok, "name_heard": heard_name})
            if ok:
                final = LINES / f"{scene}.wav"
                shutil.copyfile(path, final)
                entry.update({"file": str(final.relative_to(ROOT)), "sha256": sha256(final),
                              "render": render["n"]})
            save_manifest(manifest)
            print(f"GATE {scene} r{render['n']} {'PASS' if ok else 'FAIL'} name={heard_name} | {text}",
                  flush=True)


def cmd_choose(args):
    """A flagged line (three renders, none past the gate): the render the timing and the
    listen-through use until the operator judges it by ear. The line stays flagged."""
    import shutil

    manifest = load_manifest()
    entry = manifest["lines"][args.scene]
    if any(r.get("pass") for r in entry["renders"]) or len(entry["renders"]) < MAX_RENDERS:
        raise SystemExit(f"{args.scene} is not flagged")
    render = entry["renders"][args.render - 1]
    final = LINES / f"{args.scene}.wav"
    shutil.copyfile(ROOT / render["file"], final)
    entry.update({"file": str(final.relative_to(ROOT)), "sha256": sha256(final), "render": render["n"],
                  "flagged": True, "note": args.note})
    save_manifest(manifest)
    print(f"CHOSEN {args.scene} r{render['n']} (flagged) — {args.note}")


def summary(manifest, lines):
    passed = [s for s, e in manifest["lines"].items() if any(r.get("pass") for r in e["renders"])]
    flagged = [s for s, e in manifest["lines"].items()
               if len(e["renders"]) >= MAX_RENDERS and not any(r.get("pass") for r in e["renders"])]
    renders = sum(len(e["renders"]) for e in manifest["lines"].values())
    names = sorted({" ".join(r["name_heard"]) for e in manifest["lines"].values()
                    for r in e["renders"] if r.get("pass") and r.get("name_heard")})
    print(f"LINES: {len(passed)}/{len(lines)} rendered, renders {renders}, gate passes {len(passed)}, "
          f"name heard as {names or '—'}, flagged {flagged or 'none'}")


def cmd_all(args):
    me = [sys.executable, __file__]
    extra = ["--resume-minutes", args.resume_minutes] if args.resume_minutes else []
    only = ["--only", *args.only] if args.only else []
    for _ in range(MAX_RENDERS):
        subprocess.run([*me, "render", *extra, *only], check=True)
        subprocess.run([*me, "gate"], check=True)
    manifest = load_manifest()
    summary(manifest, script_lines(args.resume_minutes))


# ---- sample and timing ---------------------------------------------------------------------------


def cmd_sample(args):
    import numpy as np
    import soundfile as sf

    manifest = load_manifest()
    parts, sr = [], None
    for scene in SAMPLE_SCENES:
        wav, sr = sf.read(ROOT / manifest["lines"][scene]["file"])
        parts += [wav, np.zeros(int(0.8 * sr))]
    path = OUT / "voice-sample.wav"
    sf.write(path, np.concatenate(parts[:-1]), sr, subtype="PCM_24")
    print(f"VOICE_SAMPLE: {path.relative_to(ROOT)} {len(np.concatenate(parts[:-1])) / sr:.1f}s")


def cmd_timing(args):
    import librosa
    import soundfile as sf

    manifest = load_manifest()
    rows, nmap = [], []
    for line in json.loads(SCRIPT.read_text(encoding="utf-8"))["lines"]:
        entry = manifest["lines"].get(line["scene"])
        final = entry and next((r for r in entry["renders"] if r.get("pass") or r["n"] == entry.get("render")), None)
        if not final:
            rows.append({"scene": line["scene"], "text": line["narration"], "file": None,
                         "pending": "{resume_minutes}" if "{resume_minutes}" in line["narration"]
                         else "no render passed the gate"})
            continue
        path = ROOT / entry["file"]
        info = sf.info(path)
        words = final["words"]
        wav, sr = sf.read(path)
        _, (on, off) = librosa.effects.trim(wav, top_db=40, frame_length=1024, hop_length=256)
        onset, offset = round(on / sr, 3), round(off / sr, 3)
        rows.append({
            "scene": line["scene"], "chapter": line["chapter"], "text": entry["text"],
            "file": entry["file"], "sha256": sha256(path), "duration_s": round(info.duration, 3),
            "speech_start_s": words[0]["start"], "speech_end_s": words[-1]["end"],
            "onset_s": onset, "offset_s": offset,
            "render": final["n"], "seed": final["seed"], "name_heard": final["name_heard"],
            "gate": "pass" if final.get("pass") else f"flagged: {entry.get('note', '')}",
            "words": words,
        })
        nmap.append({"id": line["scene"], "beat": f"scene {line['scene']}", "text": entry["text"],
                     "file": entry["file"], "startSec": min(words[0]["start"], onset),
                     "endSec": max(words[-1]["end"], offset)})
    TIMING.write_text(json.dumps({
        "about": "Per-line narration timing (V3). Times are seconds into each line's own file; "
                 "speech start/end are the first word's start and the last word's end (Whisper word "
                 "timestamps — Whisper snaps a line's first word to 0.0), onset/offset the file's "
                 "−40 dB speech edges (each file keeps 120 ms of its render around them). "
                 "narrationMap: Product Demo Director's supplied-narration map, one thought per line, "
                 "startSec/endSec the wider of the two ranges — V4 adds each line's placement in the "
                 "master to them (and sets shotN) when it lays the lines on the picture.",
        "voice": manifest["settings"], "reference": manifest["reference"],
        "lines": rows, "narrationMap": nmap,
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    done = sum(1 for r in rows if r["file"])
    print(f"TIMING: {TIMING.relative_to(ROOT)} {done} lines"
          + (f" (pending: {[r['scene'] for r in rows if not r['file']]})" if done < len(rows) else ""))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("cmd", choices=["render", "gate", "all", "choose", "sample", "timing"])
    parser.add_argument("scene", nargs="?")
    parser.add_argument("render", nargs="?", type=int)
    parser.add_argument("--note", default="")
    parser.add_argument("--resume-minutes")
    parser.add_argument("--only", nargs="*")
    args = parser.parse_args()
    {"render": cmd_render, "gate": cmd_gate, "all": cmd_all, "choose": cmd_choose, "sample": cmd_sample,
     "timing": cmd_timing}[args.cmd](args)


if __name__ == "__main__":
    main()
