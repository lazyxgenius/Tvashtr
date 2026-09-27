import { describe, expect, it } from "vitest";

import type { SecretsList } from "../../lib/api/tools";
import {
  copiedToast,
  deleteImpact,
  deletedToast,
  formatUpdated,
  missingSentence,
  orderMissing,
  orderSecretRows,
  replacedToast,
  savedToast,
  secretNameError,
  suggestSecretName,
  usedByText,
} from "./secretFormat";

const LINEAR = { id: "t-linear", name: "linear" };
const JIRA = { id: "t-jira", name: "jira" };
const GITHUB = { id: "t-github", name: "github" };

const stored = (name: string, updated_at = "2026-09-20T12:00:00Z", used_by_tools = [GITHUB]) => ({
  name,
  created_at: updated_at,
  updated_at,
  used_by_tools,
});

describe("the secret name rule (SECRET-10)", () => {
  it("suggests the name upper-cased with runs of other characters turned into _", () => {
    expect(suggestSecretName("notion-token")).toBe("NOTION_TOKEN");
    expect(suggestSecretName("  my  api.key!! ")).toBe("MY_API_KEY");
    expect(suggestSecretName("---")).toBe("GITHUB_TOKEN");
    expect(suggestSecretName("9lives")).toBe("GITHUB_TOKEN");
  });

  it("accepts capital letters, numbers and _ and explains anything else", () => {
    expect(secretNameError("NOTION_TOKEN")).toBeNull();
    expect(secretNameError("_X9")).toBeNull();
    expect(secretNameError("notion-token")).toBe(
      "Use capital letters, numbers and _, like NOTION_TOKEN.",
    );
    expect(secretNameError("1TOKEN")).not.toBeNull();
    expect(secretNameError("A".repeat(129))).not.toBeNull();
    expect(secretNameError("A".repeat(128))).toBeNull();
  });
});

describe("the Updated cell (SECRET-6)", () => {
  const now = Date.parse("2026-09-26T10:00:00Z");
  it("reads Just now under a minute, else a short date", () => {
    expect(formatUpdated("2026-09-26T09:59:30Z", now)).toBe("Just now");
    expect(formatUpdated("2026-09-20T12:00:00Z", now)).toBe("Sep 20");
    expect(formatUpdated("2025-08-30T12:00:00Z", now)).toBe("Aug 30, 2025");
    expect(formatUpdated(null, now)).toBe("—");
  });
});

describe("row copy", () => {
  it("lists the tools that use a stored secret, or says none do", () => {
    expect(usedByText([GITHUB, LINEAR])).toBe("github, linear");
    expect(usedByText([])).toBe("Not used by any tool");
  });

  it("writes the banner for one tool and for several (SECRET-3)", () => {
    expect(missingSentence({ name: "LINEAR_TOKEN", used_by_tools: [LINEAR] })).toBe(
      " is used by linear but has no value. linear won’t connect until you add it.",
    );
    expect(missingSentence({ name: "X", used_by_tools: [LINEAR, JIRA] })).toBe(
      " is used by linear and jira but has no value. They won’t connect until you add it.",
    );
  });
});

describe("the table order", () => {
  it("puts rows saved this visit first (newest first), then missing rows, then A→Z", () => {
    const list: SecretsList = {
      secrets: [stored("SENTRY_TOKEN"), stored("NOTION_TOKEN"), stored("AWS_KEY"), stored("B")],
      missing: [
        { name: "LINEAR_TOKEN", used_by_tools: [LINEAR] },
        { name: "JIRA_TOKEN", used_by_tools: [JIRA] },
      ],
    };
    const rows = orderSecretRows(list, ["NOTION_TOKEN", "B", "GONE"]);
    expect(rows.map((r) => `${r.kind}:${r.name}`)).toEqual([
      "stored:NOTION_TOKEN",
      "stored:B",
      "missing:JIRA_TOKEN",
      "missing:LINEAR_TOKEN",
      "stored:AWS_KEY",
      "stored:SENTRY_TOKEN",
    ]);
  });
});

describe("toasts", () => {
  const after = (missing: SecretsList["missing"]): SecretsList => ({ secrets: [], missing });

  it("tells you how to use a new secret nothing used yet (SECRET-12)", () => {
    expect(savedToast("NOTION_TOKEN", undefined, null)).toBe(
      "NOTION_TOKEN saved. Use it in a tool as ${NOTION_TOKEN}.",
    );
  });

  it("says which tools a missing value unblocked (SECRET-19)", () => {
    const was = { name: "LINEAR_TOKEN", used_by_tools: [LINEAR] };
    expect(savedToast("LINEAR_TOKEN", was, after([]))).toBe("LINEAR_TOKEN saved. linear is ready.");
    const both = { name: "T", used_by_tools: [LINEAR, JIRA] };
    expect(savedToast("T", both, after([]))).toBe("T saved. linear and jira are ready.");
    // jira still waits on another secret, so it isn't called ready.
    expect(savedToast("T", both, after([{ name: "J", used_by_tools: [JIRA] }]))).toBe(
      "T saved. linear is ready; jira still needs another secret.",
    );
    // Readiness unknown when the list couldn't be reloaded.
    expect(savedToast("T", both, null)).toBe("T saved.");
  });

  it("says who picks up a replaced value (SECRET-17)", () => {
    expect(replacedToast("GITHUB_TOKEN", [GITHUB])).toBe(
      "GITHUB_TOKEN replaced. github uses the new value on its next run.",
    );
    expect(replacedToast("X", [LINEAR, JIRA])).toBe(
      "X replaced. linear and jira use the new value on their next run.",
    );
    expect(replacedToast("SENTRY_TOKEN", [])).toBe("SENTRY_TOKEN replaced.");
  });
});

describe("stable order within a visit", () => {
  const list: SecretsList = {
    secrets: [stored("SENTRY_TOKEN", undefined, []), stored("AWS_KEY", undefined, [])],
    missing: [
      { name: "LINEAR_TOKEN", used_by_tools: [LINEAR] },
      { name: "GITHUB_TOKEN", used_by_tools: [GITHUB] },
    ],
  };
  const names = (prev?: string[], fresh: string[] = []) =>
    orderSecretRows(list, fresh, prev).map((r) => r.name);

  it("uses the rule when nothing is on screen yet", () => {
    expect(names()).toEqual(["GITHUB_TOKEN", "LINEAR_TOKEN", "AWS_KEY", "SENTRY_TOKEN"]);
  });

  it("keeps rows already shown in place (a deleted, still-used secret flips in place)", () => {
    // GITHUB_TOKEN was the second row as a stored secret; it comes back missing, in the same spot.
    expect(names(["LINEAR_TOKEN", "GITHUB_TOKEN", "AWS_KEY", "SENTRY_TOKEN"])).toEqual([
      "LINEAR_TOKEN",
      "GITHUB_TOKEN",
      "AWS_KEY",
      "SENTRY_TOKEN",
    ]);
  });

  it("puts rows new to the screen by the rule: missing before, stored after, fresh on top", () => {
    expect(names(["LINEAR_TOKEN", "SENTRY_TOKEN"])).toEqual([
      "GITHUB_TOKEN",
      "LINEAR_TOKEN",
      "SENTRY_TOKEN",
      "AWS_KEY",
    ]);
    expect(names(["LINEAR_TOKEN", "SENTRY_TOKEN"], ["AWS_KEY"])).toEqual([
      "AWS_KEY",
      "GITHUB_TOKEN",
      "LINEAR_TOKEN",
      "SENTRY_TOKEN",
    ]);
  });

  it("keeps shown banners on top and adds new ones after them, A→Z", () => {
    const missing = [
      { name: "GITHUB_TOKEN", used_by_tools: [GITHUB] },
      { name: "JIRA_TOKEN", used_by_tools: [JIRA] },
      { name: "LINEAR_TOKEN", used_by_tools: [LINEAR] },
    ];
    expect(orderMissing(missing).map((m) => m.name)).toEqual([
      "GITHUB_TOKEN",
      "JIRA_TOKEN",
      "LINEAR_TOKEN",
    ]);
    expect(orderMissing(missing, ["LINEAR_TOKEN"]).map((m) => m.name)).toEqual([
      "LINEAR_TOKEN",
      "GITHUB_TOKEN",
      "JIRA_TOKEN",
    ]);
  });
});

describe("the secret menu's copy (SECRET-14/15/18/20)", () => {
  it("names the tools and agents a delete stops (SECRET-18)", () => {
    expect(deleteImpact([GITHUB], ["Engineer", "Reviewer", "Writer"])).toBe(
      "github uses it. github stops connecting for Engineer, Reviewer and Writer until you add it again. You can’t undo this.",
    );
    expect(deleteImpact([GITHUB], [])).toBe(
      "github uses it. github stops connecting until you add it again. You can’t undo this.",
    );
    expect(deleteImpact([GITHUB, JIRA], ["Engineer"])).toBe(
      "github and jira use it. They stop connecting for Engineer until you add it again. You can’t undo this.",
    );
    expect(deleteImpact([], [])).toBe("No tool uses it. You can’t undo this.");
  });

  it("says who now needs a secret after a delete (SECRET-20)", () => {
    expect(deletedToast("GITHUB_TOKEN", [GITHUB])).toBe(
      "GITHUB_TOKEN deleted. github now needs a secret.",
    );
    expect(deletedToast("GITHUB_TOKEN", [GITHUB, JIRA])).toBe(
      "GITHUB_TOKEN deleted. github and jira now need a secret.",
    );
    expect(deletedToast("SENTRY_TOKEN", [])).toBe("SENTRY_TOKEN deleted.");
  });

  it("confirms a copy with the literal reference (SECRET-15)", () => {
    expect(copiedToast("GITHUB_TOKEN")).toBe("Copied ${GITHUB_TOKEN}.");
  });
});
