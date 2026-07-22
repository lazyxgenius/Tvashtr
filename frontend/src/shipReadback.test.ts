import { describe, expect, it } from "vitest";

import { addedFile, type ShipDiff } from "../e2e/_shipReadback";

// Mutation-real unit coverage for the e2e ship-readback helper's patch parsing. Mirrors
// scripts/_ship_readback.py::added_file — greenfield added-file content lives in the patch's
// "+" lines; the "+++" file header and git's "\ No newline at end of file" marker are not content.

function diffWith(files: ShipDiff["files"]): ShipDiff {
  return { run_id: "r1", base_ref: null, ship_branch: null, files, total: files?.length ?? 0 };
}

describe("addedFile (ship-readback patch parse)", () => {
  it("reconstructs byte-exact single-line content", () => {
    const diff = diffWith([
      {
        path: "greeting.txt",
        status: "added",
        patch: [
          "diff --git a/greeting.txt b/greeting.txt",
          "new file mode 100644",
          "--- /dev/null",
          "+++ b/greeting.txt",
          "@@ -0,0 +1 @@",
          "+Hello from the canvas",
        ].join("\n"),
      },
    ]);
    expect(addedFile(diff, "greeting.txt")).toBe("Hello from the canvas");
  });

  it("reconstructs a multi-line file (join with newlines)", () => {
    const diff = diffWith([
      {
        path: "notes.md",
        status: "added",
        patch: ["+++ b/notes.md", "@@ -0,0 +1,3 @@", "+line one", "+line two", "+line three"].join(
          "\n",
        ),
      },
    ]);
    expect(addedFile(diff, "notes.md")).toBe("line one\nline two\nline three");
  });

  it("skips the +++ file header line (not content)", () => {
    const diff = diffWith([
      {
        path: "greeting.txt",
        status: "added",
        // A naive startsWith("+") would treat "+++ b/greeting.txt" as content "+ b/greeting.txt".
        patch: "+++ b/greeting.txt\n@@ -0,0 +1 @@\n+real content",
      },
    ]);
    expect(addedFile(diff, "greeting.txt")).toBe("real content");
    expect(addedFile(diff, "greeting.txt")).not.toContain("b/greeting.txt");
  });

  it("skips git's no-trailing-newline marker", () => {
    const diff = diffWith([
      {
        path: "greeting.txt",
        status: "added",
        patch: [
          "+++ b/greeting.txt",
          "@@ -0,0 +1 @@",
          "+no trailing nl",
          "\\ No newline at end of file",
        ].join("\n"),
      },
    ]);
    expect(addedFile(diff, "greeting.txt")).toBe("no trailing nl");
    expect(addedFile(diff, "greeting.txt")).not.toContain("No newline");
  });

  it("returns null when the path is missing from the diff", () => {
    const diff = diffWith([
      {
        path: "other.txt",
        status: "added",
        patch: "+++ b/other.txt\n+hi",
      },
    ]);
    expect(addedFile(diff, "greeting.txt")).toBeNull();
    expect(addedFile(diffWith([]), "greeting.txt")).toBeNull();
    expect(addedFile(null, "greeting.txt")).toBeNull();
    expect(addedFile(undefined, "greeting.txt")).toBeNull();
  });

  it("returns null when the matching entry is not status 'added'", () => {
    const modified: ShipDiff = diffWith([
      {
        path: "greeting.txt",
        status: "modified",
        patch: "+++ b/greeting.txt\n+should not be used",
      },
    ]);
    const deleted: ShipDiff = diffWith([
      {
        path: "greeting.txt",
        status: "deleted",
        patch: "--- a/greeting.txt\n-old",
      },
    ]);
    expect(addedFile(modified, "greeting.txt")).toBeNull();
    expect(addedFile(deleted, "greeting.txt")).toBeNull();
  });
});
