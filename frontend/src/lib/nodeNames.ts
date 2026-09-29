/**
 * The name and one-line description a team node shows on the canvas card, the drawer header and the
 * routing line. An agent's name and tagline live in `config.title` / `config.description` (spec
 * §4.7: settable on every node kind; `role_name` stays stable because memory and trajectories key
 * on it); nodes created before that fall back to the role's built-in title and blurb.
 */
import type { GateConfig, NodeConfig, TerminalConfig } from "./api";

export const ROLE_TITLE: Record<string, string> = {
  pm: "Product manager",
  architect: "Architect",
  engineer: "Engineer",
  reviewer: "Reviewer",
};

export const ROLE_BLURB: Record<string, string> = {
  pm: "Drafts the spec",
  architect: "Adds the technical design",
  engineer: "Writes & ships it",
  reviewer: "Checks against the spec",
};

/** The roles a blank agent gets (the palette's Thinker / Worker, a blank team's first agent): until
 *  it's named it reads "New agent" (PANEL-61). */
const BLANK_ROLES = new Set(["thinker", "worker"]);

export const NEW_AGENT_TITLE = "New agent";

/** A short, canvas-legible gate label from its `gate_kind` (a gate's `config.title` is a sentence). */
export function gateLabel(gateKind: string): string {
  if (gateKind === "prd_approval") return "PRD approval";
  if (gateKind === "review_escalation") return "Escalation";
  return gateKind;
}

interface NamedNode {
  kind: string;
  role_name: string;
  config: NodeConfig | null;
}

function configText(config: NodeConfig | null, key: "title" | "description"): string {
  const raw = (config as Record<string, unknown> | null)?.[key];
  return typeof raw === "string" ? raw.trim() : "";
}

/** The node's display name: `config.title`, else the built-in name for its kind and role. */
export function nodeTitle(node: NamedNode): string {
  if (node.kind === "gate") {
    const cfg = (node.config ?? {}) as GateConfig;
    return gateLabel(cfg.gate_kind ?? node.role_name);
  }
  const title = configText(node.config, "title");
  if (title) return title;
  if (node.kind === "terminal") {
    return (node.config as TerminalConfig | null)?.terminal_kind === "ship" ? "Ship" : "Stop";
  }
  if (node.kind === "domain_query") return "Domain ask";
  if (BLANK_ROLES.has(node.role_name)) return NEW_AGENT_TITLE;
  return ROLE_TITLE[node.role_name] ?? node.role_name;
}

/** The node's one-line description: `config.description`, else its role's built-in blurb. */
export function nodeDescription(node: NamedNode): string {
  if (node.kind === "gate") return "Gate";
  const description = configText(node.config, "description");
  if (description) return description;
  return ROLE_BLURB[node.role_name] ?? "";
}
