/**
 * "Get this agent ready  n of 3" (PANEL-62, Web-NewAgent): the checklist a new agent shows until its
 * saved instructions and model are in place (or it has run, or the user hid it). The ticks follow
 * the draft, so they move as the user works; "Hide this" is remembered per agent in this browser.
 */
import type { AgentDraft } from "../agentDraft";

export interface ReadyItem {
  key: "instructions" | "model" | "documents";
  label: string;
  /** A small note after the label ("· reads the spec by default"). */
  note?: string;
  done: boolean;
}

/**
 * The agent is still being set up: never run, and its SAVED instructions or model are blank. A chosen
 * model with no key isn't "new" — its "Needs a model" badge says so.
 */
export function isGettingReady(opts: {
  hasRun: boolean;
  savedPrompt: string;
  savedModel: string;
}): boolean {
  return !opts.hasRun && (opts.savedPrompt.trim() === "" || opts.savedModel.trim() === "");
}

export function readyItems(
  draft: Pick<AgentDraft, "prompt" | "readsFrom" | "readsDefault" | "writesTo">,
  opts: { modelNeeded: boolean; isEntry: boolean },
): ReadyItem[] {
  const defaultReads =
    !opts.isEntry &&
    draft.readsFrom.length === 0 &&
    draft.readsDefault &&
    draft.writesTo.trim() === "";
  const hasDocuments =
    opts.isEntry ||
    draft.readsFrom.length > 0 ||
    draft.readsDefault ||
    draft.writesTo.trim() !== "";
  return [
    { key: "instructions", label: "Write instructions", done: draft.prompt.trim() !== "" },
    { key: "model", label: "Pick a model", done: !opts.modelNeeded },
    {
      key: "documents",
      label: "Choose documents",
      note: defaultReads ? "· reads the spec by default" : undefined,
      done: hasDocuments,
    },
  ];
}

const hiddenKey = (nodeId: string) => `tvashtr.panel.getReadyHidden.${nodeId}`;

/** Browser storage can be missing or throw (a private window, blocked site data). */
export function isReadyHidden(nodeId: string): boolean {
  try {
    return window.localStorage.getItem(hiddenKey(nodeId)) === "1";
  } catch {
    return false;
  }
}

export function rememberReadyHidden(nodeId: string): void {
  try {
    window.localStorage.setItem(hiddenKey(nodeId), "1");
  } catch {
    // Not remembered: it hides for now and comes back next time.
  }
}
