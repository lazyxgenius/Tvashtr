import { describe, expect, it } from "vitest";

import { connection } from "../../pages/connectors/connectorsTestUtils";
import { connectorsRoute, savedGrantsToast } from "./connectorFormat";

const SUPABASE = connection();
const NOTION = connection({ id: "c2", name: "Notion", slug: "notion" });
const LINEAR = connection({ id: "c3", name: "Linear", slug: "linear", access: "write" });
const ALL = [SUPABASE, NOTION, LINEAR];
const read = (id: string) => ({ id, access: "read" as const });

describe("savedGrantsToast (CnF-Grant-4)", () => {
  it("names what the agent can use, in the agent's order, and that all of it is read only", () => {
    expect(savedGrantsToast("Reviewer", [read("c1"), read("c2"), read("c3")], ALL)).toBe(
      "Reviewer can use Supabase, Notion and Linear. All read only.",
    );
    expect(savedGrantsToast("Reviewer", [read("c2")], ALL)).toBe(
      "Reviewer can use Notion. Read only.",
    );
  });

  it("leaves 'read only' out once one of them may write", () => {
    expect(savedGrantsToast("Reviewer", [read("c1"), { id: "c3", access: "write" }], ALL)).toBe(
      "Reviewer can use Supabase and Linear.",
    );
    // A write grant on a connection that is itself read only can't write.
    expect(savedGrantsToast("Reviewer", [{ id: "c1", access: "write" }, read("c2")], ALL)).toBe(
      "Reviewer can use Supabase and Notion. All read only.",
    );
  });

  it("skips a grant whose connection is gone, and says nothing when none is left", () => {
    expect(savedGrantsToast("Reviewer", [read("gone"), read("c1")], ALL)).toBe(
      "Reviewer can use Supabase. Read only.",
    );
    expect(savedGrantsToast("Reviewer", [read("gone")], ALL)).toBeNull();
    expect(savedGrantsToast("Reviewer", [], ALL)).toBeNull();
  });
});

describe("connectorsRoute", () => {
  it("is one connection's page, or the Connectors list", () => {
    expect(connectorsRoute("c4")).toEqual({ page: "connector", connectorId: "c4" });
    expect(connectorsRoute(null)).toEqual({ page: "connectors", view: "connected" });
  });
});
