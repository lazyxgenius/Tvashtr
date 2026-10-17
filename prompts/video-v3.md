# Brief — Video V3: the narrator's voice, the re-shoots on 0.27.0, the title and end cards

Architect: Tvashtr Sidechat-24, 2026-10-16. Path: `/Users/adimac/Desktop/Tvashtr/prompts/video-v3.md`.
`prompts/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md`, `design/` belong to the architect: never stage
or commit them. Where this brief and `prompts/CLI-RULES.md` differ, this brief wins. Also read
`prompts/video-v3-script.md` (the approved narration — final text), `video/SCENES.md` and
`video/README.md` (V1/V2/V2b status, the camera, the MAC scripts), `prompts/m-desk-8-v2b2.md` Part B
(K8/K9) and `video/vendor/product-demo-director/SKILL.md` + `docs/PRODUCTION_CONTRACT.md` ("Global
narration", the supplied-master path).

## Where things are (checked by the architect on disk, 2026-10-16)

- `main` = `origin/main` = **`6b35addc`** = production (Fly v46, Desktop `desktop-v0.27.0`, alembic
  `0053`). It holds M-desk-8 (P1–P6) and both V2b sittings. Push guard ON
  (`DISABLED-no-push-during-video-work`).
- Every scene has a take (`video/takes/v2b/…`, V1's in `video/takes/v1/…`); the hero run's recording
  is `video/recordings/hero` (run `b98f6fcc`, PR #57, Reviewer on Grok). The chapter-6 film team has
  the Reviewer on `anthropic/claude-opus-5-5`; chapter 2's team (with the Query domain step) was built
  last and holds the plain name.
- The narrator's voice: `video/out/voice/reference.mp3` (14.1 s, 48 kHz mono, sha256
  `cd3db9f9af6be6dd5b0d1b451d7ef48640ce2c401a3eba9a9554a9f3cd6137df`) and `reference.txt` (its exact
  spoken words). Made with VoxCPM2's voice design — "(A calm, warm man in his thirties, clear American
  accent, steady pace)" — and picked by the operator by ear. **"Tvashtr" is said "TVAH-ster"** as in
  that clip. No real person's voice is cloned.

## Decisions (final — operator, 15–16 Oct)

- **D1 Voice: VoxCPM2** (OpenBMB, Apache 2.0, `openbmb/VoxCPM2`), run on this Mac (MPS), **every line
  cloned from the reference clip** (prompt audio + its exact text) so the film is one consistent
  narrator. No ElevenLabs, no API key, nothing leaves the Mac. Kokoro is not used.
- **D2 Timing without ElevenLabs:** speech-to-text with word timestamps on the Mac (faster-whisper or
  mlx-whisper, MIT) gives each line's speech start/end; Product Demo Director takes the lines as a
  supplied narration (its `narrationMap` with measured times), so V4 still cuts between sentences.
- **D3 Re-shoot on 0.27.0** so chapters 3–4 show the fixed wording: the replays 3.2, 3.3, 3.4,
  3.4-verdict, 3.6 (free; they replay `recordings/hero` through today's frontend — server-made text
  such as Activity lines stays as recorded, but P1's gate titles and P2's "tests failed" arc must
  show); **3.7's Changes + Ask part** (1 Ask, on the hero run's Reviewer — Grok; its Memory part stays
  V2b's); **4.1 + 4.2 together with the operator's MAC-3** (2 runs). Nothing else is re-shot (chapter
  1, 2.1–2.3, 5.1 and 8.1 stay as filmed).
- **D4 4.1/4.2 run on the chapter-6 team** (Reviewer on Opus, no Query domain step — chapter 2's team
  would fail on its domain step), shown on camera under the plain name "Indicator sprint team": rename
  teams through the app's own API off camera; never delete a team (deleting deletes its runs).
- **D5 Cards:** 0.2 (title) and 8.2 (end), 1920×1080, about 4 s each, built with Product Demo
  Director's Remotion engine / motion kit (MIT) in the product's look: background `#F7F4EE`, ink
  `#2B2622`, accent `#C8674A`, the wordmark in **Newsreader** (the app's `--font-serif`), text in
  **Inter**. 0.2: the wordmark "Tvashtr" and one line "Design an AI team. It ships reviewed pull
  requests." 8.2: the wordmark, "Your team. Your rules.", "tvashtr.fly.dev · github.com/lazyxgenius/Tvashtr",
  and a small "Built by Aditya Sharma". Silent, gentle fades; no stock footage.
- **D6 A listen-through:** chapter 3 with its narration laid on its takes (`video/out/v3/ch3-narrated.mp4`,
  1920×1080, no music), so the operator hears the voice against the picture before V4.

## The sittings (in order; a checkpoint commit after each)

1. **Branch `video/v3` from `main`.** Preflight: push guard ON; `main` = `6b35addc`; Docker; ports
   free; the reference clip's sha256 as above.
2. **The script into the project:** `video/v3/script.json` from `prompts/video-v3-script.md` — every
   line's text byte-identical (a test proves it), film order, captions/badges/notes kept.
3. **The voice:** VoxCPM2 in an ignored venv under `video/` (gitignore it); model weights in the
   Hugging Face cache. A renderer (`video/v3/voice.py`) clones from the reference for every line with
   fixed settings (record model id, cfg, steps, seed in a manifest) → `video/out/v3/lines/<scene>.wav`.
   **Quality gate per line:** transcribe it; the normalised transcript must equal the script line
   (allow only the name "Tvashtr" to vary, and say how it was heard); else re-render with a new seed —
   at most 3 renders a line, then list the line. Leading/trailing silence trimmed to 120 ms. Also
   `video/out/v3/voice-sample.wav`: lines 0.1, 3.3, 4.1, 8.2 back to back, for the operator.
4. **Timing:** `video/v3/narration-timing.json` — per line: file, sha256, duration, speech start/end,
   words with times; and the Product Demo Director `narrationMap` entries it needs. 4.2's
   `{resume_minutes}` stays a placeholder until sitting 6, then that one line is rendered.
5. **Replays + 3.7 on 0.27.0** (normal stack): `take.mjs 3.2 3.3 3.4 3.4-verdict 3.6`, then 3.7's
   Changes + Ask part (one Ask, ≤ 1; if Grok answers with a usage limit, keep V2b's 3.7 Ask and say
   so). SMOKE lines below.
6. **4.1 + 4.2 + MAC-3** (stack with `QUIET=20 STALLED=60 FAIL=180`, then normal for 4.2): before
   launching 4.1, post exactly
   `MAC-3: open Recordly, record the top-right of the screen, then reply GO` and wait for the
   operator's GO in this chat (no GO within 30 minutes → film 4.1/4.2 anyway, note MAC-3 as owed).
   Turn notifications on through the run toolbar's bell as SCENES.md's MAC-3 script says; **never click
   a macOS permission prompt** — that is the operator's. After "Failed", post
   `MAC-3: stop recording and save it as video/out/mac/MAC-3.mov`. Then 4.2 (resume from Needs you),
   real "Done in" → `{resume_minutes}` → render 4.2's line through the same gate.
7. **Cards** (D5) → `video/out/v3/0.2.mp4`, `8.2.mp4`, plus a still of each you open.
8. **The listen-through** (D6): chapter 3 = 3.1 up to Launch, 3.2, 3.3, 3.4, 3.4-verdict, 3.6, 3.7;
   each line starts 0.4 s into its scene; a take longer than its line + 1.5 s is trimmed or sped up
   (badge text as the script says); audio −16 LUFS.
9. **Docs:** `video/SCENES.md` (a V3 section: voice settings, every line's renders and how "Tvashtr"
   was heard, the re-shoots and their numbers, SMOKE lines, what V4 needs) and `video/README.md`.

## The live smoke (each with a screenshot you open)

- **P1 + P2 in the replays:** the run view's gate cards read their titles (Secret scan, No edits to
  servers/), never a raw kind; the Tests check's arc reads "tests failed".
- **P4/P5 in 3.7:** the Reviewer drawer's round row names the subscription (no "$0.0000"); the Ask's
  answer renders markdown (no raw `**`).
- **P6 in 4.2:** the resume confirm lists "Tests pass — Tvashtr runs the tests" and names every plan
  that runs again.
- **4.1 (H1/H2):** "Failed after … · on your Claude subscription"; "Next: resume from …".
- **S4:** every job's lock line (`node video/camera/smoke.mjs s4`).

## Real-work budget

| Grok Asks | Grok jobs | Claude runs | test replays | voice renders |
|---|---|---|---|---|
| ≤ 1 (3.7) | 0 otherwise | ≤ 2 (4.1, 4.2) + 1 spare | 0 | ≤ 3 per line |

## Rules

1. Commit only on `video/v3`: `video/**` and video ignore rules, your own paths by name. Prove scope:
   `git diff --stat main...video/v3` lists nothing outside `video/` and `.gitignore`. No product code.
2. No push (guard ON), never force, never `reset --hard`, never merge into `main`.
3. `.env` fenced; secrets never printed, logged, screenshotted or committed; never open the claude/grok
   credential files. Audio, video and model files never enter git.
4. Subscriptions: Engines shows Claude and Grok "Connected" before the first run; Claude jobs log
   `apiKeySource: none`. An expired sign-in or a usage cap (other than 3.7's fallback) → NEEDS_HUMAN.
5. The Mac: `caffeinate -dimsu`; pause/stop only processes you launched, by PID; the operator's
   installed Tvashtr.app may be open — leave it; delete only what you created.
6. One stack, one Desktop; never `make test` next to a running stack or on `tvashtr_film`.
7. Three-attempt rule; time box 10 h (waiting for GO or a cap doesn't count).
8. Safe state at any stop: nothing running, the branch committed, checkout on `main`.
9. After a compaction: re-read this brief and the end of `STATE.md`.

## Evidence lines

`PREFLIGHT: main=<sha> guard=ON ref_sha=<ok>` · `SCRIPT: 35 lines, 795 words, text identical` ·
`VOICE_ENV: voxcpm <version> model openbmb/VoxCPM2 device=<mps|cpu> settings <…>` ·
`LINES: <n>/35 rendered, renders <total>, gate passes <n>, name heard as <…>, flagged <list>` ·
`VOICE_SAMPLE: video/out/v3/voice-sample.wav <s>` · `TIMING: <file> <n> lines` ·
`RESHOOT: <take> <s>` (each) · `SMOKE: <check> PASS|FAIL <shot>` (each) ·
`MAC3: recorded | owed` · `RESUME: run=<id> done_in=<…> PR=<url>` · `CARDS: 0.2 <s>, 8.2 <s>` ·
`CH3_NARRATED: <file> <s> <LUFS>` · `RUNS_USED: grok_asks <n>/1, claude_runs <n>/2(+1)` ·
`DIFF: <stat>` · `READY_TO_MERGE video/v3 <sha>`, then the eight-section FINAL REPORT (CLI-RULES §4.7).

## Stop with NEEDS_HUMAN (written to STATE.md and echoed, with the FINAL REPORT) when

- the push guard is off; a sign-in expired or a usage cap is hit (apart from 3.7's fallback); macOS asks
  for a permission the operator hasn't granted;
- VoxCPM2 can't run on this Mac, or more than 5 lines fail the quality gate after 3 renders each;
- a fix would need product code, a migration or a DBOS change;
- a second, unknown problem needs a broad or unproven change; a safeguards notice stops a response;
- any `SMOKE:` line is FAIL (at the end, after everything else).
