import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectorCall, RoundConnectors } from "../../lib/api/roundConnectors";
import { ConnectorsSkipped, ConnectorsUsed } from "./ConnectorsUsed";

// Agent › Runs: what a round called through connectors (Page-Agent-Runs-what-it-read, CnF-Run-1/2)
// and what it ran without (CnF-Expired-2).

afterEach(cleanup);

const call = (over: Partial<ConnectorCall> = {}): ConnectorCall => ({
  connection_id: "c1",
  name: "Supabase",
  tool: "execute_sql",
  write: false,
  ok: true,
  blocked: false,
  forwarded: true,
  arg: "SELECT count(*) FROM indicator_values WHERE name = 'rsi_14'",
  at: "2026-09-30T10:04:00+00:00",
  duration_ms: 312,
  result_url: null,
  ...over,
});
const round = (over: Partial<RoundConnectors> = {}): RoundConnectors => ({
  used: [{ connection_id: "c1", name: "Supabase", slug: "supabase", reads: 6, writes: 0 }],
  calls: [call()],
  total_calls: 1,
  skipped: [],
  ...over,
});
const WRITE = call({
  connection_id: "c3",
  name: "Linear",
  tool: "create_issue",
  write: true,
  arg: "Follow-up: RSI rounds to 1 dp at the 70 boundary",
  duration_ms: 900,
  result_url: "https://linear.app/lazyx/issue/LIN-214",
});

const used = () => screen.getByRole("group", { name: "Connectors used this round" });
const calls = () => within(screen.getByRole("list", { name: "Calls" })).getAllByRole("listitem");

describe("ConnectorsUsed — chips and calls", () => {
  it("shows nothing for a round that used no connector", () => {
    const { container, rerender } = render(<ConnectorsUsed connectors={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ConnectorsUsed connectors={round({ used: [], calls: [], total_calls: 0 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws a connector's tile with the letters it has on the Connectors page", () => {
    const { container } = render(
      <ConnectorsUsed
        connectors={round({
          used: [
            { connection_id: "c1", name: "Supabase", slug: "supabase", reads: 6, writes: 0 },
            { connection_id: "c2", name: "Notion", slug: "notion", reads: 1, writes: 0 },
          ],
          calls: [call(), call({ connection_id: "c2", name: "Notion", tool: "search" })],
          total_calls: 2,
        })}
      />,
    );
    const tiles = [...container.querySelectorAll(".nd-conn-tile")].map((t) => t.textContent);
    // Two chips, then two calls. "Sb" is the design's tile for Supabase, not its first letters.
    expect(tiles).toEqual(["Sb", "No", "Sb", "No"]);
  });

  it("counts each connector's reads and writes on a chip, in the order they were used", () => {
    render(
      <ConnectorsUsed
        connectors={round({
          used: [
            { connection_id: "c3", name: "Linear", slug: "linear", reads: 0, writes: 1 },
            { connection_id: "c1", name: "Supabase", slug: "supabase", reads: 6, writes: 0 },
            { connection_id: "c2", name: "Notion", slug: "notion", reads: 1, writes: 0 },
            { connection_id: "c5", name: "PostHog", slug: "posthog", reads: 2, writes: 3 },
          ],
        })}
      />,
    );
    expect(
      within(used())
        .getAllByRole("listitem")
        .map((c) => c.textContent),
    ).toEqual([
      "LiLinear · 1 write",
      "SbSupabase · 6 reads",
      "NoNotion · 1 read",
      "PhPostHog · 3 writes · 2 reads",
    ]);
  });

  it("lists a call with its tool, argument, time and how long it took", () => {
    render(<ConnectorsUsed connectors={round()} />);
    const [row] = calls();
    expect(within(row).getByText("Supabase")).toBeInTheDocument();
    expect(within(row).getByText("execute_sql")).toBeInTheDocument();
    expect(within(row).getByText("Read")).toBeInTheDocument();
    expect(
      within(row).getByText("SELECT count(*) FROM indicator_values WHERE name = 'rsi_14'"),
    ).toBeInTheDocument();
    // The viewer's own clock, 24 hours: "10:04 · 0.3 s".
    expect(within(row).getByText(/^\d\d:\d\d · 0\.3 s$/)).toBeInTheDocument();
    expect(within(row).queryByRole("link")).toBeNull();
  });

  it("marks a write, says writes come first, and links to what it made", () => {
    render(<ConnectorsUsed connectors={round({ calls: [WRITE, call()], total_calls: 2 })} />);
    const [first, second] = calls();
    expect(within(first).getByText("Write")).toBeInTheDocument();
    expect(first.className).toContain("nd-conn-call--write");
    expect(second.className).not.toContain("nd-conn-call--write");
    expect(within(first).getByRole("link", { name: "Open result" })).toHaveAttribute(
      "href",
      "https://linear.app/lazyx/issue/LIN-214",
    );
    expect(screen.getByText("Writes are listed first and marked.")).toBeInTheDocument();
  });

  it("says nothing about writes when every call was a read", () => {
    render(<ConnectorsUsed connectors={round()} />);
    expect(screen.queryByText("Writes are listed first and marked.")).toBeNull();
  });

  it("never turns an address that isn't https into a link", () => {
    render(
      <ConnectorsUsed
        connectors={round({
          calls: [
            { ...WRITE, result_url: "javascript:alert(document.cookie)" },
            { ...WRITE, result_url: "http://linear.app/x" },
            { ...WRITE, result_url: " https://linear.app/x" },
          ],
          total_calls: 3,
        })}
      />,
    );
    expect(calls()).toHaveLength(3);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says when a call was refused by the read-only rule or failed", () => {
    render(
      <ConnectorsUsed
        connectors={round({
          calls: [
            call({ tool: "create_thing", write: true, ok: false, blocked: true }),
            call({ tool: "list_things", ok: false }),
          ],
          total_calls: 2,
        })}
      />,
    );
    const [blocked, failed] = calls();
    expect(blocked).toHaveTextContent("Not run: read only for this agent");
    expect(failed).toHaveTextContent("Failed");
  });

  it("says a write the provider took may have gone through, not that it failed", () => {
    const lost = { tool: "create_issue", write: true, ok: false };
    render(
      <ConnectorsUsed
        connectors={round({
          calls: [call({ ...lost, forwarded: true }), call({ ...lost, forwarded: false })],
          total_calls: 2,
        })}
      />,
    );
    // Its answer was lost, or was an error: the chips count it as a write, so the call says why.
    const [taken, neverSent] = calls();
    expect(taken).toHaveTextContent("May have gone through");
    expect(taken).not.toHaveTextContent("Failed");
    expect(neverSent).toHaveTextContent("Failed");
  });

  it("shows the first four calls, then all of them on request", () => {
    const seven = Array.from({ length: 7 }, (_, i) => call({ tool: `tool_${i}` }));
    render(<ConnectorsUsed connectors={round({ calls: seven, total_calls: 7 })} />);
    expect(calls()).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Show all 7 calls" }));
    expect(calls()).toHaveLength(7);
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
  });

  it("Show all is one toggle that stays put, says its state and names the list", () => {
    const seven = Array.from({ length: 7 }, (_, i) => call({ tool: `tool_${i}` }));
    render(<ConnectorsUsed connectors={round({ calls: seven, total_calls: 7 })} />);
    const toggle = screen.getByRole("button", { name: "Show all 7 calls" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", screen.getByRole("list", { name: "Calls" }).id);
    fireEvent.click(toggle);
    // The same button, so keyboard focus stays where it was.
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Show fewer calls");
    fireEvent.click(toggle);
    expect(calls()).toHaveLength(4);
    expect(toggle).toHaveAccessibleName("Show all 7 calls");
  });

  it("four calls or fewer need no Show all; a capped list says how many there were", () => {
    const four = Array.from({ length: 4 }, (_, i) => call({ tool: `tool_${i}` }));
    const { unmount } = render(
      <ConnectorsUsed connectors={round({ calls: four, total_calls: 4 })} />,
    );
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
    unmount();
    const fifty = Array.from({ length: 50 }, (_, i) => call({ tool: `tool_${i}` }));
    render(<ConnectorsUsed connectors={round({ calls: fifty, total_calls: 73 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Show the first 50 calls" }));
    expect(calls()).toHaveLength(50);
    expect(screen.getByText("The first 50 of 73 calls.")).toBeInTheDocument();
  });
});

describe("ConnectorsSkipped — what the round ran without", () => {
  it("shows nothing when nothing was skipped", () => {
    const { container, rerender } = render(<ConnectorsSkipped connectors={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ConnectorsSkipped connectors={round()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a round that only skipped a connector says so, with Sign in to that connection", () => {
    const only = round({
      used: [],
      calls: [],
      total_calls: 0,
      skipped: [
        { connection_id: "9d2a", name: "Notion", reason: "its sign-in expired" },
        { connection_id: null, name: "a connector", reason: "it was disconnected" },
      ],
    });
    const { container } = render(
      <>
        <ConnectorsSkipped connectors={only} />
        <div data-testid="used">
          <ConnectorsUsed connectors={only} />
        </div>
      </>,
    );
    const [notion, gone] = within(container).getAllByRole("note");
    expect(notion).toHaveTextContent("Ran without Notion: its sign-in expired.");
    expect(within(notion).getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "#/toolkit/connectors/9d2a",
    );
    expect(gone).toHaveTextContent("Ran without a connector: it was disconnected.");
    expect(within(gone).getByRole("link", { name: "Open Connectors" })).toHaveAttribute(
      "href",
      "#/toolkit/connectors",
    );
    // No chips and no calls for a round that called nothing.
    expect(screen.getByTestId("used")).toBeEmptyDOMElement();
    // Plain addresses when nothing asks to open them.
    expect(fireEvent.click(within(notion).getByRole("link", { name: "Sign in" }))).toBe(true);
  });

  it("given onOpen, Sign in and Open Connectors ask the drawer instead of leaving", () => {
    const onOpen = vi.fn();
    render(
      <ConnectorsSkipped
        onOpen={onOpen}
        connectors={round({
          skipped: [
            { connection_id: "9d2a", name: "Notion", reason: "its sign-in expired" },
            { connection_id: null, name: "a connector", reason: "it was disconnected" },
          ],
        })}
      />,
    );
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn).toHaveAttribute("href", "#/toolkit/connectors/9d2a");
    // `fireEvent` answers false when the click's default (following the address) was prevented.
    expect(fireEvent.click(signIn)).toBe(false);
    expect(onOpen).toHaveBeenLastCalledWith("9d2a");
    expect(fireEvent.click(screen.getByRole("link", { name: "Open Connectors" }))).toBe(false);
    expect(onOpen).toHaveBeenLastCalledWith(null);
  });
});
