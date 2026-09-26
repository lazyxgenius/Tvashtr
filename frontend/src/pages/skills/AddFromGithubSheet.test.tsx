import { fireEvent, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests, useBackendStatus } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { jsonError, mockApi } from "../home/homeTestUtils";
import { LIBRARY, renderAt, skill, table } from "./skillsTestUtils";

const URL_OK = "https://github.com/lazyxgenius/skills";
const SHA = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const found = (name: string, in_library = false) => ({
  name,
  path: `skills/${name}/SKILL.md`,
  description: null,
  in_library,
});
const SCAN = {
  repo: "lazyxgenius/skills",
  url: URL_OK,
  ref: "main",
  sha: SHA,
  short_sha: "1a2b3c4",
  skills: [
    found("pytest-review", true),
    found("house-style-py"),
    found("api-conventions"),
    found("commit-messages"),
  ],
};
const repoSkill = (name: string) =>
  skill(
    `r-${name}`,
    name,
    { type: "repo", url: URL_OK, ref: "main", filter: name, mode: "agent", resolved_sha: SHA },
    undefined,
    new Date().toISOString(),
  );

const NOT_FOUND = {
  code: "repo_not_found",
  message:
    "We couldn’t find that repo. Check the name, or install the GitHub App on it if it’s private.",
};

async function openSheet() {
  fireEvent.click(await screen.findByRole("button", { name: "Add from GitHub" }));
  return screen.getByRole("dialog", { name: "Add skills from GitHub" });
}

function find(sheet: HTMLElement, url: string) {
  fireEvent.change(within(sheet).getByRole("textbox", { name: "Repository" }), {
    target: { value: url },
  });
  fireEvent.click(within(sheet).getByRole("button", { name: "Find skills" }));
}

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("Add from GitHub (TkF-FromRepo)", () => {
  it("opens the sheet with Repository and Version; Find skills waits for a repo", async () => {
    mockApi({ "GET /api/skill-library": { skills: LIBRARY } });
    renderAt("#/toolkit/skills");
    const sheet = await openSheet();
    expect(within(sheet).getByText("Pull SKILL.md files from a repo")).toBeTruthy();
    expect(within(sheet).getByRole<HTMLInputElement>("textbox", { name: "Version" }).value).toBe(
      "main",
    );
    const findBtn = within(sheet).getByRole<HTMLButtonElement>("button", { name: "Find skills" });
    expect(findBtn.disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Add skills from GitHub" })).toBeNull();
  });

  it("puts a repo the scan can't find on the Repository field (TkF-FromRepo-1)", async () => {
    mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "POST /api/skill-library/scan": () => jsonError(404, NOT_FOUND),
    });
    renderAt("#/toolkit/skills");
    const sheet = await openSheet();
    find(sheet, "https://github.com/lazyxgenius/skils");
    expect((await within(sheet).findByRole("alert")).textContent).toBe(NOT_FOUND.message);
    expect(
      within(sheet).getByRole("textbox", { name: "Repository" }).getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("puts an unknown version on the Version field", async () => {
    mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "POST /api/skill-library/scan": () =>
        jsonError(422, { code: "ref_not_found", message: "We couldn’t find v9 in that repo." }),
    });
    renderAt("#/toolkit/skills");
    const sheet = await openSheet();
    find(sheet, URL_OK);
    await within(sheet).findByRole("alert");
    expect(
      within(sheet).getByRole("textbox", { name: "Version" }).getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      within(sheet).getByRole("textbox", { name: "Repository" }).getAttribute("aria-invalid"),
    ).toBeNull();
  });

  it("GitHub not answering is GitHub's problem, not an offline backend", async () => {
    mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "POST /api/skill-library/scan": () =>
        jsonError(502, { code: "github_unreachable", message: "GitHub didn’t answer. Try again." }),
    });
    renderAt("#/toolkit/skills");
    const status = renderHook(() => useBackendStatus());
    const sheet = await openSheet();
    find(sheet, URL_OK);
    expect((await within(sheet).findByRole("alert")).textContent).toBe(
      "GitHub didn’t answer. Try again.",
    );
    expect(status.result.current.state).toBe("connected");
  });

  it("lists what it found, leaves out skills you already have, and filters by globs (TkF-FromRepo-2)", async () => {
    const calls = mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "POST /api/skill-library/scan": SCAN,
    });
    renderAt("#/toolkit/skills");
    const sheet = await openSheet();
    find(sheet, URL_OK);
    const list = await within(sheet).findByRole("group", { name: "Skills found" });
    expect(calls.find((c) => c.path === "/api/skill-library/scan")?.body).toEqual({
      url: URL_OK,
      ref: "main",
    });
    expect(within(list).getByText("Found 4 skills at main @ 1a2b3c4")).toBeTruthy();
    expect(
      within(sheet).getByText("A branch, tag or commit. Pinning keeps runs repeatable."),
    ).toBeTruthy();
    expect(within(sheet).getByText("Skills update when you change the version.")).toBeTruthy();

    const box = (name: string) =>
      within(list).getByRole<HTMLInputElement>("checkbox", { name: new RegExp(`^${name}`) });
    expect(box("pytest-review").checked).toBe(false);
    expect(box("pytest-review").disabled).toBe(true);
    expect(within(list).getByText("Already in your skills")).toBeTruthy();
    expect(box("house-style-py").checked).toBe(true);
    expect(box("api-conventions").checked).toBe(true);
    const add = () =>
      within(sheet).getByRole<HTMLButtonElement>("button", { name: /^Add \d+ skills?$/ });
    expect(add().textContent).toBe("Add 3 skills");

    fireEvent.click(box("commit-messages"));
    expect(add().textContent).toBe("Add 2 skills");

    // "Only these skills" narrows the list, the summary and the count.
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Only these skills" }), {
      target: { value: "api-*, house-*" },
    });
    expect(within(list).getByText("Found 2 of 4 skills at main @ 1a2b3c4")).toBeTruthy();
    expect(within(list).queryByText("pytest-review")).toBeNull();
    expect(add().textContent).toBe("Add 2 skills");
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Only these skills" }), {
      target: { value: "nothing-*" },
    });
    expect(within(list).getByText("No skills match those names.")).toBeTruthy();
    expect(add().textContent).toBe("Add 0 skills");
    expect(add().disabled).toBe(true);
  });

  it("changing the repo goes back to Find skills", async () => {
    mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "POST /api/skill-library/scan": SCAN,
    });
    renderAt("#/toolkit/skills");
    const sheet = await openSheet();
    find(sheet, URL_OK);
    await within(sheet).findByRole("group", { name: "Skills found" });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Version" }), {
      target: { value: "v2" },
    });
    expect(within(sheet).queryByRole("group", { name: "Skills found" })).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Find skills" })).toBeTruthy();
  });

  it("adds the checked skills as Agent decides, tints the new rows and says so (TkF-FromRepo-3)", async () => {
    const calls = mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "POST /api/skill-library/scan": SCAN,
      "POST /api/skill-library/import": {
        added: ["house-style-py", "api-conventions", "commit-messages"].map(repoSkill),
        skipped: [],
      },
    });
    renderAt("#/toolkit/skills");
    const sheet = await openSheet();
    find(sheet, URL_OK);
    await within(sheet).findByRole("group", { name: "Skills found" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add 3 skills" }));

    expect(await screen.findByText("3 skills added from lazyxgenius/skills.")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Add skills from GitHub" })).toBeNull();
    expect(calls.find((c) => c.path === "/api/skill-library/import")?.body).toEqual({
      url: URL_OK,
      ref: "main",
      sha: SHA,
      skills: ["house-style-py", "api-conventions", "commit-messages"],
      mode: "agent",
    });
    const row = within(table()).getByRole("button", { name: "api-conventions" }).closest("tr")!;
    expect(row.className).toContain("sk-row--new");
    expect(within(row).getByText("lazyxgenius/skills @ main")).toBeTruthy();
    expect(within(row).getByText("Agent decides")).toBeTruthy();
    expect(within(row).getByText("Not used yet")).toBeTruthy();
    expect(within(row).getByText("Just now")).toBeTruthy();
    const old = within(table()).getByRole("button", { name: "house-style" }).closest("tr")!;
    expect(old.className).not.toContain("sk-row--new");
    expect(screen.getByRole("status", { name: "skills badge" }).textContent).toBe("6");
  });

  it("keeps the sheet open with the reason when the add fails", async () => {
    mockApi({
      "GET /api/skill-library": { skills: LIBRARY },
      "POST /api/skill-library/scan": SCAN,
      "POST /api/skill-library/import": () =>
        jsonError(422, "sha must be the full 40-character commit SHA from the scan."),
    });
    renderAt("#/toolkit/skills");
    const sheet = await openSheet();
    find(sheet, URL_OK);
    await within(sheet).findByRole("group", { name: "Skills found" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add 3 skills" }));
    expect((await within(sheet).findByRole("alert")).textContent).toBe(
      "sha must be the full 40-character commit SHA from the scan.",
    );
  });
});
