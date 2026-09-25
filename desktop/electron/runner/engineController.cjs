/**
 * Engine status for the Desktop bridge (`window.tvashtrDesktop.engines`) — the logic behind the
 * `tvashtr:engines:*` IPC handlers, kept out of main.cjs so it can be tested without Electron.
 *
 * - Status is asked of each user's OWN CLI once at launch (bootEngines), then only on Connect /
 *   Refresh / window focus after a Connect — never on a timer (A3). getStatus returns the cache.
 * - Every status change is pushed to the secret-free server mirror (A3) — launch included.
 * - Connect opens the vendor's own login in Terminal and returns at once (§3.0); focusing the window
 *   again re-asks the CLI until it is connected, `cancelConnect` stops that, or 30 min pass.
 * - Disconnect is sticky across relaunch (B1): the provider is not probed again until Connect.
 * - Refresh never rejects (B5): a probe that throws records and returns an `error` status.
 */
const { sanitizeStatus } = require("../harness/statusStore.cjs");
const { bootEngines, errorStatus, disconnectedStatus } = require("./engineBoot.cjs");

/** How long after Connect a window-focus re-probe still counts as "finishing a login". */
const LOGIN_REPROBE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Strip non-status keys before anything reaches the renderer or the store.
 * @param {unknown} row
 * @param {string} provider
 */
function toRendererStatus(row, provider) {
  const cleaned = sanitizeStatus(/** @type {any} */ (row)) || disconnectedStatus(provider);
  if (cleaned.provider !== provider) cleaned.provider = provider;
  return cleaned;
}

/**
 * @param {{
 *   providers: readonly string[],
 *   registry: { get(p: string): any },
 *   store: { read(p: string): any, write(p: string, s: object): unknown, clear(p: string): void },
 *   prefs: { isUserDisconnected(p: string): boolean, markUserDisconnected(p: string): void,
 *            clearUserDisconnected(p: string): void },
 *   statusSync: { push(s: object): Promise<void>, clear(p: string): Promise<void> },
 *   notify?: (status: object) => void,
 *   now?: () => number,
 *   log?: (m: string) => void,
 *   loginReprobeWindowMs?: number,
 * }} deps
 */
function createEngineController({
  providers,
  registry,
  store,
  prefs,
  statusSync,
  notify = () => {},
  now = Date.now,
  log = () => {},
  loginReprobeWindowMs = LOGIN_REPROBE_WINDOW_MS,
}) {
  /** @type {Map<string, number>} provider -> when Connect opened the vendor login */
  const pendingLogins = new Map();
  const known = (p) => providers.includes(p);

  const cached = (provider) => {
    const stored = store.read(provider);
    return stored ? toRendererStatus(stored, provider) : disconnectedStatus(provider);
  };

  const record = async (provider, raw) => {
    const status = toRendererStatus(raw, provider);
    store.write(provider, status);
    await statusSync.push(status);
    notify(status);
    return status;
  };

  const recordError = async (provider, err) => {
    log(`[engines] ${provider} check failed: ${err && err.message ? err.message : err}`);
    const status = errorStatus(provider);
    try {
      return await record(provider, status);
    } catch (e) {
      log(`[engines] ${provider} error status not saved: ${e && e.message ? e.message : e}`);
      notify(status);
      return status;
    }
  };

  /** Ask the CLI again — unless the user disconnected this provider in Tvashtr. */
  const probe = async (provider) => {
    if (prefs.isUserDisconnected(provider)) return cached(provider);
    const harness = registry.get(provider);
    if (!harness) return cached(provider);
    try {
      const raw = await harness.toStatus();
      // The user pressed Disconnect while the CLI was answering: keep it disconnected.
      if (prefs.isUserDisconnected(provider)) return cached(provider);
      return await record(provider, raw);
    } catch (err) {
      return recordError(provider, err);
    }
  };

  return {
    /** The one launch-time check. Resolves when every provider has a cached status. */
    boot: () =>
      bootEngines({
        providers: [...providers],
        registry,
        store: { write: (p, st) => store.write(p, toRendererStatus(st, p)) },
        statusSync,
        isUserDisconnected: (p) => prefs.isUserDisconnected(p),
        log,
      }),

    getStatus: () => providers.map(cached),

    async connect(provider) {
      const id = String(provider || "");
      const harness = known(id) ? registry.get(id) : null;
      if (!harness) return disconnectedStatus(id || "claude");
      prefs.clearUserDisconnected(id);
      const raw = await harness.connect();
      if (prefs.isUserDisconnected(id)) return cached(id); // disconnected meanwhile
      const status = await record(id, raw);
      if (!status.connected && status.state !== "needs_install") pendingLogins.set(id, now());
      return status;
    },

    async disconnect(provider) {
      const id = String(provider || "");
      pendingLogins.delete(id);
      prefs.markUserDisconnected(id);
      store.clear(id);
      await statusSync.clear(id);
      const status = disconnectedStatus(id);
      notify(status);
      return status;
    },

    async refresh(provider) {
      const id = String(provider || "");
      if (!known(id)) return disconnectedStatus(id || "claude");
      const status = await probe(id);
      if (status.connected) pendingLogins.delete(id);
      return status;
    },

    /** Stop re-asking the CLI on window focus after Connect. It can't close the Terminal window. */
    cancelConnect(provider) {
      const id = String(provider || "");
      pendingLogins.delete(id);
      return known(id) ? cached(id) : disconnectedStatus(id || "claude");
    },

    /** After Connect opened Terminal, re-ask the CLI when the user comes back to Tvashtr. */
    onWindowFocus() {
      const t = now();
      const probes = [];
      for (const [id, startedAt] of [...pendingLogins]) {
        if (t - startedAt > loginReprobeWindowMs) {
          pendingLogins.delete(id);
          continue;
        }
        probes.push(
          probe(id).then((st) => {
            if (st.connected) pendingLogins.delete(id);
          }),
        );
      }
      return Promise.allSettled(probes);
    },

    /** Providers the runner may claim jobs for. */
    connectedProviders: () =>
      providers.filter((p) => {
        if (prefs.isUserDisconnected(p)) return false;
        const st = store.read(p);
        return Boolean(st && st.connected === true);
      }),

    pendingLogins: () => [...pendingLogins.keys()],
  };
}

module.exports = { createEngineController, toRendererStatus, LOGIN_REPROBE_WINDOW_MS };
