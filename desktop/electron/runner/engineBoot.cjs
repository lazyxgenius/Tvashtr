/**
 * App-launch engine check (M-subs-desktop A3): probe each engine ONCE by asking its own CLI, cache
 * the result locally, and push it to the server mirror. There is no timer — later probes happen
 * only on Connect / Refresh / window focus after a login was started.
 */
const { sanitizeStatus } = require("../harness/statusStore.cjs");

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
 *   statusSync: { push(s: object): Promise<void> }, log?: (m: string) => void }} deps
 */
async function bootEngines({ providers, registry, store, statusSync, log = () => {} }) {
  const out = [];
  for (const provider of providers) {
    const harness = registry.get(provider);
    if (!harness) continue;
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

module.exports = { bootEngines };
