// Tvashtr Desktop app screens (desktop-app.md), group G4: Engines when a plan CLI isn't installed,
// the "Use your Claude plan" sheet (DtF-Claude-1/2/3) and the setup's "Add an API key" sheet
// (DtF-Key-1/2/3). Desktop-only boards: every scenario is `desktop: true` with the v6 fake bridge
// from desktop-app.mjs, whose setup store says this Mac's setup hasn't finished (#/setup/engines).
import { desktopBridge } from "./desktop-app.mjs";

const ME = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "lazyxgenius@users.noreply.github.com",
  github_login: "lazyxgenius",
  display_name: "lazyxgenius",
};

/** `/api/config.provider_directory` as the server serves it (NIM serves no model Tvashtr runs). */
const DIRECTORY = [
  [
    "anthropic",
    "A",
    "Anthropic",
    "Claude models",
    "anthropic/claude-sonnet-5",
    "claude",
  ],
  ["xai", "X", "xAI", "Grok models", "xai/grok-4", "grok"],
  ["openai", "O", "OpenAI", "GPT models", "openai/gpt-5", null],
  ["nvidia_nim", "N", "NVIDIA NIM", "NIM models", null, null],
].map(([provider, monogram, name, label, example_model, subscription]) => ({
  provider,
  monogram,
  name,
  label,
  example_model,
  subscription,
  embeddings: false,
  hint: example_model
    ? null
    : "NVIDIA NIM serves no model Tvashtr can run right now.",
  serves_models: Boolean(example_model),
}));

/** The saved key the design shows (DtF-Key-3): anthropic, •••• 9c1e. */
const SAVED = {
  provider: "anthropic",
  key_last4: "9c1e",
  created_at: "2026-09-26T10:00:00Z",
};
/** The design's pasted value (a password field shows it as dots either way). */
const PASTED = "sk-ant-••••••••••••••••9c1e";

/** Per scenario: GET /api/providers answers what POST /api/providers saved. */
function routes() {
  let saved = [];
  return {
    "GET /api/auth/me": ME,
    "GET /api/teams": { teams: [] },
    "GET /api/config": {
      hosted_mode: true,
      github_install_url: "https://github.com/apps/tvashtr/installations/new",
      github_manage_url: "https://github.com/apps/tvashtr/installations/new",
      provider_catalogue: [],
      provider_directory: DIRECTORY,
      default_run_budget_usd: 5,
    },
    "GET /api/providers": () => ({ json: { providers: saved } }),
    "POST /api/providers": () => {
      saved = [SAVED];
      return {
        json: {
          provider: "anthropic",
          key_last4: "9c1e",
          created_at: SAVED.created_at,
          updated_at: SAVED.created_at,
          replaced: false,
        },
      };
    },
  };
}

const heading = (page) =>
  page.getByRole("heading", { name: "How should your agents run?" });

// Claude-1 · Claude Code not found; Grok found but signed out.
const claudeMissing = {
  path: "/#/home",
  desktop: true,
  routes: routes(),
  init: desktopBridge({
    plans: {
      claude: "needs_install",
      grok: "needs_login",
      codex: "needs_install",
    },
    setup: { step: "engines" },
  }),
  steps: async (page) => {
    await heading(page).waitFor();
    await page
      .getByText("Install it and sign in once to use your Claude plan")
      .waitFor();
  },
};

// Claude-2 · Set up → "Use your Claude plan".
const planSheet = {
  ...claudeMissing,
  steps: async (page) => {
    await claudeMissing.steps(page);
    await page
      .locator('[data-provider="claude"]')
      .getByRole("button", { name: "Set up" })
      .click();
    await page.getByRole("dialog", { name: "Use your Claude plan" }).waitFor();
  },
};

// Claude-3 · Check again finds Claude Code signed in: the row connects and the toast shows.
const claudeFound = {
  ...claudeMissing,
  steps: async (page) => {
    await planSheet.steps(page);
    await page
      .getByRole("dialog", { name: "Use your Claude plan" })
      .getByRole("button", { name: "Check again" })
      .click();
    await page
      .getByRole("status")
      .getByText("Claude Code found · using your Claude plan")
      .waitFor();
    await page
      .getByRole("dialog", { name: "Use your Claude plan" })
      .waitFor({ state: "detached" });
  },
};

// Key-1 · nothing found: both plans not installed (Grok's Set up is ghost).
const nothingFound = {
  ...claudeMissing,
  init: desktopBridge({
    plans: {
      claude: "needs_install",
      grok: "needs_install",
      codex: "needs_install",
    },
    setup: { step: "engines" },
  }),
  steps: async (page) => {
    await heading(page).waitFor();
    await page
      .getByText("Install the Grok CLI to use your Grok plan")
      .waitFor();
  },
};

// Key-2 · "Use an API key instead" → the setup's Add-key sheet, anthropic pre-picked, key pasted.
const keySheet = {
  ...nothingFound,
  steps: async (page) => {
    await nothingFound.steps(page);
    await page.getByRole("button", { name: "Use an API key instead" }).click();
    const sheet = page.getByRole("dialog", { name: "Add an API key" });
    await sheet
      .getByText(
        "Covers models that start with anthropic/, like anthropic/claude-sonnet-5.",
      )
      .waitFor();
    await sheet.getByLabel("API key").fill(PASTED);
    // The design draws the field at rest (no focus ring).
    await sheet.getByLabel("API key").blur();
  },
};

// Key-3 · Save key: the row reads "anthropic key saved · •••• 9c1e" and Continue is on.
const keySaved = {
  ...nothingFound,
  steps: async (page) => {
    await keySheet.steps(page);
    await page
      .getByRole("dialog", { name: "Add an API key" })
      .getByRole("button", { name: "Save key" })
      .click();
    await page.getByText("anthropic key saved · •••• 9c1e").waitFor();
    await page
      .getByRole("dialog", { name: "Add an API key" })
      .waitFor({ state: "detached" });
  },
};

// Each board gets its own routes, so a key saved on one never shows on another.
export default [
  { name: "DtF-Claude-1", ...claudeMissing },
  { name: "DtF-Claude-2", ...planSheet },
  { name: "DtF-Claude-3", ...claudeFound },
  { name: "DtF-Key-1", ...nothingFound },
  { name: "DtF-Key-2", ...keySheet },
  { name: "DtF-Key-3", ...keySaved },
].map((sc) => ({ ...sc, routes: routes() }));
