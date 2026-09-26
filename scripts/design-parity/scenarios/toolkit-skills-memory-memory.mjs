// Toolkit › Memory (slice F4) — website and Desktop renders of every Memory artboard.
// Scenario names are `<Artboard>-web` / `<Artboard>-desktop`, so the measurement lands in
// /tmp/parity-toolkit-skills-memory/<Artboard>-<surface>.json next to the design's <Artboard>.json.
import {
  ACTIVE_ROWS,
  ACT_CONTEXT,
  ACT_SHOULD,
  ARCHIVE_ROWS,
  ARC_DISCARDED,
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

const ACTIVE = "#/toolkit/memory/active";
const activeRoutes = () => memoryRoutes({ activeRows: ACTIVE_ROWS });
const activeRows = async (page) => {
  await page.waitForSelector('section[aria-label="Active"] .mem-row');
  await page.getByRole("tab", { name: /Active \d/ }).waitFor();
  // The Repo filter's choices have loaded (repos with memories first).
  await page.waitForLoadState("networkidle");
};
const activeButton = (page, content, name) =>
  page
    .locator('section[aria-label="Active"] li.mem-row', { hasText: content })
    .getByRole("button", { name, exact: true });
// The pointer rests off the list (a clicked row moved away from under it).
const pointerAway = (page) => page.mouse.move(1400, 700);
const SHOULD_EDITED =
  "Approve only when the registry test, the TypeScript mirror and the docs list the same indicators.";

const ARCHIVE = "#/toolkit/memory/archive";
const archiveRoutes = () =>
  memoryRoutes({ activeRows: ACTIVE_ROWS, archiveRows: ARCHIVE_ROWS });
const archiveRows = async (page) => {
  await page.waitForSelector('section[aria-label="Archive"] .mem-row');
  await page.getByRole("tab", { name: /Active \d/ }).waitFor();
};

const openFilter = async (page, name) => {
  await page.getByRole("combobox", { name }).click();
  await page.getByRole("listbox", { name }).waitFor();
  // The popover's pop-in animation finishes before the shot.
  await page.waitForTimeout(250);
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
  // G5 — Active, filters, empty
  ...both("Toolkit-MemoryActive", {
    path: ACTIVE,
    routes: activeRoutes,
    steps: activeRows,
  }),
  ...both("TkF-Filters-1", {
    path: ACTIVE,
    routes: activeRoutes,
    steps: async (page) => {
      await activeRows(page);
      await openFilter(page, "Repo");
    },
  }),
  ...both("TkF-Filters-2", {
    path: ACTIVE,
    routes: activeRoutes,
    steps: async (page) => {
      await activeRows(page);
      await openFilter(page, "Scope");
    },
  }),
  // The design highlights SHOULD in the open list: the pointer rests on it.
  ...both("TkF-Filters-3", {
    path: ACTIVE,
    routes: activeRoutes,
    steps: async (page) => {
      await activeRows(page);
      await openFilter(page, "Force");
      await page.getByRole("option", { name: "SHOULD", exact: true }).hover();
    },
  }),
  ...both("TkF-Filters-4", {
    path: ACTIVE,
    routes: activeRoutes,
    steps: async (page) => {
      await activeRows(page);
      await openFilter(page, "Force");
      await page.getByRole("option", { name: "SHOULD", exact: true }).click();
      await page.getByText("1 of 14").waitFor();
      await page.mouse.move(700, 800);
    },
  }),
  ...both("TkF-Filters-5", {
    path: ACTIVE,
    routes: activeRoutes,
    steps: async (page) => {
      await activeRows(page);
      const search = page.getByRole("textbox", { name: "Search memory" });
      await search.fill("docker");
      await page
        .getByRole("heading", { name: "Nothing matches “docker”" })
        .waitFor();
      // The design draws the search at rest (no focus ring).
      await search.evaluate((el) => el.blur());
    },
  }),
  // G6 — note actions
  ...both("TkF-NoteActions-1", {
    path: ACTIVE,
    routes: activeRoutes,
    steps: async (page) => {
      await activeRows(page);
      await activeButton(page, ACT_CONTEXT.content, "Pin").click();
      await pointerAway(page);
      await toastShown(page, "Pinned. Pinned notes go to the agent first.");
      await page.getByText("Added by you · pinned").waitFor();
    },
  }),
  ...both("TkF-NoteActions-2", {
    path: ACTIVE,
    routes: activeRoutes,
    steps: async (page) => {
      await activeRows(page);
      await activeButton(page, ACT_SHOULD.content, "Edit").click();
      const box = page.getByRole("textbox", { name: "Memory text" });
      await box.waitFor();
      // The design draws the editor at rest (no focus ring).
      await box.evaluate((el) => el.blur());
      await pointerAway(page);
    },
  }),
  ...both("TkF-NoteActions-3", {
    path: ACTIVE,
    routes: activeRoutes,
    steps: async (page) => {
      await activeRows(page);
      await activeButton(page, ACT_SHOULD.content, "Edit").click();
      await page
        .getByRole("textbox", { name: "Memory text" })
        .fill(SHOULD_EDITED);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await pointerAway(page);
      await toastShown(
        page,
        "Saved. Agents see the new text on their next run.",
      );
      await page.getByText("Edited by you · just now").waitFor();
    },
  }),
  ...both("TkF-NoteActions-4", {
    path: ACTIVE,
    routes: activeRoutes,
    steps: async (page) => {
      await activeRows(page);
      await activeButton(page, ACT_CONTEXT.content, "Delete").click();
      await page
        .getByRole("alertdialog", { name: "Delete this memory?" })
        .waitFor();
      // The dialog's pop-in animation finishes before the shot.
      await page.waitForTimeout(300);
    },
  }),
  // G6 — Archive
  ...both("TkF-Archive-1", {
    path: ARCHIVE,
    routes: archiveRoutes,
    steps: archiveRows,
  }),
  ...both("TkF-Archive-2", {
    path: ARCHIVE,
    routes: archiveRoutes,
    steps: async (page) => {
      await archiveRows(page);
      await page
        .locator('section[aria-label="Archive"] li.mem-row', {
          hasText: ARC_DISCARDED.content,
        })
        .getByRole("button", { name: "Restore", exact: true })
        .click();
      await pointerAway(page);
      await toastShown(page, "Restored to Active.");
    },
  }),
  ...both("TkF-MemoryEmpty-1", {
    path: ACTIVE,
    routes: () => memoryRoutes({ pending: [], activeRows: [] }),
    steps: async (page) => {
      await page
        .getByRole("heading", {
          name: "Your agents haven’t learned anything yet",
        })
        .waitFor();
      await page.getByRole("tab", { name: "Active 0" }).waitFor();
    },
  }),
];
