/**
 * Push the Desktop's engine status to the secret-free server mirror (M-subs-desktop A3).
 *
 * The main process pushes at app launch and on connect / refresh / disconnect — only the four
 * status fields ever leave the app (the server rejects anything secret-looking anyway). A push
 * that fails (typically: the user is not signed in to Tvashtr yet) is remembered and replayed the
 * first time the runner's poll succeeds.
 */
const STATUS_BODY_KEYS = Object.freeze(["connected", "state", "account_hint", "source"]);

/** @param {Record<string, unknown>} status */
function statusBody(status) {
  return {
    connected: status.connected === true,
    state: typeof status.state === "string" ? status.state : "disconnected",
    account_hint: typeof status.account_hint === "string" ? status.account_hint : null,
    source: status.source === "harness" || status.source === "oauth" ? status.source : null,
  };
}

/**
 * @param {{ api: { putStatus: Function, deleteStatus: Function }, log?: (msg: string) => void }} deps
 */
function createStatusSync({ api, log = () => {} }) {
  /** @type {Map<string, { kind: "put", body: object } | { kind: "delete" }>} */
  const pending = new Map();

  async function apply(provider, op) {
    if (op.kind === "put") await api.putStatus(provider, op.body);
    else await api.deleteStatus(provider);
  }

  async function run(provider, op) {
    pending.set(provider, op);
    try {
      await apply(provider, op);
      if (pending.get(provider) === op) pending.delete(provider);
    } catch (e) {
      log(`[engines] mirror ${op.kind} ${provider} deferred: ${e && e.message ? e.message : e}`);
    }
  }

  return {
    push: (status) => run(String(status.provider), { kind: "put", body: statusBody(status) }),
    clear: (provider) => run(String(provider), { kind: "delete" }),
    async pushAll(statuses) {
      for (const s of statuses) await run(String(s.provider), { kind: "put", body: statusBody(s) });
    },
    async replayPending() {
      for (const [provider, op] of [...pending]) await run(provider, op);
    },
    hasPending: () => pending.size > 0,
  };
}

module.exports = { createStatusSync, statusBody, STATUS_BODY_KEYS };
