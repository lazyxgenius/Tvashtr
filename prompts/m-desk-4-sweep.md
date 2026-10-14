# M-desk-3 · G4 sweep — Desktop-visible strings that claim keys, quote dollars for subscription work, or say lanes run at once

Report only (nothing changed). Branch feat/m-desk-3. Method: workflow wf_39bbbe54-ffe — 5 finders (keys wording, dollar
wording, simultaneity wording, server-made copy, Desktop-only surfaces) → 178 raw / 119 unique findings → one adversarial
verifier per file (52 files) → completeness critic (+82) → re-verify; 266 verified rows, 55 judged misleading on the
Desktop; consolidated below (server source + FE string on one row), every file:line re-checked at HEAD. Excluded: the
strings M-desk-2 and M-desk-3 already fixed. Film = prompts/video-v1.md scenes.

## A. Simultaneity — says or implies the lanes run at once (on the Desktop they take turns, one job per provider)

| # | file:line | string | screen | film |
|---|---|---|---|---|
| S1 | backend/tvashtr/control_plane/compare.py:1016 → frontend/src/pages/compare/CompareView.tsx:497 | "Working · <agent> · round N" | Compare › a running task-set compare, a task's cell. Set cells call `_current(...)` without `desktop=` (one-task lanes pass it, compare.py:796), so a run queued behind the other lane shows "Working" instead of "Waiting for your … subscription — one job at a time" | yes — 6.3 |
| S2 | compare.py:212 (`_estimate`: the longer lane) → frontend/src/pages/compare/ComparePage.tsx:432 | "On your … subscriptions · about N min" | Compare › Start (one task): the minutes assume both lanes run together; lanes sharing a subscription take turns, so it is understated | yes — 6.3 |
| S3 | compare.py:278 (`set_estimate`: `at_once` pairs) → frontend/src/canvas/SaveNudgeDialog.tsx:135, ComparePage.tsx:417, TaskSetDialog.tsx:86 | "about N min" | Save as vN › the set check line (this step's Set-SaveCheckDesktop string), Compare › Start (task set), Edit task set: the minutes assume task pairs run at once | yes — 6.2, 6.3 |

## B. Dollars for work that runs on the subscriptions (reads $0.00, or a history-based $ figure, on the Desktop)

| # | file:line | string | screen | film |
|---|---|---|---|---|
| D1 | backend/tvashtr/control_plane/activity.py:835 | `Done in {t} · ${cost:.2f}` | Run view › Activity, last line of a finished run | yes — 3.6 |
| D2 | activity.py:837 | `Failed after {t} · ${cost:.2f}` | Run view › Activity of a failed run; a failed compare lane | yes — 4.1 |
| D3 | frontend/src/panel/run/live/DoneSummary.tsx:38 | `$X` "cost" | Run view › Done summary | yes — 3.6 |
| D4 | frontend/src/components/RunBanner.tsx:50, 52 | "cost $0.0000" | Run view › toolbar status banner | yes — 3.2 |
| D5 | frontend/src/App.tsx:1070 (shown by canvas/CanvasToolbar.tsx:113) | `$X.XX` "Spend this run" | Canvas and run view › toolbar spend chip | yes — 2.x, 3.x |
| D6 | frontend/src/panel/run/RunNodeDrawer.tsx:481 | `$X.XXXX` per round | Run view › agent drawer › Runs tab, a round's ledger line | yes — 3.7 ("cost per round") |
| D7 | frontend/src/panel/runs/RunsTab.tsx:305 | `$X.XX` per round | Canvas › agent drawer › Runs tab › Earlier rounds | yes — 6.1 |
| D8 | frontend/src/lib/agentTestsFormat.ts:110, 114 (agent_tests.py:852) | "On v7 · $X so far" / "On v7 · just now · $X" | Agent drawer › Tests tab header while running / after | yes — 6.2 |
| D9 | frontend/src/panel/tests/ReplayView.tsx:70 (agent_tests.py:909) | `$X.XX` | Tests tab › a replay's meta line | no |
| D10 | frontend/src/pages/compare/CompareView.tsx:127 (compare.py:944) | "{t} · $X so far" | Compare › running compare header | yes — 6.3 |
| D11 | CompareView.tsx:241 (compare.py:805) | "{t} · $X" | Compare › one-task running lanes A / B | yes — 6.3 |
| D12 | CompareView.tsx:385 (compare.py:1434) | Cost row: "$X", "$X", difference | Compare › one-task results table | yes — 6.3 |
| D13 | CompareView.tsx:525 (compare.py:1029) | "N rounds · $X" | Compare › task-set table cells | yes — 6.3 |
| D14 | CompareView.tsx:623 (compare.py:1117) | Cost card "v7 $X → v8 $X" | Compare › task-set results cards | yes — 6.3 |
| D15 | frontend/src/pages/compare/TaskSetDialog.tsx:86 (compare.py:284) | "Comparing two versions on this set: about $X and N min" | Compare › Task sets › Edit set (history-based $; minutes see S3) | yes — 6.3 |
| D16 | frontend/src/panel/run/live/Resume.tsx:146 (resume.py:221) | "· $X" under each step | Run view › Resume from here picker | yes — 4.2 |
| D17 | Resume.tsx:292 (resume.py:466) | "Skips work that already cost $X and took …" | Run view › Resume confirm | yes — 4.2 |
| D18 | Resume.tsx:296 | "You only pay for the steps that run again." | Run view › Resume confirm | yes — 4.2 |
| D19 | frontend/src/panel/run/live/ActivityPanel.tsx:323–324 | "… Tvashtr skips the work that is done, so you don’t pay for it again." | Run view › Activity, the "Next: resume from …" line | yes — 4.1/4.2 |
| D20 | frontend/src/pages/home/ComposerPickers.tsx:525, 528 | "Budget for this run" / "The run pauses and asks you before spending more." | Home › composer › Options (the budget counts metered spend only; subscription work never reaches it) | yes — 3.1 |
| D21 | frontend/src/pages/home/RunningNow.tsx:149, 153 | "$0.00 of $5.00" / "$0.00 spent" | Home › Running now card | yes — 8.1 |
| D22 | frontend/src/pages/home/SpendCard.tsx:65 | "Each run stops at $5.00 unless you change its budget." | Home › Spend card | yes — 8.1 |
| D23 | frontend/src/lib/versionFormat.ts:86 | a run's `$X` | Canvas › History › Runs | no |

## C. Keys — claims a key where a fresh Claude/Grok subscription runs the work

| # | file:line | string | screen | film |
|---|---|---|---|---|
| K1 | frontend/src/pages/engines/keysModel.ts:275 | "Works for website runs and Desktop runs." | Engines › API keys › ⋯ › See where it’s used (for anthropic/xai, Desktop runs go to the subscription) | no |
| K2 | keysModel.ts:306–307 | "… <agent> uses the new one on its next run." / "Agents use the new one on their next run." | Engines › API keys › Replace key dialog | no |
| K3 | keysModel.ts:312 | "<provider> key replaced. <agent> uses it on its next run." | toast after Replace key | no |
| K4 | frontend/src/pages/home/AddKeySheet.tsx:97–98 | "<provider> key saved. <team> can run on this computer." / "Keys saved. …" | toast after fixing a website-only gap from Home (the Desktop already ran it on the subscription) | no |
| K5 | frontend/src/panel/setup/ModelPicker.tsx:334 | "The provider’s own name for the model. It runs on that provider’s key." | Agent drawer › Setup › Model › custom model ID (anthropic/*, xai/* run on the subscription) | no |
| K6 | frontend/src/panel/setup/ModelNotices.tsx:58–59 | "No provider matches <model>. It will fail at run time if the name is wrong or the key isn’t set." | Agent drawer › Setup › Model warning (an unlisted anthropic/xai slug runs on the subscription) | no |
| K7 | frontend/src/panel/setup/setupCopy.ts:62 | "Used once if the main model fails (bad key, provider down)." | Agent drawer › Setup › Advanced › Backup model hint (a subscription run has no key and never falls back) | no |
| K8 | frontend/src/pages/home/composerModel.ts:71, 90, 169 | "This computer: needs <p> key" / "This computer needs N keys" / "… there’s no API key for them." | Home › composer (true by rule — shown only when no fresh subscription covers the provider — but names only the key remedy when Claude/Grok is simply not connected) | no |

## Checked and true on the Desktop (not counted)

Domains / memory / AI-check key wording (stays on keys by design: domain_ask.py, domainFormat.ts, keysModel.ts:91–397
Domains rows, agentTestsFormat.ts:92); refusals that appear only for a non-Claude/Grok model or a stale Desktop
(agent_test_runner.py:512, routers.py:903–969, run_failure.py:119/172, canvas/runBlocked.ts:36–37, lib/engines.ts:165);
run-slot wording (CompareView.tsx:149–266 "free slot", TestsTab.tsx:371, StartNext.tsx:48 — a real owner cap, not
simultaneity); spend totals that are real metered sums (SpendCard.tsx:45–60, HomeHeader.tsx:108, teamFormat.ts:112); the
Engines/Desktop-setup copy that already says "subscription first, then an API key" (OverviewPage.tsx:103, sheetModel.ts:45,
FirstTimeChooser.tsx:31, EnginesStep.tsx:235).
