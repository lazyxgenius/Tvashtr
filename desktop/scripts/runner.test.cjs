/**
 * M-subs-desktop §3.3: the Desktop runner claims a subscription node job, materializes the job's
 * workspace snapshot in its own temp dir, runs the user's OWN CLI headless there with a clean env,
 * streams the CLI's output as events, and posts back only the final text + a git patch.
 *
 * The CLIs are test doubles (fixtures/fake-*.cjs) that exit 3 if any API key / Claude Code session
 * var reaches them — so a green run here also proves the clean-env contract end to end.
 *
 * Run: node --test desktop/scripts/runner.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createRunner } = require("../electron/runner/runner.cjs");

const FAKE_CLAUDE = path.join(__dirname, "fixtures", "fake-claude.cjs");
const FAKE_GROK = path.join(__dirname, "fixtures", "fake-grok.cjs");

// The parent env a Claude Code terminal would hand the Desktop app: full of things that must
// never reach the vendor CLI child.
const LEAKY_BASE_ENV = {
  PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: os.homedir(),
  CLAUDECODE: "1",
  CLAUDE_CODE_SESSION_ID: "s-1",
  CLAUDE_CODE_MESSAGING_TOKEN: "leak",
  ANTHROPIC_API_KEY: "sk-ant-api03-leak",
  XAI_API_KEY: "xai-leak",
  OPENAI_API_KEY: "sk-leak",
};

function snapshotTarball() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "tv-src-"));
  fs.writeFileSync(path.join(src, "README.md"), "# demo\n");
  // The greenfield workspace .gitignore hides the sidecars from the ship — the runner must still
  // carry them home (force-added) or the entry node's REPORT.md would be lost.
  fs.writeFileSync(path.join(src, ".gitignore"), "REPORT.md\nREVIEW_VERDICT.json\n");
  return childProcess.execFileSync("tar", ["-czf", "-", "-C", src, "."]);
}

function fakeApi(jobs) {
  const queue = [...jobs];
  const claims = [];
  const events = [];
  const results = [];
  return {
    claims,
    events,
    results,
    async claim(providers) {
      claims.push([...providers]);
      const idx = queue.findIndex((j) => providers.includes(j.provider));
      if (idx === -1) return null;
      return queue.splice(idx, 1)[0];
    },
    async snapshot() {
      return snapshotTarball();
    },
    async postEvents(jobId, batch) {
      events.push(...batch.map((e) => ({ jobId, ...e })));
      return { cancelled: false };
    },
    async postResult(jobId, body) {
      results.push({ jobId, ...body });
      return { ok: true };
    },
  };
}

function job(id, provider, model) {
  return {
    id,
    provider,
    model,
    instruction: "Create hello.txt and write REPORT.md",
    sidecars: ["REPORT.md", "REVIEW_VERDICT.json", "TVASHTR_REMEMBER.jsonl"],
  };
}

function runnerFor(api, extra = {}) {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tv-runner-"));
  const grokRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tv-grok-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tv-home-"));
  const runner = createRunner({
    api,
    workRoot,
    grokRoot,
    home,
    baseEnv: LEAKY_BASE_ENV,
    pathDirs: async () => [],
    connectedProviders: () => ["claude", "grok"],
    binaryFor: async (provider) => (provider === "claude" ? FAKE_CLAUDE : FAKE_GROK),
    pollMs: 10,
    heartbeatMs: 50,
    ...extra,
  });
  return { runner, workRoot, grokRoot, home };
}

test("a claimed Claude job runs `claude -p` headless and posts final text + a git patch", async () => {
  const api = fakeApi([job("job-1", "claude", "anthropic/claude-sonnet-5")]);
  const { runner, workRoot } = runnerFor(api);
  await runner.tickOnce();

  assert.equal(api.results.length, 1, JSON.stringify(api.events.slice(-3)));
  const r = api.results[0];
  assert.equal(r.status, "completed", r.error);
  assert.equal(r.final_text, "Wrote hello.txt");
  assert.match(r.patch, /diff --git a\/hello\.txt b\/hello\.txt/);
  assert.match(r.patch, /REPORT\.md/, "sidecars ride home even when .gitignore hides them");
  assert.doesNotMatch(r.patch, /README\.md/, "an untouched file is not in the patch");

  const init = api.events.find((e) => e.kind === "message" && /subscription/i.test(String(e.payload.text)));
  assert.ok(init, "the node log says the CLI ran on the user's subscription");
  assert.match(String(init.payload.text), /apiKeySource: none/);
  assert.ok(api.events.some((e) => e.kind === "action" && e.payload.tool_name === "Write"));
  const argvEvent = api.events.find((e) => /--permission-mode acceptEdits/.test(String(e.payload.text)));
  assert.ok(argvEvent, "the exact headless command is logged");
  assert.deepEqual(fs.readdirSync(workRoot), [], "the job's temp copy is cleaned up");
});

test("model slugs are passed to the CLI without the provider prefix", async () => {
  const api = fakeApi([job("job-2", "claude", "anthropic/claude-sonnet-5")]);
  const { runner } = runnerFor(api);
  await runner.tickOnce();
  const started = api.events.find((e) => /model claude-sonnet-5/.test(String(e.payload.text)));
  assert.ok(started, JSON.stringify(api.events.map((e) => e.payload)));
});

test("a claimed Grok job runs `grok --prompt-file … --output-format streaming-json`", async () => {
  const api = fakeApi([job("job-3", "grok", "xai/grok-4.7")]);
  const { runner } = runnerFor(api);
  await runner.tickOnce();
  assert.equal(api.results.length, 1);
  const r = api.results[0];
  assert.equal(r.status, "completed", r.error);
  assert.match(r.final_text, /Done: wrote notes\.md/);
  assert.match(r.patch, /notes\.md/);
  assert.ok(api.events.some((e) => e.kind === "action"));
});

test("one running job per provider: a busy provider is not claimed again", async () => {
  const api = fakeApi([
    job("job-a", "claude", "anthropic/claude-sonnet-5"),
    job("job-b", "claude", "anthropic/claude-sonnet-5"),
  ]);
  const { runner } = runnerFor(api, { baseEnv: { ...LEAKY_BASE_ENV, FAKE_CLI_SLEEP_MS: "300" } });
  const first = runner.tickOnce();
  await new Promise((r) => setTimeout(r, 60));
  await runner.tickOnce({ wait: false });
  assert.ok(
    api.claims.slice(1).every((providers) => !providers.includes("claude")),
    `claude was re-claimed while busy: ${JSON.stringify(api.claims)}`,
  );
  await first;
});

test("stop() kills an in-flight CLI and posts no result (the server times the job out)", async () => {
  const api = fakeApi([job("job-s", "claude", "anthropic/claude-sonnet-5")]);
  const { runner, workRoot } = runnerFor(api, {
    baseEnv: { ...LEAKY_BASE_ENV, FAKE_CLI_SLEEP_MS: "5000" },
  });
  const inFlight = runner.tickOnce();
  await new Promise((r) => setTimeout(r, 300));
  await runner.stop();
  await inFlight;
  assert.equal(api.results.length, 0);
  assert.deepEqual(fs.readdirSync(workRoot), []);
});

test("stop({release: true}) hands the in-flight job back to the queue (DB-7)", async () => {
  const api = fakeApi([job("job-q", "claude", "anthropic/claude-sonnet-5")]);
  api.released = [];
  api.releaseJob = async (id) => {
    api.released.push(id);
  };
  const { runner } = runnerFor(api, {
    baseEnv: { ...LEAKY_BASE_ENV, FAKE_CLI_SLEEP_MS: "5000" },
  });
  const inFlight = runner.tickOnce();
  await new Promise((r) => setTimeout(r, 300));
  await runner.stop({ release: true });
  await inFlight;
  assert.deepEqual(api.released, ["job-q"]);
  assert.equal(api.results.length, 0);
});

test("a result POST that hits a control-plane restart is retried, not lost", async () => {
  const api = fakeApi([job("job-r", "claude", "anthropic/claude-sonnet-5")]);
  let failures = 2;
  const realPost = api.postResult;
  api.postResult = async (jobId, body) => {
    if (failures > 0) {
      failures -= 1;
      throw new Error("ECONNREFUSED");
    }
    return realPost(jobId, body);
  };
  const { runner } = runnerFor(api, { resultRetryMs: 10 });
  await runner.tickOnce();
  assert.equal(api.results.length, 1);
  assert.equal(api.results[0].status, "completed");
});

test("a 409 (job already expired) is not retried", async () => {
  const api = fakeApi([job("job-409", "claude", "anthropic/claude-sonnet-5")]);
  let calls = 0;
  api.postResult = async () => {
    calls += 1;
    const e = new Error("POST … -> 409");
    e.status = 409;
    throw e;
  };
  const { runner } = runnerFor(api, { resultRetryMs: 10 });
  await runner.tickOnce();
  assert.ok(calls <= 2, `retried a 409 ${calls} times`);
});

// M-subs-prod: prod runs several Fly machines, each with its own disk. A snapshot GET that reaches
// a machine without the run's workspace answers 409 (Fly's proxy normally replays it to the right
// machine first; the 409 is what's left if that couldn't happen yet — e.g. the job is moving).
function snapshot409() {
  const e = new Error("GET /api/desktop-runner/jobs/x/snapshot -> 409");
  e.status = 409;
  return e;
}

test("a snapshot 409 (workspace on another machine) is retried, then the job runs", async () => {
  const api = fakeApi([job("job-snap", "claude", "anthropic/claude-sonnet-5")]);
  let calls = 0;
  const realSnapshot = api.snapshot;
  api.snapshot = async (jobId) => {
    calls += 1;
    if (calls <= 2) throw snapshot409();
    return realSnapshot(jobId);
  };
  const { runner } = runnerFor(api, { snapshotRetryMs: 10 });
  await runner.tickOnce();
  assert.equal(calls, 3);
  assert.equal(api.results.length, 1);
  assert.equal(api.results[0].status, "completed", api.results[0].error);
});

test("a snapshot that keeps 409-ing fails the job after a few tries", async () => {
  const api = fakeApi([job("job-snap-x", "claude", "anthropic/claude-sonnet-5")]);
  let calls = 0;
  api.snapshot = async () => {
    calls += 1;
    throw snapshot409();
  };
  const { runner, workRoot } = runnerFor(api, { snapshotRetryMs: 10 });
  await runner.tickOnce();
  assert.ok(calls >= 3 && calls <= 6, `tried ${calls} times`);
  assert.equal(api.results.length, 1);
  assert.equal(api.results[0].status, "failed");
  assert.match(api.results[0].error, /workspace from Tvashtr \(409 after 6 tries\)/);
  assert.deepEqual(fs.readdirSync(workRoot), []);
});

test("a snapshot 404 (not this user's job) is not retried", async () => {
  const api = fakeApi([job("job-snap-404", "claude", "anthropic/claude-sonnet-5")]);
  let calls = 0;
  api.snapshot = async () => {
    calls += 1;
    const e = new Error("GET … -> 404");
    e.status = 404;
    throw e;
  };
  const { runner } = runnerFor(api, { snapshotRetryMs: 10 });
  await runner.tickOnce();
  assert.equal(calls, 1);
  assert.equal(api.results[0].status, "failed");
});

// Independent review (revamp-finish), DB-7 gaps.
test("a job whose claim returns after stop() is handed straight back, never run", async () => {
  const api = fakeApi([job("job-late", "claude", "anthropic/claude-sonnet-5")]);
  api.released = [];
  api.releaseJob = async (id) => {
    api.released.push(id);
  };
  let answer;
  const realClaim = api.claim.bind(api);
  api.claim = (providers) =>
    new Promise((resolve) => {
      answer = () => resolve(realClaim(providers));
    });
  const { runner } = runnerFor(api);
  const tick = runner.tickOnce();
  await new Promise((r) => setTimeout(r, 50)); // the poll is in flight
  const stopping = runner.stop({ release: true });
  answer(); // …and it comes back with a job after the quit began
  await stopping;
  await tick;
  assert.deepEqual(api.released, ["job-late"]);
  assert.equal(api.results.length, 0);
  assert.deepEqual(runner.activeJobs(), []);
});

test("a stop that lands before the CLI starts leaves no CLI running", async () => {
  const api = fakeApi([job("job-early", "claude", "anthropic/claude-sonnet-5")]);
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const { runner } = runnerFor(api, {
    baseEnv: { ...LEAKY_BASE_ENV, FAKE_CLI_SLEEP_MS: "5000" },
    binaryFor: async () => {
      await gate; // still looking for the CLI when the user quits
      return FAKE_CLAUDE;
    },
  });
  const tick = runner.tickOnce();
  await new Promise((r) => setTimeout(r, 300));
  const t0 = Date.now();
  const stopping = runner.stop();
  setTimeout(() => release(), 50);
  await stopping;
  await tick;
  // Before the fix the CLI spawned anyway, the "stopped before start" kill was a no-op, and
  // stop() sat out its whole 5 s cap waiting for the orphan.
  assert.ok(Date.now() - t0 < 3000, `stop took ${Date.now() - t0} ms`);
  assert.equal(api.results.length, 0);
});

// M-desk-7 S4: a Grok job is locked to its own copy by Grok's kernel sandbox (grokLock.cjs); the fake
// grok applies the job's profile as Grok documents it (fixtures/grokSandbox.cjs).
const { GROK_LOCK_FAILED, LOCKED_LINE } = require("../electron/runner/grokLock.cjs");

const texts = (api) => api.events.map((e) => String(e.payload.text ?? e.payload.error ?? ""));

test("S4: a Grok job runs in its own folder outside home, under its own profile, and says it's locked", async () => {
  const api = fakeApi([job("job-g1", "grok", "xai/grok-4.7")]);
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tv-home-")));
  const { runner, grokRoot } = runnerFor(api, {
    home,
    baseEnv: {
      ...LEAKY_BASE_ENV,
      FAKE_GROK_PROBES: JSON.stringify([
        "README.md",
        `${home}/tvashtr-s4-canary/secret.txt`,
        `${home}/Library/Application Support/Tvashtr/runner-jobs/claude-job/ws/a.py`,
        `${fs.realpathSync(os.tmpdir())}/other-app/cache`,
        "/Volumes/Backup/x",
        "/private/tmp/x",
      ]),
    },
  });
  await runner.tickOnce();
  const r = api.results[0];
  assert.equal(r.status, "completed", r.error);
  const lines = texts(api);
  const run = lines.findIndex((t) => t.startsWith("Running on this computer with your own Grok Build: "));
  assert.ok(run >= 0, JSON.stringify(lines));
  assert.match(lines[run], / --sandbox tvashtr-j[0-9a-f]{8}$/, "the job's own profile, not `workspace`");
  const cwd = lines[run].match(/ --cwd (\S+) /)[1];
  assert.ok(cwd.startsWith(`${fs.realpathSync(grokRoot)}/j`), cwd);
  assert.ok(!cwd.startsWith(fs.realpathSync(home)), "outside the home folder");
  assert.equal(lines[run + 1], LOCKED_LINE.grok);
  assert.equal(LOCKED_LINE.grok, "Grok Build is locked to this job's copy of the repo — it can't open your other files.");
  const said = lines.join("\n").split("\n");
  assert.deepEqual(
    said.filter((t) => t.startsWith("probe ")).map((t) => t.replace(/^probe .*: /, "")),
    ["OPENED", "REFUSED", "REFUSED", "REFUSED", "REFUSED", "REFUSED"],
  );
  const env = JSON.parse(said.find((t) => t.startsWith("env ")).slice(4));
  assert.deepEqual(
    [env.GROK_CLAUDE_MCPS_ENABLED, env.GROK_CURSOR_MCPS_ENABLED, env.GROK_CLAUDE_HOOKS_ENABLED, env.GROK_CURSOR_HOOKS_ENABLED],
    ["0", "0", "0", "0"],
  );
  assert.ok(env.TMPDIR.startsWith(`${path.dirname(cwd)}/tmp`), "its temp files stay in its own folder");
  assert.match(r.patch, /notes\.md/);
  assert.doesNotMatch(r.patch, /\.grok|prompt\.txt|lockcheck/, "never Tvashtr's own files");
  assert.deepEqual(fs.readdirSync(grokRoot), [], "the job's folder is cleaned up");
});

test("S4: the repo's own .grok/ never applies to the job and comes back unchanged (no .grok in the patch)", async () => {
  const api = fakeApi([job("job-g2", "grok", "xai/grok-4.7")]);
  api.snapshot = async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "tv-src-"));
    fs.writeFileSync(path.join(src, "README.md"), "# demo\n");
    fs.mkdirSync(path.join(src, ".grok", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(src, ".grok", "config.toml"), '[mcp_servers.x]\ncommand = "touch"\n');
    fs.writeFileSync(path.join(src, ".grok", "sandbox.toml"), '[profiles.x]\nextends = "off"\n');
    fs.writeFileSync(path.join(src, ".grok", "hooks", "a.json"), "{}");
    return childProcess.execFileSync("tar", ["-czf", "-", "-C", src, "."]);
  };
  const { runner } = runnerFor(api);
  await runner.tickOnce();
  const r = api.results[0];
  assert.equal(r.status, "completed", r.error);
  assert.ok(!texts(api).some((t) => /repo's \.grok\/config\.toml is here/.test(t)), "the repo's config was set aside");
  assert.ok(texts(api).some((t) => /^env /m.test(t)), "the fake grok really ran");
  assert.match(r.patch, /notes\.md/);
  assert.doesNotMatch(r.patch, /\.grok/, "the repo's .grok/ is back byte for byte");
});

test("S4: a Grok that can't be locked fails closed with the exact reason, before any model call", async () => {
  const api = fakeApi([job("job-g3", "grok", "xai/grok-4.7")]);
  const { runner, grokRoot } = runnerFor(api, {
    baseEnv: { ...LEAKY_BASE_ENV, FAKE_GROK_IGNORES_PROFILES: "1" },
  });
  await runner.tickOnce();
  const r = api.results[0];
  assert.equal(r.status, "failed");
  assert.equal(r.error, GROK_LOCK_FAILED);
  assert.equal(
    GROK_LOCK_FAILED,
    "Grok Build couldn't lock itself to this job's copy of the repo on this Mac, so Tvashtr didn't start it. " +
      "Nothing on your Mac was opened, and nothing was used from your Grok plan. Update Grok Build, or switch this step to Claude.",
  );
  assert.equal(r.patch, "");
  assert.ok(!texts(api).some((t) => t.startsWith("Running on this computer")), "the CLI never ran");
  assert.ok(texts(api).includes(GROK_LOCK_FAILED), "the run log says why");
  assert.deepEqual(fs.readdirSync(grokRoot), []);
});

test("S4: off a Mac there is no kernel profile to write, so a Grok job fails closed too", async () => {
  const api = fakeApi([job("job-g4", "grok", "xai/grok-4.7")]);
  const { runner } = runnerFor(api, { platform: "linux" });
  await runner.tickOnce();
  assert.equal(api.results[0].error, GROK_LOCK_FAILED);
});

test("S4: a Claude job keeps its arguments and its folder, and says it's locked to its copy", async () => {
  const api = fakeApi([job("job-c1", "claude", "anthropic/claude-sonnet-5")]);
  const { runner, workRoot } = runnerFor(api);
  await runner.tickOnce();
  assert.equal(api.results[0].status, "completed", api.results[0].error);
  const lines = texts(api);
  const run = lines.findIndex((t) => t.startsWith("Running on this computer with your own Claude Code: "));
  assert.match(
    lines[run],
    / -p --output-format stream-json --verbose --model claude-sonnet-5 --permission-mode acceptEdits --permission-prompts none --restricted --safe-mode --no-session-persistence \(prompt on stdin\)$/,
  );
  assert.equal(lines[run + 1], LOCKED_LINE.claude);
  assert.equal(LOCKED_LINE.claude, "Claude Code is locked to this job's copy of the repo — it can't open your other files.");
  assert.deepEqual(fs.readdirSync(workRoot), []);
});
