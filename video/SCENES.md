# The demo film's scenes (V1, V2, V2b, V3, V3b)

Every scene of the storyboard (`prompts/video-v1.md`) as a take script that re-records by name:
`make -C video take SCENE=<id>` (`DRY=1` to rehearse; `"<id>*"` for a scene's parts). V3's takes land
in `video/takes/v3/<take>/` (V1's, V2's and V2b's stay in `video/takes/v1/`, `v2/`, `v2b/`; a rehearsal in
`<take>-dry/`) — `take.mp4` 2880×1800 · 30 fps, `take.json`, `poster.png`, `shots/`. Review files:
`video/out/v3/contact-sheet.png` (the newest take of every scene, V3 over V2b over V2 over V1),
V2b's `video/out/v2b/ch2-preview.mp4` … `ch7-preview.mp4`, and V3's narration, cards and chapter-3
listen-through in `video/out/v3/` (below). How the camera and the voice work: `video/README.md`.

## Status

Generated from the takes on disk (`node video/camera/sheet.mjs scenes-table`): one row per take,
its V1, V2, V2b and V3 status. "clip" = a filmed take (mode, raw length); "rehearsed" = a `--dry` take
that stopped before the named spend (or ran through when it spends nothing); "—" = not taken in that
version. Budgets are the scene's own and the plan's chapter budget — raw takes run longer on purpose
(record more, V4 trims). V2b's first sitting stopped at a Grok usage cap; **its second sitting
(2026-10-16) filmed everything it owed** — 6.1–6.3 on a fresh team with the Reviewer on Claude Opus,
3.5, chapters 2 and 7, and 0.1 (below). **V3 (2026-10-16)** gave the film its narrator, re-shot
chapter 3's replays, 3.7's Ask and 4.1/4.2 on the shipped 0.27.0, and built the title and end cards.
**V3b (2026-10-17)** re-rendered 4.2's line (kept) and 3.1's (owed), and filmed `4.1-mac3` for MAC-3 — whose
recording has no banner (still owed; below).

<!-- scenes-table -->
| take | script | V1 | V2 | V2b | V3 | scene budget · chapter budget |
|---|---|---|---|---|---|---|
| 0.1 | `scenes/0.1.mjs` (web) | blocked: trade_mcp is private — run node video/camera/github-login.mjs once (operator) | clip (web) 12.7 s | clip (web) 12.7 s | — | 20 s · ch 0: 20 s |
| 0.2 | `scenes/0.2.mjs` (motion) | MOTION | MOTION | MOTION | MOTION | — s · ch 0: 20 s |
| 1.1 | `scenes/1.1.mjs` (mac) | MAC | MAC | MAC | MAC | — s · ch 1: 55 s |
| 1.2 | `scenes/1.2.mjs` (live) | clip (live) 15.3 s | — | rehearsed (live, no spend) | — | 20 s · ch 1: 55 s |
| 1.3 | `scenes/1.3.mjs` (live) | clip (live) 43.1 s | — | — | — | 20 s · ch 1: 55 s |
| 1.4 | `scenes/1.4.mjs` (sample) | clip (sample) 20.2 s | — | — | — | 12 s · ch 1: 55 s |
| 1.5 | `scenes/1.5.mjs` (sample) | clip (sample) 36.9 s | — | — | — | 15 s · ch 1: 55 s |
| 2.1 | `scenes/2.1.mjs` (live) | clip (live) 14.3 s | — | — | — | 12 s · ch 2: 70 s |
| 2.2 | `scenes/2.2.mjs` (live) | clip (live) 18.8 s | — | — | — | 12 s · ch 2: 70 s |
| 2.3 | `scenes/2.3.mjs` (live) | clip (live) 12.6 s | — | — | — | 12 s · ch 2: 70 s |
| 2.4 | `scenes/2.4.mjs` (live) | clip (live) 80.7 s | — | clip (live) 66.9 s | — | 30 s · ch 2: 70 s |
| 2.5 | `scenes/2.5.mjs` (live) | clip (live) 40.8 s | — | clip (live) 49.8 s | — | 25 s · ch 2: 70 s |
| 2.6 | `scenes/2.6.mjs` (live) | clip (live) 29.2 s | — | clip (live) 31.7 s | — | 25 s · ch 2: 70 s |
| 2.7 | `scenes/2.7.mjs` (live) | clip (live) 154.6 s | — | clip (live) 56.1 s | — | 30 s · ch 2: 70 s |
| 3.1 | `scenes/3.1.mjs` (record) | rehearsed · stopped before “Launch” | clip (record) 2281.1 s | clip (record) 657.2 s | — | 15 s · ch 3: 90 s |
| 3.2 | `scenes/3.2.mjs` (replay) | rehearsed (replay, no spend) | clip (replay) 15.8 s | clip (replay) 15.8 s | clip (replay) 15.8 s | 25 s · ch 3: 90 s |
| 3.2-proof | `scenes/3.2.mjs` (record) | clip (record) 1869.2 s | — | — | — | 25 s · ch 3: 90 s |
| 3.2-replay | `scenes/3.2.mjs` (replay) | clip (replay) 1867 s | — | — | — | 25 s · ch 3: 90 s |
| 3.3 | `scenes/3.3.mjs` (replay) | rehearsed (replay, no spend) | clip (replay) 22 s | clip (replay) 22.4 s | clip (replay) 22.9 s | 25 s · ch 3: 90 s |
| 3.4 | `scenes/3.4.mjs` (replay) | rehearsed (replay, no spend) | clip (replay) 29.8 s | clip (replay) 22 s | clip (replay) 22.2 s | 30 s · ch 3: 90 s |
| 3.4-verdict | `scenes/3.4.mjs` (replay) | — | — | clip (replay) 30.1 s | clip (replay) 29.9 s | 30 s · ch 3: 90 s |
| 3.5 | `scenes/3.5.mjs` (sample) | clip (sample) 21 s | — | clip (sample) 20.5 s | — | 15 s · ch 3: 90 s |
| 3.6 | `scenes/3.6.mjs` (replay) | rehearsed (replay, no spend) | clip (replay) 25.6 s | clip (replay) 24.1 s | clip (replay) 24.2 s | 20 s · ch 3: 90 s |
| 3.7 | `scenes/3.7.mjs` (live) | rehearsed · stopped before “Send” | clip (live) 52.6 s | clip (live) 77.4 s | — | 30 s · ch 3: 90 s |
| 3.7-ask | `scenes/3.7.mjs` (live) | — | — | — | clip (live) 70.1 s | 30 s · ch 3: 90 s |
| 4.1 | `scenes/4.1.mjs` (live) | rehearsed · stopped before “Launch” | clip (live) 282.4 s | clip (live) 319.2 s | clip (live) 316.2 s | 30 s · ch 4: 45 s |
| 4.1-mac3 | `scenes/4.1.mjs` (live) | — | — | — | clip (live) 325.2 s | 30 s · ch 4: 45 s |
| 4.2 | `scenes/4.2.mjs` (live) | rehearsed · stopped before “Resume (needs 4.1's failed run)” | clip (live) 24.7 s | clip (live) 19.9 s | clip (live) 27.1 s | 25 s · ch 4: 45 s |
| 4.2-s4 | `scenes/4.2.mjs` (live) | — | — | — | clip (live) 9.7 s | 25 s · ch 4: 45 s |
| 4.2-p6 | `scenes/4.2.mjs` (live) | — | — | clip (live) 40.1 s | — | 25 s · ch 4: 45 s |
| 5.1 | `scenes/5.1.mjs` (live) | rehearsed · stopped before “Start run” | clip (live) 26.5 s | clip (live) 22.6 s | — | 25 s · ch 5: 30 s |
| 5.1-recent | `scenes/5.1.mjs` (live) | rehearsed (live, no spend) | clip (live) 7 s | clip (live) 6.9 s | — | 25 s · ch 5: 30 s |
| 6.1 | `scenes/6.1.mjs` (live) | rehearsed · stopped before “Run all” | — | clip (live) 28.5 s | — | 30 s · ch 6: 75 s |
| 6.1-evidence | `scenes/6.1.mjs` (live) | — | — | clip (live) 37.9 s | — | 30 s · ch 6: 75 s |
| 6.1-p5 | `scenes/6.1.mjs` (live) | — | — | clip (live) 18.5 s | — | 30 s · ch 6: 75 s |
| 6.1-s4 | `scenes/6.1.mjs` (live) | — | — | clip (live) 9.4 s | — | 30 s · ch 6: 75 s |
| 6.1-seed | `scenes/6.1.mjs` (live) | — | — | clip (live) 34.4 s | — | 30 s · ch 6: 75 s |
| 6.2 | `scenes/6.2.mjs` (run) | clip (sample) 23.9 s | — | clip (run) 60.9 s | — | 40 s · ch 6: 75 s |
| 6.3 | `scenes/6.3.mjs` (run) | rehearsed · stopped before “Start compare” | — | clip (run) 35.4 s | — | 40 s · ch 6: 75 s |
| 6.3-set | `scenes/6.3.mjs` (run) | — | — | clip (run) 72.1 s | — | 40 s · ch 6: 75 s |
| 7.1 | `scenes/7.1.mjs` (live) | clip (live) 27.6 s | — | clip (live) 27.7 s | — | 20 s · ch 7: 30 s |
| 7.2 | `scenes/7.2.mjs` (live) | clip (live) 33.3 s | — | clip (live) 33.6 s | — | 30 s · ch 7: 30 s |
| 8.1 | `scenes/8.1.mjs` (sample) | clip (sample) 23.6 s | — | — | — | 25 s · ch 8: 25 s |
| 8.1-web | `scenes/8.1.mjs` (web) | clip (web) 23.5 s | — | — | — | 25 s · ch 8: 25 s |
| 8.2 | `scenes/8.2.mjs` (motion) | MOTION | MOTION | MOTION | MOTION | — s · ch 8: 25 s |
<!-- /scenes-table -->

## V3b (2026-10-17): two spoken words, MAC-3

Brief `prompts/video-v3b.md`, branch `video/v3b` from `main` `03dac4b9`. No product code; the words on
screen (`video/v3/script.json`) unchanged (`git diff main -- video/v3/script.json` empty).

### The sound check — `video/v3/phonemes.py` (D2)

Speech-to-text can't settle these two words (Whisper hears "whole" for a good "Hull", and "it's
shipped" for 4.2's `ɪ t ʃ ɪ p t`), so a phoneme recogniser decides them:
`facebook/wav2vec2-lv-60-espeak-cv-ft` @ `ae45363b` (Apache-2.0; downloaded to the Hugging Face cache
for V3b), CPU, greedy CTC, its tokenizer loaded with `do_phonemize=False` (no espeak). The checked word
is what sounds between its neighbours, each found as its own phonemes ("a" = ɐ, "moving" = m uː, "you"
= j uː, "Needs" = n iː), the match nearest that word's edge in the transcriber's word times — Whisper's
word starts run late, so its times alone handed the word's last phoneme (l, d) to the next word.

- **3.1** passes when "Hull" sounds ʌ, never oʊ; **4.2** when "in" has no æ and no d (the brief's
  rules). Both words may also hold **only their own sounds** (3.1: h ʌ l; 4.2: ɪ/ᵻ/i and n, a vowel
  required) — added after the review (workflow `wf_41f0687f-a0c`) showed must/never alone passed "it"
  (`ɪ t`, 4.2's r4 was heard "It needs you") and would pass "hut" or a weak "and" (`ə n`).
- A spoken-form render passes when the sound check passes **and** V3's transcript gate passes for
  every other word (the checked word is the one place the transcript may differ: `voice.gate(…, slot)`).
- **Reproduce first, on V3's kept files:** 3.1 **FAIL** `[ɐ] h oʊ l [m uː]` · 4.2 **FAIL**
  `[j uː] æ n d [n iː]`. V3's other renders: 3.1 r1/r3 `h oʊ l`; 4.2 r2 `ɪ n d`, r3 `ɪ n` (a good "in"
  — V3's gate failed it on "it's shipped").

### The spoken forms — `video/v3/say.json` (D1)

The voice reads a line's spoken form: the script's words in the same order, only capitals,
punctuation and declared respellings (`{"Hul": "Hull"}`) different (`voice.say_errors`;
`video/v3/test_say.py` fails an extra, missing, swapped, undeclared or unused word, and `voice.py`
refuses a tampered file). Each form gets seeds 42/43/44 with V3's settings (`voice-manifest.json` ›
`settings`, unchanged); at most 12 spoken renders a line. Kept: **4.2's form only** (3.1 is owed, so it
has no entry).

### Every render (D3) — `video/out/v3/lines/renders/<scene>-r<n>.wav`

| line | render | spoken form (its changed sentence) | seed | phonemes | transcript | verdict |
|---|---|---|---|---|---|---|
| 3.1 | r4 | add a **Hul** moving average. | 42 | `[ɐ] h ɔː l [m uː]` | pass | FAIL |
| 3.1 | r5 | add a **Hul** moving average. | 43 | `[ɐ] h oʊ l [m uː]` | pass | FAIL |
| 3.1 | r6 | add a **Hul** moving average. | 44 | `[ɐ] h oʊ l [m uː]` | pass | FAIL |
| 3.1 | r7 | add a **Huhl** moving average. | 42 | `[ɐ] h oʊ l [m uː]` | pass | FAIL |
| 3.1 | r8 | add a **Huhl** moving average. | 43 | `[ɐ] h oʊ l [m uː]` | pass | FAIL |
| 3.1 | r9 | add a **Huhl** moving average. | 44 | `[ɐ] h oʊ l [m uː]` | pass | FAIL |
| 3.1 | r10 | add a **Hull,** moving average. | 42 | `[ɐ] h ɔ l [m uː]` | pass | FAIL |
| 3.1 | r11 | add a **Hull,** moving average. | 43 | `[ɐ] h ɔ l [m uː]` | pass | FAIL |
| 3.1 | r12 | add a **Hull,** moving average. | 44 | `[ɐ] h ɔ l [m uː]` | pass | FAIL |
| 3.1 | r13 | add a **hull** moving average. (own: the common noun) | 42 | `[ɐ] h ɔ l [m uː]` | pass | FAIL |
| 3.1 | r14 | add a **hull** moving average. | 43 | `[ɐ] h oʊ l [m uː]` | pass | FAIL |
| 3.1 | r15 | add a **hull** moving average. | 44 | `[ɐ] h oʊ l [m uː]` | pass | FAIL |
| 4.2 | r4 | waits for you**,** in Needs you. | 42 | `[j uː] ɪ t [n iː]` | fail ("It needs you", "it's shipped") | FAIL |
| 4.2 | r5 | waits for you**,** in Needs you. | 43 | `[j uː] ɪ n [n iː]` | fail ("it's shipped") | FAIL |
| 4.2 | r6 | waits for you**,** in Needs you. | 44 | `[j uː] ɪ n d [n iː]` | fail | FAIL |
| 4.2 | r7 | waits for you in **"Needs you"**. | 42 | `[j uː] ɪ n d [n iː]` | fail | FAIL |
| 4.2 | r8 | waits for you in **"Needs you"**. | 43 | `[j uː] ɪ n [n iː]` | **pass** ("waits for you in Needs You … It shipped") | **PASS — kept** |

- **4.2 kept: r8** (form 2, seed 43) → `video/out/v3/lines/4.2.wav` (13.71 s, sha256 `7674b70b…`);
  its `{resume_minutes}` is "Seven" as in V3.
- **3.1 owed** after 12 renders: VoxCPM2 said `h oʊ l` (7), `h ɔ l` (4) or `h ɔː l` (1) — never ʌ, in
  any spelling. V3's r2 stays its line (`lines/3.1.wav`, sha256 `fc17a771…`, unchanged). The best
  three, by the phoneme model's probability of ʌ on the vowel's frames (a diagnostic, not the gate):
  **r10** "Hull," seed 42 `h ɔ l` (P(ʌ) 0.216) · **r13** "hull" seed 42 `h ɔ l` (0.200) · **r11**
  "Hull," seed 43 `h ɔ l` (0.136); every `oʊ` render scores ≤ 0.005. ɔ differs from ʌ only in lip
  rounding: the operator's ear decides whether one of them (or V3's r2) is good enough.
- V3's kept files are saved as `lines/renders/3.1-v3.wav` and `4.2-v3.wav` (the manifest's
  `v3_kept`); the logs are `video/out/v3b/render-form{1..4}.log`.
- **Timing (D4):** `narration-timing.json` changed only in 4.2's line and its `narrationMap` entry
  (render 1 → 8, seed 42 → 43, 13.264 → 13.712 s, gate flagged → pass, `said` and `phonemes` added);
  `voice-manifest.json` only in 3.1 and 4.2 (V3's renders untouched; 3.1 gains the `v3b` note).
- **The listen-through:** `video/v3/listen.py` re-rendered `video/out/v3/ch3-narrated.mp4` — **83.2 s,
  −16.0 LUFS**. With 3.1 owed the cut is V3's: decoded audio and video MD5s equal
  `ch3-narrated-v3.mp4` (V3's copy, kept).

### MAC-3 (D5–D7) — recorded, but no banner in it

- **The free check** (`video/camera/notify-check.mjs`, no run): the dev Desktop's page shows a "Tvashtr
  test" notification (`Notification.permission` granted, each one `shown`), re-shown every 12 s; the
  operator, reading the chat (the Desktop in the background), answered **SEEN** on the first try.
- **The run** (the spare Claude run; ledger `out/v3/budget.json` run 3/3): take **`4.1-mac3`** (part of
  `scenes/4.1.mjs`, so V3's `takes/v3/4.1` stays byte-identical, sha256 `c874fc2e…` before and after),
  rehearsed with `--dry` first (pre-roll: Claude and Grok Connected, stopped before Launch). After the
  operator's GO: run **`2bce0e59`** "Add a TRIX indicator" on chapter 6's team as "Indicator sprint
  team"; the bell turned stalls/fails on (`notify_stalls_fails=true`); spec approved; the Engineer's
  CLI paused → **Quiet 06:13:52Z → Stalled 06:14:33Z → Failed 06:17:03Z**, "Failed after 5m 0s · on your
  Claude subscription" (SMOKE 4.1 H1/H2 PASS, `takes/v3/4.1-mac3/shots/failed.png`); 325.2 s; left
  failed (no resume, no delete); its run is in `out/v3b/stall-mac3.json`.
- **The file:** the operator recorded the whole screen with macOS's own recorder and saved it to the
  Desktop; `video/out/mac/MAC-3.mov` is an exact copy (`cmp`): 430.2 s, 3420×2214 H.264, 384,734,821
  bytes, started 06:11:13Z (Stalled ≈ 200 s in).
- **SMOKE: MAC-3 FAIL.** No banner: the top-right below the menu bar, scanned twice a second over all
  430 s, changes only in the first 28 s and the last 20 s (the recording's own start and end); the
  frames 190–250 s (`video/out/v3b/mac3-frames/sheet-190-250.png`) and 205 s (`full-205.png`: the
  Desktop active — "Electron" in the menu bar — on the stalled run, "The Engineer may be stuck") show
  none.
- **Why — measured:** the same test notification with the Desktop made the active app before each
  show (`notify-check.mjs --pinned`, 17 shows, each `shown`, the window focused) → the operator: **NOT
  SEEN**. macOS shows no banner from the dev Desktop while it is the active app, and a take keeps the
  Desktop pinned and focused throughout (`take.mjs` › `frontmost`, for clean frames). The product's
  path held: the bell saved the choice into the notifier's own copy, permission was granted, and the
  inbox listed `run_stalled` for the 2.5 minutes the step was Stalled (the notifier polls every 10 s).
- **What a re-take needs:** a run (the V3 ledger has none left) and the Desktop **not** the active app
  when the Engineer goes Stalled — e.g. the camera lets go of always-on-top and brings another app
  forward after pausing the CLI — then the banner should show as it did for the SEEN check.

## V3 (2026-10-16): the narrator, the re-shoots on 0.27.0, the title and end cards


Brief `prompts/video-v3.md`, branch `video/v3` from `main` `6b35addc` (= production: Fly v46, Desktop
`desktop-v0.27.0`, alembic `0053`). No product code. Ledger `video/out/v3/budget.json` (caps 3 runs ·
0 test replays · 1 Ask): **runs 2 (4.1, 4.2) · test replays 0 · Asks 1 (3.7, Grok)**; voice renders 39
(≤ 3 a line). Every live take passed the pre-roll, which stops unless the Desktop reads Claude and Grok
**Connected**; the Claude CLI read `loggedIn` (claude.ai, Max) from a clean environment.

### The narrator — VoxCPM2 on this Mac (D1)

- **Model and settings** (`video/v3/voice-manifest.json` › `settings`): `voxcpm` 2.0.3 (Apache-2.0),
  `openbmb/VoxCPM2` @ `32279eff`, torch 2.14.1 on **MPS**, float32 (VoxCPM picks it on MPS; bf16 drifts
  there), 48 kHz out. **Every line is cloned from `video/out/voice/reference.mp3`** (sha256
  `cd3db9f9…6137df`) in VoxCPM2's "ultimate cloning" mode: the clip as prompt audio with its exact
  words (`reference.txt`) as prompt text, and the same clip as the isolated reference. `cfg_value` 2.0,
  `inference_timesteps` 10, no text normalisation, no denoise, VoxCPM's own runaway guard on; render n
  of a line uses seed 42, 43, 44. Leading/trailing silence trimmed to 120 ms (−40 dB). Nothing left the
  Mac (weights in the Hugging Face cache; `video/voice-venv/` is ignored).
- **The gate** (`voice.py gate`): mlx-whisper `large-v3-turbo` (language en, temperature 0, word
  timestamps) transcribes each render; the normalised transcript (lowercase, no punctuation, digits as
  words, a small table of same-word spellings — ⌘/cmd → command, "3/4" → "3 of 4", tool kit,
  guard rails, back-up, Groq → grok …) must equal the line, only "Tvashtr" may differ (1–2 words).
  `video/v3/test_voice.py` holds the cases.
- **Result: 35/35 lines rendered, 39 renders, 33 pass the gate; flagged 3.1 and 4.2** (3 renders each,
  then listed — the brief's NEEDS_HUMAN bar is > 5):
  - **3.1** — all three renders were heard "add a **whole** moving average"; with the hint "Add a Hull
    moving average (HMA) indicator." (a diagnostic, not the gate) all three read "Hull". Kept: r2.
  - **4.2** — all three heard "waits for you **and needs you**" for "in Needs you" (r2 also "Resume
    **it** from", r2/r3 "it**'s** shipped"); a context hint ("failed runs wait in a list called
    'Needs you'") did not change it. Kept: r1 (only in/and differs).
  - The kept render of a flagged line is recorded by `voice.py choose` (the line stays flagged) and
    used by the timing and the listen-through until the operator judges it by ear.
- **How "Tvashtr" was heard** (9 lines say it): *tvastor* (0.2, 3.6), *tvasters* (3.4-verdict,
  possessive), *tevastor* (3.4), *tvastra* (2.4, 8.2), *tvashtra* (2.5), *dvaster* (4.1), *vostor* (7.2).
  For comparison the operator's reference clip itself is heard as *Tevashtra*: the transcriber's
  spelling is not a pronunciation measure, so the name lines want an ear (4.1's *dvaster* and 7.2's
  *vostor* most).
- **4.2's `{resume_minutes}`** = the re-shot resume run's "Done in 7m 9s" → **"Seven"** (rendered after
  sitting 6 through the same gate).
- Files (ignored): `video/out/v3/lines/<scene>.wav` (the kept render; 24-bit 48 kHz mono, ~−25 LUFS),
  every render in `lines/renders/<scene>-r<n>.wav`, `video/out/v3/voice-sample.wav` (0.1, 3.3, 4.1,
  8.2 back to back, 42.4 s). Integrated loudness of the sample's lines −25.0 … −26.6 LUFS, peaks ≈ −5 dBFS.

| line | renders (seed: verdict) | kept | length | speech (onset–offset) | “Tvashtr” heard as |
|---|---|---|---|---|---|
| 0.1 | r1 (42): pass | r1 | 10.30 s | 0.12–10.19 s | — |
| 0.2 | r1 (42): pass | r1 | 1.45 s | 0.12–1.33 s | tvastor |
| 1.1 | r1 (42): pass | r1 | 4.28 s | 0.12–4.16 s | — |
| 1.2 | r1 (42): pass | r1 | 13.90 s | 0.12–13.79 s | — |
| 1.3 | r1 (42): pass | r1 | 11.21 s | 0.12–11.09 s | — |
| 1.4 | r1 (42): pass | r1 | 4.76 s | 0.12–4.64 s | — |
| 1.5 | r1 (42): pass | r1 | 6.11 s | 0.12–6.00 s | — |
| 2.1 | r1 (42): pass | r1 | 2.61 s | 0.12–2.50 s | — |
| 2.2 | r1 (42): pass | r1 | 5.70 s | 0.12–5.57 s | — |
| 2.3 | r1 (42): pass | r1 | 2.83 s | 0.12–2.71 s | — |
| 2.4 | r1 (42): pass | r1 | 15.08 s | 0.12–14.96 s | tvastra |
| 2.5 | r1 (42): pass | r1 | 10.84 s | 0.12–10.72 s | tvashtra |
| 2.6 | r1 (42): pass | r1 | 4.99 s | 0.12–4.86 s | — |
| 2.7 | r1 (42): pass | r1 | 6.66 s | 0.12–6.54 s | — |
| 3.1 | r1 (42): fail · r2 (43): fail · r3 (44): fail | r2 — **flagged** | 8.32 s | 0.12–8.20 s | — |
| 3.2 | r1 (42): pass | r1 | 5.84 s | 0.12–5.72 s | — |
| 3.3 | r1 (42): pass | r1 | 12.02 s | 0.12–11.90 s | — |
| 3.4 | r1 (42): pass | r1 | 12.58 s | 0.12–12.46 s | tevastor |
| 3.4-verdict | r1 (42): pass | r1 | 13.29 s | 0.12–13.17 s | tvasters |
| 3.6 | r1 (42): pass | r1 | 9.75 s | 0.12–9.63 s | tvastor |
| 3.7 | r1 (42): pass | r1 | 10.94 s | 0.12–10.82 s | — |
| 3.5 | r1 (42): pass | r1 | 8.18 s | 0.12–8.05 s | — |
| 4.1 | r1 (42): pass | r1 | 14.47 s | 0.12–14.36 s | dvaster |
| 4.2 | r1 (42): fail · r2 (43): fail · r3 (44): fail | r1 — **flagged** | 13.26 s | 0.12–13.14 s | — |
| 5.1 | r1 (42): pass | r1 | 11.96 s | 0.12–11.84 s | — |
| 5.1-recent | r1 (42): pass | r1 | 3.37 s | 0.12–3.24 s | — |
| 6.1 | r1 (42): pass | r1 | 11.37 s | 0.12–11.25 s | — |
| 6.2 | r1 (42): pass | r1 | 13.32 s | 0.12–13.21 s | — |
| 6.3 | r1 (42): pass | r1 | 11.86 s | 0.12–11.74 s | — |
| 6.3-set | r1 (42): pass | r1 | 9.78 s | 0.12–9.66 s | — |
| 7.1 | r1 (42): pass | r1 | 6.35 s | 0.12–6.23 s | — |
| 7.2 | r1 (42): pass | r1 | 10.07 s | 0.12–9.96 s | vostor |
| 8.1 | r1 (42): pass | r1 | 10.74 s | 0.12–10.62 s | — |
| 8.1-web | r1 (42): pass | r1 | 2.18 s | 0.12–2.06 s | — |
| 8.2 | r1 (42): pass | r1 | 3.17 s | 0.12–3.05 s | tvastra |

### Timing — `video/v3/narration-timing.json` (D2)

Per line: file, sha256, duration, speech start/end (first word's start, last word's end — Whisper
snaps a line's first word to 0.0), onset/offset (the −40 dB speech edges: every file keeps 120 ms of its
render around them), the render and seed, how the name was heard, gate pass or flagged, and every word
with its times. `narrationMap`: Product Demo Director's supplied-narration map (`docs/PRODUCTION_CONTRACT.md`
"Global narration"), one thought per line, `startSec`/`endSec` the wider of the two ranges in the line's
own file — V4 adds each line's placement in the master (and sets `shotN`) when it lays the lines on the
picture; the measured times let PDD cut only between thoughts.

### The re-shoots on 0.27.0 (D3) — `video/takes/v3/`

| take | mode | length | what it shows |
|---|---|---|---|
| 3.2 | replay of `recordings/hero` | 15.8 s | the Now bar and Activity |
| 3.3 | replay | 22.9 s | Needs you → the spec → one line added → Approve with my edits (the line now lands as the spec's last paragraph) |
| 3.4 | replay | 22.2 s | the Engineer's drawer → Raw log; "Tests failed — back to Engineer with the last 12 lines", its output opened |
| 3.4-verdict | replay | 29.9 s | the Grok Reviewer's verdict with Tvashtr's test result |
| 3.6 | replay | 24.2 s | the guardrail cards, Ship, PR #57, "Done in 10m 21s" |
| 3.7-ask | live, 1 Ask (Grok) | 70.1 s | Changes (the file list), cost per round, the Ask and its answer as a list — the Memory beat stays V2b's `3.7` |
| 4.1 | live, run #8 | 316.2 s | chapter 6's team as "Indicator sprint team"; the bell → notifications on (MAC-3); spec approved; the Engineer paused → Quiet → Stalled → "Failed after 4m 51s · on your Claude subscription" |
| 4.2 | live, run #9 | 27.1 s on camera | Home's Needs you → Resume → the picker → the confirm (P6) → Carried over → (off camera) → Done, PR #67 |
| 4.2-s4 | live, no spend | 9.7 s | evidence (not for the film): the resumed run's Engineer → Raw log |

Server-made text in the replays (Activity lines) stays as recorded; the frontend is 0.27.0's (P1's
gate titles, P2's "tests failed" arc).

### The real runs (V3)

| run | # | scene | task | what happened | wall clock | PR |
|---|---|---|---|---|---|---|
| `d4159fe6` | 8 | 4.1 | Add a TRIX indicator — chapter 6's team (Reviewer on Opus, no Query domain step), shown as "Indicator sprint team" | PM → spec gate (one line added at the spec's end, approved on camera) → Engineer started → its Claude CLI paused (SIGSTOP, the Desktop's own process tree) → Quiet → Stalled → Failed | "Failed after 4m 51s · on your Claude subscription" | — |
| `ae65f353` | 9 | 4.2 | resume of run #8 from Engineer, round 1 — opened from **Home's Needs you** (Activity saved: `video/out/v3/runs-activity.json`) | spec v2 + approval carried ("Skips 1 min of finished work") → Engineer → **Tests failed** (12 lines back) → Engineer round 2 → **Tests passed · 664** → Opus Reviewer **asked for 1 fix** (a test built its frame from a RangeIndex) → Engineer round 3 → Tests passed · 664 → Reviewer **approved** ("core/indicators.py:464-475 implements trix() as a pure function …") → Secret scan → No edits to servers/ → Ship | "Done in 7m 9s · on your Claude subscription" (→ "Seven") | [#67](https://github.com/lazyxgenius/trade_mcp/pull/67) |

The one Ask (3.7-ask, the hero run's Reviewer on Grok, `--sandbox tvashtr-j3f0389`): "Tvashtr's tests
failed on the first build. What did you check once they passed? Answer in a short bulleted list." →
"Once the reviewer was told the tests passed (665 passed), it checked the build against the spec:" and
five bullets (the `hma` function, `INDICATORS`, the tests …). No usage limit: V2b's Ask is not needed.

### The live smoke (V3) — every line with its screenshot (opened)

| check | result | screenshot (`takes/v3/…`) |
|---|---|---|
| P2 (3.4's run view: the Tests check's arc) | **PASS** — "changes requested · tests failed" | `3.4/shots/p2-arcs.png` |
| P1 (3.6's run view: the gate cards) | **PASS** — "PRD approval · Escalation · Tests pass · Secret scan · No edits to servers/", no raw kind | `3.6/shots/p1-gates.png` |
| P4 (3.7: the Reviewer's round row) | **PASS** — "227,780 in / 12,710 out · on your Grok subscription", no $0.0000 | `3.7-ask/shots/p4-round-row.png` |
| P5 (3.7: the Ask's answer renders markdown) | **PASS** — strong 1 · li 5 · code 15, no `**` outside code | `3.7-ask/shots/p5-answer-whole.png`, `p5-ask.png` |
| S4 (3.7's Ask on Grok) | **PASS** — `tvashtr-j3f0389` | `3.7-ask/shots/ask.png` |
| 4.1 H1 (the failure line) | **PASS** — "Failed after 4m 51s · on your Claude subscription" | `4.1/shots/failed.png` |
| 4.1 H2 (Next: resume …) | **PASS** — "Next: resume from Engineer, round 1. Tvashtr skips the work that is done, so it doesn't run again." | `4.1/shots/failed.png` |
| 4.2 opens from Needs you | **PASS** — "Run failed Indicator sprint team · “Add a TRIX indicator” · 1m ago · The Engineer stopped responding: no update for 3 minutes Resume View run Retry" | `4.2/shots/needs-you.png` |
| 4.2 H2 (the confirm; no dollar per step) | **PASS** — "This starts run #9. It picks up where run #8 stopped." … "Skips 1 min of finished work. Only the steps that run again use your Claude subscription." | `4.2/shots/confirm.png`, `picker.png` |
| P6 (4.2: the resume confirm) | **PASS** — runs again: "Engineer · round 1 / Tests pass — Tvashtr runs the tests / Reviewer · round 1, and round 2 if it asks for more / Secret scan — Tvashtr checks it / No edits to servers/ — Tvashtr checks it / Ship, if the checks pass"; every plan named (Claude) | `4.2/shots/confirm.png` |
| S4 (the resumed run's Engineer) | **PASS** — "--model claude-sonnet-5 --restricted --safe-mode; lock line present" (the row is cut at the drawer's width; the smoke reads its title) | `4.2-s4/shots/engineer-raw-log-drawer.png` |
| S4 (`smoke.mjs s4`, every run's Desktop jobs) | **PASS** 14/14 — V3's #8 (2 Claude jobs) and #9 (5 Claude jobs, 0 Grok) among them (`video/out/v3/smoke-s4.log`) | `4.2-s4/shots/engineer-raw-log-drawer.png` |

### MAC-3 (the operator's Recordly shot)

Posted "MAC-3: open Recordly, record the top-right of the screen, then reply GO" before 4.1; the
operator replied **GO**; 4.1 turned notifications on through the run toolbar's bell ("When a run
stalls or fails" ticked → Turn on; the account's `notify_stalls_fails` read back true); no macOS
prompt was clicked by the camera. After "Failed": "MAC-3: stop recording and save it as
video/out/mac/MAC-3.mov". Status: **owed** — the operator marked it owed
(no `video/out/mac/MAC-3.mov` when V3 closed). A re-take needs a 4.1-style stall again (one run on the
stall stack); the bell's choices stay on for the account until a take's pre-roll turns them off.

### The cards (D5) — `video/v3/cards/cards.html`

Built on Product Demo Director's motion kit (`motion/kit.js`, MIT; rendered by its
`tools/motion_render.mjs`, 4 sub-frames per frame): background `#F7F4EE`, ink `#2B2622`, accent
`#C8674A`; the wordmark in **Newsreader** 400 (the app's `--font-serif`, tracking −0.02em), text in
**Inter**, both from the app's own Google Fonts stylesheet. Silent; staggered gentle arrivals (fade +
a small rise), a short accent rule drawn from the centre, a 0.6 s fade out.

- `video/out/v3/0.2.mp4` — 4.00 s, 1920×1080, 30 fps, 120 frames: "Tvashtr" / "Design an AI team. It
  ships reviewed pull requests." Still `video/out/v3/0.2.png`.
- `video/out/v3/8.2.mp4` — 4.00 s, same: "Tvashtr" / "Your team. Your rules." /
  "tvashtr.fly.dev · github.com/lazyxgenius/Tvashtr" / "Built by Aditya Sharma". Still `8.2.png`.
- The encode's background reads (246, 244, 235) against #F7F4EE's (247, 244, 238): yuv420 rounding.

### The listen-through (D6) — `video/out/v3/ch3-narrated.mp4`

`video/v3/listen.py`: chapter 3 = 3.1 (V2b's take, up to Launch), 3.2, 3.3, 3.4, 3.4-verdict, 3.6, 3.7
(V3's 3.7-ask for Changes and the Ask, V2b's 3.7 for Memory). **83.2 s, 1920×1080, 30 fps, −16.0 LUFS
(true peak −0.9 dB), no music.** Each line starts 0.4 s into its scene; a scene lasts its line + 1.5 s;
3.4 and 3.4-verdict (badged "sped up" in the script) are sped up ×1.58 and ×2.02 with the badge drawn;
the others are trimmed to their last line + 1.5 s before their payoff (3.1: 1 s after the Launch
click, 17.0 → 18.0 s); 3.7's three beats are cut just after the line's sentence ends. Every piece is
frame-exact (2,496 frames = 83.200 s, the narration 83.200 s); the plan is `video/out/v3/ch3/plan.json`.

### Bends (V3)

- **3.1 and 4.2 are flagged lines** (above) — rendered, kept, listed for the operator's ear.
- **The spec edit now lands at the spec's end.** `End` in a wrapped last paragraph split it
  mid-sentence in V2b's 3.3 and mid-word on 0.27.0's widths; the camera now presses ⌘↓ (the document's
  end). 3.3 was re-taken (free); 4.1's real spec v2 got the clean line.
- **Team names off camera (D4):** chapter 6's team (`9dd73d65`) took the plain name; chapter 2's
  (`631680b8`, no runs) became "Indicator sprint team (earlier)" (first "(chapter 2)", changed before
  4.1 so no production label shows in Home's Needs you). For the 3.7-ask take the hero team (`9da2b1d7`)
  showed the plain name like 3.2–3.6's recording, restored to "… (earlier)" right after.
- **4.2's S4 shot is its own evidence part** (`4.2-s4`): the short drawer keeps the Raw log below its
  fold in the film take.

### Product notes seen on camera (for the architect; no product code in V3)

- The Now bar's chips and the Activity filter chips still name checks by kind ("Secret leak scan",
  "Diff touches forbidden paths") — P1 fixed the canvas cards.
- The run drawer's lower area is short: an Ask's answer and the Raw log sit below its fold; Raw log
  rows are cut at the drawer's width.
- Home's Needs you lists one "… can't run on the website" row per team (G9: by design), so every
  renamed team shows there.

### What V4 needs

- **Narration:** 35 lines `video/out/v3/lines/<scene>.wav` + `video/v3/narration-timing.json`; the
  operator listens to `voice-sample.wav`, the 9 name lines and the two flagged lines (3.1, 4.2) first —
  a re-render beyond 3 a line is the operator's call.
- **Chapter 3:** 3.1 (V2b, up to Launch), 3.2, 3.3, 3.4, 3.4-verdict, 3.6, 3.7-ask (+ V2b 3.7's Memory)
  — `ch3-narrated.mp4` is the rough cut to hear them together.
- **Chapter 4:** 3.5 (V2b), 4.1 (316.2 s: trim the Quiet/Stalled/Failed holds; MAC-3 owed), 4.2
  (27.1 s on camera + jump cuts) — the line says "Seven minutes later".
- **Cards:** `0.2.mp4`, `8.2.mp4` (4 s, silent) — 0.2's line ("This is Tvashtr.") and 8.2's line play
  over them.
- Unchanged: chapter 1, 2.1–2.3, 5.1, 8.1 (as filmed); chapters 2, 5–7 as V2b.

## V2b, second sitting (2026-10-16): the Reviewer on Claude Opus, chapter 6 on a fresh team, every owed scene

Brief `prompts/m-desk-8-v2b2.md` Part B, on `video/v2b-refilm`: `feat/m-desk-8` merged in (`db0135b2`,
`--no-ff`; P1–P6, the on-camera fixes the first sitting's product notes asked for). No Grok job ran in
this sitting. Ledger `video/out/v2b/budget-2.json` (caps 10 runs · 12 test replays · 1 Ask): **runs 8 ·
test replays 9 · Asks 1**; Claude CLI probes 1 of 2.

- **K8: the Reviewer runs on `anthropic/claude-opus-5-5`** for the rest of the film (`story.json`
  `agents.reviewer`, `runs_on: "claude"`). The picker's Claude presets are Sonnet 5 and Sonnet 4, so
  Opus goes in as a custom model ID (`flows.pickCustomModel`); one `claude -p --model claude-opus-5-5`
  with the runner's own flags proved the operator's subscription takes it (`apiKeySource=none`, reply
  "ok"). **The continuity break is accepted:** chapters 3–5 show the Grok Reviewer (V2b's first
  sitting); chapters 2, 6 and 7 show the Opus one.
- **K9: chapter 6 on a fresh "Indicator sprint team"** (final, no Query domain step, the Tests check,
  the Opus Reviewer; the hero team became "Indicator sprint team (earlier)"), with one **seed run off
  camera** (part `6.1-seed`, `video/out/v2b/seed.json`; `flows.seedRun` finds it).
- **K10: 6.1 and 6.2 re-taken whole** on that team; 6.3 and its set followed. Chapter 2 rebuilt the
  film team after chapter 6 (its own team renamed "… (earlier)", its runs kept).

### The real runs (second sitting)

| run | # | scene | task | what happened | wall clock | PR |
|---|---|---|---|---|---|---|
| `70e2e4bf` | 1 | 6.1-seed (off camera) | Add a zero-lag EMA indicator, fresh team v1 | spec gate approved → Engineer → **Tests failed** (12 lines back) → Engineer round 2 → **Tests passed · 665** → Opus Reviewer **approved round 1** ("Approved — zlema is a pure function in core/indicators.py:31 …") → Secret scan → No edits to servers/ → Ship | "Done in 6m 7s · on your Claude subscription" | [#63](https://github.com/lazyxgenius/trade_mcp/pull/63) |
| `a2cb79c8` | 5 | 4.2-p6 (evidence) | Add an Ultimate oscillator indicator, on the "(earlier)" team | spec gate approved → Engineer started → stopped through the app → the resume confirm opened for P6, then cancelled | stopped | — |
| `b30aac78` / `afe9c70e` | 3 | 6.3 compare | Add a TEMA indicator, v1 / v2 | each: Tests failed → Engineer round 2 → Tests passed → Reviewer approved; **"v2 did better"** (Reviewer's tests 3 of 4 → 4 of 4; work 2m 30s vs 3m 26s) | 6m 2s / 6m 54s (lanes take turns on Claude) | none in a compare |
| `04ba00a7` / `b686e82c` | 5 | 6.3-set | Add a Vortex indicator, v1 / v2 | as above; hidden checks pass | 8m 22s / 9m 27s | none in a compare |
| `0ceade84` / `e7029130` | 7 | 6.3-set | Add a Chande momentum oscillator, v1 / v2 | as above; set: hidden checks **2 of 2 → 2 of 2**, rounds 2.0 → 2.0, no Restore | 8m 56s / 9m 47s | none in a compare |

Test replays: 6.1 "Run all 4" on v1 (**3 of 4 passed** — the round test failed for real: the replayed
Reviewer had no test result, below), 6.2 "Save and run tests" on v2 (4), 2.7 "Run all 1" on a chapter-2
team (**1 of 1 passed**). The one Ask (6.1-evidence, the seed run's Opus Reviewer): "In a short
bulleted list, what did you check before you approved? Put each file name in backticks." (its answer
is kept at `video/out/v2b/ask-answer.md`).

### The live smoke (second sitting) — every line with its screenshot (opened)

| check | result | screenshot (`takes/v2b/…`) |
|---|---|---|
| 6.1 L1/D8 | **PASS** — 0.0 s: "On v1 · on your Claude subscription"; results "3 of 4 passed" (real counts, no usage error) | `6.1/shots/running.png`, `results.png` |
| S4 (6.1's replays on Claude) | **PASS** — 4× `--restricted --safe-mode` | `6.1/shots/results.png` |
| 6.2 L1/D8 | **PASS** — 0.0 s: `ran_on {"subscriptions":["claude"],"all":true}`; the card "Testing 1 of 4" | `6.2/shots/testing.png` |
| S4 (6.2's replays on Claude) | **PASS** — 4× `--restricted --safe-mode` | `6.2/shots/tested.png` |
| 6.3 H5 (compare) | **PASS** — "about 12 min" = the turns added up (12) | `6.3/shots/6.3-lanes.png` |
| 6.3 H1 lanes / results | **PASS** — header and lanes "on your Claude subscription"; v2's lane "PM · Waiting for your Claude subscription — one job at a time."; Cost rows name the subscription | `6.3/shots/6.3-lanes.png`, `6.3-compare-results.png` |
| 6.3 H5 (set) | **PASS** — "about 26 min" = 26 | `6.3-set/shots/6.3-set-queued.png` |
| 6.3 H4 | **PASS** — a queued cell "PM · Waiting for your Claude subscription — one job at a time." | `6.3-set/shots/6.3-set-queued.png` |
| 6.3 H1 set running / results | **PASS** — cost cards and cells "on your Claude subscription" | `6.3-set/shots/6.3-set-results.png` |
| 6.3 every lane runs the Tests check | **PASS** — 6 of 6 lane runs: "Tests failed — back to Engineer with the last 12 lines" → "Tests passed" | `6.3-set/shots/6.3-set-results.png` |
| P1 (2.4's gate cards) | **PASS** — bare and set: "PRD approval · Escalation · Tests pass · Secret scan · No edits to servers/", never a raw kind | `2.4/shots/p1-gates-bare.png`, `p1-gates-set.png` |
| P2 (a run view's loop arcs) | **PASS** — "tests failed" on the check's arc, "changes requested" on the Reviewer's | `6.1-evidence/shots/p2-arcs.png` |
| P3 (a verdict line) | **PASS** — "Approved — zlema is a pure function in core/indicators.py:31 …" | `6.1-evidence/shots/p3-verdict.png` |
| P4 (a drawer's round row) | **PASS** — "113,198 in / 2,940 out · on your Claude subscription", no $0.0000 | `6.1-evidence/shots/p4-round-row.png` |
| P5 (the Ask's answer renders markdown) | **PASS** — strong 9 · li 9 · code 30, no `**` outside code (the in-take line of 6.1-evidence said FAIL: its heuristic counted a glob's `**` inside a code span; fixed, and 6.1-p5 replays that exact answer with no spend) | `6.1-p5/shots/p5-answer-whole.png`, `p5-ask-replay.png` |
| S4 (the Ask on Claude) | **PASS** — `--restricted --safe-mode` | `6.1-evidence/shots/p5-ask.png` |
| P6 (the resume confirm) | **PASS** — runs again: "Engineer · round 1 / Tests pass — Tvashtr runs the tests / Reviewer · round 1, and round 2 if it asks for more / Secret scan — Tvashtr checks it / No edits to servers/ — Tvashtr checks it / Ship, if the checks pass" | `4.2-p6/shots/p6-confirm.png` |
| 2.5 (same-model advisory) | **PASS** — "Reviewer and Engineer both run anthropic/claude-sonnet-5 …" → `anthropic/claude-opus-5-5`: cleared | `2.5/shots/same-model-hint.png`, `chosen-model.png` |
| 2.7 L1/D8 | **PASS** — 0.0 s: "On v1 · on your Claude subscription"; "1 of 1 passed" | `2.7/shots/running.png`, `tested.png` |
| S4 (2.7's replay on Claude) | **PASS** — `--restricted --safe-mode` | `2.7/shots/tested.png` |
| S4 (every Claude job's lock line) | **PASS** — `smoke.mjs s4` on all 12 runs; this sitting's 8: 0 Grok · 29 Claude jobs, each with its lock line and `--restricted`; the seed run's Reviewer: "--model claude-opus-5-5 --restricted --safe-mode; lock line present" | `6.1-s4/shots/reviewer-raw-log-drawer.png` |

### Bends from the storyboard (second sitting)

- **K8's continuity break** (above): the Reviewer's model changes between chapter 5 and chapter 6.
- **2.5 ends on a warning, not a clean pick:** the advisory clears on Opus, and in its place the
  custom ID shows "No provider matches anthropic/claude-opus-5-5. On this Mac it runs on your Claude
  subscription; it will fail at run time if the name is wrong." (true — Opus isn't a preset; the probe
  and the seed run prove the name).
- **6.1's round test fails for real** ("3 of 4 passed"): replayed on round 1's inputs, the Opus
  Reviewer asked for test output — a test replay doesn't carry the Tests check's result. Kept (G1);
  6.2's v2 adds the line and reads 4 of 4.
- **The P-items are shown in evidence takes** where the film's own take doesn't reach them:
  `6.1-evidence` (P2–P5, the one Ask), `6.1-p5` (P5 whole, no spend), `4.2-p6` (P6 on a stopped run),
  `6.1-s4` (S4's lock line). Their titles say "not for the film"; previews leave them out.
- **3.5's sample follows the film team:** `fixtures/base.mjs` picks the film team's graph by name (the
  capture now passes chapter 6's canvas too) and the sample's `ran_on` is Claude plus the DeepSeek key
  (it read "Claude and Grok").
- **0.1 is filmed on PR #57** (the hero's) with the operator's GitHub session, deleted after (never
  opened).

### Product notes seen on camera (for the architect; no product code in Part B)

- A test replay doesn't carry the Tests check's result, so a Reviewer test can fail on "no test result
  was supplied" (6.1's round test).
- The Now bar's chips still name checks by kind ("Secret leak scan", "Diff touches forbidden paths")
  — P1 fixed the canvas cards only (3.5, 6.1).
- The run drawer's lower area is short under the Activity panel: an Ask's answer and the Raw log sit
  below its fold, and Raw log rows are cut to a few characters (the full line is the row's title).
- "1 library tool(s) — tools aren't used by Desktop subscription agents yet" shows on every run.
- "$0.00 in all" on compare and set results is the key-spend total (by design), beside cards that
  name the subscription.
- Import's "things to fix" card lists "Add a key for anthropic" twice (one per Claude model) on an
  account without the Desktop (7.2).

### What V3 needs (second sitting)

- **6.1** (28.5 s), **6.2** (60.9 s), **6.3** (35.4 s), **6.3-set** (72.1 s): keep; chapter 6 now
  reads v1 → v2 → "v2 did better" on the Opus Reviewer.
- **2.4** (66.9 s), **2.5** (49.8 s; caption or trim the custom-ID warning), **2.6** (31.7 s), **2.7**
  (56.1 s): keep; 2.1–2.3 stay V1's.
- **3.5** (20.5 s, sample): keep. **7.1** (27.7 s) and **7.2** (33.6 s): keep. **0.1** (12.7 s): keep.
- Still V1-only: 1.3–1.5, 2.1–2.3, 8.1; MAC and MOTION scenes are the operator's.
- Review files: `video/out/v2b/contact-sheet.png` (40 takes: 28 V2b, 12 V1) and
  `ch2-preview.mp4` 250.0 s · `ch3` 272.3 s · `ch4` 339.0 s · `ch5` 29.5 s · `ch6` 197.0 s · `ch7` 61.2 s.

## V2b (2026-10-14): the re-film with the Tests check — stopped at a Grok usage cap

Brief `prompts/m-desk-7-v2b.md` Part B, on `video/v2b-refilm` (from `feat/m-desk-7` 71ca1078: S4 locks
every Grok job to its copy, F1 names the check "Tests pass", F2 keeps the running toolbar on one row).
`video/stack/reset` first (a clean `tvashtr_film`: run #1 is the hero), Claude and Grok **Connected**
(`takes/v2b/1.2-dry/shots/engines-connected.png`), `apiKeySource: none` on every Claude job that spoke,
`READING_KEY = none`. **K1:** the film team runs Engineer → **Tests pass** → Reviewer; a failed check
goes back to the Engineer (limit 3); the Fixer feeds Tests pass; the group "Review loop" holds all
three (`story.json` "tests": `pip install -q -e '.[dev]' 'mcp<2' -e servers/kline_cache && python -m
pytest -q tests`).

Sittings 1 (chapter 3) and 2 (chapter 4) and most of 3 (5.1, 5.1-recent, 6.1, 6.2) are filmed. During
6.1 the operator's Grok plan hit its limit: **every Grok test replay since 09:52 UTC answered "You've
reached your free Grok Build usage limit for now … try again later"** (no reset time shown). V2b stops
there (NEEDS_HUMAN), before 6.3 and the chapter 2/7 re-takes.

### The real runs (ledger `video/out/v2b/budget.json`: runs 4 of 14 · test replays 8 of 12 · Asks 1 of 2)

| run | # | scene | task | what happened | length | PR |
|---|---|---|---|---|---|---|
| `b98f6fcc` | 1 | 3.1 hero (recorded) | Add a Hull moving average indicator — trade_mcp, `main`, scope `core/`, budget $5.00 | PM → spec gate (one line added, approved on camera) → Engineer → **Tests failed — back to Engineer with the last 12 lines** → Engineer round 2 → **Tests passed · 665 passed, 16 deselected, 3 warnings in 1.68s** → Grok Reviewer **approved round 1**, citing "Tvashtr pytest reported 665 passed…" → Secret scan → No edits to servers/ → Ship; no Escalation | "Done in 10m 21s" (unchanged after "Saved 6 new memories") | [#57](https://github.com/lazyxgenius/trade_mcp/pull/57) |
| `51d784d3` | 2 | 4.1 | Add a TRIX indicator | stack QUIET=20 STALLED=60 FAIL=180; spec gate approved → the Engineer's Claude CLI paused at its start (SIGSTOP, the Desktop's own process tree, only Claude's `stream-json`) → Quiet → Stalled → Failed | "Failed after 4m 52s · on your Claude subscription" | — |
| `3da31f1c` | 3 | 4.2 | resume of run #2 from Engineer, round 1 — opened from **Home's Needs you** | stack back to normal timers; spec v2 + approval kept ("Skips 1 min of finished work") → Engineer → Tests failed → Engineer → Tests passed · 664 → Reviewer approved → Ship | "Done in 7m 4s" | [#58](https://github.com/lazyxgenius/trade_mcp/pull/58) |
| `f7d6c632` | 4 | 5.1 | Add a DEMA indicator, from run #1 ("brought spec v2, 1 decision and 1 memory"), from the hero's PR branch | PM → PRD gate approved on camera → Engineer → Tests failed → Engineer → Tests passed · 669 → Reviewer approved → Ship; PR #59's base is `tvashtr/b98f6fcc-…` | "Done in 7m 9s" | [#59](https://github.com/lazyxgenius/trade_mcp/pull/59) |

Test replays: 6.1 "Run all 4" on v1 (the round-1 test + 3 CSV tests) and 6.2 "Save and run tests" on v2
(4) — all 8 ran under their own Grok profiles and **all 8 failed on the usage limit** ("It didn't
finish: … free Grok Build usage limit"), so both versions read 0 of 4. The one Ask (3.7, Grok):
"Tvashtr's tests failed on the first build. What did you check once they passed?" → "Once the run
reported **665 passed** the reviewer did not…" (K4: the question follows what really happened).

### The live smoke (V2b) — every line with its screenshot (opened)

| check | result | screenshot |
|---|---|---|
| Hero Tests check (T1): "Running the tests…" then "Tests failed — back to Engineer with the last 12 lines" / "Tests passed · …" | **PASS** — failed (12 lines shown on camera) → passed · 665 passed | `takes/v2b/3.1/shots/tests-1-running.png`, `tests-2-failed.png`, `tests-4-passed.png` |
| Hero T2: the failed lines reach the Engineer's next round; the Reviewer cites Tvashtr's result; no verdict asks for command or test output | **PASS** — 1 failed check, its lines in the Engineer's round 2 (`revision`); the Reviewer was given `check_result` and wrote "Tvashtr pytest reported 665 passed, 16 deselected, 3 warnings"; no ask for output | `takes/v2b/3.1/shots/reviewer-verdict.png` |
| Hero S2: the Done line keeps its time after the post-ship memory save | **PASS** — "Done in 10m 21s · on your Claude and Grok subscriptions" before and after "Saved 6 new memories" | `takes/v2b/3.1/shots/done-after-memories.png` |
| Hero S1 + F2 at 1440×900 | **PASS** — running toolbar 56 px with the Engineer and with the Reviewer working, run card inside the bar and clear; the Done summary keeps "total time" | `takes/v2b/3.1/shots/running.png`, `running-reviewer.png`, `done.png` |
| F1: the check never reads "Approve before continuing?" | **PASS** — canvas card "Tests pass" (`takes/v2b/3.1-dry/shots/canvas.png`), run view card (`3.1/shots/done.png`), Activity label "Tests pass" | as listed |
| S4: every Grok job's lock line + its own `--sandbox tvashtr-j<hex>`; every Claude job's lock line + `--restricted`; no file opened outside the copy | **PASS** — runs #1–#4: 3 Grok + 10 Claude jobs (`node video/camera/smoke.mjs s4`); Grok folders under `…/T/tvg-0484c6/j…`; the Ask (`tvashtr-j47f6e1`) and all 8 test replays ran under their own profiles | `takes/v2b/s4-rawlog/shots/reviewer-lock-line.png`, `engineer-lock-line.png`, `3.7/shots/ask.png`, `6.1/shots/results.png`, `6.2/shots/tested.png` |
| L1/H1: the subscriptions wording from launch to Done | **PASS** — 0 of 1525 recorded responses with "$0.00 +"/"$0.0000" or a Desktop read saying not all on subscriptions; Done line "· on your Claude and Grok subscriptions" | `takes/v2b/3.1/shots/done.png` |
| L2: no verdict names Tvashtr's own files | **PASS** | `takes/v2b/3.1/shots/reviewer-verdict.png` |
| L3: Changes after Done = the PR's "Files changed" | **PASS** — `core/indicators.py` +22, `tests/test_indicators.py` +35 −3, `web/lib/engine-facts.ts` +1 −1 = PR #57 | `takes/v2b/3.7/shots/changes.png` |
| 4.1 H1/H2 | **PASS** — "Failed after 4m 52s · on your Claude subscription"; "Next: resume from Engineer, round 1. Tvashtr skips the work that is done…" | `takes/v2b/4.1/shots/failed.png` |
| 4.2 opens from Needs you; H2 confirm; no dollar per step | **PASS** — "Run failed · Add a TRIX indicator · Resume"; "This starts run #3. It picks up where run #2 stopped." "Skips 1 min of finished work. Only the steps that run again use your Claude subscription." | `takes/v2b/4.2/shots/needs-you.png`, `confirm.png`, `picker.png` |
| 6.1 L1/D8: a running test's line names its subscription from its first second | **PASS** — "Running 1 of 4 · 0s — On v1 · on your Grok subscription", 0.9 s after the click (take.json: click 26.6 s, shot 27.5 s; the in-take line printed FAIL because it timed from the cursor's glide — fixed 36f32863) | `takes/v2b/6.1/shots/running.png` |
| 6.2 L1/D8 | **PASS** — at the click the app's Tests read already said `ran_on {"subscriptions":["grok"],"all":true}` | `takes/v2b/6.2/shots/testing.png` |
| 6.3 H4, H5, H1 | **NOT RUN** — 6.3 not filmed (usage cap) | — |
| 2.7 L1/D8 | **NOT RUN** — chapter 2 not re-taken (filmed last; usage cap) | — |

### Bends from the storyboard (V2b)

- **A Grok usage cap stopped the session** (above). 6.1's and 6.2's footage shows the real outcome
  (G1): "0 of 4 passed" with the usage-limit error on every row; 6.2's History pills read 0/4 for v1
  and v2. Their non-test beats (Make this a test, the CSV, Save as v2, History, What changed in v2)
  are filmed as intended.
- **The Tests check is round 1's story now:** every run's first build failed the check (the
  indicator count pinned in the tests), went back to the Engineer with the last 12 lines, passed, and
  the Grok Reviewer approved round 1 — no Escalation in V2b (V2's runs all escalated).
- **4.2 opens from Home's Needs you** (K3, lost in V2), on the normal-timer stack: the stack was put
  back to normal *before* 4.2 so a quiet Grok Reviewer can't fail the resumed run at FAIL=180.
- **3.5 moved to the last sitting:** re-capturing its sample base (`fixtures/capture-live.mjs`)
  rebuilds the film team by name, which would retire the hero team chapters 3–6 work on.
- **0.1 is blocked:** `video/out/github-session.json` was deleted after V2's 0.1 (G8); the operator
  signs in again with `node video/camera/github-login.mjs` before a re-take.
- **The operator's installed Tvashtr.app was open** (idle, not signed in to this stack — no runner
  polled the film account): `take.mjs` gained `VIDEO_OTHER_DESKTOP_OK=<pid>`; it was never touched.
- **S4 screenshots come from an evidence take** (`takes/v2b/s4-rawlog`, no spend): the record take's
  Raw log sat below the short drawer's fold; the evidence take wraps the feed rows (a style injected
  into that take only) so the lock lines read whole.
- **V2's hero recording** moved to `video/recordings/hero-v2` (3.1 records to `hero`).

### Product notes seen on camera (for the architect; no product code in Part B)

- The Activity verdict line drops a `reasons` **string** (the Reviewer wrote one): "Approved" shows
  without its reasons, though `REVIEW_VERDICT.json` cites Tvashtr's pytest.
- The guardrail cards read their raw kinds (`secret_leak_scan`, `diff_touches_forbidden_paths`):
  `gateLabel` names only PRD approval, Escalation and Tests pass.
- Both loop arcs (Tests pass → Engineer, Reviewer → Engineer) read "changes requested".
- The resume confirm lists "Tests pass, when you approve" (the check needs no approval) and "use your
  Claude subscription" though the Grok Reviewer runs again.
- The Reviewer drawer's round row reads "$0.0000" (3.7's "cost per round"); the Ask's answer shows raw
  `**markdown**`; "1 library tool(s) — tools aren't used by Desktop subscription agents yet" shows on
  every run.

### Still owed (V2b → after the Grok limit resets)

All filmed in the second sitting (above): the Reviewer moved to Claude (K8), so no Grok job was needed.

| scene | real work | note |
|---|---|---|
| 6.1 / 6.2 test results | "Run again" on v1 and v2: 4 + 4 test replays | the budget has **4** left (8 of 12 spent on the capped replays) — the architect decides |
| 6.3 + 6.3-set | 2 + 4 runs (budget left 10) | hidden checks proven in the sandbox image (127 passed on `main`, exit 0; the indicator greps exit 1 until an agent adds them) |
| 3.5 | none (sample) | after 6.3: `take.mjs video/fixtures/capture-live.mjs`, `node video/fixtures/export-live.mjs`, then `take.mjs 3.5` |
| 2.4, 2.5, 2.6, 2.7, 7.1, 7.2 | 2.7: 1 test replay | last (they rebuild teams by name) |
| 0.1 | none | needs the operator's GitHub session; delete it after (G8) |
| review files | none | contact sheet + ch2–ch7 previews again at the end |

### What V3 needs (per filmed scene)

- **3.1** (record, 657.2 s): keep; V4 uses its first minute. **3.2** 15.8 s, **3.3** 22.4 s, **3.4**
  22 s (Tests failed → its lines opened), **3.4-verdict** 30.1 s, **3.6** 24.1 s: keep; re-takes are
  free from `recordings/hero`.
- **3.7** (77.4 s, 1 Ask): keep; caption "cost per round $0.0000" (product) or crop it.
- **4.1** (319.2 s) and **4.2** (19.9 s on camera): keep — 4.2 now opens on Needs you.
- **5.1** (22.6 s) and **5.1-recent** (6.9 s): keep.
- **6.1** (29 s) and **6.2** (60.6 s): re-take their results after the limit resets (or V4 cuts at
  "Running 1 of 4").
- **6.3**, **3.5**, **0.1**, chapters **2** and **7**: owed (above).

## V2 (2026-10-11): the real runs — wrapped up after chapter 5

Brief `prompts/m-desk-5-v2.md` Part B, on `video/v2-runs`, after Part A (M-desk-5) fixed L1–L4.
`video/stack/reset` first (a clean `tvashtr_film`), Claude and Grok **Connected** on the Desktop, the
Claude CLI log `apiKeySource: none` on every job, `READING_KEY = none`. Sittings 1 (chapter 3 + 0.1)
and 2 (chapter 4) are done; sitting 3 stopped after 5.1 on the operator's request: **6.1, 6.2, 6.3
and the 2.7 re-take are still owed** (and with them the 6.1/6.2 and 6.3 smoke checks and the
ch5/ch6 previews).

### The real runs (ledger `video/out/v2/budget.json`: runs 6 of 12 · test replays 0 of 12 · Asks 1 of 2)

Run numbers are the app's (the account's runs in order). Times per job are the Desktop runner's
claim → finish; a run's length is the app's own where it showed one.

| run | # | scene | task | what happened | length | PR |
|---|---|---|---|---|---|---|
| `86bff6c6` | 1 | 3.1 hero (recorded) | Add a Hull moving average indicator — trade_mcp, `main`, scope `core/`, budget $5.00 | PM 1.5 min → spec gate (one line added, approved on camera) → Engineer 2.0 → Grok Reviewer 5.5 (changes requested: the indicator registry) → Engineer 3.5 → Reviewer 12.0 → Engineer 3.2 → Reviewer 9.0 → Escalation approved on camera → Ship | "Done in 37m 16s" (37m 36s later: see bends) | [#53](https://github.com/lazyxgenius/trade_mcp/pull/53) |
| `e0078405` | 2 | 4.1, take 1 | Add a TRIX indicator | the camera found no job CLI to pause (a camera bug, fixed) → **cancelled through the app**; its Engineer had already edited `core/indicators.py` +1 | — | — |
| `99115ced` | 3 | 4.1 | Add a TRIX indicator | PM 0.6 → spec gate approved → Engineer's CLI paused at its start (SIGSTOP, the Desktop's own process tree) → Quiet → Stalled → Failed | "Failed after 4m 17s" | — |
| `77b1547e` | 4 | 4.2, take 1 | resume of run #3 | camera slip: the scene clicked the first "Resume from here" (the PM's) → nothing kept → **cancelled through the app**; run #3 now reads "Picked up again as run #4" | — | — |
| `828210b9` | 5 | 4.2 | resume of run #2 from Engineer, round 1 | spec v2 + approval kept ("Skips 1 min of finished work") → Engineer 2.7 → Reviewer 8.7 → Engineer 2.3 → Reviewer 9.8 → Engineer 2.2 → Reviewer 8.5 → Escalation approved on camera → Ship | ≈34.6 min | [#54](https://github.com/lazyxgenius/trade_mcp/pull/54) |
| `95a2d956` | 6 | 5.1 | Add a DEMA indicator, started from run #1 (spec, decisions, memories, summaries carried; from the PR branch `tvashtr/86bff6c6-…`) | PM 1.3 (this run's spec v1) → PRD gate approved on camera → Engineer 2.3 → Reviewer 7.4 → Engineer 2.2 → Reviewer 10.0 → Engineer 2.1 → Reviewer 7.3 → Escalation approved on camera → Ship | ≈33.2 min | [#55](https://github.com/lazyxgenius/trade_mcp/pull/55) |

The one Ask (3.7, the Reviewer on Grok): "Why did you reject round 1?" → answered in ≈20 s (Grok job
0.2 min): round 1 was `changes_requested` because adding `hma` grows `INDICATORS` from 28 to 29 (the
registry count the tests pin).

### The live smoke (M-desk-4 + M-desk-5)

| check | result | screenshot |
|---|---|---|
| 3.6 / hero (L1, H1): chip, banner, Done summary, Activity's last line name the subscriptions | **PASS** — "on your Claude and Grok subscriptions" everywhere; "Done in 37m 16s · on your Claude and Grok subscriptions"; no "$0.00 +", no "$0.0000" | `video/takes/v2/3.1/shots/done.png` (+ `running.png`, 3.6's `poster.png`) |
| hero (L2): no verdict names `REPORT.md`, `REVIEW_VERDICT.json`, `SPEC.md`, `TVASHTR_REMEMBER.jsonl` | **PASS** — 0 of 3 verdicts; the Grok jobs carried only `REVIEW_VERDICT.json` home | `video/takes/v2/3.1/shots/reviewer-verdict.png` |
| 3.7 (L3): after Done, Changes lists the PR's "Files changed" | **PASS** — 3 of 3: `core/indicators.py` +21, `tests/test_indicators.py` +13 −2, `web/lib/engine-facts.ts` +1 −1 (= `gh api …/pulls/53/files`; the app's `/api/runs/<id>/diff` gave the same 3); the run's workspace is gone | `video/takes/v2/3.7/shots/changes-list.png` — the same run view in headless Chromium (the website surface, same `/diff` answer) with the list scrolled into view; the Desktop take's `changes.png` shows only the first row above the drawer's fold |
| hero (L4): no "repo produced no skills" line | **PASS** — the only banner is the by-design "1 library tool(s) — tools aren't used by Desktop subscription agents yet"; `mcp-builder` was in all 3 Engineer jobs | `video/takes/v2/3.1/shots/running.png` |
| 4.1 (H1, H2): failure line "· on your Claude subscription"; "Next: resume from …" says Tvashtr skips done work | **PASS** — "Failed after 4m 17s · on your Claude subscription"; "Next: resume from Engineer, round 1. Tvashtr skips the work that is done, so it doesn't run again." | `video/takes/v2/4.1/shots/failed.png` |
| 4.2 (H2): "Skips N min of finished work." + "Only the steps that run again use your Claude subscription."; no dollar per step | **PASS** — both lines, word for word; the picker shows plans, no dollars | `video/takes/v2/4.2/shots/confirm.png`, `picker.png` |
| 6.3 (H4, H5, H1): queued set cell; estimate minutes add up the turns; header/lanes/results/set cards name the subscriptions | **NOT RUN** (owed with 6.3) | — |
| 6.1/6.2 (L1, D8): a running test's line names its subscription from its first second | **NOT RUN** (owed with 6.1/6.2; the scenes now shoot `running`/`testing` for it) | — |

### Decisions G1–G9, as filmed

- **G1** real numbers and bends: this section and the scene notes below.
- **G2** real versions: `story.json` says v1 → v2 and V1's v7/v8 sample (`fixtures/history.mjs`) is
  retired; the film team is still at **v1** — 6.2 (which saves v2) and 6.3 (which compares them) are
  owed.
- **G3** `READING_KEY = none`: the hero team has no Query domain step; 1.5 stays SAMPLE; **2.3 is for
  V4: "an example step — cut or caption".**
- **G4** no team-instruction workarounds: the Reviewer's instructions are chapter 2's; `mcp-builder`
  stays on the Engineer.
- **G5** the record take (3.1) opened the spec gate's spec, the Engineer's drawer while it worked,
  the Reviewer's drawer and Changes — 3.2/3.3/3.4/3.6 replayed without an unanswered request.
- **G6** the notifications ask is asked **once per account** (`notify_asked`): 3.1 answered "Not
  now" on camera (22.8 s), so 4.1 never sees it. MAC-3 stays the operator's.
- **G7** AI checks: the stack's settings have no checks key (read as a boolean only, never printed),
  so the server's `ai_status` reports AI checks unavailable. The probe *through the app* (6.1 reads
  its Tests answer first) has **not run** — 6.1 is owed; when it runs and AI checks are unavailable,
  6.1 films those moments from sample data listed in take.json `sample`.
- **G8** 0.1 filmed on PR #53 with the operator's GitHub session; then
  `video/out/github-session.json` was **deleted** (never opened).
- **G9** the Engines "N to fix" badge counts team × surface pairs that can't run (Claude/Grok teams
  on the website, which has no keys for them) — by design, not hidden.

### Bends from the storyboard (V2)

- **Every Desktop run ends at the Escalation gate.** The Grok Reviewer has no shell on the Desktop
  (file tools only), so it can't run `pytest`/`git diff`: round 1 is a real review, rounds 2–3 ask
  for test output it can't get. All three shipped runs (#1, #5, #6) took 3 rounds and were approved
  on camera ("ship the last build as-is"). The storyboard's "round 1 back, round 2 approved" (3.4)
  is round 1 back, rounds 2–3 back, Escalation.
- **The Done line rewrites itself:** the hero read "Done in 37m 16s" at Done and "Done in 37m 36s"
  after the post-ship memory save ("Saved 8 new memories from this run", 20 s later). 3.6 shows the
  first, 3.7 the second.
- **4.2 resumes run #2, not 4.1's run #3.** A camera slip resumed #3 from the PM (run #4,
  cancelled); the product then counts #3 as picked up. Run #2 (the same TRIX task, stopped while its
  Engineer worked) is resumed from its own run view's callout — Needs you lists failed runs, not
  stopped ones — so 4.2 opens on "You stopped this run at Engineer, round 1", not on Home's Needs you.
  The confirm reads "This starts run #5. It picks up where run #2 stopped."
- **5.1's PM writes a new spec** (the run's spec v1) even with "The final spec" carried, and the
  PRD gate asks again (approved on camera); the Now bar reads "From run #1".
- **The Reviewer's own files show in Activity:** "Edited REVIEW_VERDICT.json", "Edited REPORT.md"
  (its sidecars) — the verdicts no longer mention them (L2), the Activity still lists the edits.
- **3.7's Memory beat is on the Engineer's drawer:** the hero's 8 new memories wait for review (5 the
  Engineer's, 3 with no source agent); the Reviewer learned none.
- **Off-camera cuts:** 4.2 waits 2064 s off camera (the resumed run), 5.1 waits 81 s + 1893 s (each a
  jump cut marked "back on camera" with `off_s` in take.json); the Desktop stays open throughout.
- **Layout seen on every run view at 1440×900** (product, not camera): the run card under the
  toolbar overlaps the toolbar row ("Opened PR" clipped), and the Done summary clips "total time" and
  wraps "on your Claude and Grok subscriptions" onto two lines.

### Still owed (V2 → next sitting)

| scene | real work | note |
|---|---|---|
| 6.1 | 4 test replays (1 round test + 3 CSV) on Grok | AI checks from sample data (G7); smoke L1/D8 (`shots/running`) |
| 6.2 | 4 test replays ("Save and run tests") | saves **v2** (G2); smoke L1/D8 (`shots/testing`) |
| 6.3 | 6 runs (one task × 2 versions + "Indicators" 2 tasks × 2 versions) | after 6.2; smoke H4/H5/H1; 2–3 h unattended |
| 2.7 re-take | 1 test replay | the test line's subscription from its first second (L1); builds its own team — film it last |
| ch5/ch6 previews | none | after 6.x |

Budget left for them: 6 runs, 12 test replays, 1 Ask — exactly 6.3's six runs; no retry room.

### What V3 needs (per filmed scene)

- **0.1** (12.7 s, PR #53): fine as is; a fresh GitHub session is needed for any re-take (the file
  was deleted).
- **3.1** (record, 2281 s): V4 uses only its first minute; the hero can stay.
- **3.2–3.6** (replays 15.8 / 22 / 29.8 / 25.6 s): re-takes are free; 3.4 must narrate three
  rounds + Escalation (or V3 decides on a Reviewer that can run tests on the Desktop — a product
  decision, not a camera one).
- **3.7** (52.6 s, 1 Ask): the Changes list sits below the drawer's fold — scroll it into view
  before the shot (`changes-list.png` was taken separately for the smoke).
- **4.1** (282.4 s): keep; the Quiet/Stalled/Failed holds can be trimmed in V4.
- **4.2** (24.7 s on camera): the "Needs you" opening is lost (see bends); a clean re-take needs a
  fresh 4.1 failure (1 run) plus the resume (1 run) in one sitting.
- **5.1** (26.5 s) + **5.1-recent** (7 s): keep.
- Captions for V4: the Escalation approvals, the Done-line rewrite, the run card overlap.

## Scene by scene: how it is filmed, and what doesn't match the story

Modes: LIVE (the real Desktop on tvashtr_film) · SAMPLE (fixtures in the real Desktop) · WEB
(Chromium) · RUN (scripted; spends in V2, rehearsed `--dry` in V1) · REPLAY (a recording of a real
run) · MAC (the operator, Recordly) · MOTION (V5). "Pre-wired" = built off camera through the app's
API before the take, because filming it reliably isn't possible (named per scene).

**0.1 PR on GitHub** — RUN/WEB, `scenes/0.1.mjs`. trade_mcp is **private**: the PR page needs the
operator's GitHub session (`node video/camera/github-login.mjs` once; saved to the ignored
`video/out/github-session.json`). Until then the take stops with "BLOCKED". The V1 proof PR is
https://github.com/lazyxgenius/trade_mcp/pull/51. **V2:** filmed on the hero PR #53 (12.7 s), then
`video/out/github-session.json` was deleted (G8) — a re-take needs a new session.
**0.2 title** — MOTION (V5).
**1.1 Sign in with GitHub; install the App** — MAC (below): the Desktop's sign-in opens the system
browser, which the camera can't film.
**1.2 Engines** — LIVE. Overview → Subscriptions (Claude and Grok **Connected**) → API keys (the one
key, DeepSeek, shown `•••• <last4>`). The Terminal sign-in is MAC-2. "A backup model" is per agent
(Advanced → Backup model), filmed in 2.5 on the Engineer. Seen once: the Desktop's launch probe
read Grok as "Needs login" while `grok models` answered in 1 s — the pre-roll now uses the app's own
Refresh (never a Terminal sign-in) and stops NEEDS_HUMAN if still not Connected. The Engines nav's
"N to fix" badge (team × surface pairs that can't run: Claude/Grok teams on the website) is by
design (G9) and stays on screen.
**1.3 Toolkit** — LIVE. Web fetch (Browse → Add), a secret by name `EXCHANGE_API_KEY` (a placeholder
value, deleted after the take), and `mcp-builder` imported from `anthropics/skills` (the only public
skills repo checked; trade_mcp is an MCP server). The dialog finds 19 skills; the take keeps only
mcp-builder. **Product finding:** in a run, that library skill fails to load — the run view's banner
reads "repo produced no skills (… filter='mcp-builder')" (proof run 610661d5). **Fixed by M-desk-5
L4:** in V2's hero run `mcp-builder` loaded into all three Engineer jobs and no such line appeared.
**1.4 Connectors: Linear** — SAMPLE (`fixtures/connectors.mjs`). No Linear account: the browser half
never happens (window.open / shell.openExternal stubbed in the take), the connection turns
connected on the 3rd poll; the tool list is a guess at Linear's MCP tools (not on screen).
**1.5 Domains** — SAMPLE (`fixtures/domains.mjs`, three tiny real PDFs). The sample adds a Hugging
Face reading key the film account doesn't have; the answer text, latency and passages are sample
content; the answer model shows as "deepseek deepseek-chat" (the server's label). Operator item: an
embeddings key (HF or OpenAI) to film it live.
**2.1 New team from a template** — LIVE. New team → "PM → Engineer ⇄ Reviewer" → name → Create team.
**2.2 PM's instructions; Edits allowed off** — LIVE. One line typed into the PM's instructions;
"Edits allowed off" is the PM's **locked** Read-only (the entry agent can't edit files, so it can't
be switched on camera); Save.
**2.3 A Query domain feeding the PM** — LIVE, via Domains › Exchange API docs › Use in teams › "Add
as a step in a team". **Mismatch:** a Query domain can't come *before* the PM (the first node must
be a thinker: `root_not_thinker`), so it sits PM → Query domain → PRD gate and feeds the spec the
Engineer and Reviewer read. The domain has no files and no embeddings key on the film account:
**a run through this step would fail**. **V2 (G3, `READING_KEY = none`):** the hero team has no
domain step; 2.3 is marked for V4 — "an example step — cut or caption".
**2.4 Spec gate; Engineer tools and skills; Reviewer loop; guardrail; Ship and Stop** — LIVE. The
gate card reads **"PRD approval"**, not "Spec approval". The guardrail is **two gates** (a gate has
one check): their cards read the raw kinds `secret_leak_scan` and `diff_touches_forbidden_paths`,
and the path is the glob `servers/**`. Pre-wired: the two gates (plain approval gates, wired
Reviewer → gate → gate → Ship / Stop); their checks are set on camera. The Engineer's Skills & tools
tab notes that tools aren't used on a Claude-subscription run (skills are added to its
instructions). "Up to 3 rounds" is visible only on the group frame (2.7); the loop arc reads
"changes requested".
**2.5 A model per agent** — LIVE. Engineer and PM → claude-sonnet-5; the Engineer's backup model
DeepSeek (the Desktop notes Claude runs use the subscription and don't switch to it); Reviewer →
claude-sonnet-5 → the same-model hint ("Reviewer and Engineer both run …") → grok-4.7 (V1–V2b first
sitting); since K8 → a custom model ID, `anthropic/claude-opus-5-5` (the hint clears).
**2.6 Remember; budget; failure path → Fixer** — LIVE. The label is **"Remember what it learns"**
(not "I learn"). There is **no budget control on the canvas**: the $5.00 is the composer's "Budget
for this run" (3.1's Run options; the server default). Pre-wired: an unconfigured new agent between
the Engineer and the Reviewer (a downstream "+" lands it on top of the Reviewer, and the Fixer → Reviewer
edge needs a drag); on camera it is renamed Fixer, given the Engineer template and DeepSeek, and its
path becomes "If it fails or times out". **Story mismatch:** the Fixer never runs for a stalled
Desktop job — the stall sweep fails such a run instead of taking the failure path.
**2.7 Tidy; group the loop; v1; Test this agent** — LIVE. Tidy, select Engineer + Reviewer, Group
"Review loop" (frame: "Engineer ⇄ Reviewer · up to 3 rounds"), the header "v1 · saved just now"
(layout changes aren't versions), then More actions → Test this agent → Tests → Run all 1 — a real
replay of the Reviewer on its Grok subscription (V1's one test; since K8 on its Claude subscription). Before any run the Reviewer has no
rounds, so its test comes from a CSV (setup). Order changed so a `--dry` rehearsal covers all but
the spend.
**3.1 Home composer** — RUN, record "hero" (V2). The task, trade_mcp, Run options: branch main,
Scope `core`, Budget $5.00 → Launch, then the whole hero run is recorded (3.2–3.6 are replays of it).
On a fresh account Desktop Home shows the ready card instead of the composer; the flow handles it.
**3.2 Live run view** — REPLAY of "hero" from the launch (V2); V1: rehearsed on the proof
recording, and the F5 proof is its "proof" (record) and "replay" parts: run 610661d5 recorded live
(1869 s, 74 pair moments), replayed with the Desktop runner signed out (every claim 401). Pairs
(`video/out/v1/pairs-3.2-replay.png`): **53/74 identical; 71/74 identical apart from relative ages
("1 s ago" vs "3 s ago"); 3/74 (pairs 4, 19, 43) one Activity poll apart.** The live page and the
replay poll on their own timers, so a replay matches the live take to the poll, not to the second.
**3.3 Gate → Needs you → fix one line → approve** — REPLAY from the gate (V2); rehearsed on proof.
**3.4 Engineer on Claude; Reviewer on Grok; round 1 back, round 2 approved** — REPLAY (V2). "Its own
copy of the repo" has no visible copy (the raw log names "Running on this computer with your own
Claude Code"). Rounds are the real run's: the proof run needed 3 rounds then the escalation gate,
and so did V2's hero (the Grok Reviewer has no shell: rounds 2–3 ask for test output) — 29.8 s replay.
**3.5 Retrying → backup switch** — SAMPLE (`fixtures/retrying.mjs`). **Not reachable live:** a
Desktop subscription job never emits retry/backup events (only the API-key gateway path does), and
the film account has no second provider for a backup. V4 must caption it as an illustration or drop it.
**3.6 Guardrail passes; Ship; PR; Done** — REPLAY (V2). A passing guardrail writes no Activity line
(its card turns Approved).
**3.7 Changes; Ask; cost per round; Memory** — LIVE on the newest finished run (V2: hero; V1
rehearsed on the proof run, stops before the Ask's Send). Memory review mode is switched on in setup
so new memories wait for Keep/Discard. **V2:** 52.6 s on the hero run, one Ask ("Why did you reject
round 1?"); Keep/Discard on the **Engineer's** drawer (the Reviewer learned nothing); the Changes list
sits below the drawer's fold (`shots/changes-list.png`, taken in headless Chromium, shows all three).
**4.1 Quiet → Stalled → Failed** — RUN (V2): stack with `QUIET=20 STALLED=60 FAIL=180`; the
Engineer's CLI is paused through the Desktop's own process tree (SIGSTOP). The Mac notification is
MAC-3. **V2:** 282.4 s, run #3 — Quiet ≈92 s, Stalled ≈131 s, Failed ≈274 s into the take ("Failed
after 4m 17s · on your Claude subscription"). The camera finds the CLI by `--output-format` once the
runner claims the job (Claude reads its prompt on stdin, so its command line has no `runner-jobs/`
path — take 1 failed on that); the notifications ask doesn't come (3.1 answered it).
**4.2 Resume** — RUN (V2). **V2:** 24.7 s on camera (2064 s off camera), run #5 resumed from run
#2 at "Engineer, round 1" via the stopped run's own callout (see "Bends"); PR #54. V1 has no failed run, so its rehearsal only opens
Home's Needs you and stops there. The confirm's sections are "Kept", "Runs again" and a
"Skips N min of finished work" line — there is no "saved" heading ("Safe:" is in the failed callout).
**5.1 Start the next run from this** — RUN (V2) on the hero run: "Add a DEMA indicator", carry
spec/decisions/memories/summaries, Start from the PR branch. Recent tasks exist only in Home's
composer: part `5.1-recent`. **V2:** 26.5 s on camera (81 s + 1893 s off camera), run #6 from the
hero's branch → PR #55; the PM still writes the run's own spec and the PRD gate asks again; 5.1-recent
7 s.
**6.1 Tests** — RUN. Make this a test (round 1, an AI check) → tests from a CSV (the column mapped
on camera) → Run all (a spend: V1's one test went to 2.7). "Check the AI check" opens only from a
failed AI-check result, after Run all.
**6.2 History** — V1: SAMPLE (`fixtures/history.mjs`, v7/v8). **V2 (G2):** rewritten LIVE on the film
team — edit the Reviewer, "N changes since v1", Save as **v2** with "Save and run the Reviewer's 4
tests", History, What changed in v2; the v7/v8 sample is retired. **Not filmed yet (owed).**
**6.3 Compare; task set; Restore** — RUN (V2; compares and task sets spend). The task set
"Indicators" with hidden checks is saved on camera; the compare stops before "Start compare". **V2:**
compares v1 and v2 (after 6.2) on "Add a TEMA indicator", then the set on both versions, each wait
off camera; Restore shows only when the winning version isn't current. **Not filmed yet (owed);
rehearsed in V1 only.**
**7.1 My agents** — LIVE. Save the Reviewer as "Strict Reviewer" → another team ("Bugfix squad") →
Templates → Strict Reviewer → Undo → again → "Based on Strict Reviewer v1".
**7.2 Team file; Import on a second account** — LIVE with `HOSTED=0 video/stack/up` (the email
sign-up exists only on a self-hosted backend; hosted mode offers only GitHub). The panel's lock line
reads **"No secrets or sign-ins inside"**. Account B finishes this Mac's first-run setup the moment
it is created (a camera hook on the sign-up response, not product code); each re-take makes a new
`lazyx.teammate+<n>@tvashtr.local`. The Desktop saves the team file through Electron's own download
(a native Save panel): the camera sets the save path in the main process first. On the imported
team's canvas the "things to fix" card covers the Product manager's card.
**8.1 Home** — SAMPLE (`fixtures/home.mjs`) + part `8.1-web` (WEB, the same Home on the website).
The local-folder run ("Branch tvashtr/…") is sample data; **product layout bug:** a long branch name
squeezes that Recent runs row (the idea disappears). The composer placeholder still says "Add an RSI
indicator with tests" (product copy).
**8.2 end card** — MOTION (V5).

### Across the film

- **Money on subscriptions:** the live proof run's toolbar read "$0.00 + your Claude and Grok
  subscriptions" (the mixed wording) with no API-key work in it. **V2 (M-desk-5 L1):** "on your
  Claude and Grok subscriptions" from launch to Done.
- **Escalation:** in the proof run the Grok Reviewer asked three rounds running for the agents'
  scratch files (`REPORT.md`, `TVASHTR_REMEMBER…`) to be removed; the run parked at the Escalation
  gate, which V1 approved through the app's API ("ship the last build as-is") so the recording could
  end — PR #51 carries those files. **V2 (M-desk-5 L2):** no verdict names those files any more;
  the runs still escalate, now because the Grok Reviewer can't run tests (no shell).
- **Local paths on screen:** an Activity line shows the Desktop job's temp path
  (`…/runner-jobs/<id>/prompt.txt`).
- **2.4's first take configured the wrong gate** ("approval" matched "PRD approval"); gates are found
  by node id now, and 2.4 was re-filmed.
- **Team names:** each scene rebuilds "Indicator sprint team"; a same-named team that already has
  runs is renamed "… (earlier)" (deleting would delete its runs). For V2's clean account,
  `video/stack/reset` first.


## Before V2 (measured in V1)

V1's measurements and plan, kept as written; what V2 did with each item is in "V2" above (1 → G3,
2 → L4, 3 → L2, 4 → G2, 5 → G8, 7 → G5, 8 → done).

**What a real run costs on the subscriptions** — the F5 proof run (one README line, the full film
team without the domain step): PM spec 0.6 min · Engineer round 1 0.2 min · Grok Reviewer 6.5 min ·
Engineer round 2 2.8 min · Reviewer 4.4 min · Engineer round 3 3.0 min · Reviewer 7.2 min · (the
Escalation gate, then Ship) — **30m 42s** to PR #51. The Grok Reviewer is the slow seat (4–7 min a
round); every one of its three rejections was about the agents' scratch files, not the change.

**Real work per scene in V2** (V1 measured what it could; the rest is estimated from the proof run):

| scene | real work | expected time |
|---|---|---|
| 3.1 (records the hero run; 3.2–3.6 are replays of it) | 1 run: "Add a Hull moving average indicator" | 30–45 min (2–3 rounds) |
| 3.7 | 1 Ask (the Reviewer, Grok) | 1–3 min |
| 0.1 | none (the hero PR's page; operator GitHub session) | — |
| 4.1 | 1 run: "Add a TRIX indicator", Engineer paused (stack with QUIET=20 STALLED=60 FAIL=180) | ~6 min to Failed |
| 4.2 | 1 run: the resume of 4.1 | 20–35 min |
| 5.1 | 1 run: "Add a DEMA indicator" from the hero run | 30–45 min |
| 6.1 | the Reviewer's tests (a round test + 3 CSV tests) on Grok | ~8 min |
| 6.2 save | "Save and run tests" (4 tests) on Grok | ~8 min |
| 6.3 | Compare v7/v8 on one task (2 runs) + the "Indicators" set (2 tasks × 2 versions = 4 runs), lanes taking turns on the subscriptions | 2–3 h |
| 2.7 (re-take only) | 1 test replay (V1 used it: passed) | ~2 min |

**Suggested sittings:** (1) `video/stack/reset`, then 3.1 → 3.2/3.3/3.4/3.6 replays → 3.7 → 0.1
(≈1 h 15 min, one run); (2) stack with the stall knobs: 4.1 → 4.2 (+ MAC-3) (≈45 min, two runs);
(3) 5.1 → 6.1 → 6.2 save (≈1 h, one run + tests); (4) 6.3 unattended (2–3 h, six runs — check the
plans' usage caps first); MAC-1/MAC-2 any time.

**V2 must fix or decide first:**
1. **The Query domain step would fail the hero run** (no embeddings key, no files in "Exchange API
   docs"): give the account an OpenAI or Hugging Face key plus real exchange-API PDFs (then 1.5 can
   be live too), or run the hero on the team without the domain step (as the proof did).
2. **The mcp-builder library skill doesn't load at run time** (the run view's banner): take it off
   the Engineer before the hero run, or wait for a product fix.
3. **The Reviewer rejects over the agents' scratch files** (`REPORT.md`, `TVASHTR_REMEMBER*`): add
   one line to the Reviewer's instructions (a team edit, not product) — or expect the Escalation
   gate again.
4. **Version numbering:** chapter 2 ends at v1, 6.2 says "2 changes since v7" — save versions
   through the story or relabel 6.2.
5. **0.1:** the operator runs `node video/camera/github-login.mjs` once (trade_mcp is private).
6. **7.2** needs `HOSTED=0 video/stack/up` (restart the backend), then back to hosted.
7. **The hero record take paces the replays:** a replay holds at each gate the page approved until
   the camera clicks it, but any drawer or tab a later scene opens must also have been opened in the
   record take (3.4's Engineer drawer wasn't in the proof recording) — add those views to 3.1's flow
   before V2 records.
8. `video/stack/reset` before V2, so the account holds only the film's own teams and runs.

## Operator items

### MAC shots (record with Recordly; Tvashtr frontmost; `caffeinate -dimsu` running)

Each script names the app, the visible label to click and what should show. Record at 1440×900 if
Recordly lets you pick a window size; V4 cuts them in beside the camera's takes.

**MAC-1 — 1.1 Sign in with GitHub; install the GitHub App on trade_mcp** (the GitHub side; the
Desktop opens the system browser, which the camera can't film)

1. Quit every Tvashtr Desktop. Open Tvashtr Desktop signed out (the Welcome page): heading
   **"Welcome to Tvashtr"**.
2. Start Recordly on the whole screen (the Desktop and the browser will both show).
3. Tvashtr: click **"Sign in with GitHub"**. The Desktop shows **"Finish signing in in your
   browser"** (buttons "Open the browser again", "Copy the sign-in link", "Cancel").
4. Browser (opened by itself): GitHub's **"Authorize Tvashtr"** page (the app is `tvashtr-dev` on
   the local stack) → click the green **"Authorize …"** button. If GitHub asks which account, pick
   **lazyxgenius**.
5. Browser: the Tvashtr page **"Open Tvashtr Desktop"** → click it; macOS asks **"Open Tvashtr?"**
   → **"Open Link"**. The Desktop moves on by itself (signed in).
6. Install the App on trade_mcp: Tvashtr → Home → the composer's repo button (shows
   "Pick a folder") → **"Install the Tvashtr GitHub App →"** (or, when it is already installed,
   **"Add repositories on GitHub →"**).
7. Browser: github.com **"Install Tvashtr"** (or "Configure") → **"Only select repositories"** →
   pick **lazyxgenius/trade_mcp** → **"Install"** (or "Save").
8. Back in Tvashtr, open the repo picker again: **lazyxgenius/trade_mcp · main** is listed under
   "GitHub App repos". Stop recording.

Note: the App is already installed on trade_mcp for this account, so GitHub shows "Configure" and
"Save" rather than "Install". On the local stack the GitHub OAuth callback is
`http://localhost:8000/api/auth/github/callback` (the dev App); for the website flavour use the
production app at https://tvashtr.fly.dev with the installed Tvashtr Desktop.

**MAC-2 — 1.2 Claude and Grok connected with your own sign-in (opens Terminal)**

The Desktop opens Terminal only when the CLI is signed out (an already signed-in CLI just shows
"Connected"). Recording this means signing the CLI out first and back in on camera — your call.

1. In a plain Terminal (not inside the Claude app): `claude auth logout` (Grok: `grok logout`).
2. Start Recordly on the whole screen.
3. Tvashtr → **Engines** → **Subscriptions** → the **Claude** card shows **"Needs sign-in"** →
   click **"Connect"**.
4. Terminal opens by itself with the line **"Signing in to Claude Code — follow the prompts
   below."** The Tvashtr card shows **"Waiting for sign-in"** and the callout "Finish signing in to
   Claude in the Terminal window that just opened…".
5. Terminal: follow the prompts (choose your **Claude subscription**, not an API key); the browser
   opens claude.ai → **"Authorize"**. Never film the code/token Terminal may print — cover or crop
   that part, or stop and restart recording around it.
6. Terminal prints **"When you're done, switch back to Tvashtr — it re-checks automatically."**
   Switch back: the card turns **"Connected" · "Claude Max · via Claude Code"** (Grok: "Grok
   subscription"). Stop recording.

**MAC-3 — 4.1 the Mac notification ("Indicator sprint team stalled")**

1. In the run view of a 4.1-style run, turn notifications on: the ask comes once per account and
   V2's 3.1 answered it "Not now", so use the run toolbar's bell (Notifications) → **"Turn on"**
   (keep "When a run stalls or fails" ticked). macOS may ask **"“Electron” Would Like to Send You
   Notifications"** (the dev Desktop is "Electron"; the installed app is "Tvashtr") → **"Allow"**.
   That macOS permission is yours to grant (V1 never clicks it).
2. Start Recordly on the top-right of the screen before the Engineer goes Stalled.
3. The banner shows **"Indicator sprint team stalled"** — "No update for N minutes. Nothing
   shipped; finished steps are saved." (later "Indicator sprint team failed" is suppressed when
   the stall was already announced). Click it: Tvashtr opens the run. Stop recording.

V3b: macOS shows the banner only while the Desktop is **not** the active app — a take that keeps it
pinned and focused records no banner (V3b › MAC-3).

### Other operator items

- **A throwaway API key** for the "add a key" moment of 1.2 (V1 shows the DeepSeek key masked only;
  no real key is typed on camera).
- **Linear** (1.4) and **an embeddings key** (1.5) if those scenes should be filmed live instead of
  from sample data.
- **The Claude CLI sign-in**: check `claude auth status` from a plain Terminal before V2's runs
  (inside the Claude app it reads the app's own sign-in).
