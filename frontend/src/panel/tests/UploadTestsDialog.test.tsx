import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonError, mockApi } from "../../pages/home/homeTestUtils";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { FILE_CHECK } from "./testsFixtures";
import { UploadTestsDialog } from "./UploadTestsDialog";

// M7 Test-Upload / Test-UploadError.

const BASE = "/api/teams/t1/nodes/n-rev/tests";
const FILE = { filename: "reviewer-examples.csv", content: "task,diff,expected,file,notes\n" };

afterEach(() => {
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

function renderDialog() {
  const onClose = vi.fn();
  const onAdded = vi.fn();
  render(
    <UploadTestsDialog
      teamId="t1"
      nodeId="n-rev"
      agent="Reviewer"
      file={FILE}
      onClose={onClose}
      onAdded={onAdded}
    />,
  );
  return {
    onClose,
    onAdded,
    dialog: screen.getByRole("dialog", { name: "Add tests from a file" }),
  };
}

describe("UploadTestsDialog", () => {
  it("Test-Upload: the file, each column's first row and use, 12 tests ready, Add 12 tests", async () => {
    const calls = mockApi({
      [`POST ${BASE}/file/check`]: FILE_CHECK,
      [`POST ${BASE}/file`]: { added: 12 },
    });
    const { dialog, onAdded } = renderDialog();
    expect(dialog).toHaveTextContent(
      "Each row becomes one test for the Reviewer. Tell Tvashtr what each column is.",
    );
    expect(await within(dialog).findByText("12 rows · 5 columns")).toBeInTheDocument();
    expect(calls[0].body).toEqual(FILE);
    const select = within(dialog).getByLabelText<HTMLSelectElement>("Use notes as");
    expect(select.value).toBe("skip");
    expect([...select.options].map((o) => o.text)).toEqual([
      "What the agent gets",
      "Must say",
      "Must name a file",
      "Don’t use",
    ]);
    const ready = within(dialog).getByRole("status");
    expect(ready).toHaveTextContent("12 tests are ready");
    expect(ready).toHaveTextContent(
      "All 12 check what the Reviewer must say. 9 also check a file it must name.",
    );
    expect(dialog).toHaveTextContent("Rows with an empty task are skipped");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 12 tests" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(12));
    expect(calls.at(-1)).toMatchObject({
      path: `${BASE}/file`,
      body: {
        ...FILE,
        mapping: {
          task: "gets",
          diff: "gets",
          expected: "must_say",
          file: "must_name_file",
          notes: "skip",
        },
      },
    });
  });

  it("each change of use checks again with the whole mapping; the latest answer wins", async () => {
    let n = 0;
    const calls = mockApi({
      [`POST ${BASE}/file/check`]: (_u: URL, body: { mapping?: Record<string, string> }) => {
        n += 1;
        return body.mapping?.file === "skip"
          ? {
              ...FILE_CHECK,
              columns: FILE_CHECK.columns.map((c) =>
                c.name === "file" ? { ...c, use: "skip" } : c,
              ),
              ready: { tests: 12, must_say: 12, must_name_file: 0 },
            }
          : FILE_CHECK;
      },
    });
    const { dialog } = renderDialog();
    await within(dialog).findByText("12 rows · 5 columns");
    fireEvent.change(within(dialog).getByLabelText("Use file as"), { target: { value: "skip" } });
    await waitFor(() =>
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        "All 12 check what the Reviewer must say.",
      ),
    );
    expect(within(dialog).getByRole("status")).not.toHaveTextContent("also check");
    expect(n).toBe(2);
    expect((calls.at(-1)?.body as { mapping: unknown }).mapping).toEqual({
      task: "gets",
      diff: "gets",
      expected: "must_say",
      file: "skip",
      notes: "skip",
    });
  });

  it("no column for the task: says so and Add stays off", async () => {
    mockApi({
      [`POST ${BASE}/file/check`]: {
        ...FILE_CHECK,
        columns: FILE_CHECK.columns.map((c) => ({ ...c, use: c.use === "gets" ? "skip" : c.use })),
        ready: { tests: 0, must_say: 0, must_name_file: 0 },
      },
    });
    const { dialog } = renderDialog();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Pick a column for What the agent gets.",
    );
    expect(within(dialog).getByRole("button", { name: "Add tests" })).toBeDisabled();
  });

  it("Test-UploadError: a file that can't be read says why; Choose another reads the new one", async () => {
    let reply: unknown = jsonError(422, "This file can’t be read: line 3 isn’t valid JSON.");
    const calls = mockApi({ [`POST ${BASE}/file/check`]: () => reply });
    const { dialog } = renderDialog();
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("This file can’t be read");
    expect(alert).toHaveTextContent(
      "Line 3 isn’t valid JSON. Use CSV with a header row, or one JSON object per line.",
    );
    expect(within(dialog).getByText("Couldn’t read it")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add tests" })).toBeDisabled();
    reply = FILE_CHECK;
    // jsdom's File has no text(): give the picked file one.
    const file = Object.assign(new File(["task\nAdd EMA\n"], "fixed.csv", { type: "text/csv" }), {
      text: () => Promise.resolve("task\nAdd EMA\n"),
    });
    fireEvent.change(screen.getByTestId("test-file"), { target: { files: [file] } });
    expect(await within(dialog).findByText("12 rows · 5 columns")).toBeInTheDocument();
    expect(within(dialog).getByText("fixed.csv")).toBeInTheDocument();
    expect(calls.at(-1)?.body).toEqual({ filename: "fixed.csv", content: "task\nAdd EMA\n" });
  });
});
