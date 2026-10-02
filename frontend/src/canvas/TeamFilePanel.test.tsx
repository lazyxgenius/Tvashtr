import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { ToastProvider } from "../design-system/components";
import { TeamFilePanel } from "./TeamFilePanel";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;
let content = "name: Before\n";

beforeEach(() => {
  fetchMock = vi.fn<Fetch>(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          filename: "t.yaml",
          format: "yaml",
          content,
          lines: 1,
          needs: { connectors: [], secrets: [] },
        }),
      ),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("the Team file panel (M4)", () => {
  it("reads the file again when the canvas changes while it is open", async () => {
    const view = (revision: number) => (
      <ToastProvider>
        <TeamFilePanel teamId="team-1" revision={revision} onClose={vi.fn()} />
      </ToastProvider>
    );
    const { rerender } = render(view(1));
    const panel = screen.getByRole("complementary", { name: "Team file" });
    await waitFor(() => expect(panel).toHaveTextContent("name: Before"));
    content = "name: After\n";
    rerender(view(2));
    await waitFor(() => expect(panel).toHaveTextContent("name: After"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
