import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { ProxyOptions } from "vite";
import { defineConfig } from "vitest/config";

// The dev server proxies backend routes to the FastAPI app so the frontend can call /health (and
// /api/*) without CORS config. The target defaults to :8000 (normal dev + the existing e2e scripts),
// but `TVASHTR_API_PROXY_TARGET` overrides it so a parallel-session / non-8000 backend (e.g. the
// M-unify U3 edits-toggle e2e on :8002) can be proxied without editing this file.
const API_PROXY_TARGET = process.env.TVASHTR_API_PROXY_TARGET ?? "http://localhost:8000";

// Desktop Electron (`desktop/scripts/dev.mjs`) sets TVASHTR_DESKTOP_ORIGIN so the Vite proxy
// mirrors local-server.cjs: GitHub callback headers + strip Domain/Secure on Set-Cookie.
const DESKTOP_ORIGIN = (process.env.TVASHTR_DESKTOP_ORIGIN || "").replace(/\/$/, "");
const GITHUB_CALLBACK_PREFIX = "/api/auth/github/callback";

function stripCookieDomainAndSecure(setCookie: string): string {
  return String(setCookie)
    .replace(/;\s*Domain=[^;]*/gi, "")
    .replace(/;\s*Secure/gi, "");
}

function desktopAwareProxy(): string | ProxyOptions {
  if (!DESKTOP_ORIGIN) return API_PROXY_TARGET;
  return {
    target: API_PROXY_TARGET,
    changeOrigin: true,
    secure: true,
    xfwd: true,
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq, req) => {
        const urlPath = (req.url || "").split("?")[0];
        if (
          urlPath === GITHUB_CALLBACK_PREFIX ||
          urlPath.startsWith(`${GITHUB_CALLBACK_PREFIX}/`)
        ) {
          proxyReq.setHeader(
            "X-Tvashtr-Redirect-Uri",
            `${DESKTOP_ORIGIN}${GITHUB_CALLBACK_PREFIX}`,
          );
          proxyReq.setHeader("X-Tvashtr-Frontend-Origin", DESKTOP_ORIGIN);
        }
      });
      proxy.on("proxyRes", (proxyRes) => {
        const raw = proxyRes.headers["set-cookie"];
        if (!raw) return;
        const list = Array.isArray(raw) ? raw : [raw];
        proxyRes.headers["set-cookie"] = list.map(stripCookieDomainAndSecure);
      });
    },
  };
}

const proxyTarget = desktopAwareProxy();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/health": proxyTarget,
      "/api": proxyTarget,
    },
  },
  // vitest = unit suite under src/ plus pure helpers under e2e/**/*.test.ts (kept out of the
  // production image via .dockerignore). Playwright owns e2e/**/*.spec.ts — do NOT widen the
  // e2e glob to *.spec.ts or vitest will try to run the live gates as unit tests.
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}", "e2e/**/*.test.ts"],
    // jsdom globally — the pure-fn tests don't touch the DOM, so a global jsdom env is
    // harmless for them and spares the RTL/component tests a per-file docblock. `globals`
    // registers jest-dom matchers + RTL's auto-cleanup without per-file boilerplate (the
    // existing explicit `from "vitest"` imports keep working — globals is additive).
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
  },
});
