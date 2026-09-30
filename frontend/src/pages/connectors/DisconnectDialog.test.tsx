/**
 * "Disconnect <name>?" (CnF-Disc-2): names the agents that lose access, says what Tvashtr deletes
 * and how to revoke it on the provider's side.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionDetail } from "../../lib/api/connectors";
import { mockApi, renderWithProviders, resetToolkitStores } from "../tools/toolsTestUtils";
import { DisconnectDialog } from "./DisconnectDialog";
import { connection } from "./connectorsTestUtils";

const usage = (role_name: string, team_id = "t1", team_name = "Indicator sprint team") => ({
  node_id: `n-${role_name}`,
  role_name,
  title: null,
  team_id,
  team_name,
  access: "read" as const,
});
const HINT = "To remove Tvashtr on Supabase’s side too, revoke it in Supabase’s settings.";
const detail = (over: Partial<ConnectionDetail> = {}): ConnectionDetail => ({
  ...connection(),
  used_by_agents: [usage("engineer"), usage("reviewer")],
  recent_use: [],
  revoke_hint: HINT,
  ...over,
});

function show(props: Partial<Parameters<typeof DisconnectDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onDisconnected = vi.fn();
  renderWithProviders(
    <DisconnectDialog
      connection={connection()}
      onClose={onClose}
      onDisconnected={onDisconnected}
      {...props}
    />,
  );
  return { onClose, onDisconnected };
}

beforeEach(() => resetToolkitStores());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetToolkitStores();
});

describe("DisconnectDialog", () => {
  it("names the agents that lose access and how to revoke it at the provider", async () => {
    const calls = mockApi({
      "GET /api/connectors/c1": detail(),
      "DELETE /api/connectors/c1": { removed_from_agents: 2, revoked: true },
    });
    const { onDisconnected } = show();
    const dialog = await screen.findByRole("alertdialog", { name: "Disconnect Supabase?" });
    expect(dialog).toHaveTextContent(
      "Engineer and Reviewer in Indicator sprint team use it. They lose access now, and a run that’s going finishes without it. Tvashtr deletes its copy of your sign-in. To remove Tvashtr on Supabase’s side too, revoke it in Supabase’s settings.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(onDisconnected).toHaveBeenCalledOnce());
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/api/connectors/c1" });
  });

  it("uses the page’s own data without asking again", () => {
    const calls = mockApi({});
    show({ detail: detail({ used_by_agents: [usage("reviewer")] }) });
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Reviewer in Indicator sprint team uses it. It loses access now, and a run that’s going finishes without it.",
    );
    expect(calls).toEqual([]);
  });

  it("says when no agent uses it, and that a key is deleted", () => {
    mockApi({});
    show({
      detail: detail({ auth_kind: "api_key", used_by_agents: [], revoke_hint: null }),
    });
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "No agent uses it. Tvashtr deletes its copy of your key.",
    );
  });

  it("groups the agents by team", () => {
    mockApi({});
    show({
      detail: detail({
        used_by_agents: [usage("engineer"), usage("reviewer"), usage("writer", "t2", "Docs team")],
      }),
    });
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Engineer and Reviewer in Indicator sprint team, Writer in Docs team use it. They lose access now",
    );
  });

  it("falls back to the row’s counts when the agents can’t be loaded", async () => {
    mockApi({
      "GET /api/connectors/c1": new Response(JSON.stringify({ detail: "boom" }), { status: 500 }),
    });
    show();
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "2 agents in 1 team use it. They lose access now, and a run that’s going finishes without it. Tvashtr deletes its copy of your sign-in.",
    );
  });

  it("keeps the dialog open when the disconnect fails", async () => {
    mockApi({
      "DELETE /api/connectors/c1": new Response(JSON.stringify({ detail: "boom" }), {
        status: 500,
      }),
    });
    const { onDisconnected, onClose } = show({ detail: detail() });
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t disconnect Supabase. Try again.",
    );
    expect(onDisconnected).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
