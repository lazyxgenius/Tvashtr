/**
 * The Desktop runner's HTTP client. It talks to the SAME local origin the UI loads from (the local
 * proxy → the Tvashtr control plane) with the SAME `tv_session` cookie the UI uses — a Tvashtr
 * session, never a vendor credential. Bodies are status / job data only.
 */
function httpError(method, pathname, status) {
  const e = new Error(`${method} ${pathname} -> ${status}`);
  /** @type {any} */ (e).status = status;
  return e;
}

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
  };
}

module.exports = { createRunnerApi };
