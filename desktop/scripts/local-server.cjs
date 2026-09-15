/**
 * Serve the built Vite frontend from a real HTTP origin and reverse-proxy
 * /api + /health to the hosted Tvashtr backend.
 *
 * Why not file:// or absolute VITE_API_BASE → fly.dev?
 * The hosted app is one-origin by design (SPA + /api share https://tvashtr.fly.dev)
 * so the tv_session cookie stays first-party with SameSite=lax. A cross-origin
 * Electron renderer would hit CORS + third-party cookie breakage. Localhost +
 * proxy keeps relative /api paths and cookies working with no large FE rewrite.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

/**
 * @param {{ distDir: string, apiBase: string, port?: number }} opts
 * @returns {Promise<{ server: import('http').Server, url: string, port: number }>}
 */
async function startServer(opts) {
  const distDir = path.resolve(opts.distDir);
  const apiBase = String(opts.apiBase || "https://tvashtr.fly.dev").replace(/\/$/, "");
  const preferred = Number(opts.port || 5178);

  const indexHtml = path.join(distDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    throw new Error(
      `Frontend build missing at ${indexHtml}. Run \`npm run build\` in desktop/ first ` +
        `(or set TVASHTR_DESKTOP_DIST).`,
    );
  }

  const app = express();

  // Mount at app root with pathFilter so /api and /health are NOT stripped
  // (Express app.use("/api", proxy) would forward /api/config → target/config).
  const proxy = createProxyMiddleware({
    target: apiBase,
    changeOrigin: true,
    secure: true,
    xfwd: true,
    pathFilter: (pathname) => pathname === "/health" || pathname.startsWith("/api"),
    on: {
      proxyRes(proxyRes) {
        const raw = proxyRes.headers["set-cookie"];
        if (!raw) return;
        const list = Array.isArray(raw) ? raw : [raw];
        // Strip Domain so the cookie is host-only for 127.0.0.1. Keep Secure —
        // Chromium treats localhost / 127.0.0.1 as a secure context for cookies.
        proxyRes.headers["set-cookie"] = list.map((c) =>
          String(c).replace(/;\s*Domain=[^;]*/gi, ""),
        );
      },
    },
  });

  app.use(proxy);

  app.use(express.static(distDir, { index: false, fallthrough: true }));

  // SPA fallback (same idea as backend mount_frontend).
  app.get(/.*/, (req, res) => {
    if (req.path.startsWith("/api/") || req.path === "/api" || req.path === "/health") {
      res.status(404).json({ detail: "Not found" });
      return;
    }
    res.sendFile(indexHtml);
  });

  const server = http.createServer(app);

  const port = await listenPrefer(server, preferred);
  const url = `http://127.0.0.1:${port}/`;
  console.log(`[tvashtr-desktop] static FE at ${url} → API ${apiBase}`);
  return { server, url, port };
}

function listenPrefer(server, preferred) {
  return new Promise((resolve, reject) => {
    const tryPort = (port, attemptsLeft) => {
      const onError = (err) => {
        server.off("listening", onListening);
        if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
          tryPort(port + 1, attemptsLeft - 1);
        } else {
          reject(err);
        }
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(server.address().port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    };
    tryPort(preferred, 20);
  });
}

module.exports = { startServer };

if (require.main === module) {
  const distDir = process.env.TVASHTR_DESKTOP_DIST || path.join(__dirname, "..", "dist-fe");
  const apiBase = process.env.TVASHTR_API_BASE || process.env.VITE_API_BASE || "https://tvashtr.fly.dev";
  const port = Number(process.env.TVASHTR_DESKTOP_PORT || 5178);
  startServer({ distDir, apiBase, port }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
