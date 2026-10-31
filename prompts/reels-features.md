# Brief — Feature reels f1–f5: five short reels, one feature each

Architect: Tvashtr Sidechat-25, 2026-10-23. Path: `/Users/adimac/Desktop/Tvashtr/prompts/reels-features.md`.
This continues Reel 1 (`prompts/reel-1.md` — read it: its rules, limits and look all still apply unless
this brief changes them). The operator approved Reel 1's cut-02 (the "what is Tvashtr" tour) and asked
for at most five feature reels. Where this brief and the skill differ, this brief wins.

## What to make

Five reels, **35–55 s each** (aim for about 45 s), 16:9, 1920×1080, 30 fps, in **the exact look, voice,
caption style, kicker labels, honesty labels and end card of Reel 1 cut-02**, so they read as one series.
Each opens with a series kicker (e.g. "Tvashtr feature · Design your team") and ends on the same end card
("Tvashtr. Your team. Your rules.", the line, `github.com/lazyxgenius/Tvashtr`, "Built by Aditya Sharma").
The operator asked for every topic to be covered (Domains, saved runs and the rest), so the five group
the whole product; denser reels move faster (one short line a feature).

| Id | Reel | Topics |
|---|---|---|
| f1 | Design your team | templates, blank agents defined by instructions, wiring and checks, a model per agent and the blind-spot warning, a Fixer path, grouping, testing an agent |
| f2 | Equip your agents | your Claude and Grok plans or API keys, the Toolkit (MCP servers, secrets by name, skills from GitHub), Connectors, **Domains** (your documents, answers with sources, a Query domain step), memory |
| f3 | Checks that keep runs on track | the spec you approve, Tvashtr running the tests, a failure going back, a reviewer on another model, secret and forbidden-path scans, the real PR |
| f4 | Every run, saved | the live view, Activity in plain words, what changed, Ask any agent why, what the team remembers, a stalled run waiting in Needs you and resuming, **the next task starting from a saved run**, recent tasks |
| f5 | Improve and share your team | agent tests, version two, comparing versions on real work, task sets with hidden checks, saving an agent as your own, sharing a team as one file |

## Where things live

The same project folder as Reel 1: `/Users/adimac/Desktop/tvashtr-reel`. **Reuse** its engine, look,
voice tools (`tools/vox_takes.py`, `tools/name_check.py`), synthesized sound library, footage index and
build steps (STATUS.md, JOURNAL.md). Each reel gets its own `plan/<id>/` and `src-<id>/` (or one shared
`src/` with per-reel data — your call, say which), and its own numbered cuts: `out/<id>-cut-01.mp4`
(+ the phone copy, contact sheet, script). Never touch Reel 1's files in `out/` or `cache/draft-08.mp4`.
`/Users/adimac/Desktop/Tvashtr` stays read-only; the license rule stands (nothing from the skill goes into
the Tvashtr repo or anywhere public).

## Starting scripts (the architect's — keep every claim; cut, shorten or reorder for timing)

Each is built from the film's own approved, fact-checked narration (`video/v3/script.json`). Shots come
from the film's takes (`plan/footage.md`; the scene ids below). A new claim needs the operator's OK at
SCRIPTS READY. Scenes marked * are sample-data takes: use them only with the film's label
"Illustration · sample data" on screen, as the film did.

**f1 · Design your team** (2.1, 2.2, 2.4, 2.5, 2.6, 2.7)
1. In Tvashtr, you design the AI team. Start from a template, or a blank canvas. (2.1)
2. Every agent is a blank box: its job is whatever you write in its instructions. (2.2)
3. Wire in the checks: you approve the spec, Tvashtr runs your tests, and the reviewer can send work back. (2.4)
4. Choose a model for each agent. Give the reviewer the engineer's model, and Tvashtr warns you: they'd share blind spots. (2.5 — trim before the custom-ID warning that follows the pick)
5. Draw a failure path to a Fixer, and group the review loop. (2.6, 2.7)
6. Then try an agent before you trust it: its test passes, one of one. (2.7)

**f2 · Equip your agents** (1.2, 1.3, 1.4*, 1.5*, 2.3, 2.6)
1. Give your agents what they need to do real work.
2. They run on the Claude and Grok plans you already pay for, from Tvashtr Desktop, or on your own API keys, stored encrypted. (1.2)
3. The Toolkit holds what every team can use: MCP servers, secrets saved by name, and skills imported from GitHub. (1.3)
4. Connect the apps your work lives in, like Linear, and choose what agents may do there. (1.4*)
5. Turn your documents into a domain agents can search. Every answer shows its sources. (1.5*)
6. Add it to a team as a step that asks one question every run, and passes the answer and its sources on. (2.3)
7. And let an agent remember what it learns. (2.6)
Line 3 shows the Toolkit only: Desktop subscription agents don't use library tools yet, so no shot may
suggest a Desktop run used them. Don't claim a Query domain step ran in the runs the film shows (it didn't).

**f3 · Checks that keep runs on track** (3.3, 3.4, 3.1 @ ~336 s, 3.4-verdict, 3.6, 0.1)
1. Long agent runs drift. Tvashtr's checks keep them on what you asked for.
2. First, a planner writes the spec, and the run waits for you. Fix a line, approve, and only then is any code written. (3.3)
3. The engineer works on its own copy of your repo. Then Tvashtr runs your tests itself. (3.4)
4. A failure sends the last twelve lines straight back. Round two: six hundred and sixty-five tests pass. (3.4, 3.1)
5. Only then does a reviewer, on another model, check the change against the spec, citing Tvashtr's test result, not the engineer's word. (3.4-verdict)
6. A secret scan and a forbidden-paths check pass, and the pull request opens. (3.6, 0.1)

**f4 · Every run, saved** (3.2, 3.7, 3.7-ask, 4.1, 4.2, 5.1, 5.1-recent)
1. Every run in Tvashtr is saved, and you're never in the dark.
2. While it works, one bar shows what every agent is doing, and Activity says it in plain words. (3.2)
3. Afterwards, see exactly which files changed, and ask any agent why it did what it did. (3.7, 3.7-ask)
4. Choose what the team remembers: keep one lesson, drop another. (3.7)
5. If a run stalls or fails, it waits for you in Needs you. Resume from the step that broke. (4.1 — must carry its film label "Agent paused on purpose · timers shortened for this video"; 4.2)
6. The next task builds on the last: start it from a shipped run, and it brings the spec, the decision and what the agents learned. (5.1)
7. And tasks you've run before come back as you type. (5.1-recent)

**f5 · Improve and share your team** (6.1, 6.2, 6.3, 6.3-set, 7.1, 7.2)
1. Changed an agent? Prove the change helps.
2. Turn any round an agent did into a test, with an AI check on what it should say. Run them all: three of four pass. (6.1)
3. Edit the reviewer and save version two: its tests run straight away, four of four. (6.2)
4. Then compare both versions on a new task. Version two did better: its reviewer passed one more test. (6.3)
5. Or run a task set, with hidden checks the agents never see. (6.3-set)
6. Save your best agent as your own, or share the whole team as one file, with no secrets inside. (7.1, 7.2 — crop the duplicate "Add a key for anthropic" line)
Keep the film's exact claim in line 4 ("passed one more test"); don't widen it to "a better reviewer".

## Footage notes (carry over from the film)

The pink "1 library tool(s)" band stays out of frame everywhere. 3.7's "cost per round $0.0000": crop it
or keep it out. 2.5's custom-ID warning: trim. 4.1 keeps its staged-stall label. Sample-data takes only
where marked * above, always labelled. Every number on screen is one the footage shows. Nothing private in
any frame (the Reel 1 sweeps' rules; 7.2 shows test addresses on a fake `.local` domain — fine, but no
real address).

## Three stops for the operator

1. **SCRIPTS READY** — all five tightened scripts, each with its shot list (take @ seconds, speed label),
   its estimated length, and anything you cut. Wait for "GO" or notes.
2. **FIRST REEL READY** — f1 delivered in full (`out/f1-cut-01.mp4` + phone copy + contact sheet). This is
   the series' format check. Wait for "GO" or notes; notes on f1 apply to all five.
3. **ALL READY** — f2–f5 delivered the same way, then the eight-section FINAL REPORT (Tvashtr's
   `prompts/CLI-RULES.md` §4.7) with every reel's QA numbers.

No voice-sample stop this time: the narrator is approved. Every gate of Reel 1 applies to every reel
(thumbnail first frame, first word by 1.3 s, line endings intact, word-synced captions readable at phone
size, a sound on every cut, -14 LUFS and ≤ -1.5 dBTP, no unplanned black or frozen frames, "Tvashtr"
passes the phoneme check every time, no em dash in your own text, every frame looked at).

## Rules

Everything in Reel 1's "Rules", "Honesty and privacy" and "No new recording" holds: $0, no new recording
of any kind, cut only from the takes on disk, Tvashtr read-only, no git remote, never print a key,
`caffeinate -dimsu` while rendering, never run the voice model beside Chrome/ffmpeg work. Time box: 10
hours of work, not counting waits at the stops. Keep STATUS.md current enough that a fresh session could
finish the series from it alone.

## Stop with NEEDS_HUMAN when

a needed take is missing or unreadable; a frame you need shows something private; a beat can't be shown
honestly with the footage on disk (say which, and what you'd cut); a step would need a paid service or a
write inside the Tvashtr folder; or a safeguards notice.
