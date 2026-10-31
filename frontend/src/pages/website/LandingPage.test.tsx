import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import type { AuthUser, Config } from "../../lib/api";
import { DESKTOP_MAC_DMG_URL } from "../../lib/desktopDownload";
import { stubFetch } from "../desktop/desktopTestUtils";
import { SiteRoot } from "./SiteRoot";
import { downloadLinks, SITE } from "./testUtils";

const ME: AuthUser = {
  id: "u1",
  email: "l@x.dev",
  github_login: "lazyxgenius",
  display_name: "Lazyx",
};

const CONFIG: Config = {
  hosted_mode: true,
  github_install_url: "",
  github_manage_url: "",
  provider_catalogue: [
    {
      provider: "anthropic",
      thinker_default: "a",
      worker_default: "a",
      thinker_presets: [],
      worker_presets: [],
    },
    {
      provider: "groq",
      thinker_default: "g",
      worker_default: null,
      thinker_presets: [],
      worker_presets: [],
    },
    {
      provider: "nvidia_nim",
      thinker_default: null,
      worker_default: null,
      thinker_presets: [],
      worker_presets: [],
    },
    {
      provider: "xai",
      thinker_default: null,
      worker_default: "x",
      thinker_presets: [],
      worker_presets: [],
    },
  ],
};

function renderLanding(user: AuthUser | null = null, config: Config | null = CONFIG) {
  return render(
    <ToastProvider>
      <SiteRoot route={{ page: "welcome" }} user={user} config={config} onAuthed={vi.fn()} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  window.location.hash = "#/welcome";
  // The site facts only add the star count; most tests don't wait for them.
  stubFetch({ "GET /api/public/site": "pending" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("The landing (WEB-9..18)", () => {
  it("is titled for the website and draws every section, without the testimonial", () => {
    renderLanding();
    expect(document.title).toBe("Tvashtr — compose your own team of AI agents");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Compose your own team of AI agents",
    );
    for (const name of [
      "Agent tools are either a black box or a pile of code.",
      "Composable. Legible. Steerable.",
      "From idea to reviewed pull request.",
      "Same teams. Run them where it suits you.",
      "For people who want the team to be theirs.",
      "Before you start.",
      "Start weaving.",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.queryByText(/\[Name\]|add once you have permission/)).toBeNull();
  });

  it("says 'source on GitHub', never 'open source', until a license lands (OQ-4)", () => {
    const { container } = renderLanding();
    expect(screen.getByText(/^Source on GitHub$/)).toBeInTheDocument();
    expect(screen.getByText("Free, source on GitHub")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Compose your first team in a few minutes. Free, with the source on GitHub.",
      ),
    ).toBeInTheDocument();
    // The FAQ may ask the question; no sentence on the page claims it.
    const text = (container.textContent ?? "").replace("Is it open source?", "");
    expect(text).not.toMatch(/open source/i);
  });

  it("shows the live star count, and drops it when the site facts can't be read (OQ-13)", async () => {
    stubFetch({ "GET /api/public/site": { body: SITE } });
    const { unmount } = renderLanding();
    expect(await screen.findByText("Source on GitHub · 128 stars")).toBeInTheDocument();
    unmount();
    const fetchMock = stubFetch({ "GET /api/public/site": "network" });
    renderLanding();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText(/^Source on GitHub$/)).toBeInTheDocument();
    expect(screen.queryByText(/stars/)).toBeNull();
  });

  it("every Download for Mac opens the download page, and no link is a versioned release (WEB-9, WEB-37)", () => {
    const { container } = renderLanding();
    const downloads = screen.getAllByRole("link", { name: "Download for Mac" });
    expect(downloads).toHaveLength(3);
    for (const link of downloads) expect(link).toHaveAttribute("href", "#/download");
    // Every link into a release (a tag, an asset) is the stable latest-release DMG; the footer's
    // Changelog is the releases list itself.
    for (const a of container.querySelectorAll("a[href*='/releases/']")) {
      expect(a.getAttribute("href")).toBe(DESKTOP_MAC_DMG_URL);
    }
    expect(downloadLinks(container).every((href) => href === DESKTOP_MAC_DMG_URL)).toBe(true);
  });

  it("signed out, Start building and Start on the web go to sign-in", () => {
    renderLanding();
    const starts = screen.getAllByRole("link", { name: "Start building — sign in with GitHub" });
    expect(starts).toHaveLength(2);
    for (const link of starts) expect(link).toHaveAttribute("href", "#/signin");
    expect(screen.getByRole("link", { name: "Start on the web" })).toHaveAttribute(
      "href",
      "#/signin",
    );
  });

  it("signed in, the same labels go straight Home (OQ-21) and the header offers Open app", () => {
    renderLanding(ME);
    for (const link of screen.getAllByRole("link", {
      name: "Start building — sign in with GitHub",
    })) {
      expect(link).toHaveAttribute("href", "#/home");
    }
    expect(screen.getByRole("link", { name: "Start on the web" })).toHaveAttribute(
      "href",
      "#/home",
    );
    expect(screen.getByRole("link", { name: "Open app" })).toHaveAttribute("href", "#/home");
    expect(screen.getByText("lazyxgenius")).toBeInTheDocument();
  });

  it("draws the pictures as static, hidden, never-focusable mocks (WEB-10)", () => {
    const { container } = renderLanding();
    // The mock gate's buttons are pictures: out of the accessibility tree and the tab order.
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    const approve = within(container.querySelector<HTMLElement>(".web-gates")!).getByText(
      "Approve",
    );
    expect(approve.closest("button")).toHaveAttribute("tabindex", "-1");
    const pictures = container.querySelectorAll(
      ".tp__stage, .web-crew, .web-mock-card, .web-gates",
    );
    expect(pictures).toHaveLength(5);
    for (const mock of pictures) {
      expect(mock).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("shows no times, counts or run results on its pictures (landing-1.md §5)", () => {
    const { container } = renderLanding();
    for (const picture of container.querySelectorAll(".web-crew, .web-mock-card, .web-gates")) {
      // A model's name and the Domains answer's numbered source are the only digits it may show.
      const words = picture.textContent?.replace(/grok-4\.7|claude-sonnet-5|back\s*1/g, "");
      expect(words).not.toMatch(/\d/);
    }
    expect(screen.queryByText(/Real run/)).toBeNull();
  });

  it("compares the two ways to run in a real table (WEB-15)", () => {
    renderLanding();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: /Website/ })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /Desktop app/ })).toBeInTheDocument();
    const row = within(table).getByRole("row", { name: /Where it runs/ });
    expect(within(row).getByRole("rowheader", { name: "Where it runs" })).toBeInTheDocument();
    // Honest copy (independent review): only steps on a Claude or Grok plan run on the Mac.
    expect(within(row).getByText("Your computer, for steps on your plan")).toBeInTheDocument();
    const closing = within(table).getByRole("row", { name: /Runs when you close it/ });
    expect(
      within(closing).getByText("Steps on your plan stop; the rest go on"),
    ).toBeInTheDocument();
    // Nothing forces a review before Ship: say what the product offers, not "every change".
    expect(screen.queryByText("Every change reviewed before it ships")).toBeNull();
    expect(screen.getByText("Review loops and approval gates before it ships")).toBeInTheDocument();
  });
});

describe("The questions (WEB-17, OQ-28)", () => {
  it("opens the first answer on load, and only one answer at a time", () => {
    renderLanding();
    const first = screen.getByRole("button", { name: "Do I need an API key?" });
    const second = screen.getByRole("button", {
      name: "Does Tvashtr see my code or my Claude login?",
    });
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(first.getAttribute("aria-controls")!)).toBeVisible();

    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(first.getAttribute("aria-controls")!)).not.toBeVisible();
    expect(screen.getByText(/Your agents work in a private sandbox/)).toBeVisible();

    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-expanded", "false");
  });

  it("names only the providers that power a seat, never one that runs nothing (OQ-11)", () => {
    renderLanding();
    fireEvent.click(screen.getByRole("button", { name: "Which models can I use?" }));
    const answer = screen.getByText(/^On the website, any model from/);
    expect(answer).toHaveTextContent(
      "any model from anthropic, groq or xai, with your own API key",
    );
    expect(answer).not.toHaveTextContent("nvidia");
  });

  it("stays honest with no catalogue", () => {
    renderLanding(null, null);
    fireEvent.click(screen.getByRole("button", { name: "Is it open source?" }));
    expect(
      screen.getByText("The source is on GitHub. A license hasn’t been chosen yet."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Which models can I use?" }));
    expect(screen.getByText(/any model from a supported provider,/)).toBeVisible();
  });
});

describe("The team picture (landing-1.md §1)", () => {
  it("tells assistive tech what it shows, and rests on the finished state", () => {
    const { container } = renderLanding();
    expect(
      screen.getByText(/^A team at work: a task goes to the Product manager/),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-cap="pr"]')).toHaveClass("tp__cap--end");
    expect(container.querySelector('[data-stop="ship"] [data-st="done"]')).toHaveClass(
      "tp__st--end",
    );
    expect(container.querySelector(".tp__lit")).toBeInTheDocument();
  });

  it("takes a stop out of the team and re-routes the path, and puts it back", () => {
    const { container } = renderLanding();
    const reviewer = screen.getByRole("button", { name: "Reviewer" });
    expect(reviewer).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector('[data-edge="tests-rev"]')).toBeInTheDocument();
    fireEvent.click(reviewer);
    expect(reviewer).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector('[data-stop="rev"]')).toBeNull();
    expect(container.querySelector('[data-edge="tests-scan"]')).toBeInTheDocument();
    expect(screen.queryByText("changes requested", { selector: ".tp__label" })).toBeNull();
    fireEvent.click(reviewer);
    expect(container.querySelector('[data-stop="rev"]')).toBeInTheDocument();
  });
});

describe("The demo videos (landing-1.md §8)", () => {
  let play: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    play = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads nothing before a press, then plays Reel 1 with sound and the browser's controls", () => {
    const { container } = renderLanding();
    const video = container.querySelector<HTMLVideoElement>(".web-demo video")!;
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("src", "/media/reel-1.mp4");
    expect(video).toHaveAttribute("poster", "/media/reel-1-poster.webp");
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video).not.toHaveAttribute("controls");
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Play the 1-minute demo, with sound" }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.muted).toBe(false);
    fireEvent.play(video);
    expect(video).toHaveAttribute("controls");
    expect(screen.queryByRole("button", { name: /Play the 1-minute demo/ })).toBeNull();
  });

  it("plays one full run in a lightbox, with captions, and Escape returns to the page", () => {
    const { container } = renderLanding();
    expect(container.querySelector('video[src="/media/demo-2min.mp4"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See one full run · 2 min" }));
    const dialog = screen.getByRole("dialog", { name: "One full run · 2 min" });
    const track = dialog.querySelector("track")!;
    expect(track).toHaveAttribute("src", "/media/demo-2min.en.vtt");
    expect(track).toHaveAttribute("kind", "captions");
    expect(track).toHaveAttribute("srclang", "en");
    expect(track.hasAttribute("default")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the hero's Watch the demo starts Reel 1", () => {
    renderLanding();
    fireEvent.click(screen.getByRole("button", { name: "Watch the demo · 1 min" }));
    expect(play).toHaveBeenCalledTimes(1);
  });
});
