"""Demo D1: everything around the film (brief film-demo §2): the thumbnail, both posters, the hero loop with its
poster and hero-loop.json, and the YouTube description.

    . video/env.sh && export PLAYWRIGHT_MODULE=$PWD/video/node_modules/playwright/index.mjs
    video/voice-venv/bin/python video/demo/assets.py          # → video/out/demo/

The hero loop is a real run changing state (3.4-verdict: the Reviewer finishes, the guardrails pass), cropped to the
Now bar and the canvas, at 1x; the last 0.6 s cross-fades into the first, so it loops with no jump.
"""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "video" / "out" / "demo"
WORK = OUT / "work"
TAKES = ROOT / "video" / "takes"

HERO = {"take": "v3/3.4-verdict", "in": 20.3, "loop": 9.0, "fade": 0.6, "crop": "2880:744:0:380", "size": "1920:496"}
THUMB = {"take": "v3/3.6", "at": 18.8, "crop": "2880:730:0:390"}  # the Shipped band and the team's graph
POSTER = {"take": "v3/3.6", "at": 18.8}
WIN = {"x": 160, "y": 14, "w": 1600, "h": 1000}  # the film's window on the 1920×1080 canvas (build.py)
SITE, REPO = "https://tvashtr.fly.dev", "https://github.com/lazyxgenius/Tvashtr"


def run(cmd):
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{' '.join(map(str, cmd[:3]))} … failed:\n{r.stderr[-1200:]}")


def webp(src, dst, quality):
    run(["ffmpeg", "-y", "-v", "error", "-i", src, "-frames:v", "1", "-c:v", "libwebp", "-quality", quality, "-compression_level", "6", dst])


def thumbnail():
    crop = WORK / "thumb-crop.png"
    run(["ffmpeg", "-y", "-v", "error", "-ss", THUMB["at"], "-i", TAKES / THUMB["take"] / "take.mp4", "-frames:v", "1",
         "-vf", f"crop={THUMB['crop']}", crop])
    page = WORK / "thumb.html"
    page.write_text((ROOT / "video/demo/thumb.html").read_text().replace('|| "crop.png"', f'|| "{crop.as_uri()}"'))
    run(["node", ROOT / "video/demo/shot.mjs", page, OUT / "youtube-thumbnail.jpg", 1280, 720])
    print("THUMBNAIL:", (OUT / "youtube-thumbnail.jpg").stat().st_size // 1024, "KB")


def poster():
    """The film's own framing of the Shipped frame, no badge and no words."""
    png = WORK / "demo-poster.png"
    run(["ffmpeg", "-y", "-v", "error", "-ss", POSTER["at"], "-i", TAKES / POSTER["take"] / "take.mp4", "-i", WORK / "frame.png",
         "-filter_complex", f"[0:v]scale={WIN['w']}:{WIN['h']}:flags=lanczos,pad=1920:1080:{WIN['x']}:{WIN['y']}:color=0xF7F4EE[p];"
                            "[p][1:v]overlay=0:0:format=auto[o]", "-map", "[o]", "-frames:v", "1", png])
    webp(png, OUT / "demo-poster.webp", 80)
    print("DEMO_POSTER:", (OUT / "demo-poster.webp").stat().st_size // 1024, "KB")


def hero():
    s, ln, f = HERO["in"], HERO["loop"], HERO["fade"]
    src = TAKES / HERO["take"] / "take.mp4"
    graph = (f"[0:v]crop={HERO['crop']},scale={HERO['size']}:flags=lanczos,fps=30,format=yuv420p,split=3[x][y][z];"
             f"[x]trim=start={s + f}:end={s + ln},setpts=PTS-STARTPTS[a];"
             f"[y]trim=start={s + ln}:end={s + ln + f},setpts=PTS-STARTPTS[t];"
             f"[z]trim=start={s}:end={s + f},setpts=PTS-STARTPTS[h];"
             f"[t][h]xfade=transition=fade:duration={f}:offset=0[b];[a][b]concat=n=2:v=1:a=0[v]")
    common = ["-i", src, "-filter_complex", graph, "-map", "[v]", "-an"]  # the trims are the take's own times
    run(["ffmpeg", "-y", "-v", "error", *common, "-c:v", "libx264", "-crf", 25, "-preset", "slow", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", OUT / "hero-loop.mp4"])
    run(["ffmpeg", "-y", "-v", "error", *common, "-c:v", "libvpx-vp9", "-crf", 36, "-b:v", 0, "-row-mt", 1, "-pix_fmt", "yuv420p",
         OUT / "hero-loop.webm"])
    webp(OUT / "hero-loop.mp4", OUT / "hero-poster.webp", 85)
    (OUT / "hero-loop.json").write_text(json.dumps({
        "take": f"video/takes/{HERO['take']}/take.mp4", "in": s, "out": round(s + ln + f, 2), "speed": 1,
        "what": "A real run's Reviewer finishes and approves, then the secret scan and the forbidden-paths check pass.",
    }, indent=1) + "\n")
    print("HERO:", {n: (OUT / n).stat().st_size // 1024 for n in ("hero-loop.mp4", "hero-loop.webm", "hero-poster.webp")}, "KB")


def description():
    cuts = json.loads((OUT / "demo-2min.cuts.json").read_text())
    start = {s["n"]: s["start_s"] for s in cuts["shots"]}
    chapters = [(0, "A real pull request"), (start[3], "Build the team"), (start[6], "Give it a task and watch a real run"),
                (start[11], "Change an agent and compare the results")]
    stamp = lambda t: f"{int(t // 60)}:{int(t % 60):02d}"  # noqa: E731
    text = (
        "Tvashtr lets you design an AI team: a product manager, an engineer and a reviewer, each a blank box whose job is whatever you "
        "write in its instructions. You wire in the checks that keep a run on track, give the team a task on your own repo, and it "
        "plans, writes, tests and reviews the change on your Claude and Grok subscriptions, then opens a real pull request. "
        "Run it on your desktop, or on the web.\n\n"
        + "\n".join(f"{stamp(t)} {title}" for t, title in chapters)
        + f"\n\nTry it: {SITE}\nSource: {REPO}\n"
    )
    (OUT / "youtube-description.txt").write_text(text)
    print("DESCRIPTION:", [(stamp(t), title) for t, title in chapters])


if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    thumbnail()
    poster()
    hero()
    description()
