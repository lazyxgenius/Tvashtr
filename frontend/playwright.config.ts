import { defineConfig, devices } from "@playwright/test";

// Live J3 steering E2E (P1.7b). The backend (LOCAL sandbox, real NIM agent, NO auto-approve)
// and the Vite dev server are started by `scripts/steering_e2e.sh`; this config just drives a
// browser against the running dev server. Single worker, no retries: it's one long live run.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.TVASHTR_E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
