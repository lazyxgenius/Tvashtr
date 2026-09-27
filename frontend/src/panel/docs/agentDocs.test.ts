import { describe, expect, it } from "vitest";

import type { RunDoc } from "../../lib/api/docs";
import {
  agentDocs,
  docChipsByNode,
  docLabel,
  readBy,
  readersLine,
  specLine,
  versionLine,
  writtenBy,
} from "./agentDocs";

const who = (node_id: string, label: string) => ({ node_id, clone_node_id: `c-${node_id}`, label });
const doc = (over: Partial<RunDoc>): RunDoc => ({
  id: "d",
  name: "spec",
  title: "PRD",
  doc_type: "prd",
  is_shared_spec: false,
  version_count: 2,
  latest_version: {
    version_no: 2,
    created_at: new Date(Date.now() - 36 * 60_000).toISOString(),
    author: null,
    note: null,
  },
  written_by: [],
  read_by: [],
  ...over,
});
const SPEC = doc({
  id: "d-spec",
  is_shared_spec: true,
  written_by: [who("n-pm", "Product manager")],
  read_by: [who("n-pm", "Product manager"), who("n-eng", "Engineer"), who("n-rev", "Reviewer")],
});
const NOTES = doc({
  id: "d-notes",
  name: "build-notes",
  doc_type: "build-notes",
  written_by: [who("n-eng", "Engineer")],
  read_by: [who("n-rev", "Reviewer")],
});

describe("agentDocs (PANEL-76..80)", () => {
  it("splits the run's documents into the spec, what the agent wrote and what it read", () => {
    const rev = agentDocs([NOTES, SPEC], "n-rev", {
      writesTo: "",
      readsFrom: ["build-notes", "qa"],
    });
    expect(rev.shared?.id).toBe("d-spec");
    expect(rev.writes).toEqual([]);
    expect(rev.reads.map((d) => d.id)).toEqual(["d-spec", "d-notes"]);
    expect(rev.missingReads).toEqual(["qa"]);
    const eng = agentDocs([NOTES, SPEC], "n-eng", { writesTo: "build-notes", readsFrom: [] });
    expect(eng.writes.map((d) => d.id)).toEqual(["d-notes"]);
    expect(eng.missingWrite).toBeNull();
    expect(
      agentDocs([SPEC], "n-eng", { writesTo: "build-notes", readsFrom: [] }).missingWrite,
    ).toBe("build-notes");
  });

  it("writes the card lines", () => {
    expect(specLine(SPEC)).toBe("PRD · written by Product manager");
    expect(versionLine(NOTES)).toBe("v2 · 36m ago");
    expect(versionLine(SPEC, 3)).toBe("v2 · 36m ago · read by all 3 agents");
    expect(versionLine(SPEC, 4)).toBe("v2 · 36m ago · read by 3 agents");
    expect(writtenBy(NOTES)).toBe("Written by Engineer");
    expect(readBy(NOTES)).toBe("Read by Reviewer");
  });
});

describe("the Documents drawer and the canvas chips", () => {
  it("labels the spec, lists readers who don't write it", () => {
    expect([docLabel(SPEC), docLabel(NOTES)]).toEqual(["Shared spec", "build-notes"]);
    expect(readersLine(NOTES)).toBe("v2 · 36m ago · read by Reviewer");
    expect(readersLine(doc({ read_by: [] }))).toBe("v2 · 36m ago");
  });

  it("puts each written document on its writers' cards, by authored or clone id", () => {
    const unwritten = doc({ id: "d-x", latest_version: null, written_by: [who("n-rev", "R")] });
    const team = docChipsByNode([SPEC, NOTES, unwritten], false);
    expect([...team.entries()].map(([k, v]) => [k, v.map((d) => d.id)])).toEqual([
      ["n-pm", ["d-spec"]],
      ["n-eng", ["d-notes"]],
    ]);
    expect([...docChipsByNode([SPEC], true).keys()]).toEqual(["c-n-pm"]);
  });
});
