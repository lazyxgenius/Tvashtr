// `lib/api` is imported FIRST, on purpose. `lib/api.ts` reads a round's `connectors` block (the
// agent drawer's Runs tab), and `connectors.ts` imports `./runs`, whose `ApiDetailError` extends
// `ApiError` from `lib/api.ts` at load. A value import of `connectors.ts` from `lib/api.ts` is
// therefore a cycle that throws "Class extends value undefined" for any entry that loads
// `lib/api.ts` first. tsc and `vite build` don't see it. So the parser lives in a module that
// imports nothing.
import { describe, expect, it } from "vitest";

import { ApiError } from "../api";
import { parseRoundConnectors as fromTheClient } from "./connectors";
import { parseRoundConnectors } from "./roundConnectors";
import source from "./roundConnectors.ts?raw";

describe("roundConnectors — the leaf module lib/api.ts can import", () => {
  it("imports nothing, so nothing it loads can reach lib/api.ts", () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/^\s*export\s[^;]*\sfrom\s/m);
  });

  it("parses a round when lib/api loaded first", () => {
    expect(ApiError).toBeDefined();
    const round = parseRoundConnectors({ calls: [{ tool: "list_tables" }], total_calls: 3 });
    expect(round?.total_calls).toBe(3);
    expect(round?.calls[0]).toMatchObject({ tool: "list_tables", write: true, ok: false });
    expect(parseRoundConnectors(null)).toBeNull();
  });

  it("is the parser the connectors client exports", () => {
    expect(fromTheClient).toBe(parseRoundConnectors);
  });
});
