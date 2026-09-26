/**
 * What the skill editor hands the Skills list after a save (TkF-NewSkill-5): the row to tint, and
 * — from the toast's "Choose agents", which can fire after the page has changed — the skill whose
 * "Turn on for agents" picker should open. The list takes each request once, whether it is already
 * mounted (it subscribes) or mounts next (it takes what is waiting).
 */
export interface SkillsHandoff {
  highlight?: string;
  openAgentsFor?: { id: string; name: string };
}

let pending: SkillsHandoff = {};
const listeners = new Set<() => void>();

export function handOffToSkills(request: SkillsHandoff): void {
  pending = { ...pending, ...request };
  listeners.forEach((l) => l());
}

/** The waiting request (empty if none); it is cleared. */
export function takeSkillsHandoff(): SkillsHandoff {
  const out = pending;
  pending = {};
  return out;
}

export function subscribeSkillsHandoff(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function __resetSkillsHandoffForTests(): void {
  pending = {};
  listeners.clear();
}
