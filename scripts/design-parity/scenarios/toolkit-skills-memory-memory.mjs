// Toolkit › Memory (slice F4) — website and Desktop renders of every Memory artboard.
// Scenario names are `<Artboard>-web` / `<Artboard>-desktop`, so the measurement lands in
// /tmp/parity-toolkit-skills-memory/<Artboard>-<surface>.json next to the design's <Artboard>.json.
import {
  MEM_MUST_NOT,
  MEM_SHOULD,
  frozenClock,
  memoryRoutes,
} from "./toolkit-skills-memory-fixtures.mjs";

// `routes` is a factory: each render gets its own fixture state (a Keep in the web render must not
// leak into the Desktop one).
const both = (
  artboard,
  { path = "#/toolkit/memory/inbox", routes, steps, settle },
) => [
  {
    name: `${artboard}-web`,
    path,
    routes: routes(),
    steps,
    settle,
    init: frozenClock,
  },
  {
    name: `${artboard}-desktop`,
    path,
    routes: routes(),
    steps,
    settle,
    init: frozenClock,
    desktop: true,
  },
];

const inboxRows = async (page) => {
  await page.waitForSelector('section[aria-label="Inbox"] .mem-row');
  // The review switch has loaded (its copy is set) and the tab counts are in.
  await page
    .getByText("On: every new memory waits in the Inbox until you keep it.")
    .waitFor();
  await page.getByRole("tab", { name: /Inbox \d/ }).waitFor();
};
const rowButton = (page, content, name) =>
  page
    .locator("li.mem-row", { hasText: content })
    .getByRole("button", { name, exact: true });
const toastShown = async (page, text) => {
  await page.locator('[role="status"].ds-toast', { hasText: text }).waitFor();
  // The toast's pop-in animation finishes before the shot.
  await page.waitForTimeout(300);
};

export default [
  // G4 — Memory shell + Inbox
  ...both("Toolkit-MemoryInbox", {
    routes: () => memoryRoutes(),
    steps: inboxRows,
  }),
  ...both("TkF-Review-1", { routes: () => memoryRoutes(), steps: inboxRows }),
  ...both("TkF-Review-2", {
    routes: () => memoryRoutes(),
    steps: async (page) => {
      await inboxRows(page);
      // The DS switch's input is visually hidden: click its track (the label), as a person does.
      await page.locator(".mem-review .ds-switch").click();
      await toastShown(page, "New memories now apply right away.");
    },
  }),
  ...both("TkF-Inbox-1", { routes: () => memoryRoutes(), steps: inboxRows }),
  ...both("TkF-Inbox-2", {
    routes: () => memoryRoutes(),
    steps: async (page) => {
      await inboxRows(page);
      await rowButton(page, MEM_SHOULD.content, "Keep").click();
      await toastShown(page, "Kept. Reviewer uses it from the next run.");
      await page.getByRole("tab", { name: "Inbox 1" }).waitFor();
    },
  }),
  ...both("TkF-Inbox-3", {
    routes: () => memoryRoutes(),
    steps: async (page) => {
      await inboxRows(page);
      await rowButton(page, MEM_MUST_NOT.content, "Edit").click();
      const box = page.getByRole("textbox", { name: "Memory text" });
      await box.waitFor();
      // The design draws the editor at rest (no focus ring).
      await box.evaluate((el) => el.blur());
    },
  }),
  // The SHOULD was kept in TkF-Inbox-2; discarding the caution clears the Inbox.
  ...both("TkF-Inbox-4", {
    routes: () => memoryRoutes({ pending: [MEM_MUST_NOT] }),
    steps: async (page) => {
      await inboxRows(page);
      await rowButton(page, MEM_MUST_NOT.content, "Discard").click();
      await toastShown(page, "Discarded. You’ll find it in Archive.");
      await page.getByRole("heading", { name: "Inbox is clear" }).waitFor();
      await page.getByRole("tab", { name: "Inbox 0" }).waitFor();
    },
  }),
];
