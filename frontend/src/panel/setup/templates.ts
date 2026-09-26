/**
 * Applying one of the built-in agent templates (PANEL-30..33, spec Q7): a template sets the
 * instructions and its default File access (Product manager and Reviewer read-only, Engineer can
 * edit files). File access only moves on a sandboxed agent that isn't the team's entry agent (the
 * entry agent stays read-only; a thinker has no sandbox).
 */
import type { NodeTemplate } from "../../lib/api/nodes";
import type { AgentDraft } from "../agentDraft";

/** The template chooser a new agent shows in place of its empty instructions (Web-NewAgent). */
export const CHOOSER_TEMPLATE_KEYS = ["pm", "engineer", "reviewer"] as const;

/** Before the templates load, the chooser and the menu still name them. */
export const TEMPLATE_TITLES: Record<string, string> = {
  pm: "Product manager",
  architect: "Architect",
  engineer: "Engineer",
  reviewer: "Reviewer",
};

export interface TemplateApplication {
  patch: Partial<AgentDraft>;
  /** How File access moves with it: "edits" turns editing on, "readOnly" turns it off. */
  fileAccess: "edits" | "readOnly" | null;
}

export function templateApplication(
  template: NodeTemplate,
  draft: Pick<AgentDraft, "prompt" | "editsAllowed">,
  canSetFileAccess: boolean,
): TemplateApplication {
  const patch: Partial<AgentDraft> = { prompt: template.prompt };
  if (!canSetFileAccess || template.edits_allowed === draft.editsAllowed) {
    return { patch, fileAccess: null };
  }
  patch.editsAllowed = template.edits_allowed;
  return { patch, fileAccess: template.edits_allowed ? "edits" : "readOnly" };
}

/** Over non-empty text a template asks first (an empty editor takes it at once). */
export function templateNeedsConfirm(prompt: string): boolean {
  return prompt.trim() !== "";
}

/** "The Reviewer template replaces what’s in the editor now. Nothing is saved until…" — naming the
 *  File access change too when the template brings one. */
export function replaceConfirmText(
  title: string,
  fileAccess: TemplateApplication["fileAccess"],
): string {
  const also =
    fileAccess === "edits"
      ? " and lets this agent edit files"
      : fileAccess === "readOnly"
        ? " and makes this agent read-only"
        : "";
  return (
    `The ${title} template replaces what’s in the editor now${also}. ` +
    "Nothing is saved until you press Save, so Discard brings your text back."
  );
}

export function templateAppliedText(title: string): string {
  return `${title} template applied`;
}
