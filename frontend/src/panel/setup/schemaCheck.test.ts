import { describe, expect, it } from "vitest";

import { checkSchema, exampleSchema, schemaDraftText, uncheckedNote } from "./schemaCheck";

// The design's broken schema (Flow-Schema-2): no comma after the "required" list on line 3.
const MISSING_COMMA = [
  "{",
  '  "type": "object",',
  '  "required": ["verdict", "reasons"]',
  '  "properties": {',
  '    "verdict": { "enum": ["approved", "changes_requested"] },',
  '    "reasons": { "type": "string" }',
  "  }",
  "}",
].join("\n");
const FIXED = MISSING_COMMA.replace('"reasons"]\n', '"reasons"],\n');

const errorOf = (text: string) => {
  const r = checkSchema(text);
  return r.state === "error" ? r.message : r.state;
};

describe("checkSchema — JSON with line hints", () => {
  it("names the line of the list that needs a comma after it", () => {
    expect(checkSchema(MISSING_COMMA)).toEqual({
      state: "error",
      message: "Line 3: add a comma after the list.",
      line: 3,
    });
  });

  it("accepts the fixed schema as valid, with nothing it skips", () => {
    const r = checkSchema(FIXED);
    expect(r.state).toBe("valid");
    if (r.state === "valid") {
      expect(r.schema.required).toEqual(["verdict", "reasons"]);
      expect(r.unchecked).toEqual([]);
    }
  });

  it("is empty when there's nothing but whitespace", () => {
    expect(checkSchema("  \n ")).toEqual({ state: "empty" });
  });

  it.each([
    ['{\n  "type": "object"\n  "title": "x"\n}', "Line 2: add a comma after “object”."],
    ['{\n  "a": {}\n  "b": 1\n}', "Line 2: add a comma after the object."],
    ['{\n  "a": 5\n  "b": 1\n}', "Line 2: add a comma after 5."],
    ['{\n  "type": "object",\n}', "Line 3: remove the comma before the }."],
    ['{ "required": ["a",] }', "Line 1: remove the comma before the ]."],
    ['{ type: "object" }', "Line 1: put “type” in double quotes."],
    ["{ 'type': \"object\" }", "Line 1: use double quotes, not single quotes."],
    ['{ "type" "object" }', "Line 1: add a colon after “type”."],
    ['{\n  "type": "object"', "Line 2: close the { from line 1 with }."],
    ['{ "type": "obj', "Line 1: close the quote."],
    ['{ "type": object }', "Line 1: “object” isn’t JSON. Put text in double quotes."],
    ['{ "type": "object" } x', "Line 1: remove what comes after the end of the schema."],
    ['{\n  // the verdict\n  "type": "object"\n}', "Line 2: JSON can’t have comments. Remove it."],
  ])("explains %j", (text, message) => {
    expect(errorOf(text)).toBe(message);
  });
});

describe("checkSchema — the keywords runs check", () => {
  it("wants an object at the top", () => {
    expect(errorOf('["a"]')).toBe('Line 1: a schema is a JSON object, like { "type": "object" }.');
  });

  it("knows the seven type names, alone or in a list", () => {
    expect(checkSchema('{ "type": ["string", "null"] }').state).toBe("valid");
    expect(errorOf('{\n  "type": "objekt"\n}')).toBe(
      "Line 2: “objekt” isn’t a type. Use object, array, string, number, integer, boolean or null.",
    );
    expect(errorOf('{ "type": 3 }')).toBe('Line 1: “type” takes a type name, like "string".');
  });

  it("checks enum, required, properties and items, all the way down", () => {
    expect(errorOf('{ "enum": "a" }')).toBe("Line 1: “enum” takes a list of allowed values.");
    expect(errorOf('{ "required": [1] }')).toBe(
      "Line 1: “required” takes a list of property names in quotes.",
    );
    expect(errorOf('{ "properties": [] }')).toBe(
      "Line 1: “properties” takes an object: each property’s own schema.",
    );
    expect(errorOf('{\n  "properties": {\n    "verdict": "string"\n  }\n}')).toBe(
      'Line 3: give “verdict” a schema object, like { "type": "string" }.',
    );
    expect(errorOf('{ "items": { "type": "strin" } }')).toMatch(/^Line 1: “strin” isn’t a type/);
    expect(checkSchema('{ "items": true, "properties": { "a": false } }').state).toBe("valid");
  });

  it("lists the keywords runs don't check, once, and ignores annotations", () => {
    const r = checkSchema(
      '{ "title": "x", "minLength": 1, "properties": { "a": { "pattern": "x", "minLength": 2 } } }',
    );
    expect(r.state === "valid" && r.unchecked).toEqual(["minLength", "pattern"]);
    expect(uncheckedNote(["minLength", "pattern"])).toBe(
      "Runs check type, enum, required, properties and items only, so they skip “minLength” and “pattern”.",
    );
    expect(uncheckedNote([])).toBeNull();
  });
});

describe("schemaDraftText / exampleSchema", () => {
  it("pretty-prints a valid schema, clears an empty one, refuses a broken one", () => {
    expect(schemaDraftText('{"type":"object"}')).toBe('{\n  "type": "object"\n}');
    expect(schemaDraftText("   ")).toBe("");
    expect(schemaDraftText(MISSING_COMMA)).toBeNull();
  });

  it("offers the verdict file for a verdict agent and a report for any other", () => {
    expect(exampleSchema(["approved"])).toBe(FIXED);
    expect(exampleSchema(["pass", "fail"])).toContain('"enum": ["pass", "fail"]');
    expect(exampleSchema(null)).toContain('"required": ["summary"]');
    for (const labels of [["approved"], ["pass", "fail"], null]) {
      expect(checkSchema(exampleSchema(labels)).state).toBe("valid");
    }
  });
});
