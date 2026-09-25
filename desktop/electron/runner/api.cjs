/**
 * The Desktop runner's HTTP client. It talks to the SAME local origin the UI loads from (the local
 * proxy → the Tvashtr control plane) with the SAME `tv_session` cookie the UI uses — a Tvashtr
 * session, never a vendor credential. Bodies are status / job data only.
 */
const fs = require("fs");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");

function httpError(method, pathname, status, detail = null) {
  const e = new Error(`${method} ${pathname} -> ${status}`);
  /** @type {any} */ (e).status = status;
  /** @type {any} */ (e).detail = detail;
  return e;
}

/** The FastAPI ``detail`` of an error response, when it is a readable string. */
async function errorDetail(res) {
  try {
    const body = await res.json();
    if (body && typeof body.detail === "string") return body.detail;
    if (body && body.detail && typeof body.detail.message === "string") return body.detail.message;
  } catch {
    /* not JSON */
  }
  return null;
}

/** Big repo bundles take a while over a home connection. */
const TRANSFER_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * @param {{ baseUrl: () => string, cookieHeader: () => Promise<string|null>,
 *   fetchImpl?: typeof fetch, timeoutMs?: number }} deps
 */
function createRunnerApi({ baseUrl, cookieHeader, fetchImpl = fetch, timeoutMs = 60000 }) {
  async function request(method, pathname, json) {
    const headers = { accept: "application/json" };
    const cookie = await cookieHeader();
    if (cookie) headers.cookie = cookie;
    if (json !== undefined) headers["content-type"] = "application/json";
    const res = await fetchImpl(`${baseUrl().replace(/\/$/, "")}${pathname}`, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw httpError(method, pathname, res.status);
    return res;
  }

  async function send(method, pathname, { body, headers = {}, timeout = timeoutMs } = {}) {
    const cookie = await cookieHeader();
    const all = { ...headers };
    if (cookie) all.cookie = cookie;
    const res = await fetchImpl(`${baseUrl().replace(/\/$/, "")}${pathname}`, {
      method,
      headers: all,
      body,
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw httpError(method, pathname, res.status, await errorDetail(res));
    return res;
  }

  const jobPath = (id, tail) => `/api/desktop-runner/jobs/${encodeURIComponent(id)}/${tail}`;

  return {
    async claim(providers) {
      const res = await request("POST", "/api/desktop-runner/claim", { providers });
      const body = await res.json();
      return body && body.job ? body.job : null;
    },
    async snapshot(jobId) {
      const res = await request("GET", jobPath(jobId, "snapshot"));
      return Buffer.from(await res.arrayBuffer());
    },
    async postEvents(jobId, events) {
      const res = await request("POST", jobPath(jobId, "events"), { events });
      return res.json();
    },
    async postResult(jobId, body) {
      const res = await request("POST", jobPath(jobId, "result"), body);
      return res.json();
    },
    async putStatus(provider, body) {
      await request("PUT", `/api/engines/subscriptions/${encodeURIComponent(provider)}`, body);
    },
    async deleteStatus(provider) {
      await request("DELETE", `/api/engines/subscriptions/${encodeURIComponent(provider)}`);
    },
    /**
     * P10: upload a `git bundle` of a local folder's base branch (multipart `bundle`, `label`,
     * `base_ref`) → `{snapshot_id, size_bytes}`. Errors carry `.status` and the server `.detail`.
     */
    async uploadRepoSnapshot({ file, label, baseRef }) {
      const form = new FormData();
      form.append("bundle", await fs.openAsBlob(file), "repo.bundle");
      form.append("label", label);
      form.append("base_ref", baseRef);
      const res = await send("POST", "/api/desktop/repo-snapshots", {
        body: form,
        headers: { accept: "application/json" },
        timeout: TRANSFER_TIMEOUT_MS,
      });
      return res.json();
    },
    /** P10: stream a run's result bundle to ``destFile`` (at most ``maxBytes``). */
    async downloadShipBundle(runId, destFile, { maxBytes }) {
      const res = await send("GET", `/api/runs/${encodeURIComponent(runId)}/ship-bundle`, {
        timeout: TRANSFER_TIMEOUT_MS,
      });
      const tooBig = () => {
        const e = new Error("result bundle too large");
        /** @type {any} */ (e).code = "too_large";
        return e;
      };
      if (Number(res.headers.get("content-length") || 0) > maxBytes) throw tooBig();
      if (!res.body) throw new Error("empty response");
      let seen = 0;
      const limit = new Transform({
        transform(chunk, _enc, done) {
          seen += chunk.length;
          done(seen > maxBytes ? tooBig() : null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(/** @type {any} */ (res.body)),
        limit,
        fs.createWriteStream(destFile),
      );
      return { size_bytes: seen };
    },
  };
}

module.exports = { createRunnerApi, httpError };
