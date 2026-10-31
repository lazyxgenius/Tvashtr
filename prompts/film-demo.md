# Brief — Film D1: "Tvashtr in 2 minutes" + the landing page's video files

Architect: Tvashtr Sidechat-26, 2026-10-31. Path: `/Users/adimac/Desktop/Tvashtr/prompts/film-demo.md`.
Model: **Sonnet 5.5, effort high**, Claude desktop app Code tab, auto mode. The operator is on the
**Claude Pro plan**: keep the session lean (see §7).

## 1. Why

Tvashtr's landing page is being redesigned (next session, `prompts/landing-1.md`). It needs:
- a **~2-minute narrated demo** that plays on YouTube when a visitor clicks "Watch the demo" (Wistia's
  data: engagement holds to about 2 minutes, then falls), and
- a **silent ~10-second loop** of a real run for the top of the page, served from the site itself.

You make both from the film's **existing** footage and voice. Nothing new is recorded. The full
~7½-minute film (V4) is **not** this session.

## 2. What to deliver — all in `video/out/demo/` (ignored by git)

| File | Spec |
|---|---|
| `demo-2min.mp4` | 1920×1080, 30 fps, H.264 + AAC 48 kHz, **1:50–2:10**, -14 LUFS integrated (±1), true peak ≤ -1.5 dBTP |
| `demo-2min.en.vtt` + `demo-2min.en.srt` | captions = the script's exact words (§3), timed to the voice, ≤ 2 lines, ≤ 42 characters a line |
| `youtube-thumbnail.jpg` | 1280×720, < 2 MB, readable at phone size: one strong real frame + at most 5 words in the brand type |
| `youtube-description.txt` | 2–3 plain sentences on what Tvashtr is; chapters (first `0:00`, at least 3, each ≥ 10 s); the links `https://tvashtr.fly.dev` and `https://github.com/lazyxgenius/Tvashtr` |
| `hero-loop.webm` (VP9 or AV1) + `hero-loop.mp4` (H.264) | 8–12 s, **no audio track**, ≤ 2 MB each, ≥ 1440 px wide, loops with no visible jump (a short crossfade at the seam is fine) |
| `hero-poster.webp` | the loop's first frame, same size, < 200 KB |
| `hero-loop.json` | `{ "take": "<path>", "in": s, "out": s, "speed": n, "what": "<one plain sentence of what it shows>" }` — the page labels the loop from it |
| `demo-poster.webp` | 1920×1080, < 300 KB: the frame the page shows before the visitor clicks play (may match the thumbnail, without words) |
| `demo-2min.cuts.json` | every shot: take path, in, out, speed, label shown |
| `demo-2min-sheet.png` | contact sheet: one frame per second |

Plus, committed on branch `video/demo-2min` (from `main` `54d4d322`): the build script(s) and data in a
new folder `video/demo/`, and a short "Demo D1" section in `video/README.md` (what to run, what each
file is). Media never enters git.

## 3. The script — architect-written, final words. Reuse the rendered voice lines.

Lines 1–5 and 8–13 already exist as passed renders in `video/out/v3/lines/<id>.wav` (the film's
open-source narrator, VoxCPM2). **Use those files as they are.** Only lines 6 and 11 are new.

| # | Voice | Words (exact) | Picture | Label on screen |
|---|---|---|---|---|
| 1 | `0.1.wav` | This pull request adds a new indicator to a real trading repo. An AI team planned it, wrote it, tested it and reviewed it. You designed that team. | take 0.1 (the real PR page) | Real pull request |
| 2 | `0.2.wav` | This is Tvashtr. | card `video/out/v3/0.2.mp4` | — |
| 3 | `2.1.wav` | Now build the team. Start from a template. | take 2.1 | — |
| 4 | `2.2.wav` | Every agent is a blank box: its job is whatever you write in its instructions. | take 2.2 | — |
| 5 | `2.4.wav` | Then wire in the checks. You approve the spec. Tvashtr runs your tests, and a failure loops back to the engineer. The reviewer can send work back too. Guardrails scan for secrets and block edits to the servers folder. | take 2.4 (V2b) | Sped up (with the factor) |
| 6 | **NEW `d.task`** | Now give the team a task. Pick the repo, the branch, and the one folder it may touch. Launch. | take 3.1 (V2b), only up to Launch | — |
| 7 | `3.3.wav` | First, the product manager writes a spec, and the run waits for you. The spec is a real document. Fix a line, approve, and only then is any code written. | take 3.3 (V3) | Real run |
| 8 | `3.4.wav` | The engineer works on its own copy of your repo, on your Claude subscription. Then Tvashtr runs your tests itself. The first build fails, and the last twelve lines go straight back to the engineer. | take 3.4 (V3) | Real run · sped up |
| 9 | `3.4-verdict.wav` | Round two passes: six hundred and sixty-five tests. Only then does the reviewer, on Grok, check the change against the spec. It approves, citing Tvashtr's test result, not the engineer's word. | take 3.4-verdict (V3) | Real run · sped up |
| 10 | `3.6.wav` | A secret scan and a forbidden-paths check both pass. Tvashtr opens the pull request. Done in ten minutes, on your subscriptions. | take 3.6 (V3) | Real run |
| 11 | **NEW `d.compare`** | Change an agent, and the team keeps both versions. Then compare them on a real task, taking turns on your subscription. Version two did better: its reviewer passed one more test. | take 6.3 (V2b), the lanes and the results | Real run · waits cut |
| 12 | `8.1-web.wav` | On your desktop, or on the web. | take 8.1-web (V1) | — |
| 13 | `8.2.wav` | Tvashtr. Your team. Your rules. | card `video/out/v3/8.2.mp4` (hold ~2 s after the line) | — |

Why these: the hook (a real PR), what it is, the team is yours, the checks that keep a run on track,
one real run end to end, and proof that changing the team changes the result (compare). Line 3.1's
old render says "hole" for "Hull", so line 6 drops the indicator's name (it is on screen). Line 11 joins
approved words from 6.2 and 6.3 so "both versions" has a meaning without 6.2.

**Takes:** for each scene use the take `video/SCENES.md` marks as current (V3 over V2b over V1; the ones
`video/out/v3/ch3-narrated-v3.mp4` used for chapter 3). If a take named here is missing or unusable, stop
(§6). Trim, jump-cut or speed a take to fit its line; any speed-up shows its label with the factor
(e.g. "2× speed"); keep speed ≤ 4× and text on screen readable. Never show a number the footage does not
show.

**New lines (6 and 11):** render with the film's pipeline (`video/v3/voice.py`, its reference voice,
seeds 42/43/44, at most 12 renders a line) into **new** paths under `video/out/demo/lines/`. Gate: the
Whisper transcript matches the words (punctuation aside), every ending intact, loudness matched to the
old lines. Neither new line contains "Tvashtr", so no name check is needed. Never run the voice model
while Chrome or ffmpeg work is running.

## 4. Look and sound

- The film's look exactly: the take framed as V0/V3 frame it (cream `#F7F4EE` ground, rounded corners,
  soft shadow, coral `#d97757` ring), the film's badge style for labels, the 0.2/8.2 cards as built.
  The 8.2 card already shows `tvashtr.fly.dev · github.com/lazyxgenius/Tvashtr` and "Built by Aditya
  Sharma"; keep it.
- **No burned-in captions** (the page turns YouTube captions on; burned text would cover the UI).
- Sound: the voice, a soft cut sound only where the film uses one, and optionally a quiet music bed
  **generated in code** (no samples), ducked under the voice. If in doubt, no bed.
- Build with the film's toolchain (`video/README.md`: Product Demo Director / Remotion, or ffmpeg where
  that is simpler). Nothing from `~/Desktop/tvashtr-reel` or `~/.claude/skills/one-file-studio` (its
  licence is personal use; this goes on a public product site).

## 5. Hero loop (the top of the landing page)

Pick the 8–12 s that best show **a real run moving through the team**: agents visibly changing state
on the canvas or run view (3.2, 3.4, 3.6 or 2.4 are candidates). It must read at 1280 px wide and on a
phone, show nothing private, and loop cleanly. Speed ≤ 4×; record the factor in `hero-loop.json`.
Crop to the part that tells the story rather than the whole window if that reads better.

## 6. Checks (run them all yourself; echo each result)

1. Duration 1:50–2:10; first word by 1.3 s; every line's last word intact; no line clipped by a cut.
2. Loudness: `ffmpeg -af ebur128=peak=true` → integrated -14 ±1 LUFS, true peak ≤ -1.5 dBTP.
3. `blackdetect` and `freezedetect` → no black or frozen stretch you didn't plan (cards and holds listed).
4. Captions: every cue's words = the script's words; timing within 0.3 s of the voice.
5. Look at `demo-2min-sheet.png` (one frame a second) **and** the frames either side of every cut; open
   the thumbnail, both posters and five frames of the hero loop. Nothing private (emails, tokens, keys,
   personal paths) anywhere.
6. Every speed-up labelled; labels match `demo-2min.cuts.json`.
7. File specs in §2 (size, codecs, dimensions) — print `ffprobe` lines.
8. Invariants: the sha256 of every file in `video/out/v3/lines/`, `video/v3/script.json` and
   `video/v3/narration-timing.json` is unchanged (print before/after); `git diff --stat main..HEAD`
   shows changes only under `video/demo/`, `video/README.md` (and `video/v3/voice.py` only if §7's
   additive option was needed).

**Stop and write `NEEDS_HUMAN: <reason>` to `STATE.md`** if: a take named in §3 is missing or can't
carry its line honestly; a frame shows something private that a crop can't remove; a new line fails 12
renders; a step needs a paid service, a new recording, a write outside `video/`, or a push.

## 7. Working rules (Pro plan)

- One stop: **DEMO READY** — post the paths of every file in §2, the QA numbers, the cuts table and the
  contact sheet, then wait. The operator and the architect watch it; notes come back as one list and you
  make `cut-02` (keep cut-01's files).
- Lean: look at contact sheets, not every frame; don't re-read big files you've already read; no
  subagents; no workflows. Update `STATE.md` after each step so a usage-limit pause loses nothing.
- `caffeinate -dimsu` while rendering. Time box: 4 hours of work, not counting the wait at the stop.
- No git push, no remote, no deploy; commit only your own paths on `video/demo-2min`; never print a key.
- If `video/v3/voice.py` needs a change to render lines from another script file, make it additive (a new
  option; every existing call behaves exactly as before) and list it under DEVIATIONS.
