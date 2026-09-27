import { afterEach, describe, expect, it, vi } from "vitest";

import type { GraphEdge } from "../../lib/api";
import type { NodeTemplate } from "../../lib/api/nodes";
import { isGettingReady, isReadyHidden, readyItems, rememberReadyHidden } from "./getReady";
import { contractInSync, contractUpdate } from "./routing";
import {
  replaceConfirmText,
  templateApplication,
  templateAppliedText,
  templateNeedsConfirm,
} from "./templates";

const tpl = (key: string, edits_allowed: boolean): NodeTemplate => ({
  key,
  title: key,
  description: "",
  role_name: key,
  node_kind: "worker",
  edits_allowed,
  writes_to: null,
  verdict_labels: [],
  prompt: `You are the ${key}.`,
});

describe("templates (PANEL-31/32, Q7)", () => {
  it("set the instructions and, on a sandboxed agent, their default File access", () => {
    const draft = { prompt: "old", editsAllowed: false };
    expect(templateApplication(tpl("engineer", true), draft, true)).toEqual({
      patch: { prompt: "You are the engineer.", editsAllowed: true },
      fileAccess: "edits",
    });
    expect(templateApplication(tpl("reviewer", false), draft, true)).toEqual({
      patch: { prompt: "You are the reviewer." },
      fileAccess: null,
    });
    expect(
      templateApplication(tpl("reviewer", false), { ...draft, editsAllowed: true }, true),
    ).toEqual({
      patch: { prompt: "You are the reviewer.", editsAllowed: false },
      fileAccess: "readOnly",
    });
    // The entry agent (or a thinker) keeps its File access.
    expect(templateApplication(tpl("engineer", true), draft, false).patch).toEqual({
      prompt: "You are the engineer.",
    });
  });

  it("ask first only over non-empty text, naming a File access change", () => {
    expect(templateNeedsConfirm("  \n")).toBe(false);
    expect(templateNeedsConfirm("x")).toBe(true);
    expect(replaceConfirmText("Reviewer", null)).toBe(
      "The Reviewer template replaces what’s in the editor now. Nothing is saved until you press Save, so Discard brings your text back.",
    );
    expect(replaceConfirmText("Engineer", "edits")).toContain(
      "replaces what’s in the editor now and lets this agent edit files.",
    );
    expect(replaceConfirmText("Reviewer", "readOnly")).toContain("and makes this agent read-only.");
    expect(templateAppliedText("Reviewer")).toBe("Reviewer template applied");
  });
});

describe("contractUpdate (PANEL-36)", () => {
  const edges: GraphEdge[] = [
    {
      id: "e1",
      source_node_id: "rev",
      target_node_id: "ship",
      edge_type: "default",
      conditions: { when: "approved" },
    },
    {
      id: "e2",
      source_node_id: "rev",
      target_node_id: "eng",
      edge_type: "default",
      conditions: { loop_limit: 3 },
    },
  ];

  it("previews exactly the non-blank lines Add lines writes, and the result is in sync", () => {
    const update = contractUpdate("rev", "Review it.", edges);
    expect(update).not.toBeNull();
    const { next, added, removed } = update!;
    expect(removed).toEqual([]);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((line) => line.trim() !== "" && next.includes(line))).toBe(true);
    expect(next.startsWith("Review it.\n")).toBe(true);
    expect(contractInSync(next, ["approved"])).toBe(true);
    // Applying it again changes nothing.
    const again = contractUpdate("rev", next, edges)!;
    expect(again.next).toBe(next);
    expect(again.added).toEqual([]);
  });

  it("shows the lines a refresh takes out of an older verdict block", () => {
    const first = contractUpdate("rev", "Review it.", edges)!.next;
    const relabelled = edges.map((e) =>
      e.id === "e1" ? { ...e, conditions: { when: "ship_it" } } : e,
    );
    const update = contractUpdate("rev", `${first}Then stop.`, relabelled)!;
    expect(update.removed).toContain("Then stop.");
    expect(update.added.join("\n")).toContain('"ship_it"');
  });

  it("is null for an agent with no verdict arrow", () => {
    expect(contractUpdate("eng", "Build it.", edges)).toBeNull();
  });
});

describe("Get this agent ready (PANEL-62)", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  const draft = { prompt: "", readsFrom: [], readsDefault: true, writesTo: "" };

  it("shows while a never-run agent's saved instructions or model are missing", () => {
    const base = { hasRun: false, savedPrompt: "Do it.", savedModel: "xai/grok-4.7" };
    expect(isGettingReady(base)).toBe(false);
    expect(isGettingReady({ ...base, savedPrompt: " " })).toBe(true);
    expect(isGettingReady({ ...base, savedModel: "" })).toBe(true);
    expect(isGettingReady({ ...base, hasRun: true, savedPrompt: "" })).toBe(false);
  });

  it("ticks what the draft has: instructions, a model, documents (the spec by default)", () => {
    const items = readyItems(draft, { modelNeeded: true, isEntry: false });
    expect(items.map((i) => [i.label, i.done, i.note])).toEqual([
      ["Write instructions", false, undefined],
      ["Pick a model", false, undefined],
      ["Choose documents", true, "· reads the spec by default"],
    ]);
    const none = readyItems(
      { ...draft, prompt: "x", readsDefault: false },
      { modelNeeded: false, isEntry: false },
    );
    expect(none.map((i) => i.done)).toEqual([true, true, false]);
    expect(
      readyItems({ ...draft, writesTo: "notes" }, { modelNeeded: false, isEntry: false })[2],
    ).toMatchObject({ done: true, note: undefined });
  });

  it("remembers Hide this per agent, and survives storage that throws", () => {
    expect(isReadyHidden("n1")).toBe(false);
    rememberReadyHidden("n1");
    expect(isReadyHidden("n1")).toBe(true);
    expect(isReadyHidden("n2")).toBe(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isReadyHidden("n1")).toBe(false);
    expect(() => rememberReadyHidden("n3")).not.toThrow();
  });
});
