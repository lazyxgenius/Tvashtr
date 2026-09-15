/**
 * Local subscription-run supervisor (skeleton).
 * Tracks spawned worker pids, forwards log lines, stops on quit.
 * YAGNI: no full agent loop; log-only placeholder worker.
 */
const { spawn: defaultSpawn } = require("child_process");
const crypto = require("crypto");

/**
 * @param {{
 *   spawn?: (...args: unknown[]) => import('child_process').ChildProcess,
 *   sendLog?: (payload: { localRunId: string, line: string }) => void,
 * }} [deps]
 */
function createLocalRunSupervisor(deps = {}) {
  const spawnFn = typeof deps.spawn === "function" ? deps.spawn : defaultSpawn;
  const sendLog =
    typeof deps.sendLog === "function"
      ? deps.sendLog
      : () => {
          /* no-op */
        };

  /** @type {Map<string, { localRunId: string, pid: number | undefined, child: { kill?: Function, on?: Function, stdout?: NodeJS.ReadableStream, stderr?: NodeJS.ReadableStream }, teamGraphId: string, idea: string, provider: string }>} */
  const runs = new Map();

  function emit(localRunId, line) {
    sendLog({ localRunId, line: String(line ?? "") });
  }

  /**
   * @param {{ teamGraphId: string, idea: string, provider?: string }} payload
   * @returns {Promise<{ localRunId: string }>}
   */
  async function startLocal(payload) {
    const teamGraphId = String(payload?.teamGraphId ?? "");
    const idea = String(payload?.idea ?? "");
    const provider = String(payload?.provider || "claude");
    const localRunId = `local-${crypto.randomBytes(6).toString("hex")}`;

    // Skeleton worker: log a start line then idle until killed (injectable spawn for tests).
    const child = spawnFn(
      process.execPath,
      [
        "-e",
        `process.stdout.write("tvashtr local-run skeleton ready\\n"); setInterval(() => {}, 1e6);`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const entry = {
      localRunId,
      pid: child && child.pid,
      child,
      teamGraphId,
      idea,
      provider,
    };
    runs.set(localRunId, entry);

    emit(
      localRunId,
      `[local-run] started id=${localRunId} team=${teamGraphId} provider=${provider} idea=${idea.slice(0, 80)}`,
    );

    const forward = (buf) => {
      const text = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
      for (const line of text.split(/\r?\n/)) {
        if (line) emit(localRunId, line);
      }
    };
    if (child && child.stdout && typeof child.stdout.on === "function") {
      child.stdout.on("data", forward);
    }
    if (child && child.stderr && typeof child.stderr.on === "function") {
      child.stderr.on("data", forward);
    }
    if (child && typeof child.on === "function") {
      child.on("exit", () => {
        if (runs.get(localRunId)?.child === child) {
          runs.delete(localRunId);
          emit(localRunId, `[local-run] exited id=${localRunId}`);
        }
      });
    }

    return { localRunId };
  }

  /**
   * @param {string} localRunId
   */
  async function stopLocal(localRunId) {
    const id = String(localRunId || "");
    const entry = runs.get(id);
    if (!entry) return;
    try {
      if (entry.child && typeof entry.child.kill === "function") {
        entry.child.kill();
      }
    } catch {
      /* ignore */
    }
    runs.delete(id);
    emit(id, `[local-run] stopped id=${id}`);
  }

  async function stopAll() {
    const ids = [...runs.keys()];
    for (const id of ids) {
      await stopLocal(id);
    }
  }

  function list() {
    return [...runs.values()].map((r) => ({
      localRunId: r.localRunId,
      pid: r.pid,
      teamGraphId: r.teamGraphId,
      provider: r.provider,
    }));
  }

  return { startLocal, stopLocal, stopAll, list };
}

module.exports = { createLocalRunSupervisor };
