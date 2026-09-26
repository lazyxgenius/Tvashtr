/**
 * Paste mcp.json (TkF-Paste-1..3, TOOL-61..66): a small hand-written JSON scanner that keeps going
 * past mistakes, so the sheet can say what to fix in plain words ("Line 3: add a comma after the
 * linear entry.") and still count the servers; then the servers themselves, from `mcpServers`
 * (Claude, Cursor) or `servers` (VS Code), made ready for Tvashtr:
 * - VS Code's `${input:x}` / `${env:X}` become `${X}`, and `"type": "stdio"` goes;
 * - a name that breaks the tool-name rule is made to fit it ("My Server" → my-server);
 * - the backend's own connection check runs per server, so a row can say why it can't be added;
 * - a name you already have is flagged ("Replaces your <name>", spec Q1);
 * - values that look like secrets are found so they can move to Secrets (spec Q13).
 * Comments and trailing commas (VS Code writes JSONC) are accepted as they are. No dependency:
 * `JSON.parse`'s messages differ per engine and name no entries.
 */
import type { ServerConfig } from "../../lib/api/tools";
import { TOOL_NAME_RE } from "./connectionForm";
import { type Transport, transportOf } from "./toolConfig";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface ScanResult {
  /** What the scanner read, stepping over mistakes (undefined for blank text). */
  value: Json | undefined;
  /** The first mistake in words, e.g. "Line 3: add a comma after the linear entry.", or null. */
  error: string | null;
}

const WORD = /[A-Za-z0-9_$.-]/;
const preview = (s: string) => (s.length > 30 ? `${s.slice(0, 30)}…` : s);

class Scanner {
  i = 0;
  line = 1;
  issue: { line: number; message: string } | null = null;

  constructor(private readonly s: string) {}

  eof(): boolean {
    return this.i >= this.s.length;
  }

  peek(): string {
    return this.s[this.i] ?? "";
  }

  fail(line: number, message: string): void {
    if (!this.issue) this.issue = { line, message };
  }

  /** The last line with anything on it (where "add a } at the end" belongs). */
  lastLine(): number {
    const body = this.s.slice(0, this.s.trimEnd().length);
    return body.split("\n").length;
  }

  /** Whitespace, `//` and block comments. */
  skip(): void {
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === "\n") {
        this.line++;
        this.i++;
      } else if (c === " " || c === "\t" || c === "\r" || c === "﻿") {
        this.i++;
      } else if (c === "/" && s[this.i + 1] === "/") {
        while (this.i < s.length && s[this.i] !== "\n") this.i++;
      } else if (c === "/" && s[this.i + 1] === "*") {
        const start = this.line;
        const end = s.indexOf("*/", this.i + 2);
        const stop = end === -1 ? s.length : end + 2;
        for (let j = this.i; j < stop; j++) if (s[j] === "\n") this.line++;
        if (end === -1) this.fail(start, "close the comment with */.");
        this.i = stop;
      } else {
        return;
      }
    }
  }

  value(owner: string | null): Json | undefined {
    const c = this.peek();
    if (c === "{") return this.object(owner, true);
    if (c === "[") return this.array(owner);
    if (c === '"') return this.string('"');
    if (c === "'") {
      this.fail(this.line, "use double quotes, not single quotes.");
      return this.string("'");
    }
    if (c === "-" || (c >= "0" && c <= "9")) return this.number();
    if (c && WORD.test(c)) return this.word();
    this.fail(
      this.eof() ? this.lastLine() : this.line,
      owner ? `add a value after "${owner}".` : "add a value here.",
    );
    return undefined;
  }

  /** An object's members; `braced` false reads members pasted without the outer { }. */
  object(owner: string | null, braced: boolean): { [key: string]: Json } {
    const out: { [key: string]: Json } = {};
    if (braced) this.i++;
    let last: string | null = null;
    let lastEnd = this.line;
    let afterMember = false;
    for (;;) {
      this.skip();
      if (this.eof()) {
        if (braced) {
          this.fail(
            this.lastLine(),
            owner ? `add a } to close the ${owner} entry.` : "add a } at the end.",
          );
        }
        return out;
      }
      const c = this.peek();
      if (c === "}" && braced) {
        this.i++;
        return out;
      }
      if (c === "]" && braced) {
        this.fail(
          this.line,
          owner ? `use } here to close the ${owner} entry.` : "use } here, not ].",
        );
        this.i++;
        return out;
      }
      if (c === ",") {
        this.i++;
        if (afterMember) afterMember = false;
        else this.fail(this.line, "remove the extra comma.");
        continue;
      }
      const keyLine = this.line;
      let key: string;
      if (c === '"' || c === "'") {
        if (afterMember) this.fail(lastEnd, `add a comma after the ${last} entry.`);
        if (c === "'") this.fail(keyLine, "use double quotes, not single quotes.");
        key = this.string(c);
      } else if (WORD.test(c)) {
        if (afterMember) this.fail(lastEnd, `add a comma after the ${last} entry.`);
        key = this.rawWord();
        this.fail(keyLine, `put ${key} in double quotes.`);
      } else {
        this.fail(this.line, `remove the ${c} here.`);
        this.i++;
        continue;
      }
      this.skip();
      if (this.peek() === ":") this.i++;
      else this.fail(keyLine, `add a colon after "${key}".`);
      this.skip();
      const v = this.value(key);
      if (v !== undefined) out[key] = v;
      last = key;
      lastEnd = this.line;
      afterMember = true;
    }
  }

  array(owner: string | null): Json[] {
    const out: Json[] = [];
    this.i++;
    let lastEnd = this.line;
    let afterItem = false;
    for (;;) {
      this.skip();
      if (this.eof()) {
        this.fail(
          this.lastLine(),
          owner ? `add a ] to close the ${owner} list.` : "add a ] to close the list.",
        );
        return out;
      }
      const c = this.peek();
      if (c === "]") {
        this.i++;
        return out;
      }
      if (c === "}") {
        this.fail(
          this.line,
          owner ? `use ] here to close the ${owner} list.` : "use ] here, not }.",
        );
        this.i++;
        return out;
      }
      if (c === ",") {
        this.i++;
        if (afterItem) afterItem = false;
        else this.fail(this.line, "remove the extra comma.");
        continue;
      }
      if (afterItem) {
        this.fail(
          lastEnd,
          owner ? `add a comma between the ${owner} items.` : "add a comma between the items.",
        );
      }
      const before = this.i;
      const v = this.value(owner);
      if (v === undefined) {
        if (this.i === before) this.i++;
        continue;
      }
      out.push(v);
      lastEnd = this.line;
      afterItem = true;
    }
  }

  /** A quoted string; a line break before the closing quote ends it (and is the mistake). */
  string(q: string): string {
    const s = this.s;
    const start = this.line;
    this.i++;
    let out = "";
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === q) {
        this.i++;
        return out;
      }
      if (c === "\n") break;
      if (c === "\\") {
        const e = s[this.i + 1] ?? "";
        if (e === "u" && /^[0-9a-fA-F]{4}$/.test(s.slice(this.i + 2, this.i + 6))) {
          out += String.fromCharCode(parseInt(s.slice(this.i + 2, this.i + 6), 16));
          this.i += 6;
          continue;
        }
        const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
        out += map[e] ?? e;
        this.i += 2;
        continue;
      }
      out += c;
      this.i++;
    }
    this.fail(start, `close the quote after "${preview(out)}".`);
    return out;
  }

  number(): Json {
    const start = this.i;
    while (this.i < this.s.length && /[-+0-9.eE]/.test(this.s[this.i])) this.i++;
    const text = this.s.slice(start, this.i);
    const n = Number(text);
    if (Number.isFinite(n) && /^-?\d/.test(text)) return n;
    this.fail(this.line, `put ${text} in double quotes.`);
    return text;
  }

  rawWord(): string {
    const start = this.i;
    while (this.i < this.s.length && WORD.test(this.s[this.i])) this.i++;
    return this.s.slice(start, this.i);
  }

  /** A bare word as a value: true / false / null, else a mistake. */
  word(): Json {
    const line = this.line;
    const w = this.rawWord();
    if (w === "true") return true;
    if (w === "false") return false;
    if (w === "null") return null;
    if (w === "True" || w === "False") {
      this.fail(line, `use ${w.toLowerCase()} instead of ${w}.`);
      return w === "True";
    }
    if (w === "None" || w === "undefined") {
      this.fail(line, `use null instead of ${w}.`);
      return null;
    }
    this.fail(line, `put ${w} in double quotes.`);
    return w;
  }
}

/** Read pasted JSON, stepping over mistakes; the first one comes back in words. */
export function scanJson(text: string): ScanResult {
  if (!text.trim()) return { value: undefined, error: null };
  const sc = new Scanner(text);
  sc.skip();
  let value: Json | undefined;
  const c = sc.peek();
  if (c === "{" || c === "[") {
    value = sc.value(null);
  } else if (c === '"' || c === "'") {
    // Only the servers, without the outer { }: read them as that object's members.
    value = sc.object(null, false);
  } else {
    sc.fail(sc.line, "paste the whole file, starting with {.");
  }
  sc.skip();
  if (!sc.eof()) {
    const extra = sc.peek();
    sc.fail(
      sc.line,
      extra === "}" || extra === "]"
        ? `remove the extra ${extra}.`
        : "remove the text after the last }.",
    );
  }
  return {
    value,
    error: sc.issue ? `Line ${sc.issue.line}: ${sc.issue.message}` : null,
  };
}

// ---- The servers ----

/** One pasted server, as the checklist shows it. */
export interface PastedServer {
  /** The name it's added under (the pasted key, made to fit the tool-name rule when needed). */
  name: string;
  /** The key as pasted, when the name had to change; else null. */
  pastedAs: string | null;
  config: ServerConfig;
  transport: Transport | null;
  /** Why it can't be added (the backend's own words), or null. */
  problem: string | null;
  /** You already have a tool with this name: adding it replaces that tool's settings. */
  replaces: boolean;
  /** Values that look like secrets, written into the config as they are. */
  secrets: LiteralSecret[];
}

/** A literal value that looks like a secret, and the secret it would move to. */
export interface LiteralSecret {
  block: "env" | "headers";
  key: string;
  /** The secret's name in Secrets (free among yours and the other moves). */
  name: string;
  value: string;
  /** A header's "Bearer ": only the token moves; the header keeps "Bearer ${NAME}". */
  prefix: string;
}

export interface PasteRead {
  /** The first thing to fix, in words; null once it reads. */
  error: string | null;
  /** The servers found (also while there's an error, so the count holds). */
  servers: PastedServer[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export const NO_SERVERS =
  "Couldn’t find any servers. Paste JSON with “mcpServers” (Claude, Cursor) or “servers” (VS Code).";
export const EMPTY_SERVERS = "There are no servers in it yet.";
export const UNNAMED_SERVER = "Name this server: put it inside “mcpServers”: { “my-server”: … }.";

/** The pasted servers map: `mcpServers`, VS Code's `servers` (or `mcp.servers` in settings.json),
 *  or a bare map of servers. */
function serversMap(root: unknown): Record<string, unknown> | null {
  if (!isObject(root)) return null;
  if (isObject(root.mcpServers)) return root.mcpServers;
  if (isObject(root.servers)) return root.servers;
  if (isObject(root.mcp) && isObject(root.mcp.servers)) return root.mcp.servers;
  const values = Object.values(root);
  if (values.length > 0 && values.every((v) => isObject(v) && ("command" in v || "url" in v))) {
    return root;
  }
  return null;
}

/** A secret name from any id: `github-pat` → GITHUB_PAT. */
export function secretNameOf(id: string): string {
  const n = id
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!n) return "SECRET";
  return /^[0-9]/.test(n) ? `_${n}` : n;
}

/** The tool-name rule's version of a pasted key: "My Server" → my-server ("" when nothing fits). */
export function toolSlug(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
}

function mapStrings(v: unknown, f: (s: string) => string): unknown {
  if (typeof v === "string") return f(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f));
  if (isObject(v)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)]));
  }
  return v;
}

/** VS Code's refs → `${X}`; no `"type": "stdio"` (a command already says so). */
export function normaliseServer(raw: Record<string, unknown>): ServerConfig {
  const out = mapStrings(raw, (s) =>
    s.replace(/\$\{(?:input|env):([^}]*)\}/g, (_m, id: string) => `\${${secretNameOf(id)}}`),
  ) as ServerConfig;
  if (out.type === "stdio") delete out.type;
  return out;
}

/** Why a config can't connect, or null — the backend's rule and words (`server_config_error`). */
export function serverProblem(config: ServerConfig): string | null {
  const { command, url, args } = config;
  const hasCommand = typeof command === "string" && command.trim() !== "";
  const hasUrl = typeof url === "string" && url.trim() !== "";
  if (hasCommand && hasUrl) return "Use a command or a URL, not both.";
  if (!hasCommand && !hasUrl) return "Add a command or a URL.";
  if (hasUrl && !/^https?:\/\//i.test(String(url).trim())) return "Use an http:// or https:// URL.";
  if (args !== undefined && args !== null) {
    if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
      return "Arguments must be a list of strings.";
    }
  }
  if (config.env !== undefined && config.env !== null && !isObject(config.env)) {
    return "Environment must be an object of names and values.";
  }
  if (config.headers !== undefined && config.headers !== null && !isObject(config.headers)) {
    return "Headers must be an object of names and values.";
  }
  return null;
}

const SECRETISH = /TOKEN|KEY|SECRET|PASSWORD/i;

/**
 * Env / header values written out in full that look like secrets (spec Q13): a key with TOKEN,
 * KEY, SECRET or PASSWORD in it, or a `Bearer <token>` header — 8+ characters, no spaces, not
 * already a `${NAME}`. Each gets a secret name no one has yet (`taken` grows).
 */
export function literalSecrets(
  server: string,
  config: ServerConfig,
  taken: Set<string>,
): LiteralSecret[] {
  const out: LiteralSecret[] = [];
  for (const block of ["env", "headers"] as const) {
    const values = config[block];
    if (!isObject(values)) continue;
    for (const [key, raw] of Object.entries(values)) {
      if (typeof raw !== "string" || raw.includes("${")) continue;
      const bearer = /^(Bearer\s+)(\S+)$/i.exec(raw.trim());
      if (!bearer && !SECRETISH.test(key)) continue;
      const value = bearer ? bearer[2] : raw.trim();
      if (value.length < 8 || /\s/.test(value)) continue;
      const base =
        block === "env"
          ? secretNameOf(key)
          : /^authorization$/i.test(key)
            ? secretNameOf(`${server}_token`)
            : secretNameOf(`${server}_${key}`);
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
      taken.add(name);
      out.push({ block, key, name, value, prefix: bearer ? bearer[1] : "" });
    }
  }
  return out;
}

/** The config with the chosen secrets swapped for their `${NAME}`. */
export function withSecretsMoved(config: ServerConfig, secrets: LiteralSecret[]): ServerConfig {
  const out = structuredClone(config);
  for (const s of secrets) {
    const block = out[s.block];
    if (isObject(block)) block[s.key] = `${s.prefix}\${${s.name}}`;
  }
  return out;
}

/**
 * Pasted text → what the sheet shows: the first thing to fix, and the servers found (counted from
 * the tolerant read even while there's a mistake). `existing` are your tool names, `stored` your
 * secret names.
 */
export function readMcpJson(text: string, existing: string[], stored: Set<string>): PasteRead {
  const scan = scanJson(text);
  if (scan.value === undefined && !scan.error) return { error: null, servers: [] };
  const map = serversMap(scan.value);
  const servers: PastedServer[] = [];
  const names = new Set<string>();
  const taken = new Set(stored);
  for (const [key, raw] of Object.entries(map ?? {})) {
    const fits = TOOL_NAME_RE.test(key.trim());
    const name = fits ? key.trim() : toolSlug(key);
    const config = isObject(raw) ? normaliseServer(raw) : {};
    const problem = !name
      ? "Give it a name with letters or numbers."
      : names.has(name)
        ? "Another server here has this name."
        : serverProblem(config);
    if (name) names.add(name);
    servers.push({
      name: name || key,
      pastedAs: fits ? null : key,
      config,
      transport: transportOf(config),
      problem,
      replaces: Boolean(name) && existing.includes(name),
      secrets: problem ? [] : literalSecrets(name, config, taken),
    });
  }
  if (scan.error) return { error: scan.error, servers };
  if (!map) {
    const lone = isObject(scan.value) && ("command" in scan.value || "url" in scan.value);
    return { error: lone ? UNNAMED_SERVER : NO_SERVERS, servers };
  }
  if (servers.length === 0) return { error: EMPTY_SERVERS, servers };
  return { error: null, servers };
}
