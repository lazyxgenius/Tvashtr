// video/recordings/live-base (capture-live.mjs) → video/fixtures/live-base.json: the latest answer
// to each renderer GET, keyed the way the fixtures route ("GET /api/x?query"). Committed: it holds
// no secret (provider keys appear only as their last 4; the scan below refuses key-like strings).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRecording } from "../camera/intercept.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rec = loadRecording(path.join(here, "..", "recordings", "live-base"));
const routes = {};
for (const e of rec.entries) {
  if (e.method !== "GET" || e.status >= 300) continue;
  const text = Buffer.from(e.body, "base64").toString("utf8");
  try {
    routes[`GET ${e.path}${e.search}`] = JSON.parse(text);
  } catch {
    /* not JSON */
  }
}
const out = JSON.stringify({ captured_at: new Date().toISOString(), routes }, null, 1);
const bad = out.match(/(sk-[A-Za-z0-9_-]{12,}|xai-[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN)/);
if (bad) throw new Error(`refusing to write: a key-like string (${bad[0].slice(0, 6)}…)`);
fs.writeFileSync(path.join(here, "live-base.json"), `${out}\n`);
console.log(`live-base.json: ${Object.keys(routes).length} routes`);
