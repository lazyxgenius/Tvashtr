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
  const runner = createRunner({
    api,
    workRoot,
    baseEnv: LEAKY_BASE_ENV,
    pathDirs: async () => [],
    connectedProviders: () => ["claude", "grok"],
    binaryFor: async (provider) => (provider === "claude" ? FAKE_CLAUDE : FAKE_GROK),
    pollMs: 10,
    heartbeatMs: 50,
    ...extra,
  });
  return { runner, workRoot };
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
