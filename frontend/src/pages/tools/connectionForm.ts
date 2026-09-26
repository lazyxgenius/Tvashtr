/**
 * The Connection form the Add tool wizard (and later the tool page) edits: where it runs, the URL
 * or command and arguments, the header / environment rows, and any raw-JSON keys the form has no
 * field for (kept as they are). Pure helpers: form ⇄ `server_config`, the step's validation, the
 * raw JSON text, and the `${` secret picker's options.
 */
import type { SecretsList, ServerConfig } from "../../lib/api/tools";
import { suggestSecretName } from "../secrets/secretFormat";
import {
  type KeyValueRow,
  SECRET_REF,
  type Transport,
  buildServerConfig,
  rowsOfBlock,
  transportOf,
} from "./toolConfig";

/** The kept tool-name rule (backend `TOOL_NAME_RE`): agents see it as the MCP server key. */
export const TOOL_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const TOOL_NAME_RULE = "Use lowercase letters, numbers, - and _, like my-server.";

export interface ConnectionForm {
  transport: Transport;
  url: string;
  command: string;
  /** Space-separated. */
  args: string;
  headers: KeyValueRow[];
  env: KeyValueRow[];
  /** Raw-JSON keys the form doesn't edit (e.g. `type`, `timeout`), sent as they are. */
  extras: Record<string, unknown>;
}

export const EMPTY_CONNECTION: ConnectionForm = {
  transport: "remote",
  url: "",
  command: "",
  args: "",
  headers: [],
  env: [],
  extras: {},
};

const FORM_KEYS = new Set(["url", "headers", "command", "args", "env"]);

/** The form → the INNER `server_config` (only the chosen transport's fields). */
export function formToConfig(form: ConnectionForm): ServerConfig {
  const remote = form.transport === "remote";
  return {
    ...form.extras,
    ...buildServerConfig(
      form.transport,
      remote ? form.url : form.command,
      remote ? "" : form.args,
      remote ? form.headers : form.env,
    ),
  };
}

/** A parsed config → the form. The other transport's fields keep what `prev` had. */
export function configToForm(config: ServerConfig, prev: ConnectionForm): ConnectionForm {
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) if (!FORM_KEYS.has(k)) extras[k] = v;
  const transport = transportOf(config) ?? prev.transport;
  if (transport === "remote") {
    return {
      ...prev,
      transport,
      url: typeof config.url === "string" ? config.url : "",
      headers: rowsOfBlock(config.headers),
      extras,
    };
  }
  const args = Array.isArray(config.args)
    ? config.args.filter((a): a is string => typeof a === "string").join(" ")
    : "";
  return {
    ...prev,
    transport,
    command: typeof config.command === "string" ? config.command : "",
    args,
    env: rowsOfBlock(config.env),
    extras,
  };
}

/** The raw JSON the Advanced disclosure shows for the form. */
export function configText(form: ConnectionForm): string {
  return JSON.stringify(formToConfig(form), null, 2);
}

export const RAW_JSON_INVALID = "This isn’t valid JSON yet. The form keeps its last valid version.";
export const RAW_JSON_NOT_OBJECT = "Use one server’s settings: an object with a url or a command.";

/** Typed raw JSON → the parsed config, or the inline error (the form is left alone). */
export function parseConfigText(text: string): { config: ServerConfig } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: RAW_JSON_INVALID };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: RAW_JSON_NOT_OBJECT };
  }
  return { config: parsed as ServerConfig };
}

/** Step 2's "Next: Secrets" check (the backend's rule), or null when it can connect. */
export function connectionError(form: ConnectionForm): string | null {
  if (form.transport === "remote") {
    const url = form.url.trim();
    if (!url) return "Add the server’s URL.";
    if (!/^https?:\/\//i.test(url)) return "Use an http:// or https:// URL.";
    return null;
  }
  return form.command.trim() ? null : "Add the command that starts the server.";
}

/** Step 1's "Next: Connection" check, or null. */
export function toolNameError(name: string, taken: string[]): string | null {
  const n = name.trim();
  if (!n) return "Give the tool a name.";
  if (!TOOL_NAME_RE.test(n)) return TOOL_NAME_RULE;
  if (taken.includes(n)) return `You already have a tool named ${n}.`;
  return null;
}

/** The secret a new tool most likely needs: `linear` → `LINEAR_TOKEN`. */
export function suggestedSecret(toolName: string): string {
  return suggestSecretName(`${toolName}_token`);
}

// ---- A header / env value as literal text and `${NAME}` chips ----

export type ValueSegment = { kind: "text"; text: string } | { kind: "ref"; name: string };

/** "Bearer ${LINEAR_TOKEN}" → text "Bearer ", ref LINEAR_TOKEN. */
export function valueSegments(value: string): ValueSegment[] {
  const out: ValueSegment[] = [];
  let at = 0;
  for (const m of value.matchAll(new RegExp(SECRET_REF.source, "g"))) {
    const start = m.index ?? 0;
    if (start > at) out.push({ kind: "text", text: value.slice(at, start) });
    out.push({ kind: "ref", name: m[1] });
    at = start + m[0].length;
  }
  if (at < value.length) out.push({ kind: "text", text: value.slice(at) });
  return out;
}

export const hasSecretRef = (value: string) => valueSegments(value).some((s) => s.kind === "ref");

/** The `${partial` being typed just before the caret, or null. */
export function openRefAt(value: string, caret: number): { start: number; typed: string } | null {
  const m = /\$\{([A-Za-z0-9_]*)$/.exec(value.slice(0, caret));
  return m ? { start: caret - m[0].length, typed: m[1] } : null;
}

// ---- The `${` picker ----

export interface SecretOption {
  name: string;
  /** "used by github", "not used". */
  usage: string;
}

/** The stored secrets the picker offers (a missing name has no value to pick). */
export function secretOptions(list: SecretsList): SecretOption[] {
  return list.secrets
    .map((s) => ({
      name: s.name,
      usage:
        s.used_by_tools.length > 0
          ? `used by ${s.used_by_tools.map((t) => t.name).join(", ")}`
          : "not used",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type PickerOption =
  | { kind: "secret"; name: string; usage: string }
  | { kind: "create"; name: string };

/**
 * What the picker lists for the text typed after `${`: the stored secrets whose name contains it,
 * then "Create <NAME>" — the tool's suggested name, or what you typed when it isn't a start of that
 * — unless that name already exists.
 */
export function pickerOptions(
  options: SecretOption[],
  typed: string,
  suggestion: string,
): PickerOption[] {
  const q = typed.toUpperCase();
  const matches: PickerOption[] = options
    .filter((o) => o.name.includes(q))
    .map((o) => ({ kind: "secret", name: o.name, usage: o.usage }));
  const create = q === "" || suggestion.startsWith(q) ? suggestion : suggestSecretName(q);
  if (options.some((o) => o.name === create)) return matches;
  return [...matches, { kind: "create", name: create }];
}

/** The option the picker highlights first: the tool's suggested secret when it's listed. */
export function defaultPick(options: PickerOption[], suggestion: string): number {
  const i = options.findIndex((o) => o.name === suggestion);
  return i === -1 ? 0 : i;
}
