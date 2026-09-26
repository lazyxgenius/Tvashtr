/**
 * Copy for the Use in teams tab and its dialogs (DM-92…97): the cards' row lines, the Add step
 * dialog's default question and places, the Give access dialog's rows and the toasts.
 */
import type { useToast } from "../../design-system/components";
import type { AddedStep, DomainAgent, DomainStep, StepPlace } from "../../lib/api/domains";
import { formatUpdated } from "./domainFormat";

/** Put the raw UUID on the clipboard (DM-17, DM-93). */
export function copyDomainId(domainId: string, toast: ReturnType<typeof useToast>): void {
  const failed = () => toast({ message: "Couldn’t copy the domain ID.", tone: "error" });
  if (!navigator.clipboard) {
    failed();
    return;
  }
  navigator.clipboard
    .writeText(domainId)
    .then(() => toast({ message: "Domain ID copied." }))
    .catch(failed);
}

/** The name with its first letter lower-cased unless the first word is an acronym ("Q3 filings",
 *  "API guide") — the same rule as the backend's "Look up <name>" step title. */
export function lowerName(name: string): string {
  const trimmed = name.trim();
  const first = trimmed.split(" ", 1)[0] ?? "";
  const acronym = first.length > 1 && /[A-Z0-9]/.test(first[1] ?? "");
  return acronym ? trimmed : trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** The Add step dialog's question (DM-94). */
export function defaultQuestion(name: string): string {
  return `What do our ${lowerName(name)} say about {idea}?`;
}

export function lastQuestionLine(iso: string | null, now: Date): string {
  return iso ? `Last question asked ${formatUpdated(iso, now)}.` : "No questions yet.";
}

export function stepLine(step: DomainStep): string {
  return `${step.team_name} · ${
    step.pass_to_spec ? "answer passed to the spec" : "answer on the run log only"
  }`;
}

export function agentLine(agent: DomainAgent): string {
  return `${agent.team_name} · ${
    agent.scope === "all" ? "can search all your domains" : "can search this domain"
  }`;
}

/** A Give access row's second line: "<Team> · <model>", or that it has access already. */
export function agentChoiceLine(agent: DomainAgent): string {
  if (agent.scope) return `${agent.team_name} · Can search it already`;
  return agent.model ? `${agent.team_name} · ${agent.model}` : agent.team_name;
}

/** DM-96 / B-16: Desktop plan runs get no MCP tools, so no Domains tools. */
export function subscriptionNote(subscription: string): string {
  const plan =
    subscription === "claude" ? "Claude" : subscription === "grok" ? "Grok" : subscription;
  return `On Tvashtr Desktop with your ${plan} plan it can’t search domains yet.`;
}

export function matchesAgent(agent: DomainAgent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [agent.title, agent.team_name, agent.model ?? ""].some((s) => s.toLowerCase().includes(q));
}

export function placeLabel(place: StepPlace): string {
  return `After ${place.after}`;
}

/** DM-95: "Added after Product manager. Connected to Writer." */
export function addedStepToast(added: AddedStep): string {
  return added.connected_to
    ? `Added after ${added.after.title}. Connected to ${added.connected_to.title}.`
    : `Added after ${added.after.title}.`;
}

export function accessToast(agent: DomainAgent, domainName: string): string {
  return `${agent.title} can now search ${domainName}`;
}
