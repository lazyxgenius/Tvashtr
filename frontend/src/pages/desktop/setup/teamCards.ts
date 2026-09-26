/**
 * Pure pieces of setup's First team step (desktop-app.md DT-33..DT-36): the three cards, the strip
 * chip names and the "where it will run" labels.
 */
import type { DesktopTemplateNode } from "../../../lib/api/desktop";

export interface SetupTeamCard {
  /** The key `POST /api/teams` takes. */
  template: string;
  title: string;
  description: string;
  recommended?: boolean;
  /** Whether the card shows the template's strip (Blank shows none, as designed). */
  strip: boolean;
}

/** DT-34 (OQ-11 for Blank's copy). The first is preselected. */
export const SETUP_TEAM_CARDS: readonly SetupTeamCard[] = [
  {
    template: "review_loop",
    title: "Plan, build, review",
    description:
      "A product manager writes the spec, you approve it, an engineer builds, a reviewer checks.",
    recommended: true,
    strip: true,
  },
  {
    template: "spec_only",
    title: "Spec only",
    description: "Turns an idea into a reviewed spec. No code changes.",
    strip: true,
  },
  {
    template: "blank",
    title: "Blank canvas",
    description: "Start with one agent and add your own.",
    strip: false,
  },
];

/** OQ-13: the prefilled team name. */
export const FIRST_TEAM_NAME = "My first team";

/** DT-36: any failure but a 422 (which shows the server's words under the field). */
export const CREATE_FAILED = "Couldn't create the team — is the backend running? Try again.";

const CHIP_NAMES: Record<string, string> = {
  pm: "Product manager",
  gate: "You approve",
  engineer: "Engineer",
  reviewer: "Reviewer",
  ship: "Ship PR",
};

/** DT-35: a strip chip's display name. */
export function chipName(node: DesktopTemplateNode): string {
  return CHIP_NAMES[node.role] ?? node.label;
}

/** DT-35: where a model node will run; null for gates and terminals (no label). */
export function runsOnLabel(node: DesktopTemplateNode): string | null {
  if (node.kind !== "thinker" && node.kind !== "worker") return null;
  switch (node.runs_on) {
    case "claude":
      return "Claude plan";
    case "grok":
      return "Grok plan";
    case "api_key":
      return "API key";
    default:
      return "Needs setup";
  }
}
