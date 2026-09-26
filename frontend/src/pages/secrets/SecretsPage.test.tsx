import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SecretsList } from "../../lib/api/tools";
import { refreshBadges } from "../../lib/workspaceStatus";
import {
  FETCH as FETCH_TOOL,
  GITHUB as GITHUB_TOOL,
  LINEAR as LINEAR_TOOL,
  mockApi,
  renderWithProviders,
  resetToolkitStores,
} from "../tools/toolsTestUtils";
import { SecretsPage } from "./SecretsPage";

vi.mock("../../lib/workspaceStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workspaceStatus")>()),
  refreshBadges: vi.fn(async () => {}),
}));

beforeEach(() => resetToolkitStores());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(refreshBadges).mockClear();
  resetToolkitStores();
});

const LINEAR = { id: "t-linear", name: "linear" };
const GITHUB = { id: "t-github", name: "github" };
const thisYear = new Date().getFullYear();

function designList(): SecretsList {
  return {
    secrets: [
      {
        name: "SENTRY_TOKEN",
        created_at: `${thisYear}-08-30T12:00:00Z`,
        updated_at: `${thisYear}-08-30T12:00:00Z`,
        used_by_tools: [],
      },
      {
        name: "GITHUB_TOKEN",
        created_at: `${thisYear}-09-20T12:00:00Z`,
        updated_at: `${thisYear}-09-20T12:00:00Z`,
        used_by_tools: [GITHUB],
      },
    ],
    missing: [{ name: "LINEAR_TOKEN", used_by_tools: [LINEAR] }],
  };
}

// github's page data: the agents a delete of GITHUB_TOKEN stops (SECRET-18).
const usage = (node_id: string, role_name: string, team_name: string) => ({
  node_id,
  role_name,
  title: null,
  team_id: `team-${team_name}`,
  team_name,
});
const GITHUB_DETAIL = {
  ...GITHUB_TOOL,
  used_by_agents: [
    usage("n-eng", "engineer", "web"),
    usage("n-rev", "reviewer", "web"),
    usage("n-wri", "writer", "docs"),
  ],
};

/**
 * A fake server: GET reads the list, POST creates (409 when taken), PUT replaces, DELETE removes —
 * a name a tool still uses comes back under `missing` (spec Q2). `routes` override any of them.
 */
function serve(initial: SecretsList = designList(), routes: Record<string, unknown> = {}) {
  const state = structuredClone(initial);
  const calls = mockApi({
    "GET /api/tool-library": { tools: [FETCH_TOOL, GITHUB_TOOL, LINEAR_TOOL] },
    "GET /api/tool-library/:id": (u: URL) =>
      u.pathname.endsWith(`/${GITHUB_TOOL.id}`)
        ? GITHUB_DETAIL
        : new Response(JSON.stringify({ detail: "tool not found in your library" }), {
            status: 404,
          }),
    "DELETE /api/secrets/:name": (u: URL) => {
      const name = decodeURIComponent(u.pathname.split("/").pop() ?? "");
      const row = state.secrets.find((s) => s.name === name);
      state.secrets = state.secrets.filter((s) => s.name !== name);
      if (row?.used_by_tools.length) {
        state.missing.push({ name, used_by_tools: row.used_by_tools });
        state.missing.sort((a, b) => a.name.localeCompare(b.name));
      }
      return new Response(null, { status: 204 });
    },
    "GET /api/secrets": () => state,
    "POST /api/secrets": (_u: URL, body: { name: string; value: string }) => {
      if (state.secrets.some((s) => s.name === body.name))
        return new Response(
          JSON.stringify({
            detail: `${body.name} already exists. Use Replace value on it instead.`,
          }),
          { status: 409 },
        );
      const at = new Date().toISOString();
      const missing = state.missing.find((m) => m.name === body.name);
      state.missing = state.missing.filter((m) => m.name !== body.name);
      state.secrets.push({
        name: body.name,
        created_at: at,
        updated_at: at,
        used_by_tools: missing?.used_by_tools ?? [],
      });
      return { name: body.name, created_at: at, updated_at: at };
    },
    "PUT /api/secrets/:name": (u: URL) => {
      const name = decodeURIComponent(u.pathname.split("/").pop() ?? "");
      const at = new Date().toISOString();
      const row = state.secrets.find((s) => s.name === name);
      if (row) row.updated_at = at;
      return { name, created_at: row?.created_at, updated_at: at };
    },
    ...routes,
  });
  renderWithProviders(<SecretsPage />);
  return calls;
}

const table = () => screen.getByRole("table");
const rows = () => within(table()).getAllByRole("row").slice(1);
const rowNames = () => rows().map((r) => r.querySelector(".sc-name__text")?.textContent);
const dialog = (name: string) => screen.getByRole("dialog", { name });

describe("Secrets page", () => {
  it("shows the header, a banner per missing name, the table and the Engines footer", async () => {
    serve();
    expect(screen.getByRole("heading", { level: 1, name: "Secrets" })).toBeInTheDocument();
    expect(
      screen.getByText(/Values your tools use as \$\{NAME\}\. Stored encrypted/),
    ).toBeInTheDocument();
    await screen.findByRole("table");

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(
      "LINEAR_TOKEN is used by linear but has no value. linear won’t connect until you add it.",
    );
    expect(within(banner).getByRole("button", { name: "Add value" })).toBeInTheDocument();

    // Missing rows first, then A→Z.
    expect(rowNames()).toEqual(["LINEAR_TOKEN", "GITHUB_TOKEN", "SENTRY_TOKEN"]);
    const [linear, github, sentry] = rows();
    expect(within(linear).getByText("No value")).toBeInTheDocument();
    expect(within(linear).getByText("linear")).toBeInTheDocument();
    expect(within(linear).getByText("—")).toBeInTheDocument();
    expect(within(linear).getByRole("button", { name: "Add value" })).toBeInTheDocument();

    expect(within(github).getByText("Sensitive")).toBeInTheDocument();
    expect(within(github).getByText("github")).toBeInTheDocument();
    expect(within(github).getByText("Sep 20")).toBeInTheDocument();
    expect(
      within(github).getByRole("button", { name: "More actions for GITHUB_TOKEN" }),
    ).toBeInTheDocument();

    expect(within(sentry).getByText("Not used by any tool")).toBeInTheDocument();
    expect(within(sentry).getByText("Aug 30")).toBeInTheDocument();

    // A value is never shown, masked or otherwise.
    expect(screen.queryByText(/•/)).not.toBeInTheDocument();

    expect(document.querySelector(".sc-footer__text")).toHaveTextContent(
      "Model API keys (OpenAI, Gemini, OpenRouter…) live in Engines, not here.",
    );
    expect(screen.getByRole("link", { name: "Open Engines →" })).toHaveAttribute(
      "href",
      "#/engines",
    );
  });

  it("shows the empty state when nothing is stored and nothing is missing", async () => {
    serve({ secrets: [], missing: [] });
    expect(await screen.findByText("No secrets yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Add secret" })[1]);
    expect(dialog("Add a secret")).toBeInTheDocument();
  });

  it("says when the list can't load, and retries", async () => {
    let fail = true;
    mockApi({
      "GET /api/secrets": () =>
        fail ? new Response("{}", { status: 500 }) : { secrets: [], missing: [] },
    });
    renderWithProviders(<SecretsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your secrets.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No secrets yet")).toBeInTheDocument();
  });
});

describe("Add a secret", () => {
  async function openAdd() {
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Add secret" }));
    return dialog("Add a secret");
  }
  const fill = (d: HTMLElement, name: string, value: string) => {
    fireEvent.change(within(d).getByLabelText("Name"), { target: { value: name } });
    fireEvent.change(within(d).getByLabelText("Value"), { target: { value } });
  };

  it("keeps Save disabled until both fields have text; the value is a password field", async () => {
    serve();
    const d = await openAdd();
    const save = within(d).getByRole("button", { name: "Save secret" });
    expect(within(d).getByLabelText("Name")).toHaveAttribute("placeholder", "e.g. GITHUB_TOKEN");
    expect(
      within(d).getByText("Capital letters, numbers and _. Tools use it as ${NAME}."),
    ).toBeInTheDocument();
    expect(within(d).getByLabelText("Value")).toHaveAttribute("type", "password");
    expect(
      within(d).getByText("Stored encrypted. We never show a value again."),
    ).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(within(d).getByLabelText("Name"), { target: { value: "NOTION_TOKEN" } });
    expect(save).toBeDisabled();
    fireEvent.change(within(d).getByLabelText("Value"), { target: { value: "   " } });
    expect(save).toBeDisabled();
    fireEvent.change(within(d).getByLabelText("Value"), { target: { value: "secret" } });
    expect(save).toBeEnabled();
  });

  it("explains the name rule with a suggestion, without sending anything", async () => {
    const calls = serve();
    const d = await openAdd();
    fill(d, "notion-token", "secret");
    fireEvent.click(within(d).getByRole("button", { name: "Save secret" }));
    expect(within(d).getByRole("alert")).toHaveTextContent(
      "Use capital letters, numbers and _, like NOTION_TOKEN.",
    );
    expect(within(d).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    // Editing the name clears the error.
    fireEvent.change(within(d).getByLabelText("Name"), { target: { value: "NOTION_TOKEN" } });
    expect(within(d).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the server's 'already exists' under Name", async () => {
    serve();
    const d = await openAdd();
    fill(d, "GITHUB_TOKEN", "secret");
    fireEvent.click(within(d).getByRole("button", { name: "Save secret" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(
      "GITHUB_TOKEN already exists. Use Replace value on it instead.",
    );
    expect(dialog("Add a secret")).toBeInTheDocument();
  });

  it("saves: the new row goes on top with Just now, a toast, and the badges refresh", async () => {
    const calls = serve();
    const d = await openAdd();
    fill(d, " NOTION_TOKEN ", "ntn_123");
    fireEvent.click(within(d).getByRole("button", { name: "Save secret" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "NOTION_TOKEN",
      value: "ntn_123",
    });
    await waitFor(() =>
      expect(rowNames()).toEqual(["NOTION_TOKEN", "LINEAR_TOKEN", "GITHUB_TOKEN", "SENTRY_TOKEN"]),
    );
    const [notion] = rows();
    expect(within(notion).getByText("Just now")).toBeInTheDocument();
    expect(within(notion).getByText("Not used by any tool")).toBeInTheDocument();
    expect(
      screen.getByText("NOTION_TOKEN saved. Use it in a tool as ${NOTION_TOKEN}."),
    ).toBeInTheDocument();
    expect(refreshBadges).toHaveBeenCalled();
  });

  it("keeps the dialog open with a retryable message when the server fails", async () => {
    mockApi({
      "GET /api/secrets": designList(),
      "POST /api/secrets": () => new Response("{}", { status: 500 }),
    });
    renderWithProviders(<SecretsPage />);
    const d = await openAdd();
    fill(d, "NOTION_TOKEN", "x");
    fireEvent.click(within(d).getByRole("button", { name: "Save secret" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(
      "Couldn’t save the secret. Try again.",
    );
    expect(within(d).getByRole("button", { name: "Save secret" })).toBeEnabled();
  });

  it("closes on Cancel and on Escape without saving", async () => {
    const calls = serve();
    const d = await openAdd();
    fireEvent.click(within(d).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await openAdd();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("Add a missing value", () => {
  it("opens Add <NAME> from the banner with the name fixed, then clears the banner", async () => {
    const calls = serve();
    await screen.findByRole("table");
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Add value" }));
    const d = dialog("Add LINEAR_TOKEN");
    expect(within(d).getByLabelText("Name")).toHaveValue("LINEAR_TOKEN");
    expect(within(d).getByLabelText("Name")).toBeDisabled();
    // Focus starts in the value field (the name is fixed).
    expect(within(d).getByLabelText("Value")).toHaveFocus();
    fireEvent.change(within(d).getByLabelText("Value"), { target: { value: "lin_api_1" } });
    fireEvent.click(within(d).getByRole("button", { name: "Save secret" }));

    expect(await screen.findByText("LINEAR_TOKEN saved. linear is ready.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "LINEAR_TOKEN",
      value: "lin_api_1",
    });
    expect(screen.queryByText(/but has no value/)).not.toBeInTheDocument();
    expect(rowNames()).toEqual(["LINEAR_TOKEN", "GITHUB_TOKEN", "SENTRY_TOKEN"]);
    const [linear] = rows();
    expect(within(linear).getByText("Sensitive")).toBeInTheDocument();
    expect(within(linear).getByText("Just now")).toBeInTheDocument();
    expect(refreshBadges).toHaveBeenCalled();
  });

  it("opens the same dialog from the missing row's Add value", async () => {
    serve();
    await screen.findByRole("table");
    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Add value" }));
    expect(dialog("Add LINEAR_TOKEN")).toBeInTheDocument();
  });
});

describe("Replace value", () => {
  it("replaces a stored value from the row menu", async () => {
    const calls = serve();
    await screen.findByRole("table");
    const github = rows()[1];
    fireEvent.click(within(github).getByRole("button", { name: "More actions for GITHUB_TOKEN" }));
    fireEvent.click(within(github).getByRole("menuitem", { name: "Replace value" }));

    const d = dialog("Replace GITHUB_TOKEN");
    expect(
      within(d).getByText(
        "The old value is deleted when you save. github picks up the new one on its next run.",
      ),
    ).toBeInTheDocument();
    expect(within(d).getByLabelText("Name")).toBeDisabled();
    expect(
      within(d).getByText("Names can’t be changed. Delete and add a new secret instead."),
    ).toBeInTheDocument();
    const replace = within(d).getByRole("button", { name: "Replace value" });
    expect(replace).toBeDisabled();
    fireEvent.change(within(d).getByLabelText("New value"), { target: { value: "ghp_new" } });
    fireEvent.click(replace);

    expect(
      await screen.findByText("GITHUB_TOKEN replaced. github uses the new value on its next run."),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PUT")).toMatchObject({
      path: "/api/secrets/GITHUB_TOKEN",
      body: { value: "ghp_new" },
    });
    expect(refreshBadges).toHaveBeenCalled();
  });
});

describe("Secret ⋯ menu", () => {
  const openMenu = (name: string) => {
    const row = rows().find((r) => r.querySelector(".sc-name__text")?.textContent === name);
    if (!row) throw new Error(`no row ${name}`);
    fireEvent.click(within(row).getByRole("button", { name: `More actions for ${name}` }));
    return within(row).getByRole("menu", { name: `More actions for ${name}` });
  };
  const pick = (name: string, item: string) =>
    fireEvent.click(within(openMenu(name)).getByRole("menuitem", { name: item }));

  it("offers Replace value, See tools that use it, Copy ${NAME} and Delete secret", async () => {
    serve();
    await screen.findByRole("table");
    const menu = openMenu("GITHUB_TOKEN");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Replace value", "See tools that use it", "Copy ${GITHUB_TOKEN}", "Delete secret"]);
  });

  it("shows the tools that use it, with their agents and teams and an Open link", async () => {
    serve();
    await screen.findByRole("table");
    pick("GITHUB_TOKEN", "See tools that use it");

    const pop = dialog("Tools that use GITHUB_TOKEN");
    expect(within(pop).getByText("Used by 1 tool")).toBeInTheDocument();
    expect(within(pop).getByText("github")).toBeInTheDocument();
    expect(await within(pop).findByText("3 agents · 2 teams")).toBeInTheDocument();
    const open = within(pop).getByRole("link", { name: "Open" });
    expect(open).toHaveAttribute("href", "#/toolkit/tools/t-github");
    expect(open).toHaveFocus();

    // Escape closes it and puts focus back on the ⋯.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Tools that use GITHUB_TOKEN" })).toBeNull();
    expect(screen.getByRole("button", { name: "More actions for GITHUB_TOKEN" })).toHaveFocus();
  });

  it("says when no tool uses it", async () => {
    serve();
    await screen.findByRole("table");
    pick("SENTRY_TOKEN", "See tools that use it");
    const pop = dialog("Tools that use SENTRY_TOKEN");
    expect(within(pop).getByText("Not used by any tool")).toBeInTheDocument();
    expect(within(pop).queryByRole("link")).toBeNull();
  });

  describe("Copy ${NAME}", () => {
    afterEach(() => {
      Reflect.deleteProperty(navigator, "clipboard");
    });
    const stubClipboard = (writeText: (text: string) => Promise<void>) => {
      const fn = vi.fn(writeText);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: fn },
        configurable: true,
      });
      return fn;
    };

    it("writes the literal ${NAME} and confirms it", async () => {
      const writeText = stubClipboard(async () => {});
      serve();
      await screen.findByRole("table");
      pick("GITHUB_TOKEN", "Copy ${GITHUB_TOKEN}");
      expect(await screen.findByText("Copied ${GITHUB_TOKEN}.")).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith("${GITHUB_TOKEN}");
    });

    it("says so when the clipboard refuses", async () => {
      stubClipboard(() => Promise.reject(new Error("denied")));
      serve();
      await screen.findByRole("table");
      pick("GITHUB_TOKEN", "Copy ${GITHUB_TOKEN}");
      expect(await screen.findByText("Couldn’t copy ${GITHUB_TOKEN}.")).toBeInTheDocument();
    });
  });

  describe("Delete secret", () => {
    const confirm = (name: string) => screen.findByRole("alertdialog", { name: `Delete ${name}?` });

    it("names the tool and its agents, then the row comes back as No value (spec Q2)", async () => {
      const calls = serve();
      await screen.findByRole("table");
      pick("GITHUB_TOKEN", "Delete secret");

      const d = await confirm("GITHUB_TOKEN");
      expect(d).toHaveTextContent(
        "github uses it. github stops connecting for Engineer, Reviewer and Writer until you add it again. You can’t undo this.",
      );
      expect(calls.some((c) => c.method === "GET" && c.path === "/api/tool-library/t-github")).toBe(
        true,
      );
      fireEvent.click(within(d).getByRole("button", { name: "Delete secret" }));

      expect(
        await screen.findByText("GITHUB_TOKEN deleted. github now needs a secret."),
      ).toBeInTheDocument();
      expect(calls.find((c) => c.method === "DELETE")).toMatchObject({
        path: "/api/secrets/GITHUB_TOKEN",
      });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      // Still used by github: the row stays in its place as No value, with a banner of its own.
      await waitFor(() => expect(within(rows()[1]).getByText("No value")).toBeInTheDocument());
      expect(rowNames()).toEqual(["LINEAR_TOKEN", "GITHUB_TOKEN", "SENTRY_TOKEN"]);
      expect(within(rows()[1]).getByRole("button", { name: "Add value" })).toBeInTheDocument();
      const banners = screen
        .getAllByRole("status")
        .filter((b) => b.classList.contains("sc-banner"));
      expect(banners.map((b) => b.textContent)).toEqual([
        expect.stringContaining("LINEAR_TOKEN is used by linear"),
        expect.stringContaining("GITHUB_TOKEN is used by github"),
      ]);
      expect(refreshBadges).toHaveBeenCalled();
    });

    it("removes an unused secret's row", async () => {
      const calls = serve();
      await screen.findByRole("table");
      pick("SENTRY_TOKEN", "Delete secret");

      const d = await confirm("SENTRY_TOKEN");
      expect(d).toHaveTextContent("No tool uses it. You can’t undo this.");
      expect(calls.some((c) => c.path.startsWith("/api/tool-library/"))).toBe(false);
      fireEvent.click(within(d).getByRole("button", { name: "Delete secret" }));

      expect(await screen.findByText("SENTRY_TOKEN deleted.")).toBeInTheDocument();
      await waitFor(() => expect(rowNames()).toEqual(["LINEAR_TOKEN", "GITHUB_TOKEN"]));
    });

    it("leaves the agents out when the tool's page can't load", async () => {
      serve(designList(), {
        "GET /api/tool-library/:id": new Response(JSON.stringify({ detail: "boom" }), {
          status: 500,
        }),
      });
      await screen.findByRole("table");
      pick("GITHUB_TOKEN", "Delete secret");
      expect(await confirm("GITHUB_TOKEN")).toHaveTextContent(
        "github uses it. github stops connecting until you add it again. You can’t undo this.",
      );
    });

    it("keeps the secret on Cancel", async () => {
      const calls = serve();
      await screen.findByRole("table");
      pick("GITHUB_TOKEN", "Delete secret");
      const d = await confirm("GITHUB_TOKEN");
      fireEvent.click(within(d).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);
      expect(screen.getByRole("button", { name: "More actions for GITHUB_TOKEN" })).toHaveFocus();
    });

    it("stays open with a retryable message when the delete fails", async () => {
      serve(designList(), {
        "DELETE /api/secrets/:name": () =>
          new Response(JSON.stringify({ detail: "boom" }), { status: 500 }),
      });
      await screen.findByRole("table");
      pick("GITHUB_TOKEN", "Delete secret");
      const d = await confirm("GITHUB_TOKEN");
      fireEvent.click(within(d).getByRole("button", { name: "Delete secret" }));
      expect(await within(d).findByRole("alert")).toHaveTextContent(
        "Couldn’t delete the secret. Try again.",
      );
      expect(screen.getByRole("alertdialog", { name: "Delete GITHUB_TOKEN?" })).toBeInTheDocument();
      expect(within(rows()[1]).getByText("Sensitive")).toBeInTheDocument();
    });
  });
});
