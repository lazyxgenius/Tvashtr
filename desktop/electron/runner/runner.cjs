/**
 * Tvashtr Desktop runner (M-subs-desktop §3.1/§3.3) — replaces the old log-only localRuns
 * placeholder.
 *
 * Analogy: a GitHub Actions self-hosted runner. The hosted control plane still owns the team graph
 * (routing, gates, documents, loop caps, PR shipping); only the "hands" of a subscription node run
 * here, on the user's own machine, with the user's OWN installed CLI and its own sign-in.
 *
 * Loop: while the app is open, poll `POST /api/desktop-runner/claim` (each poll is also the
 * runner heartbeat the server's freshness check reads). A claimed job is run in its own temp copy
 * of the repo: snapshot → base commit → the CLI headless (clean env, enriched PATH) → stream its
 * output as run events → post back ONLY the final text + a git patch. At most one job per provider
 * at a time. `stop()` (app quit) kills in-flight CLIs and posts nothing — the server fails the node
 * with "Tvashtr Desktop went offline" once the job's heartbeat goes stale.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const childProcess = require("child_process");

const { buildChildEnv } = require("../harness/spawnEnv.cjs");
const { buildCliInvocation, RUNNABLE_PROVIDERS, DISPLAY } = require("./cliCommand.cjs");
const { createClaudeStreamParser, createGrokStreamParser, cap } = require("./streamEvents.cjs");
const { createWorkspaceOps } = require("./workspace.cjs");

const MAX_PATCH_BYTES = 40 * 1024 * 1024;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** POST the result, riding out a control-plane restart (a lost result = an "offline" node). */
async function postResultWithRetry(api, jobId, body, { attempts = 6, delayMs = 2000, log }) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await api.postResult(jobId, body);
    } catch (e) {
      lastErr = e;
      // 4xx (other than 408/429) will not get better — e.g. 409: the job already expired.
      const status = e && e.status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) throw e;
      log(`[runner] result post for ${jobId} failed (attempt ${i + 1}): ${e && e.message ? e.message : e}`);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

/**
 * GET the job's workspace snapshot, retrying a 409. Prod runs several Fly machines, each with its
 * own disk, and only the one executing the run holds its workspace: Fly's proxy replays the GET
 * there (`fly-replay`), and a 409 is what's left when that couldn't happen yet — the holder was
 * briefly unreachable, or the run is being recovered onto another machine, which re-creates the
 * workspace and re-points the job (a re-clone takes a while, hence ~25 s in all). The job's
 * heartbeat keeps flowing meanwhile. Any other status fails at once.
 */
async function snapshotWithRetry(api, jobId, { attempts = 6, delayMs = 5000, log, cancelled }) {
  for (let i = 1; ; i += 1) {
    try {
      return await api.snapshot(jobId);
    } catch (e) {
      if (!(e && e.status === 409) || cancelled()) throw e;
      if (i >= attempts) {
        throw new Error(
          `couldn't get this run's workspace from Tvashtr (409 after ${attempts} tries) — ` +
            "the server running it may be restarting; retry the run",
        );
      }
      log(`[runner] snapshot for ${jobId} got 409 (attempt ${i}/${attempts}) — retrying`);
      await sleep(delayMs);
    }
  }
}

function safeId(id) {
  return String(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "job";
}

/**
 * @param {{
 *   api: { claim: Function, snapshot: Function, postEvents: Function, postResult: Function },
 *   workRoot: string,
 *   baseEnv?: NodeJS.ProcessEnv,
 *   pathDirs?: () => Promise<string[]>,
 *   connectedProviders: () => string[],
 *   binaryFor: (provider: string) => Promise<string|null>,
 *   spawn?: typeof childProcess.spawn,
 *   workspaceOps?: ReturnType<typeof createWorkspaceOps>,
 *   pollMs?: number,
 *   heartbeatMs?: number,
 *   flushMs?: number,
 *   log?: (msg: string) => void,
 *   onPollOk?: () => void,
 *   resultRetryMs?: number,
 *   snapshotRetryMs?: number,
 * }} deps
 */
function createRunner({
  api,
  workRoot,
  baseEnv = process.env,
  pathDirs = async () => [],
  connectedProviders,
  binaryFor,
  spawn = childProcess.spawn,
  workspaceOps = createWorkspaceOps(),
  pollMs = 3000,
  heartbeatMs = 10000,
  flushMs = 1000,
  log = () => {},
  onPollOk = () => {},
  resultRetryMs = 2000,
  snapshotRetryMs = 5000,
}) {
  let stopped = false;
  let looping = false;
  /** @type {Map<string, { jobId: string, child: any, cancelled: boolean, promise: Promise<void> }>} */
  const active = new Map();

  async function childEnv() {
    return buildChildEnv(baseEnv, { pathDirs: await pathDirs() });
  }

  function freeProviders() {
    return (connectedProviders() || []).filter(
      (p) => RUNNABLE_PROVIDERS.includes(p) && !active.has(p),
    );
  }

  async function runJob(job, entry) {
    const dir = path.join(workRoot, safeId(job.id));
    const ws = path.join(dir, "ws");
    let seq = 0;
    const pending = [];
    const emit = (kind, payload) => pending.push({ seq: seq++, kind, payload });
    let flushing = Promise.resolve();
    const flush = () => {
      flushing = flushing.then(async () => {
        if (entry.cancelled) return;
        const batch = pending.splice(0, pending.length);
        try {
          const r = await api.postEvents(job.id, batch);
          if (r && r.cancelled) cancel("the control plane cancelled this job");
        } catch (e) {
          pending.unshift(...batch);
          log(`[runner] events post failed for ${job.id}: ${e && e.message ? e.message : e}`);
        }
      });
      return flushing;
    };
    const cancel = (why) => {
      if (entry.cancelled) return;
      entry.cancelled = true;
      log(`[runner] job ${job.id} cancelled: ${why}`);
      if (entry.child) {
        try {
          entry.child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
      }
    };
    entry.cancel = cancel;

    const flushTimer = setInterval(() => {
      if (pending.length) void flush();
    }, flushMs);
    const heartbeatTimer = setInterval(() => void flush(), heartbeatMs);
    try {
      fs.mkdirSync(ws, { recursive: true });
      const env = await childEnv();
      const name = DISPLAY[job.provider] || job.provider;
      const tarball = await snapshotWithRetry(api, job.id, {
        delayMs: snapshotRetryMs,
        log,
        cancelled: () => entry.cancelled || stopped,
      });
      if (entry.cancelled) return;
      const base = await workspaceOps.materialize({
        tarball,
        dir,
        ws,
        env,
        sidecars: job.sidecars,
      });
      const binaryPath = await binaryFor(job.provider);
      if (!binaryPath) throw new Error(`${name} CLI was not found on this computer`);
      const promptFile = path.join(dir, "prompt.txt");
      fs.writeFileSync(promptFile, String(job.instruction || ""), { mode: 0o600 });
      const inv = buildCliInvocation({
        provider: job.provider,
        model: job.model,
        binaryPath,
        workspace: ws,
        promptFile,
        prompt: String(job.instruction || ""),
      });
      emit("message", {
        source: "tvashtr-desktop",
        text: `Running on this computer with your own ${name}: ${inv.display}`,
      });
      await flush();

      const parser = job.provider === "claude" ? createClaudeStreamParser() : createGrokStreamParser();
      const stderrTail = [];
      const exit = await new Promise((resolve) => {
        const child = spawn(inv.cmd, inv.args, {
          cwd: ws,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        entry.child = child;
        if (entry.cancelled) cancel("stopped before start");
        child.on("error", (err) => {
          stderrTail.push(String(err && err.message ? err.message : err));
          resolve({ code: -1 });
        });
        child.on("close", (code, signal) => resolve({ code, signal }));
        readline.createInterface({ input: child.stdout }).on("line", (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let obj = null;
          try {
            obj = JSON.parse(trimmed);
          } catch {
            emit("message", { source: job.provider, text: cap(trimmed) });
            return;
          }
          for (const ev of parser.feed(obj)) emit(ev.kind, ev.payload);
        });
        readline.createInterface({ input: child.stderr }).on("line", (line) => {
          if (!line.trim()) return;
          stderrTail.push(line);
          if (stderrTail.length > 40) stderrTail.shift();
          emit("message", { source: `${job.provider}:stderr`, text: cap(line, 1000) });
        });
        if (inv.stdin !== null) {
          child.stdin.on("error", () => {});
          child.stdin.end(inv.stdin);
        } else {
          child.stdin.end();
        }
      });
      entry.child = null;
      if (entry.cancelled || stopped) return; // quit / cancelled: post nothing

      if (typeof parser.finish === "function") {
        for (const ev of parser.finish() || []) emit(ev.kind, ev.payload);
      }
      const st = parser.state;
      const ok = exit.code === 0 && !st.isError;
      let patch = "";
      try {
        patch = await workspaceOps.diff({ ws, env, base, sidecars: job.sidecars });
      } catch (e) {
        if (ok) throw e;
      }
      if (Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES) {
        throw new Error(`the change is too large to send back (${Buffer.byteLength(patch)} bytes)`);
      }
      const error = ok
        ? null
        : st.errorText ||
          `${name} exited with code ${exit.code}${exit.signal ? ` (${exit.signal})` : ""}` +
            (stderrTail.length ? `: ${stderrTail.slice(-3).join(" | ")}` : "");
      emit("message", {
        source: "tvashtr-desktop",
        text: ok
          ? `${name} finished — sending the result and patch (${patch.length} bytes) to Tvashtr`
          : `${name} failed: ${error}`,
      });
      await flush();
      await postResultWithRetry(api, job.id, {
        status: ok ? "completed" : "failed",
        final_text: cap(st.finalText || "", 200000),
        patch,
        error: error ? cap(error, 2000) : null,
        usage: st.usage,
      }, { log, delayMs: resultRetryMs });
    } catch (e) {
      if (!entry.cancelled && !stopped) {
        const msg = e && e.message ? e.message : String(e);
        log(`[runner] job ${job.id} failed: ${msg}`);
        emit("error", { error: cap(msg, 2000) });
        await flush();
        try {
          await api.postResult(job.id, {
            status: "failed",
            final_text: "",
            patch: "",
            error: cap(msg, 2000),
            usage: null,
          });
        } catch (err) {
          log(`[runner] result post failed for ${job.id}: ${err && err.message ? err.message : err}`);
        }
      }
    } finally {
      clearInterval(flushTimer);
      clearInterval(heartbeatTimer);
      await flushing.catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * One poll: heartbeat + (maybe) claim a job for a free provider. ``wait`` awaits the claimed
   * job to completion (tests); the loop passes ``wait: false`` so providers run in parallel.
   */
  async function tickOnce({ wait = true } = {}) {
    if (stopped) return;
    let job = null;
    try {
      job = await api.claim(freeProviders());
      onPollOk();
    } catch (e) {
      log(`[runner] poll failed: ${e && e.message ? e.message : e}`);
      return;
    }
    if (!job || stopped) return;
    if (!RUNNABLE_PROVIDERS.includes(job.provider) || active.has(job.provider)) {
      log(`[runner] ignoring job ${job.id} for busy/unknown provider ${job.provider}`);
      return;
    }
    const entry = { jobId: job.id, child: null, cancelled: false, promise: Promise.resolve() };
    active.set(job.provider, entry);
    entry.promise = runJob(job, entry).finally(() => {
      if (active.get(job.provider) === entry) active.delete(job.provider);
    });
    if (wait) await entry.promise;
  }

  function start() {
    if (looping) return;
    looping = true;
    stopped = false;
    (async () => {
      while (!stopped) {
        await tickOnce({ wait: false });
        await sleep(pollMs);
      }
      looping = false;
    })();
  }

  async function stop() {
    stopped = true;
    const entries = [...active.values()];
    for (const entry of entries) {
      if (entry.cancel) entry.cancel("Tvashtr Desktop is quitting");
      else entry.cancelled = true;
    }
    await Promise.race([
      Promise.allSettled(entries.map((e) => e.promise)),
      sleep(5000),
    ]);
  }

  return {
    start,
    stop,
    tickOnce,
    activeJobs: () => [...active.entries()].map(([provider, e]) => ({ provider, jobId: e.jobId })),
  };
}

module.exports = { createRunner };
