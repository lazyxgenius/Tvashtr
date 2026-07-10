import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The dev server proxies backend routes to the FastAPI app so the frontend can call /health (and
// /api/*) without CORS config. The target defaults to :8000 (normal dev + the existing e2e scripts),
// but `TVASHTR_API_PROXY_TARGET` overrides it so a parallel-session / non-8000 backend (e.g. the
// M-unify U3 edits-toggle e2e on :8002) can be proxied without editing this file.
const API_PROXY_TARGET = process.env.TVASHTR_API_PROXY_TARGET ?? "http://localhost:8000";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/health": API_PROXY_TARGET,
      "/api": API_PROXY_TARGET,
    },
  },
  // vitest = the unit suite under src/ only. The Playwright `e2e/*.spec.ts` files are run by
  // the Playwright runner (make steering-e2e), not vitest — scope the unit glob to src/ so the
  // default `*.spec.ts` glob doesn't try to execute the live E2E as a unit test.
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // jsdom globally — the pure-fn tests don't touch the DOM, so a global jsdom env is
    // harmless for them and spares the RTL/component tests a per-file docblock. `globals`
    // registers jest-dom matchers + RTL's auto-cleanup without per-file boilerplate (the
    // existing explicit `from "vitest"` imports keep working — globals is additive).
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
  },
});
