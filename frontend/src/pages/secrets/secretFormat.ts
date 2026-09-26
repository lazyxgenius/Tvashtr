/**
 * Toolkit › Secrets copy and rules: the `${NAME}` name rule and its suggestion (the same as the
 * server's `check_secret_name` / `suggest_secret_name`), the Updated cell ("Just now" / "Sep 20"),
 * tool-name lists, the banner sentence, the table order and the toasts after a save.
 */
import type { MissingSecret, SecretItem, SecretRef, SecretsList } from "../../lib/api/tools";

/** SECRET-10: capital letters, numbers and _, not starting with a number; at most 128. */
export const SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const MAX_NAME = 128;
const EXAMPLE = "GITHUB_TOKEN";

/** The input upper-cased with each run of other characters turned into `_` ("notion-token" →
 *  NOTION_TOKEN), or the example name when that still isn't valid. */
export function suggestSecretName(raw: string): string {
  let out = "";
  for (const ch of raw.trim().toUpperCase()) {
    if (/[A-Z0-9_]/.test(ch)) out += ch;
    else if (!out.endsWith("_")) out += "_";
  }
  const suggestion = out.replace(/^_+|_+$/g, "").slice(0, MAX_NAME);
  return SECRET_NAME_RE.test(suggestion) ? suggestion : EXAMPLE;
}

/** The Name field's format error, or null when the name follows the rule. */
export function secretNameError(name: string): string | null {
  if (SECRET_NAME_RE.test(name) && name.length <= MAX_NAME) return null;
  return `Use capital letters, numbers and _, like ${suggestSecretName(name)}.`;
}

/** `${NAME}` — how a tool refers to the secret. */
export const refOf = (name: string) => "${" + name + "}";

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** SECRET-6: "Just now" under a minute, else a short date ("Sep 20"; with the year when older). */
export function formatUpdated(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  if (now - t < 60_000) return "Just now";
  const d = new Date(t);
  return d.getFullYear() === new Date(now).getFullYear()
    ? SHORT_DATE.format(d)
    : LONG_DATE.format(d);
}

/** "linear", "linear and jira", "linear, jira and notion". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The Used by cell of a stored row (SECRET-6). */
export function usedByText(tools: SecretRef[]): string {
  return tools.length > 0 ? tools.map((t) => t.name).join(", ") : "Not used by any tool";
}

/** SECRET-3: the rest of the banner after the bold name. */
export function missingSentence(m: MissingSecret): string {
  const names = m.used_by_tools.map((t) => t.name);
  if (names.length === 0) return " has no value.";
  if (names.length === 1)
    return ` is used by ${names[0]} but has no value. ${names[0]} won’t connect until you add it.`;
  return ` is used by ${joinNames(names)} but has no value. They won’t connect until you add it.`;
}

export type SecretRow =
  | { kind: "missing"; name: string; missing: MissingSecret }
  | { kind: "stored"; name: string; secret: SecretItem };

/**
 * Table order: rows added during this visit (newest first), then missing rows, then A→Z. Rows
 * already on screen (`previous`, the last order shown) keep their places — a row that flips between
 * stored and No value (a delete, spec Q2) changes in place rather than jumping.
 */
export function orderSecretRows(
  list: SecretsList,
  fresh: string[],
  previous: string[] = [],
): SecretRow[] {
  const stored = new Map(list.secrets.map((s) => [s.name, s]));
  const pinned: SecretRow[] = [];
  for (const name of fresh) {
    const secret = stored.get(name);
    if (secret) pinned.push({ kind: "stored", name, secret });
  }
  const pinnedNames = new Set(pinned.map((r) => r.name));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const missing: SecretRow[] = [...list.missing]
    .filter((m) => !stored.has(m.name))
    .sort(byName)
    .map((m) => ({ kind: "missing", name: m.name, missing: m }));
  const rest: SecretRow[] = list.secrets
    .filter((s) => !pinnedNames.has(s.name))
    .sort(byName)
    .map((s) => ({ kind: "stored", name: s.name, secret: s }));
  const rank = new Map(previous.map((name, i) => [name, i]));
  const shown = [...missing, ...rest]
    .filter((r) => rank.has(r.name))
    .sort((a, b) => (rank.get(a.name) ?? 0) - (rank.get(b.name) ?? 0));
  const isNew = (r: SecretRow) => !rank.has(r.name);
  return [...pinned, ...missing.filter(isNew), ...shown, ...rest.filter(isNew)];
}

/** The banners' order: the server's (A→Z), except that banners already shown stay on top. */
export function orderMissing(missing: MissingSecret[], previous: string[] = []): MissingSecret[] {
  const rank = new Map(previous.map((name, i) => [name, i]));
  return missing
    .map((m, i) => ({ m, at: rank.get(m.name) ?? previous.length + i }))
    .sort((a, b) => a.at - b.at)
    .map(({ m }) => m);
}

/**
 * The toast after a value is saved (SECRET-12 / SECRET-19). When the name was missing, say which
 * tools it unblocked — a tool still waiting on another secret isn't "ready". `after` is the
 * refreshed list (null when it couldn't be loaded, so readiness is unknown).
 */
export function savedToast(
  name: string,
  wasMissing: MissingSecret | undefined,
  after: SecretsList | null,
): string {
  const users = wasMissing?.used_by_tools ?? [];
  if (users.length === 0) return `${name} saved. Use it in a tool as ${refOf(name)}.`;
  if (!after) return `${name} saved.`;
  const blocked = new Set(after.missing.flatMap((m) => m.used_by_tools.map((t) => t.id)));
  const ready = users.filter((t) => !blocked.has(t.id)).map((t) => t.name);
  const waiting = users.filter((t) => blocked.has(t.id)).map((t) => t.name);
  const parts: string[] = [];
  if (ready.length) parts.push(`${joinNames(ready)} ${ready.length > 1 ? "are" : "is"} ready`);
  if (waiting.length)
    parts.push(
      `${joinNames(waiting)} still ${waiting.length > 1 ? "need" : "needs"} another secret`,
    );
  return `${name} saved. ${parts.join("; ")}.`;
}

/** SECRET-17: the toast after a value is replaced. */
export function replacedToast(name: string, users: SecretRef[]): string {
  if (users.length === 0) return `${name} replaced.`;
  const names = users.map((t) => t.name);
  return `${name} replaced. ${joinNames(names)} ${names.length > 1 ? "use" : "uses"} the new value on ${names.length > 1 ? "their" : "its"} next run.`;
}

/** SECRET-14: the heading of "See tools that use it" ("Used by 1 tool" / "Not used by any tool"). */
export function toolsUsingHeading(count: number): string {
  if (count === 0) return "Not used by any tool";
  return `Used by ${count} ${count === 1 ? "tool" : "tools"}`;
}

/**
 * SECRET-18: the delete confirmation's impact sentence — who uses the secret and which agents lose
 * the tool ("github uses it. github stops connecting for Engineer, Reviewer and Writer until you
 * add it again. You can’t undo this."). `agents` are the using tools' agent names (may be empty).
 */
export function deleteImpact(users: SecretRef[], agents: string[]): string {
  const undo = "You can’t undo this.";
  if (users.length === 0) return `No tool uses it. ${undo}`;
  const names = users.map((t) => t.name);
  const who = joinNames(names);
  const forWhom = agents.length > 0 ? ` for ${joinNames(agents)}` : "";
  return names.length === 1
    ? `${who} uses it. ${who} stops connecting${forWhom} until you add it again. ${undo}`
    : `${who} use it. They stop connecting${forWhom} until you add it again. ${undo}`;
}

/** SECRET-20: the toast after a delete. */
export function deletedToast(name: string, users: SecretRef[]): string {
  if (users.length === 0) return `${name} deleted.`;
  const names = users.map((t) => t.name);
  return `${name} deleted. ${joinNames(names)} now ${names.length > 1 ? "need" : "needs"} a secret.`;
}

/** SECRET-15: the toast after "Copy ${NAME}". */
export const copiedToast = (name: string) => `Copied ${refOf(name)}.`;
