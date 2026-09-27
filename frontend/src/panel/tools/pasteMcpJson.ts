/**
 * Paste mcp.json (PANEL-97; Flow-PasteJson-2): read the servers out of a pasted config — under
 * `mcpServers` (Claude, Cursor), `servers` (VS Code) or bare — tolerating comments and trailing
 * commas (VS Code writes JSONC) and members pasted without the outer braces. A broken paste says
 * where, in words.
 */
import { jsonProblem } from "../setup/schemaCheck";
import { asRecord } from "./nodeTools";

export interface PastedServer {
  name: string;
  server: Record<string, unknown>;
}

export type PasteResult =
  | { state: "empty" }
  | { state: "error"; message: string }
  /** `skipped`: entries with neither a url nor a command. */
  | { state: "ok"; servers: PastedServer[]; skipped: string[] };

/** A comma with only space or comments before the closing bracket. */
const TRAILING = /^,(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*[}\]]/;

/** Comments and trailing commas become spaces; strings and line breaks stay where they were. */
export function stripJsonc(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      const close = text[i + 1] === "/" ? "\n" : "*/";
      const at = text.indexOf(close, i + 2);
      const stop = at === -1 ? text.length : at + (close === "\n" ? 0 : 2);
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
    } else if (c === "," && TRAILING.test(text.slice(i))) {
      out += " ";
    } else {
      out += c;
    }
  }
  return out;
}

export function parseMcpJson(text: string): PasteResult {
  if (!text.trim()) return { state: "empty" };
  const clean = stripJsonc(text);
  let root: unknown;
  try {
    root = JSON.parse(clean);
  } catch {
    try {
      // Members copied without the outer braces: "linear": { … }
      root = JSON.parse(stripJsonc(`{${text}\n}`));
    } catch {
      return {
        state: "error",
        message: `That isn’t valid JSON — ${jsonProblem(clean) ?? "check the brackets and quotes."}`,
      };
    }
  }
  const top = asRecord(root);
  const isServer = (v: Record<string, unknown>) =>
    typeof v.url === "string" || typeof v.command === "string";
  if (isServer(top)) {
    return {
      state: "error",
      message: 'This server has no name. Paste it as { "mcpServers": { "<name>": … } }.',
    };
  }
  const map = asRecord(top.mcpServers ?? top.servers ?? top);
  const servers: PastedServer[] = [];
  const skipped: string[] = [];
  for (const [name, value] of Object.entries(map)) {
    const server = { ...asRecord(value) };
    if (!isServer(server)) {
      skipped.push(name);
      continue;
    }
    // VS Code marks local servers "stdio"; a command already says so.
    if (server.type === "stdio") delete server.type;
    servers.push({ name, server });
  }
  return { state: "ok", servers, skipped };
}
