import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { connection } from "../../pages/connectors/connectorsTestUtils";
import { mockApi } from "../../pages/tools/toolsTestUtils";
import { ConnectorsChecklist } from "./ConnectorsChecklist";

// Agent › Skills & tools › Connectors (Page-Agent-Skills-tools, CnF-Grant-1..4,
// Page-Agent-on-a-Claude-plan).

const SUPABASE = connection();
const NOTION = connection({
  id: "c2",
  connector_key: "notion",
  name: "Notion",
  slug: "notion",
  scope: null,
  scope_picker: null,
  read_only_by: "annotations",
});
const LINEAR = connection({
  id: "c3",
  connector_key: "linear",
  name: "Linear",
  slug: "linear",
  access: "write",
  scope: null,
  scope_picker: null,
  read_only_by: "annotations",
});
const SENTRY = connection({
  id: "c4",
  connector_key: "sentry",
  name: "Sentry",
  slug: "sentry",
  status: "needs_signin",
  last_error: "Sentry refused the saved sign-in.",
  scope: null,
  scope_picker: null,
  read_only_by: "annotations",
});
const ALL = [SUPABASE, NOTION, LINEAR, SENTRY];

beforeEach(() => __resetBackendStatusForTests());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const section = () => screen.getByRole("region", { name: /^Connectors/ });
const callout = () => section().querySelector(".dm-dlist__callout") as HTMLElement;
const box = (name: string) =>
  within(section()).findByRole<HTMLInputElement>("checkbox", { name: new RegExp(`^${name}`) });

describe("Connectors this agent can use", () => {
  it("lists every connection with its access, the agent's ones ticked, and counts them", async () => {
    mockApi({ "GET /api/connectors": { connections: ALL } });
    render(
      <ConnectorsChecklist
        value={[
          { id: "c1", access: "read" },
          { id: "c2", access: "read" },
        ]}
        onChange={() => {}}
      />,
    );
    const s = section();
    expect((await box("Supabase")).checked).toBe(true);
    expect((await box("Notion")).checked).toBe(true);
    expect((await box("Linear")).checked).toBe(false);
    expect(within(s).getByRole("heading", { name: /^Connectors\s*2/ })).toBeInTheDocument();
    expect(within(s).getByText("Connectors this agent can use")).toBeInTheDocument();
    expect(
      within(s).getByText("Read only · project trade-mcp-prod · ap-southeast-1"),
    ).toBeInTheDocument();
    expect(within(s).getByText("Read & write allowed")).toBeInTheDocument();
    expect(s).toHaveTextContent(
      "During a run it can call the read tools of what’s ticked. Calls go through Tvashtr, so the agent never holds your sign-in.",
    );
    expect(
      within(s).getByLabelText(
        "Apps you connected in Toolkit › Connectors. Tick the ones this agent may use.",
      ),
    ).toBeInTheDocument();
    expect(callout()).not.toHaveClass("nd-conn__callout--warn");
    expect(callout().querySelector(".lucide-info")).not.toBeNull();
  });

  it("says it is loading until the list arrives", async () => {
    mockApi({ "GET /api/connectors": { connections: ALL } });
    render(<ConnectorsChecklist value={[{ id: "c1", access: "read" }]} onChange={() => {}} />);
    expect(within(section()).getByRole("status")).toHaveTextContent("Loading your connectors…");
    expect(section()).toHaveAttribute("aria-busy", "true");
    await box("Supabase");
    expect(within(section()).queryByRole("status")).toBeNull();
    expect(section()).not.toHaveAttribute("aria-busy");
  });

  it("ticking adds a read-only grant and unticking removes it", async () => {
    mockApi({ "GET /api/connectors": { connections: ALL } });
    const onChange = vi.fn();
    const { rerender } = render(<ConnectorsChecklist value={[]} onChange={onChange} />);
    fireEvent.click(await box("Notion"));
    expect(onChange).toHaveBeenLastCalledWith([{ id: "c2", access: "read" }]);
    rerender(
      <ConnectorsChecklist
        value={[
          { id: "c1", access: "read" },
          { id: "c2", access: "read" },
        ]}
        onChange={onChange}
      />,
    );
    fireEvent.click(await box("Supabase"));
    expect(onChange).toHaveBeenLastCalledWith([{ id: "c2", access: "read" }]);
  });

  it("offers Access only on a ticked connection that allows writes (CnF-Grant-3)", async () => {
    mockApi({ "GET /api/connectors": { connections: ALL } });
    const onChange = vi.fn();
    const { rerender } = render(
      <ConnectorsChecklist
        value={[{ id: "c1", access: "read" }]}
        onChange={onChange}
        agentName="Reviewer"
      />,
    );
    await box("Linear");
    // Supabase is ticked but read only; Linear allows writes but isn't ticked.
    expect(within(section()).queryByRole("combobox")).toBeNull();
    fireEvent.click(await box("Linear"));
    const ticked = [
      { id: "c1", access: "read" as const },
      { id: "c3", access: "read" as const },
    ];
    expect(onChange).toHaveBeenLastCalledWith(ticked);
    rerender(<ConnectorsChecklist value={ticked} onChange={onChange} agentName="Reviewer" />);
    const access = within(section()).getByRole<HTMLSelectElement>("combobox", {
      name: "What Reviewer may do in Linear",
    });
    expect(access.value).toBe("read");
    expect([...access.options].map((o) => o.text)).toEqual(["Read only", "Read & write"]);
    expect(section()).toHaveTextContent(
      "Linear is connected with read & write, so you choose per agent. Reviewer starts on read only.",
    );
    expect(callout().querySelector(".lucide-pencil")).not.toBeNull();
    fireEvent.change(access, { target: { value: "write" } });
    expect(onChange).toHaveBeenLastCalledWith([
      { id: "c1", access: "read" },
      { id: "c3", access: "write" },
    ]);
  });

  it("once the tick is saved the note is the usual one again (CnF-Grant-4)", async () => {
    mockApi({ "GET /api/connectors": { connections: ALL } });
    const saved = [{ id: "c1", access: "read" as const }];
    const ticked = [...saved, { id: "c3", access: "read" as const }];
    const { rerender } = render(
      <ConnectorsChecklist value={saved} saved={saved} onChange={() => {}} agentName="Reviewer" />,
    );
    fireEvent.click(await box("Linear"));
    rerender(
      <ConnectorsChecklist value={ticked} saved={saved} onChange={() => {}} agentName="Reviewer" />,
    );
    expect(section()).toHaveTextContent("Reviewer starts on read only.");
    // Save: the saved grants catch up with the draft.
    rerender(
      <ConnectorsChecklist
        value={ticked}
        saved={ticked}
        onChange={() => {}}
        agentName="Reviewer"
      />,
    );
    expect(section()).not.toHaveTextContent("starts on read only");
    expect(section()).toHaveTextContent(
      "During a run it can call the read tools of what’s ticked.",
    );
  });

  it("a connection that needs attention links to its page to sign in again", async () => {
    mockApi({ "GET /api/connectors": { connections: ALL } });
    render(<ConnectorsChecklist value={[{ id: "c4", access: "read" }]} onChange={() => {}} />);
    expect((await box("Sentry")).checked).toBe(true);
    const links = within(section()).getAllByRole("link", { name: "Sign in again" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "#/toolkit/connectors/c4");
    expect(within(section()).getByText(/^Needs attention/)).toBeInTheDocument();
  });

  it("names what fixes a connection that needs attention: a key is replaced, no sign-in is connected again", async () => {
    const needs = (id: string, name: string, auth_kind: "api_key" | "none") =>
      connection({ id, name, slug: id, auth_kind, signin_host: null, status: "needs_signin" });
    mockApi({
      "GET /api/connectors": {
        connections: [needs("c7", "Apify", "api_key"), needs("c8", "Acme", "none")],
      },
    });
    render(<ConnectorsChecklist value={[]} onChange={() => {}} />);
    await box("Apify");
    expect(within(section()).getByRole("link", { name: "Replace key" })).toHaveAttribute(
      "href",
      "#/toolkit/connectors/c7",
    );
    expect(within(section()).getByRole("link", { name: "Connect it again" })).toHaveAttribute(
      "href",
      "#/toolkit/connectors/c8",
    );
    expect(within(section()).queryByRole("link", { name: "Sign in again" })).toBeNull();
  });

  it("given onOpen, its links ask the drawer to go there instead of leaving on their own", async () => {
    mockApi({ "GET /api/connectors": { connections: ALL } });
    const onOpen = vi.fn();
    const { unmount } = render(
      <ConnectorsChecklist value={[]} onChange={() => {}} onOpen={onOpen} />,
    );
    await box("Sentry");
    const again = within(section()).getByRole("link", { name: "Sign in again" });
    expect(again).toHaveAttribute("href", "#/toolkit/connectors/c4");
    // `fireEvent` answers false when the click's default (following the address) was prevented.
    expect(fireEvent.click(again)).toBe(false);
    expect(onOpen).toHaveBeenLastCalledWith("c4");
    unmount();
    mockApi({ "GET /api/connectors": { connections: [] } });
    render(<ConnectorsChecklist value={[]} onChange={() => {}} onOpen={onOpen} />);
    const open = await within(section()).findByRole("link", { name: "Open Connectors" });
    expect(fireEvent.click(open)).toBe(false);
    expect(onOpen).toHaveBeenLastCalledWith(null);
  });

  it("without onOpen a link is a plain address (the run view has no draft to guard)", async () => {
    mockApi({ "GET /api/connectors": { connections: ALL } });
    render(<ConnectorsChecklist value={[]} onChange={() => {}} />);
    await box("Sentry");
    expect(fireEvent.click(within(section()).getByRole("link", { name: "Sign in again" }))).toBe(
      true,
    );
  });

  it("a grant whose connector is gone can be removed, even with nothing connected", async () => {
    mockApi({ "GET /api/connectors": { connections: [] } });
    const onChange = vi.fn();
    render(
      <ConnectorsChecklist
        value={[
          { id: "gone", access: "read" },
          { id: "gone-too", access: "write" },
        ]}
        onChange={onChange}
      />,
    );
    expect(
      await within(section()).findByText("2 connectors this agent had are no longer connected."),
    ).toBeInTheDocument();
    fireEvent.click(within(section()).getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("a draft holding a grant that points at nothing saves only the ones that exist", async () => {
    mockApi({ "GET /api/connectors": { connections: ALL } });
    const onChange = vi.fn();
    render(
      <ConnectorsChecklist
        value={[
          { id: "gone", access: "write" },
          { id: "c1", access: "read" },
        ]}
        onChange={onChange}
      />,
    );
    // The heading counts what is ticked, not the grant that points at nothing.
    await box("Supabase");
    expect(within(section()).getByRole("heading", { name: /^Connectors\s*1/ })).toBeTruthy();
    expect(
      within(section()).getByText("1 connector this agent had is no longer connected."),
    ).toBeInTheDocument();
    fireEvent.click(await box("Notion"));
    expect(onChange).toHaveBeenLastCalledWith([
      { id: "c1", access: "read" },
      { id: "c2", access: "read" },
    ]);
  });

  it("a failed load leaves the draft as it was, and Try again loads the list", async () => {
    let fail = true;
    mockApi({
      "GET /api/connectors": () =>
        fail
          ? new Response(JSON.stringify({ detail: "boom" }), { status: 500 })
          : { connections: ALL },
    });
    const onChange = vi.fn();
    render(<ConnectorsChecklist value={[{ id: "c1", access: "read" }]} onChange={onChange} />);
    expect(await within(section()).findByText("Couldn’t load your connectors.")).toBeTruthy();
    // Nothing to tick, so nothing can be written; the grant still counts, and isn't called gone.
    expect(within(section()).queryByRole("checkbox")).toBeNull();
    expect(within(section()).getByRole("heading", { name: /^Connectors\s*1/ })).toBeTruthy();
    expect(within(section()).queryByText(/no longer connected/)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    fail = false;
    fireEvent.click(within(section()).getByRole("button", { name: "Try again" }));
    expect((await box("Supabase")).checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Try again works in the run view's read-only fieldset, by key too, and keeps focus in the section", async () => {
    let fail = true;
    mockApi({
      "GET /api/connectors": () =>
        fail
          ? new Response(JSON.stringify({ detail: "boom" }), { status: 500 })
          : { connections: ALL },
    });
    render(
      <fieldset disabled>
        <ConnectorsChecklist value={[{ id: "c1", access: "read" }]} onChange={() => {}} />
      </fieldset>,
    );
    // A `<button>` in a disabled fieldset is dead; this one must not be.
    const retry = await within(section()).findByRole("button", { name: "Try again" });
    expect(retry).toBeEnabled();
    expect(retry).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(retry, { key: "Enter" });
    expect(within(section()).getByRole("heading", { name: /^Connectors/ })).toHaveFocus();
    // Still failing: the error comes back, and a click retries as well.
    fail = false;
    fireEvent.click(await within(section()).findByRole("button", { name: "Try again" }));
    expect((await box("Supabase")).checked).toBe(true);
  });

  it("with nothing connected it points to Connectors", async () => {
    mockApi({ "GET /api/connectors": { connections: [] } });
    render(<ConnectorsChecklist value={[]} onChange={() => {}} />);
    expect(await within(section()).findByText(/^You haven’t connected an app yet\./)).toBeTruthy();
    expect(within(section()).getByRole("link", { name: "Open Connectors" })).toHaveAttribute(
      "href",
      "#/toolkit/connectors",
    );
  });

  it("an agent on a Claude plan can't tick any, and is told why", async () => {
    mockApi({ "GET /api/connectors": { connections: ALL } });
    render(
      <ConnectorsChecklist
        value={[{ id: "c1", access: "read" }]}
        onChange={() => {}}
        agentName="Reviewer"
        plan="Claude"
      />,
    );
    expect((await box("Supabase")).disabled).toBe(true);
    expect((await box("Linear")).disabled).toBe(true);
    expect(section()).toHaveTextContent(
      "Reviewer runs on your Claude plan in Tvashtr Desktop. Connectors and tools don’t reach plan runs yet. Give it an API-key model in Setup to use them.",
    );
    expect(section()).not.toHaveTextContent("During a run it can call");
    // The amber warning notice with its triangle, as the canvas draws it.
    expect(callout()).toHaveClass("nd-conn__callout--warn");
    expect(callout().querySelector(".lucide-triangle-alert")).not.toBeNull();
  });
});
