import { joinAnd } from "../nodeActions";

/**
 * The Output format editor's live check (PANEL-60): parse the text as JSON with friendly,
 * line-numbered messages ("Line 3: add a comma after the list."), then check it's a schema the run
 * can use. Runs validate a subset of JSON Schema — `type`, `enum`, `required`, `properties` and
 * `items` (backend `guardrails._schema_violation`) — so those keywords must be well formed, and any
 * other keyword is reported as not checked rather than silently ignored.
 */
export type SchemaCheck =
  | { state: "empty" }
  | { state: "error"; message: string; line: number }
  | { state: "valid"; schema: Record<string, unknown>; unchecked: string[] };

/** The type names the run's validator knows (backend `guardrails._type_ok`). */
const TYPES = ["object", "array", "string", "number", "integer", "boolean", "null"];
const TYPE_LIST = "object, array, string, number, integer, boolean or null";
/** Keywords the run checks. */
const CHECKED = new Set(["type", "enum", "required", "properties", "items"]);
/** Annotations: they describe the schema and are never a check, so they aren't "skipped" either. */
const ANNOTATIONS = new Set([
  "$schema",
  "$id",
  "$comment",
  "title",
  "description",
  "default",
  "examples",
]);

// ---- A small JSON parser that knows where it is ------------------------------------------------

type JsonNode =
  | { kind: "object"; line: number; endLine: number; entries: JsonEntry[] }
  | { kind: "array"; line: number; endLine: number; items: JsonNode[] }
  | { kind: "string"; line: number; endLine: number; value: string }
  | { kind: "number" | "literal"; line: number; endLine: number; raw: string };

interface JsonEntry {
  key: string;
  line: number;
  value: JsonNode;
}

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

const quote = (s: string, max = 24) => `“${s.length > max ? `${s.slice(0, max)}…` : s}”`;

/** How the value before a missing comma reads: "the list", "the object", “object”, 5. */
function describe(node: JsonNode): string {
  if (node.kind === "array") return "the list";
  if (node.kind === "object") return "the object";
  if (node.kind === "string") return quote(node.value);
  return node.raw;
}

function parseJson(text: string): JsonNode {
  let pos = 0;
  let line = 1;
  const fail = (message: string, at = line): never => {
    throw new ParseFailure(`Line ${at}: ${message}`, at);
  };

  const ws = () => {
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === "\n") {
        line += 1;
        pos += 1;
      } else if (ch === " " || ch === "\t" || ch === "\r") {
        pos += 1;
      } else if (ch === "/" && (text[pos + 1] === "/" || text[pos + 1] === "*")) {
        fail("JSON can’t have comments. Remove it.");
      } else {
        return;
      }
    }
  };

  const word = () => {
    const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(pos));
    return m ? m[0] : "";
  };

  const parseString = (): JsonNode => {
    const start = pos;
    const startLine = line;
    pos += 1;
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === '"') {
        pos += 1;
        return {
          kind: "string",
          line: startLine,
          endLine: startLine,
          value: JSON.parse(text.slice(start, pos)) as string,
        };
      }
      if (ch === "\n") break;
      if (ch === "\\") {
        const next = text[pos + 1] ?? "";
        if (next === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(pos + 2, pos + 6))) {
            fail("a \\u escape needs four hex digits.", startLine);
          }
          pos += 6;
          continue;
        }
        if (!'"\\/bfnrt'.includes(next) || next === "") {
          fail(`${quote(`\\${next}`)} isn’t an escape JSON knows. Write \\\\ for a backslash.`);
        }
        pos += 2;
        continue;
      }
      if (ch < " ") fail("a tab inside quotes has to be written \\t.", startLine);
      pos += 1;
    }
    return fail("close the quote.", startLine);
  };

  const parseValue = (closing: string | null): JsonNode => {
    ws();
    if (pos >= text.length) {
      return fail(closing ? `add a value before the end.` : "the schema is empty.");
    }
    const ch = text[pos];
    if (ch === "{") return parseObject();
    if (ch === "[") return parseArray();
    if (ch === '"') return parseString();
    if (ch === "'") return fail("use double quotes, not single quotes.");
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(pos));
      if (!m) return fail(`${quote(text.slice(pos, pos + 8).split(/\s/)[0])} isn’t a number.`);
      pos += m[0].length;
      return { kind: "number", line, endLine: line, raw: m[0] };
    }
    const w = word();
    if (w === "true" || w === "false" || w === "null") {
      pos += w.length;
      return { kind: "literal", line, endLine: line, raw: w };
    }
    if (w) return fail(`${quote(w)} isn’t JSON. Put text in double quotes.`);
    if (closing && ch === closing) return fail(`add a value before the ${ch}.`);
    return fail(`${quote(ch)} doesn’t belong here.`);
  };

  const parseObject = (): JsonNode => {
    const openLine = line;
    const entries: JsonEntry[] = [];
    pos += 1;
    ws();
    if (text[pos] === "}") {
      pos += 1;
      return { kind: "object", line: openLine, endLine: line, entries };
    }
    for (;;) {
      ws();
      if (pos >= text.length) fail(`close the { from line ${openLine} with }.`);
      const ch = text[pos];
      if (ch === "}" && entries.length > 0) fail("remove the comma before the }.");
      if (ch === "'") fail("use double quotes, not single quotes.");
      if (ch !== '"') {
        const w = word();
        fail(w ? `put ${quote(w)} in double quotes.` : `${quote(ch)} can’t start a key.`);
      }
      const keyNode = parseString() as Extract<JsonNode, { kind: "string" }>;
      ws();
      if (text[pos] !== ":") {
        fail(`add a colon after ${quote(keyNode.value)}.`, keyNode.line);
      }
      pos += 1;
      const value = parseValue("}");
      entries.push({ key: keyNode.value, line: keyNode.line, value });
      const valueEnd = line;
      ws();
      if (pos >= text.length) fail(`close the { from line ${openLine} with }.`);
      if (text[pos] === ",") {
        pos += 1;
        continue;
      }
      if (text[pos] === "}") {
        pos += 1;
        return { kind: "object", line: openLine, endLine: line, entries };
      }
      if (text[pos] === "]") fail("this ] closes a list that was never opened.");
      fail(`add a comma after ${describe(value)}.`, valueEnd);
    }
  };

  const parseArray = (): JsonNode => {
    const openLine = line;
    const items: JsonNode[] = [];
    pos += 1;
    ws();
    if (text[pos] === "]") {
      pos += 1;
      return { kind: "array", line: openLine, endLine: line, items };
    }
    for (;;) {
      ws();
      if (items.length > 0 && text[pos] === "]") fail("remove the comma before the ].");
      const value = parseValue("]");
      items.push(value);
      const valueEnd = line;
      ws();
      if (pos >= text.length) fail(`close the [ from line ${openLine} with ].`);
      if (text[pos] === ",") {
        pos += 1;
        continue;
      }
      if (text[pos] === "]") {
        pos += 1;
        return { kind: "array", line: openLine, endLine: line, items };
      }
      if (text[pos] === "}") fail("this } closes an object that was never opened.");
      fail(`add a comma after ${describe(value)}.`, valueEnd);
    }
  };

  const root = parseValue(null);
  ws();
  if (pos < text.length) fail("remove what comes after the end of the schema.");
  return root;
}

// ---- The schema check -------------------------------------------------------------------------

function checkType(node: JsonNode): string | null {
  const names = node.kind === "array" ? node.items : [node];
  if (names.length === 0) return `Line ${node.line}: list at least one type in “type”.`;
  for (const n of names) {
    if (n.kind !== "string") {
      return `Line ${n.line}: “type” takes a type name, like "string".`;
    }
    if (!TYPES.includes(n.value)) {
      return `Line ${n.line}: ${quote(n.value)} isn’t a type. Use ${TYPE_LIST}.`;
    }
  }
  return null;
}

/** A subschema is an object (checked in turn) or true/false (always / never matches). */
function isSchemaValue(node: JsonNode): boolean {
  return node.kind === "object" || (node.kind === "literal" && node.raw !== "null");
}

function checkSchemaNode(node: JsonNode, unchecked: string[]): string | null {
  if (node.kind !== "object") return null;
  for (const { key, line, value } of node.entries) {
    let problem: string | null = null;
    if (key === "type") {
      problem = checkType(value);
    } else if (key === "enum") {
      if (value.kind !== "array") problem = `Line ${line}: “enum” takes a list of allowed values.`;
    } else if (key === "required") {
      if (value.kind !== "array" || value.items.some((i) => i.kind !== "string")) {
        problem = `Line ${line}: “required” takes a list of property names in quotes.`;
      }
    } else if (key === "properties") {
      if (value.kind !== "object") {
        problem = `Line ${line}: “properties” takes an object: each property’s own schema.`;
      } else {
        for (const prop of value.entries) {
          if (!isSchemaValue(prop.value)) {
            problem = `Line ${prop.line}: give ${quote(prop.key)} a schema object, like { "type": "string" }.`;
          } else {
            problem = checkSchemaNode(prop.value, unchecked);
          }
          if (problem) break;
        }
      }
    } else if (key === "items") {
      const schemas = value.kind === "array" ? value.items : [value];
      for (const s of schemas) {
        problem = isSchemaValue(s)
          ? checkSchemaNode(s, unchecked)
          : `Line ${s.line}: “items” takes a schema object, like { "type": "string" }.`;
        if (problem) break;
      }
    } else if (!ANNOTATIONS.has(key) && !CHECKED.has(key) && !unchecked.includes(key)) {
      unchecked.push(key);
    }
    if (problem) return problem;
  }
  return null;
}

/** JSON's first mistake in words ("Line 3: add a comma after the list."), or null (the paste sheet). */
export function jsonProblem(text: string): string | null {
  try {
    parseJson(text);
    return null;
  } catch (e) {
    if (e instanceof ParseFailure) return e.message;
    throw e;
  }
}

export function checkSchema(text: string): SchemaCheck {
  if (!text.trim()) return { state: "empty" };
  let root: JsonNode;
  try {
    root = parseJson(text);
  } catch (e) {
    if (e instanceof ParseFailure) return { state: "error", message: e.message, line: e.line };
    throw e;
  }
  if (root.kind !== "object") {
    return {
      state: "error",
      message: `Line ${root.line}: a schema is a JSON object, like { "type": "object" }.`,
      line: root.line,
    };
  }
  const unchecked: string[] = [];
  const problem = checkSchemaNode(root, unchecked);
  if (problem) {
    const line = Number(/^Line (\d+)/.exec(problem)?.[1] ?? root.line);
    return { state: "error", message: problem, line };
  }
  return { state: "valid", schema: JSON.parse(text) as Record<string, unknown>, unchecked };
}

/** Under "Valid JSON Schema" when it uses keywords the run doesn't check. */
export function uncheckedNote(unchecked: readonly string[]): string | null {
  if (unchecked.length === 0) return null;
  const shown = unchecked.slice(0, 3).map((k) => quote(k, 32));
  if (unchecked.length > 3) shown.push("the rest");
  return `Runs check type, enum, required, properties and items only, so they skip ${joinAnd(shown)}.`;
}

/** The text Done writes into the draft: "" for none, else the schema pretty-printed. */
export function schemaDraftText(text: string): string | null {
  const result = checkSchema(text);
  if (result.state === "empty") return "";
  if (result.state === "error") return null;
  return JSON.stringify(result.schema, null, 2);
}

/**
 * Insert example: a verdict agent's REVIEW_VERDICT.json, or a one-field report for any other agent.
 * With a single labelled arrow ("approved") the other verdict its instructions name is the rework
 * one, so the example lists "changes_requested" too; two or more labels cover the branches.
 */
export function exampleSchema(verdictLabels: readonly string[] | null): string {
  if (verdictLabels) {
    const values =
      verdictLabels.length >= 2
        ? verdictLabels
        : [...new Set([verdictLabels[0] ?? "approved", "changes_requested"])];
    const list = values.map((v) => JSON.stringify(v)).join(", ");
    return [
      "{",
      '  "type": "object",',
      '  "required": ["verdict", "reasons"],',
      '  "properties": {',
      `    "verdict": { "enum": [${list}] },`,
      '    "reasons": { "type": "string" }',
      "  }",
      "}",
    ].join("\n");
  }
  return [
    "{",
    '  "type": "object",',
    '  "required": ["summary"],',
    '  "properties": {',
    '    "summary": { "type": "string" }',
    "  }",
    "}",
  ].join("\n");
}
