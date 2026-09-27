/**
 * Focus-Skills' detail pane (FOCUS-52): what the selected skill loads, how big it is, which of the
 * team's agents carry it, its SKILL.md and one line on how this agent receives it. Pure.
 */
import type { SkillLibraryItem, TeamGraphNode } from "../../lib/api";
import { nodeTitle } from "../../lib/nodeNames";
import { MODE_LABELS, type SkillRef, type SkillRowData, repoName } from "../skills/nodeSkills";

export interface SkillFacts {
  loads: string;
  /** "412 characters", or how a repo skill gets its size. */
  size: string;
  /** This agent first, then the team's other agents that carry the same skill. */
  usedBy: string;
  /** The SKILL.md text; null when it is fetched from a repo when the team runs. */
  content: string | null;
  explanation: string;
}

/** The same skill on two agents: an inline skill by name, a repo by URL + ref + filter, a library item by id. */
function identity(raw: unknown): string | null {
  const s = raw as SkillRef | null;
  if (!s || typeof s !== "object") return null;
  if (s.type === "inline") return `inline:${s.name}`;
  if (s.type === "repo") return `repo:${repoName(s.url)}@${s.ref}:${s.filter ?? ""}`;
  if (s.type === "library") return `library:${s.id}`;
  return null;
}

const MODE_LINE: Record<SkillRowData["mode"], string> = {
  always: "Always-on skills go into every prompt in full.",
  trigger: "Triggered skills load in full when the conversation mentions a trigger word.",
  agent: "Agent-decides skills are listed by name; the agent opens one when it needs it.",
};

export function skillFacts({
  row,
  skills,
  library,
  node,
  name,
  nodes,
  subscription,
}: {
  row: SkillRowData;
  /** This agent's draft skills (the row's index points into it). */
  skills: readonly unknown[];
  library: readonly SkillLibraryItem[] | null;
  node: TeamGraphNode;
  /** This agent's name as the header shows it. */
  name: string;
  nodes: readonly TeamGraphNode[];
  /** "Grok" when this agent runs on a Desktop subscription (its skills join its instructions). */
  subscription: string | null;
}): SkillFacts {
  const raw = skills[row.index] as SkillRef;
  let content: string | null = null;
  if (raw.type === "inline") content = raw.content;
  else if (raw.type === "library") {
    const source = library?.find((item) => item.id === raw.id)?.source;
    if (source?.type === "inline") content = source.content;
  }
  const id = identity(raw);
  const others = nodes
    .filter((n) => n.id !== node.id && (n.skills ?? []).some((s) => identity(s) === id))
    .map((n) => nodeTitle(n));
  const delivery = subscription
    ? `${name} runs on your ${subscription} subscription on this computer, so the skill is added to its instructions.`
    : `${name} is a ${node.kind === "agent" ? "worker" : "thinker"} agent, so it also gets this skill as context.`;
  return {
    loads: MODE_LABELS[row.mode],
    size:
      content === null
        ? "Fetched when the team runs"
        : `${content.length.toLocaleString("en-US")} characters`,
    usedBy: [name, ...others].join(", "),
    content,
    explanation: `${MODE_LINE[row.mode]} ${delivery}`,
  };
}
