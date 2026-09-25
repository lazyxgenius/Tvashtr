// Serve Google Fonts to headless Chromium through curl, with a disk cache.
//
// Why: a font fallback makes every screenshot look larger than the real product, which is exactly
// the drift this harness exists to catch. In sandboxes whose HTTPS proxy Chromium can't verify,
// curl (which trusts the system CA bundle) fetches the files instead; elsewhere this is just a cache.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CACHE = process.env.FONT_CACHE_DIR || path.join(os.tmpdir(), "tvashtr-design-parity-fonts");
fs.mkdirSync(CACHE, { recursive: true });
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function fetchCached(url) {
  const key = crypto.createHash("sha1").update(url).digest("hex");
  const file = path.join(CACHE, key);
  if (!fs.existsSync(file)) {
    const body = execFileSync("curl", ["-sS", "-f", "-A", UA, url], { maxBuffer: 20 * 1024 * 1024 });
    fs.writeFileSync(file, body);
  }
  return fs.readFileSync(file);
}

export async function routeFonts(context) {
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    const url = route.request().url();
    try {
      const body = fetchCached(url);
      const type = url.includes("googleapis") ? "text/css; charset=utf-8" : "font/woff2";
      await route.fulfill({
        status: 200,
        body,
        headers: { "content-type": type, "access-control-allow-origin": "*" },
      });
    } catch {
      await route.abort();
    }
  });
}
