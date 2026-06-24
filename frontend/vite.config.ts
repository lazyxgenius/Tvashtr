import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The dev server proxies backend routes to the FastAPI app on :8000 so the
// frontend can call /health (and later /api/*) without CORS config.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/health": "http://localhost:8000",
      "/api": "http://localhost:8000",
    },
  },
  // vitest = the unit suite under src/ only. The Playwright `e2e/*.spec.ts` files are run by
  // the Playwright runner (make steering-e2e), not vitest — scope the unit glob to src/ so the
  // default `*.spec.ts` glob doesn't try to execute the live E2E as a unit test.
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
