import { describe, expect, it } from "vitest";

import type { TeamSummary } from "../../lib/api";
import { plan } from "./desktopTestUtils";
import { engineChip, newestTeam, targetChip } from "./readyCard";

describe("ready card chips (DT-39, OQ-24)", () => {
  it("plans in use first: both, one, or the saved keys; none when nothing can run", () => {
    const both = [plan("claude", "connected"), plan("grok", "connected")];
    expect(engineChip(both, ["Anthropic"])).toBe("Claude and Grok plans connected");
    // Launch-2: Grok still needs sign-in, so the chip doesn't claim it.
    expect(engineChip([plan("claude", "connected"), plan("grok", "needs_login")], [])).toBe(
      "Claude plan connected",
    );
    expect(engineChip([plan("grok", "connected"), plan("codex", "connected")], [])).toBe(
      "Grok plan connected",
    );
    expect(engineChip([plan("claude", "disconnected")], ["Anthropic"])).toBe("Anthropic key saved");
    expect(engineChip(null, ["Anthropic", "OpenAI"])).toBe("Anthropic, OpenAI keys saved");
    expect(engineChip([plan("claude", "needs_install")], [])).toBeNull();
  });

  it("the project: folder, repo, or hidden for Decide at launch", () => {
    expect(targetChip({ kind: "folder", path: "/Users/l/code/x", displayPath: "~/code/x" })).toBe(
      "~/code/x",
    );
    expect(targetChip({ kind: "github", repo: "lazyxgenius/trade_mcp" })).toBe(
      "lazyxgenius/trade_mcp",
    );
    expect(targetChip({ kind: "ask" })).toBeNull();
    expect(targetChip(null)).toBeNull();
  });

  it("the team is the newest library team", () => {
    const t = (name: string, created_at: string) => ({ name, created_at }) as TeamSummary;
    expect(
      newestTeam([t("Old", "2026-09-01T00:00:00Z"), t("New", "2026-09-26T00:00:00Z")])?.name,
    ).toBe("New");
    expect(newestTeam([])).toBeNull();
  });
});
