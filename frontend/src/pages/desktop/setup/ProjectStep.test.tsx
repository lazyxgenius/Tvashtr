import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../../design-system/components";
import { type DesktopSetup, loadDesktopSetup } from "../../../lib/desktopSetup";
import {
  type FakeBridgeOptions,
  installDesktopBridge,
  ME,
  stubFetch,
  uninstallDesktopBridge,
} from "../desktopTestUtils";
import { ProjectStep } from "./ProjectStep";

const TRADE = { path: "/Users/ada/code/trade_mcp", displayPath: "~/code/trade_mcp" };
const NOTES = { path: "/Users/ada/Documents/notes", displayPath: "~/Documents/notes" };
const GIT_TRADE = {
  is_git: true as const,
  current_branch: "main",
  branches: ["main"],
  tracked_file_count: 42,
  subpaths: [],
  remote_url: "https://github.com/lazyxgenius/trade_mcp.git",
};
const NOT_GIT = {
  is_git: false as const,
  error: "This folder isn't a git repository.",
  reason: "not_git" as const,
};

async function renderStep(
  opts: {
    setup?: Partial<DesktopSetup>;
    repos?: FakeBridgeOptions["repos"];
    routes?: Parameters<typeof stubFetch>[0];
    teamsAlready?: boolean | null;
  } = {},
) {
  const bridge = installDesktopBridge({
    setup: { step: "project", ...opts.setup },
    repos: opts.repos ?? {
      pick: TRADE,
      inspect: { [TRADE.path]: GIT_TRADE, [NOTES.path]: NOT_GIT },
    },
  });
  const fetchMock = stubFetch(opts.routes ?? {});
  const setup = await loadDesktopSetup(ME.id);
  render(
    <ToastProvider placement="setup">
      <ProjectStep
        login="lazyxgenius"
        setup={setup!}
        teamsAlready={opts.teamsAlready ?? false}
        onSwitch={vi.fn()}
      />
    </ToastProvider>,
  );
  return { bridge, fetchMock };
}

const radio = (name: string) => screen.getByRole("radio", { name });
const continueButton = () => screen.getByRole("button", { name: "Continue" });
const card = (name: string) => radio(name).closest<HTMLElement>(".st-card")!;

beforeEach(() => {
  window.location.hash = "#/setup/project";
});

afterEach(() => {
  uninstallDesktopBridge();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProjectStep — DT-Project, DtF-Git-1..3", () => {
  it("first time: the folder card is chosen, Choose folder… shows and Continue is off (OQ-20)", async () => {
    await renderStep();
    expect(
      screen.getByRole("heading", { name: "Where should your teams work?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Agents read and change code here. They work on a new branch and ask you before anything is merged.",
      ),
    ).toBeInTheDocument();
    expect(radio("A folder on this Mac")).toHaveAttribute("aria-checked", "true");
    expect(radio("A GitHub repository")).toHaveAttribute("aria-checked", "false");
    expect(radio("Decide when I launch a run")).toHaveAttribute("aria-checked", "false");
    expect(
      within(card("A folder on this Mac")).getByRole("button", { name: "Choose folder…" }),
    ).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();
  });

  it("a git folder: the row, the sage line and Change; Continue saves it and goes to First team", async () => {
    const { bridge } = await renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    expect(
      await screen.findByText("git repo · branch main · lazyxgenius/trade_mcp"),
    ).toBeInTheDocument();
    expect(screen.getByText("~/code/trade_mcp")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(bridge.repos.inspect).toHaveBeenCalledWith(TRADE.path);
    expect(continueButton()).toBeEnabled();

    fireEvent.click(continueButton());
    await waitFor(() => expect(window.location.hash).toBe("#/setup/team"));
    expect(bridge.setup.update).toHaveBeenCalledWith(ME.id, {
      workspace: { kind: "folder", ...TRADE },
      step: "team",
    });
    expect(bridge.repos.recent.add).toHaveBeenCalledWith(TRADE.path);
  });

  it("Change picks again; a cancelled picker keeps the folder", async () => {
    const { bridge } = await renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    await screen.findByText("~/code/trade_mcp");
    bridge.repos.pickFolder.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    await waitFor(() => expect(bridge.repos.pickFolder).toHaveBeenCalledTimes(2));
    expect(screen.getByText("~/code/trade_mcp")).toBeInTheDocument();
    bridge.repos.pickFolder.mockResolvedValueOnce(NOTES);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(await screen.findByRole("button", { name: "Set up git here" })).toBeInTheDocument();
  });

  it("not a git repo: the amber box and Continue off; Set up git here makes it one (Git-2 → Git-3)", async () => {
    const { bridge } = await renderStep({
      repos: { pick: NOTES, inspect: { [NOTES.path]: NOT_GIT } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    const box = await screen.findByRole("alert");
    expect(box).toHaveTextContent(
      "~/Documents/notes isn’t a git repository. Teams track and review their changes with git.",
    );
    expect(within(box).getByRole("button", { name: "Choose another folder" })).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();

    fireEvent.click(within(box).getByRole("button", { name: "Set up git here" }));
    expect(await screen.findByText("git set up · branch main · no remote yet")).toBeInTheDocument();
    expect(bridge.repos.initGit).toHaveBeenCalledWith({ path: NOTES.path });
    expect(screen.getByText("~/Documents/notes")).toBeInTheDocument();
    expect(continueButton()).toBeEnabled();
  });

  it("a refused set-up shows the bridge's words and keeps both ways on", async () => {
    await renderStep({
      repos: {
        pick: NOTES,
        inspect: { [NOTES.path]: NOT_GIT },
        initGit: new Error("This folder is empty. Add your project's files, then set up git."),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set up git here" }));
    const box = await screen.findByRole("alert");
    await waitFor(() =>
      expect(box).toHaveTextContent(
        "This folder is empty. Add your project's files, then set up git.",
      ),
    );
    expect(within(box).getByRole("button", { name: "Set up git here" })).toBeEnabled();
    expect(continueButton()).toBeDisabled();
  });

  it("a Desktop without initGit only offers Choose another folder", async () => {
    await renderStep({
      repos: { pick: NOTES, inspect: { [NOTES.path]: NOT_GIT }, initGit: false },
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    const box = await screen.findByRole("alert");
    expect(within(box).queryByRole("button", { name: "Set up git here" })).toBeNull();
  });

  it.each([
    [
      "inside a repo",
      {
        is_git: false as const,
        error: "This folder is inside the git repository at ~/code. Choose that folder instead.",
        reason: "inside_repo" as const,
      },
      "This folder is inside the git repository at ~/code. Choose that folder instead.",
    ],
    [
      "a detached HEAD",
      { ...GIT_TRADE, current_branch: null },
      "~/code/trade_mcp is on a detached HEAD. Check out a branch, then choose it again.",
    ],
    [
      "git missing",
      new Error("Git isn't installed on this computer, or Tvashtr can't find it."),
      "Git isn't installed on this computer, or Tvashtr can't find it.",
    ],
  ])("%s: the reason in the amber box, only Choose another folder", async (_what, answer, text) => {
    await renderStep({ repos: { pick: TRADE, inspect: { [TRADE.path]: answer } } });
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    const box = await screen.findByRole("alert");
    expect(box).toHaveTextContent(text);
    expect(within(box).queryByRole("button", { name: "Set up git here" })).toBeNull();
    expect(within(box).getByRole("button", { name: "Choose another folder" })).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();
  });

  it("reads a folder saved earlier on this Mac again (DT-Project)", async () => {
    const { bridge } = await renderStep({ setup: { workspace: { kind: "folder", ...TRADE } } });
    expect(
      await screen.findByText("git repo · branch main · lazyxgenius/trade_mcp"),
    ).toBeInTheDocument();
    expect(bridge.repos.pickFolder).not.toHaveBeenCalled();
    expect(continueButton()).toBeEnabled();
  });

  it("Decide when I launch a run: Continue is on and saves `ask`", async () => {
    const { bridge } = await renderStep();
    fireEvent.click(screen.getByText("You’ll pick a folder or repo each time."));
    expect(radio("Decide when I launch a run")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: "Choose folder…" })).toBeNull();
    fireEvent.click(continueButton());
    await waitFor(() => expect(window.location.hash).toBe("#/setup/team"));
    expect(bridge.setup.update).toHaveBeenCalledWith(ME.id, {
      workspace: { kind: "ask" },
      step: "team",
    });
    expect(bridge.repos.recent.add).not.toHaveBeenCalled();
  });

  it("the arrow keys move between the three cards", async () => {
    await renderStep();
    const folder = radio("A folder on this Mac");
    folder.focus();
    fireEvent.keyDown(folder, { key: "ArrowDown" });
    expect(radio("A GitHub repository")).toHaveAttribute("aria-checked", "true");
    expect(radio("A GitHub repository")).toHaveFocus();
  });

  it("A GitHub repository: pick one from the App's repos, then Continue saves it (OQ-19)", async () => {
    const { bridge } = await renderStep({
      routes: {
        "GET /api/github/repos": {
          body: {
            repos: [
              {
                name: "trade_mcp",
                full_name: "lazyxgenius/trade_mcp",
                private: false,
                default_branch: "main",
                html_url: "https://github.com/lazyxgenius/trade_mcp",
              },
            ],
            installation_count: 1,
          },
        },
        "GET /api/config": {
          body: {
            github_install_url: "https://gh/install",
            github_manage_url: "https://gh/manage",
          },
        },
      },
    });
    fireEvent.click(screen.getByText("A GitHub repository"));
    const select = await screen.findByLabelText<HTMLSelectElement>("Repository");
    expect(continueButton()).toBeDisabled();
    fireEvent.change(select, { target: { value: "lazyxgenius/trade_mcp" } });
    expect(continueButton()).toBeEnabled();
    fireEvent.click(continueButton());
    await waitFor(() => expect(window.location.hash).toBe("#/setup/team"));
    expect(bridge.setup.update).toHaveBeenCalledWith(ME.id, {
      workspace: { kind: "github", repo: "lazyxgenius/trade_mcp" },
      step: "team",
    });
  });

  it("A GitHub repository with none connected offers Connect GitHub (the App's install page)", async () => {
    await renderStep({
      routes: {
        "GET /api/github/repos": { body: { repos: [], installation_count: 0 } },
        "GET /api/config": {
          body: {
            github_install_url: "https://gh/install",
            github_manage_url: "https://gh/manage",
          },
        },
      },
    });
    fireEvent.click(screen.getByText("A GitHub repository"));
    const connect = await screen.findByRole("link", { name: "Connect GitHub" });
    // Desktop's install link returns to this app (the existing in-window App install).
    expect(connect.getAttribute("href")).toMatch(/^https:\/\/gh\/install\?redirect_uri=/);
    expect(continueButton()).toBeDisabled();
  });

  it("with teams already, Continue finishes setup and goes Home; the rail says so (DT-37)", async () => {
    const { bridge } = await renderStep({
      teamsAlready: true,
      setup: { workspace: { kind: "folder", ...TRADE } },
    });
    const rail = screen.getByRole("complementary", { name: "Set up Tvashtr Desktop" });
    expect(within(rail).getByText("You have teams already")).toBeInTheDocument();
    await screen.findByText("git repo · branch main · lazyxgenius/trade_mcp");
    fireEvent.click(continueButton());
    await waitFor(() => expect(window.location.hash).toBe("#/home"));
    const patch = bridge.setup.update.mock.calls.at(-1)![1];
    expect(patch.workspace).toEqual({ kind: "folder", ...TRADE });
    expect(typeof patch.finishedAt).toBe("string");
  });

  it("a failed save stays put and says so", async () => {
    const { bridge } = await renderStep({ setup: { workspace: { kind: "ask" } } });
    bridge.setup.update.mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(continueButton());
    expect(
      await screen.findByText("Couldn’t save this Mac’s setup. Try again."),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#/setup/project");
  });

  it("Back goes to Engines", async () => {
    await renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(window.location.hash).toBe("#/setup/engines");
  });
});
