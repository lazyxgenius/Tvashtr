/**
 * App-launch engine check (M-subs-desktop A3): probe each engine ONCE by asking its own CLI, cache
 * the result locally, and push it to the server mirror. There is no timer — later probes happen
 * only on Connect / Refresh / window focus after a login was started.
 *
 * A provider the user disconnected in Tvashtr (``isUserDisconnected``) is NOT probed: it boots as
 * Disconnected and its mirror row is cleared, even though its CLI is still signed in (B1).
 */
const { sanitizeStatus } = require("../harness/statusStore.cjs");

function disconnectedStatus(provider) {
  return {
    provider,
    connected: false,
    state: "disconnected",
    account_hint: null,
    source: null,
    checked_at: null,
  };
}

function errorStatus(provider) {
  return {
    provider,
    connected: false,
    state: "error",
    account_hint: null,
    source: "harness",
    checked_at: new Date().toISOString(),
  };
}

/**
 * @param {{ providers: string[], registry: { get(p: string): any },
 *   store: { write(p: string, s: object): unknown },
 *   statusSync: { push(s: object): Promise<void>, clear?(p: string): Promise<void> },
 *   isUserDisconnected?: (p: string) => boolean, log?: (m: string) => void }} deps
 */
async function bootEngines({
  providers,
  registry,
  store,
  statusSync,
  isUserDisconnected = () => false,
  log = () => {},
}) {
  const out = [];
  for (const provider of providers) {
    const harness = registry.get(provider);
    if (!harness) continue;
    if (isUserDisconnected(provider)) {
      const status = disconnectedStatus(provider);
      store.write(provider, status);
      out.push(status);
      if (typeof statusSync.clear === "function") await statusSync.clear(provider);
      continue;
    }
    let status;
    try {
      status = sanitizeStatus(await harness.toStatus()) || errorStatus(provider);
    } catch (e) {
      log(`[engines] ${provider} probe failed: ${e && e.message ? e.message : e}`);
      status = errorStatus(provider);
    }
    status.provider = provider;
    store.write(provider, status);
    out.push(status);
    await statusSync.push(status);
  }
  return out;
}

module.exports = { bootEngines, errorStatus, disconnectedStatus };
