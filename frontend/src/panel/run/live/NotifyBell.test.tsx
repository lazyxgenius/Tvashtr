/** R10 (Prob-NotifyAsk): the run bar's bell asks once, then saves the three choices. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetNotifyPrefsForTests } from "../../../lib/runNotifier";
import { type Call, mockApi, resetHomeState } from "../../../pages/home/homeTestUtils";
import { NotifyBell } from "./NotifyBell";

const requestPermission = vi.fn(() => Promise.resolve("granted"));

const DEFAULTS = {
  get_started_hidden: false,
  notify_asked: false,
  notify_needs_you: true,
  notify_stalls_fails: true,
  notify_finishes: true,
};

function serve(prefs: Record<string, boolean>): Call[] {
  return mockApi({
    "GET /api/account/preferences": prefs,
    "PATCH /api/account/preferences": (_u: URL, body: unknown) => ({
      ...prefs,
      ...(body as object),
    }),
  });
}

const patches = (calls: Call[]) =>
  calls.filter((c) => c.method === "PATCH" && c.path === "/api/account/preferences");

const box = (name: RegExp) => screen.getByRole("checkbox", { name });

beforeEach(() => {
  resetHomeState();
  __resetNotifyPrefsForTests();
  requestPermission.mockReset();
  requestPermission.mockImplementation(() => Promise.resolve("granted"));
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetHomeState();
});

describe("NotifyBell", () => {
  it("asks once on its own, all three choices on, and Turn on saves them", async () => {
    const calls = serve(DEFAULTS);
    render(<NotifyBell />);
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    expect(
      within(dialog).getByText("Get a notification when a run needs you?"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Even when Tvashtr is in the background. You can change this later in Settings.",
      ),
    ).toBeInTheDocument();
    expect(box(/When a run needs you.*An approval or a question/)).toBeChecked();
    expect(box(/When a run stalls or fails/)).toBeChecked();
    expect(box(/When a run finishes.*With its pull request/)).toBeChecked();

    fireEvent.click(box(/When a run finishes/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn on" }));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(patches(calls)).toHaveLength(1));
    expect(patches(calls)[0].body).toEqual({
      notify_asked: true,
      notify_needs_you: true,
      notify_stalls_fails: true,
      notify_finishes: false,
    });
    expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
  });

  it("Not now records the answer with every choice off, without asking the OS", async () => {
    const calls = serve(DEFAULTS);
    render(<NotifyBell />);
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(patches(calls)).toHaveLength(1));
    expect(patches(calls)[0].body).toEqual({
      notify_asked: true,
      notify_needs_you: false,
      notify_stalls_fails: false,
      notify_finishes: false,
    });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
  });

  it("asks on its own only once a session", async () => {
    serve(DEFAULTS);
    const first = render(<NotifyBell />);
    await screen.findByRole("dialog", { name: "Notifications" });
    first.unmount();
    render(<NotifyBell />);
    await screen.findByRole("button", { name: "Notifications" });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
  });

  it("once asked, stays shut until the bell is clicked, then shows the saved choices", async () => {
    serve({ ...DEFAULTS, notify_asked: true, notify_stalls_fails: false });
    render(<NotifyBell />);
    const bell = await screen.findByRole("button", { name: "Notifications" });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
    fireEvent.click(bell);
    await screen.findByRole("dialog", { name: "Notifications" });
    expect(box(/When a run needs you/)).toBeChecked();
    expect(box(/When a run stalls or fails/)).not.toBeChecked();
    expect(box(/When a run finishes/)).toBeChecked();
  });

  it.each(["denied", "default"])(
    "Turn on with the browser's answer %s saves every choice off, the dialog's words unchanged",
    async (answer) => {
      requestPermission.mockImplementation(() => Promise.resolve(answer));
      const calls = serve(DEFAULTS);
      render(<NotifyBell />);
      const dialog = await screen.findByRole("dialog", { name: "Notifications" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Turn on" }));
      expect(requestPermission).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(patches(calls)).toHaveLength(1));
      expect(patches(calls)[0].body).toEqual({
        notify_asked: true,
        notify_needs_you: false,
        notify_stalls_fails: false,
        notify_finishes: false,
      });
      // Asked again from the bell: the same words, the choices as saved.
      fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
      const again = await screen.findByRole("dialog", { name: "Notifications" });
      expect(
        within(again).getByText("Get a notification when a run needs you?"),
      ).toBeInTheDocument();
      expect(box(/When a run needs you/)).not.toBeChecked();
    },
  );

  it("Turn on when the browser already blocks notifications saves every choice off", async () => {
    vi.stubGlobal("Notification", { permission: "denied", requestPermission });
    const calls = serve(DEFAULTS);
    render(<NotifyBell />);
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(patches(calls)).toHaveLength(1));
    expect(patches(calls)[0].body).toMatchObject({
      notify_asked: true,
      notify_needs_you: false,
      notify_stalls_fails: false,
      notify_finishes: false,
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
