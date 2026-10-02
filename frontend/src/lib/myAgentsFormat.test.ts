import { afterEach, describe, expect, it } from "vitest";

import { setProviderCatalogue } from "./api";
import type { SavedAgent } from "./api/myAgents";
import {
  agentMenuMeta,
  behindPill,
  libraryMeta,
  nextVersionFor,
  providerName,
  usedInLine,
} from "./myAgentsFormat";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const agent = (over: Partial<SavedAgent> = {}): SavedAgent => ({
  id: "a1",
  name: "Strict reviewer",
  purpose: "Reviews.",
  latest: 2,
  updated_at: "2026-10-01T10:00:00Z",
  built_on: "Reviewer",
  model: "xai/grok-4.7",
  skills: 2,
  tools: 1,
  file_access: "read-only",
  versions: [],
  used_in: [
    { team_id: "t1", team_name: "Indicator sprint team", version: 2 },
    { team_id: "t2", team_name: "Bugfix squad", version: 1 },
  ],
  behind: [{ team_id: "t2", team_name: "Bugfix squad", version: 1 }],
  ...over,
});

afterEach(() => setProviderCatalogue([]));

describe("my agents words (Agents-Menu, Agents-Library, Agents-Save)", () => {
  it("the menu meta: the latest version and how many teams use it", () => {
    expect(agentMenuMeta(agent())).toBe("v2 · 2 teams");
    expect(agentMenuMeta(agent({ latest: 1, used_in: [] }))).toBe("v1");
    expect(
      agentMenuMeta(agent({ used_in: [{ team_id: "t", team_name: "Docs", version: 1 }] })),
    ).toBe("v2 · 1 team");
  });

  it("the card's meta line and its Used in line", () => {
    expect(libraryMeta(agent(), NOW)).toBe(
      "Built on Reviewer · xai/grok-4.7 · 2 skills · read-only · updated yesterday",
    );
    expect(
      libraryMeta(
        agent({
          built_on: "Product manager",
          skills: 1,
          file_access: null,
          updated_at: "2026-09-28T10:00:00Z",
        }),
        NOW,
      ),
    ).toBe("Built on Product manager · xai/grok-4.7 · 1 skill · updated 4 days ago");
    expect(usedInLine(agent())).toBe("Used in Indicator sprint team (v2) and Bugfix squad (v1)");
    expect(usedInLine(agent({ used_in: [] }))).toBeNull();
  });

  it("the behind pill", () => {
    expect(behindPill(agent())).toBe("1 team is on v1");
    expect(
      behindPill(
        agent({
          latest: 3,
          behind: [
            { team_id: "a", team_name: "A", version: 1 },
            { team_id: "b", team_name: "B", version: 1 },
          ],
        }),
      ),
    ).toBe("2 teams are on v1");
    expect(
      behindPill(
        agent({
          latest: 3,
          behind: [
            { team_id: "a", team_name: "A", version: 1 },
            { team_id: "b", team_name: "B", version: 2 },
          ],
        }),
      ),
    ).toBe("2 teams are on older versions");
    expect(behindPill(agent({ behind: [] }))).toBeNull();
  });

  it("the version a save makes: the typed name's next version (case and spaces ignored), else 1", () => {
    const agents = [agent()];
    expect(nextVersionFor("  strict REVIEWER ", agents)).toBe(3);
    expect(nextVersionFor("Spec writer", agents)).toBe(1);
  });

  it("names the provider the way the model picker does (Grok, Claude), else its label", () => {
    setProviderCatalogue([
      {
        provider: "openai",
        thinker_default: "openai/gpt-4o-mini",
        worker_default: "openai/gpt-4o-mini",
        thinker_presets: [],
        worker_presets: [],
        label: "OpenAI",
      },
    ]);
    expect(providerName("xai/grok-4.7")).toBe("Grok");
    expect(providerName("anthropic/claude-sonnet-4")).toBe("Claude");
    expect(providerName("openai/gpt-4o-mini")).toBe("OpenAI");
    expect(providerName("mystery/x")).toBe("mystery");
  });
});
