import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import type { RunnerStatus } from "../../lib/api/engines";
import { openTvashtrDesktop } from "../../lib/desktopDeepLinks";
import { DESKTOP_MAC_DMG_URL, DESKTOP_RELEASES_URL } from "../../lib/desktopDownload";
import { EnginesPage } from "./EnginesPage";
import {
  RUNNER_STALE,
  SUBS,
  installDesktop,
  mockEnginesApi,
  renderEngines,
  resetEnginesState,
  sub,
} from "./enginesTestUtils";

// The browser can't follow `tvashtr://` in jsdom; record the hand-off instead.
vi.mock("../../lib/desktopDeepLinks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/desktopDeepLinks")>()),
  openTvashtrDesktop: vi.fn(),
}));

const PLATFORM = Object.getOwnPropertyDescriptor(window.navigator, "platform");

beforeEach(() => {
  resetEnginesState();
  vi.mocked(openTvashtrDesktop).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetEnginesState();
  if (PLATFORM) Object.defineProperty(window.navigator, "platform", PLATFORM);
  else Reflect.deleteProperty(window.navigator, "platform");
});

const SEEN = "2026-09-26T08:00:00+00:00";
const FRESH: RunnerStatus = { fresh: true, last_seen_at: SEEN, providers: ["claude", "grok"] };

/** The website mirror; `runner()` is read on every request, so a test can move the check-in. */
function api(runner: () => RunnerStatus = () => FRESH, subs = SUBS) {
  return mockEnginesApi({
    "GET /api/engines/subscriptions": () => ({ subscriptions: subs, runner: runner() }),
  });
}

async function loaded() {
  await screen.findByRole("article", { name: "Codex" });
}

const opening = () => screen.queryByRole("alertdialog", { name: "Opening Tvashtr Desktop…" });
const getting = () => screen.queryByRole("alertdialog", { name: "Get Tvashtr Desktop" });
const banner = () =>
  within(
    screen.getByText(
      "Subscriptions run on your own computer. Open Tvashtr Desktop to connect them. Website runs always use API keys.",
    ).parentElement!,
  );

function setPlatform(platform: string) {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
}

/** Let the 3s check-in poll run `times` times and its answers land. */
async function poll(times = 1) {
  for (let n = 0; n < times; n += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
  }
}

describe("Open Tvashtr Desktop (EnF-WebDesktop-2, ENG-48)", () => {
  it("hands tvashtr:// to the browser and says what happens next", async () => {
    api();
    renderEngines("subscriptions");
    await loaded();
    fireEvent.click(banner().getByRole("button", { name: "Open Tvashtr Desktop" }));

    expect(openTvashtrDesktop).toHaveBeenCalledTimes(1);
    expect(openTvashtrDesktop).toHaveBeenCalledWith(undefined);
    const dialog = within(opening()!);
    expect(
      dialog.getByText(
        "Your browser may ask if it can open the Tvashtr app. Say yes. If nothing opens, you may not have the app yet.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(dialog.getByRole("button", { name: "Try again" }));
    expect(openTvashtrDesktop).toHaveBeenCalledTimes(2);
    expect(opening()).not.toBeNull();

    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(opening()).toBeNull();
  });

  it("Download Tvashtr Desktop swaps to Get Tvashtr Desktop", async () => {
    api();
    renderEngines("subscriptions");
    await loaded();
    fireEvent.click(banner().getByRole("button", { name: "Open Tvashtr Desktop" }));
    fireEvent.click(within(opening()!).getByRole("button", { name: "Download Tvashtr Desktop" }));
    expect(opening()).toBeNull();
    expect(getting()).not.toBeNull();
  });

  it("closes itself once Desktop checks in after the link went out, and not before", async () => {
    let runner = FRESH;
    const calls = api(() => runner);
    renderEngines("subscriptions");
    await loaded();
    vi.useFakeTimers();
    fireEvent.click(banner().getByRole("button", { name: "Open Tvashtr Desktop" }));

    // Desktop was already checking in, but nothing new yet: the dialog stays.
    await poll(2);
    const polls = calls.filter((c) => c.path === "/api/engines/subscriptions").length;
    expect(polls).toBeGreaterThanOrEqual(3); // the page's load + two 3s polls
    expect(opening()).not.toBeNull();

    runner = { ...FRESH, last_seen_at: "2026-09-26T08:00:05+00:00" };
    await poll();
    expect(opening()).toBeNull();
  });

  it("stays open while Desktop hasn't checked in at all", async () => {
    api(() => RUNNER_STALE);
    renderEngines("subscriptions");
    await loaded();
    vi.useFakeTimers();
    fireEvent.click(banner().getByRole("button", { name: "Open Tvashtr Desktop" }));
    await poll(3);
    expect(opening()).not.toBeNull();
  });

  it("a card whose Desktop isn't checking in opens Desktop on that card (ENG-38)", async () => {
    api(
      () => RUNNER_STALE,
      [
        { ...sub("claude", "connected", "Claude Pro"), runner_fresh: false },
        sub("grok", "needs_login"),
        sub("codex", "needs_install"),
      ],
    );
    renderEngines("subscriptions");
    await loaded();
    const claude = within(screen.getByRole("article", { name: "Claude" }));
    fireEvent.click(claude.getByRole("button", { name: "Open Tvashtr Desktop" }));
    expect(openTvashtrDesktop).toHaveBeenCalledWith("claude");
    expect(opening()).not.toBeNull();
  });
});

describe("Get Tvashtr Desktop (EnF-WebDesktop-3, ENG-47)", () => {
  it("offers the latest Mac DMG and the one-line fix for an unsigned app", async () => {
    setPlatform("MacIntel");
    api();
    renderEngines("subscriptions");
    await loaded();
    fireEvent.click(banner().getByRole("button", { name: "Download" }));

    const dialog = within(getting()!);
    for (const line of [
      "Same teams, tools and keys as the website",
      "Runs use your subscription first, then API keys",
      "Runs stop when you quit the app",
    ]) {
      expect(dialog.getByText(line)).toBeInTheDocument();
    }
    expect(dialog.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      DESKTOP_MAC_DMG_URL,
    );
    expect(
      dialog.getByText("xattr -dr com.apple.quarantine /Applications/Tvashtr.app"),
    ).toBeInTheDocument();
    expect(dialog.queryByText("Tvashtr Desktop is Mac-only for now.")).toBeNull();

    fireEvent.click(dialog.getByRole("button", { name: "Not now" }));
    expect(getting()).toBeNull();
  });

  it("says Desktop is Mac-only on any other platform, with the releases page, not the DMG (OQ-18)", async () => {
    setPlatform("Win32");
    api();
    renderEngines("subscriptions");
    await loaded();
    fireEvent.click(banner().getByRole("button", { name: "Download" }));
    const dialog = within(getting()!);
    expect(dialog.getByText("Tvashtr Desktop is Mac-only for now.")).toBeInTheDocument();
    // No macOS Terminal fix, and no Mac download pretending to work here.
    expect(dialog.queryByText(/xattr/)).toBeNull();
    expect(dialog.queryByText(/Tvashtr is damaged/)).toBeNull();
    expect(dialog.queryByRole("link", { name: "Download" })).toBeNull();
    expect(dialog.getByRole("link", { name: "See releases" })).toHaveAttribute(
      "href",
      DESKTOP_RELEASES_URL,
    );
  });
});

describe("a tvashtr:// link that points at a card", () => {
  it("highlights that card and starts nothing", async () => {
    mockEnginesApi();
    const desktop = installDesktop();
    render(
      <ToastProvider>
        <EnginesPage tab="subscriptions" connect="grok" />
      </ToastProvider>,
    );
    await loaded();
    expect(screen.getByRole("article", { name: "Grok" })).toHaveAttribute("data-highlight", "true");
    expect(screen.getByRole("article", { name: "Claude" })).not.toHaveAttribute("data-highlight");
    expect(desktop.engines.connect).not.toHaveBeenCalled();
  });
});
