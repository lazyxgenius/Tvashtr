# API — Agent tests (M7, brief §4 M7, rulings R6 R7 R12)

A **test** is one saved round of one agent: what it got (the task, the spec / documents it read, the
change and the test output it saw) plus **checks** on what it says. **Run all N** replays ONLY this
agent, once per test, on each saved input with its current saved setup, and checks the answer. Every
route is owner-scoped (another account's team / node / test → 404). Words are made server-side where
this file says so; errors are `{"detail": "<plain words>"}`.

Tests belong to the LIBRARY agent (the node you open on the team canvas). Rounds of runs are rounds of
that agent's run copies; a test made from one keeps a copy of everything the replay needs, so it still
replays after the run is gone.

## Check kinds

| kind | label | passes when |
|---|---|---|
| `must_say` | Must say | the answer contains the value (case, spaces and curly quotes ignored) |
| `must_not_say` | Must not say | the answer doesn't contain it |
| `must_name_file` | Must name a file | the answer names the path, or the agent changed that file |
| `ai` | AI check | a small model on **Tvashtr's** key (never the owner's) says the answer meets the value (R7) |

An AI check that can't run is **skipped, not failed**: `met: null` with `reason` "Not available yet"
(no server key) or "No AI checks left this month" (200 per account per month). A test passes when the
replay finished and every check that ran is met.

The answer a replay is checked on: a reviewer (an agent whose result routes the team) → its verdict,
`"Approved"` or `"Changes requested: <reasons>"` (a reviewer that writes no verdict fails: "It gave no
verdict, so its checks didn’t run."); any other agent → its REPORT.md if it wrote one, else its closing
message. `files` = the files it changed (worked out on the host, before vs after). A Must say / Must
not say whose value is a verdict ("Approved", "Changes requested") checks the verdict itself, so
"can't be approved" doesn't say Approved; a file name matches as a whole path.

## `GET /api/teams/{team_id}/nodes/{node_id}/tests` — the Tests tab

```jsonc
{
  "tests": [{
    "id": "…", "name": "Catches an unregistered indicator",
    "meta": "From run #12 · round 1 · 3 checks",          // or "From a file · row 7 · 1 check + AI check"
    "source": {"kind": "round", "run_id": "…", "run_number": 12, "iteration": 1} | {"kind": "file", "row": 7},
    "checks": [{"kind": "must_say", "value": "Changes requested", "from_round": true},
               {"kind": "ai", "value": "Asks for RSI to be registered on INDICATORS",
                "judge": {"agree": 9, "total": 10, "trusted": true,
                          "labels": [{"answer": "…", "you": true, "ai": true, "reason": "…"}]} | null}],
    "gets": {                                             // "What the Reviewer gets" (the New dialog rows)
      "task": "Add an RSI indicator",
      "documents": [{"name": "Spec", "version_no": 2, "pages": 1, "is_shared_spec": true}],
      "change": [{"path": "core/indicators.py", "added": 48, "removed": 3}],   // [] = none
      "change_by": "Engineer" | null,                     // whose change it was ("The Engineer’s change")
      "test_output": "3 failed, 38 passed" | null,
      "feedback": true                                    // it got a reviewer's feedback (round 2+)
    },
    "created_at": "…"
  }],
  "run": null | {                                         // the newest test run of this agent
    "id": "…", "status": "running" | "done" | "stopped" | "failed",
    "version": 7 | null,                                  // "On v7"; null when the agent had changes no version holds
    "trigger": "manual" | "save",
    "total": 6, "done": 2, "passed": 2, "failed": 0,
    "cost_usd": 0.14, "started_at": "…", "ended_at": "…" | null, "elapsed_s": 100,
    "waiting_for_slot": false,                            // R12: the owner's runs use all 3 slots
    "error": null | "Tvashtr restarted while the tests ran. Run them again.",
    "since": {"version": 6, "delta": 1} | null,           // "+1 since v6" (vs the newest finished run on an older version; delta may be ≤ 0)
    "results": [{
      "id": "…", "test_id": "…" | null, "name": "Names the file to fix",
      "status": "waiting" | "running" | "passed" | "failed" | "stopped",
      "answer": "Changes requested: …" | null, "files": ["core/indicators.py"],
      "checks": [{"kind": "ai", "value": "names the file and line for each problem", "met": false,
                  "reason": "No file or line named. Something like core/indicators.py:118 was expected."}],
      "error": null | "It took more than 10 minutes, so it was stopped." | "It didn't finish: …",
      "cost_usd": 0.07
    }]
  },
  "last": "Last run on v7 · 2h ago · 5 passed, 1 failed" | null,   // the header subline when not running
  "estimate": {"cost_usd": 0.40, "minutes": 4} | null,             // for all tests, on the owner's keys
  "ai": {"available": true, "left": 186, "limit": 200}
}
```
Results are in test order. A `running` run whose worker hasn't been heard from for 12 minutes reads (and
is saved) as `failed` with the restart error above.

## `GET /api/teams/{t}/nodes/{n}/tests/from-round?invocation_id=<int>` — the New dialog

The round must be one of this agent's (its run copy's) rounds. →
```jsonc
{"invocation_id": 812, "run_id": "…", "run_number": 12, "iteration": 1, "role": "Reviewer",
 "answered": "Changes requested" | null,      // a reviewer's verdict in that round
 "gets": { …as tests[].gets… },
 "checks": [{"kind": "must_say", "value": "Changes requested", "from_round": true}],   // prefilled for a reviewer
 "estimate": {"cost_usd": 0.07} | null,
 "ai": {"available": true, "left": 186, "limit": 200}}
```
409 with the reason when the round can't be a test: "Can't make a test from this round (it ran before
checkpoints)", "… (it didn't finish)", "… (its change was too large to keep)", "… (its folder was on
your computer)".

## `POST /api/teams/{t}/nodes/{n}/tests` → 201 — Save test

Body `{"invocation_id": 812, "name": "Catches an unregistered indicator", "checks": [{"kind", "value",
"from_round"?}]}`. Name 1–120 chars (trimmed); 1–10 checks, each value 1–500 chars → 422 otherwise
("Add at least one check"). → `{"test": <tests[] item>}`.

## `DELETE /api/teams/{t}/nodes/{n}/tests/{test_id}` → 204

Its past results stay in their runs (named).

## `POST /api/teams/{t}/nodes/{n}/tests/file/check` — Add tests from a file (dry run)

Body `{"filename": "reviewer-examples.csv", "content": "<text>", "mapping"?: {"task": "gets", …}}`.
CSV (header row) or JSON lines (one object per line). ≤ 2 MB, ≤ 200 rows. →
```jsonc
{"filename": "reviewer-examples.csv", "rows": 12,
 "columns": [{"name": "task", "first": "Add an EMA indicator", "use": "gets"},
             {"name": "diff", "first": "core/indicators.py +22 −0 …", "use": "gets"},
             {"name": "expected", "first": "Changes requested", "use": "must_say"},
             {"name": "file", "first": "core/indicators.py", "use": "must_name_file"},
             {"name": "notes", "first": "from the March audit", "use": "skip"}],
 "ready": {"tests": 12, "must_say": 12, "must_name_file": 9}}
```
`use`: `gets` (What the agent gets) · `must_say` · `must_name_file` · `skip` (Don’t use). Without
`mapping`, `use` is a guess from the column name; with it, `ready` follows the mapping. A row becomes a
test when its first `gets` column has text and at least one check has text ("Rows with an empty task
are skipped"). The `gets` columns make the task, in order (`task` text, then `"\n\n<column>:\n<text>"`
for the others). 422 `"This file can't be read: line 3 isn't valid JSON."` / `"… it has no header
row."` / `"… it is larger than 2 MB."` / `"… it has more than 200 rows."` / `"Pick a column for What the
agent gets."`

## `POST /api/teams/{t}/nodes/{n}/tests/file` → 201

Same body with `mapping` required → `{"added": 12}`. Each test: `source.kind = "file"`, `row` = its
row number (1 = the first data row), name = the task's first line (≤ 120 chars), an empty repo.

## `POST /api/teams/{t}/nodes/{n}/tests/run` → 202 — Run all N

→ `{"run": <run>}`. Replays this agent's tests one after another on its current SAVED setup (the
drawer saves or discards a draft first). 409 "The tests are already running" · 422 "Add a test first".
A replay counts toward the owner's 3 concurrent runs only (R12); while all 3 are taken the run waits
(`waiting_for_slot: true`). Each replay is stopped after 10 minutes; a stop or the cap reaches a
replay before its agent starts, and its slot stays counted until it has really ended. Model work is on the owner's keys;
AI checks on Tvashtr's.

## `POST /api/teams/{t}/nodes/{n}/tests/stop` → the run (`status: "stopped"`, unfinished results `stopped`).

## `GET /api/teams/{t}/nodes/{n}/tests/results/{result_id}` — Open this replay

```jsonc
{"id": "…", "name": "…", "version": 7, "status": "failed", "at": "…", "duration_s": 41, "cost_usd": 0.07,
 "gets": { …the test's gets… }, "answer": "…", "files": ["…"], "checks": [ …as results[].checks… ],
 "error": null}
```

## `GET /api/teams/{t}/nodes/{n}/tests/{test_id}/answers` — answers to label (Check the AI check)

`{"answers": [{"text": "Changes requested: register rsi …", "from": "Run #12 · round 1"}]}` — up to 20
distinct answers this agent gave: its rounds' answers and its replays', newest first.

## `POST /api/teams/{t}/nodes/{n}/tests/{test_id}/judge` — Check the AI check

Body `{"check": 3, "labels": [{"answer": "…", "you": true}]}` (1–20 labels; `check` = the index of an
`ai` check) → runs the AI check on each answer not judged before (each one counts toward the 200) and
saves the labels with the test ("Your labels are saved with the test"):
```jsonc
{"rows": [{"answer": "…", "you": true, "ai": true | false | null, "reason": "…"}],
 "agree": 9, "total": 10, "trusted": true,          // trusted: ≥ 10 labels and agrees on ≥ 8 of 10
 "ai": {"available": true, "left": 176, "limit": 200}}
```
409 "AI checks aren't available yet" when the server has no checks key. `ai: null` rows: the month's
limit ran out mid-way.

## Additions to existing routes

- `GET /api/teams/{t}/nodes/{n}/runs` — each round gains `test_blocked: null | "<the 409 reason>"`
  (null ⇒ "Make this a test" is enabled).
- `GET /api/teams/{team_id}/graph` — each agent node gains `tests: null | {"total": 6, "passed": 5 |
  null, "ran": 6 | null, "stopped": false, "running": null | {"done": 2, "total": 6}}` (the canvas chip "5 of 6 tests" /
  "● Testing 3 of 6"; `passed` and `ran` (its total) are of the newest finished or stopped run, null when never run; `stopped` ⇒ that run was stopped (the chip is neutral); the Tests tab
  count is `total`).
- `GET /api/teams/{t}/versions` — gains `tests: null | {"count": 6, "agents": [{"node_id", "name":
  "Reviewer", "count": 6}], "sub": "You changed the Reviewer’s instructions. The Reviewer has 6
  tests.", "option": "Save and run the Reviewer’s 6 tests", "estimate": {"cost_usd": 0.4, "minutes":
  4} | null}` — the agents changed since the newest version that have tests (null ⇒ no nudge: Save as
  vN saves at once, as in M5). Each `versions[]` row gains `tests: null | {"passed": 6, "total": 6,
  "running": false}` — the newest test run of each agent on that version, added up (History's pill).
- `POST /api/teams/{t}/versions` — body gains `run_tests: bool` (default false). After the save
  commits, a test run starts for each changed agent with tests (`trigger: "save"`, on the new version),
  never blocking or failing the save. Response gains `tests_started: [{"node_id", "run_id"}]`.

- `GET /api/spend` — a replay runs on the owner's keys, so its cost counts in the month / week totals
  and its team's row (an AI check is on Tvashtr's key and never counts).

## Settings (R7)

`TVASHTR_CHECKS_MODEL` (default `openai/gpt-4.1-mini`) and `TVASHTR_CHECKS_API_KEY` (empty ⇒ AI checks
"Not available yet"). Production has no key until the operator sets the two Fly secrets.
