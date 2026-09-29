import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubFetch } from "../desktop/desktopTestUtils";
import { SignInDone } from "./SignInDone";

const ME = {
  id: "u1",
  email: "lazyxgenius@users.noreply.github.com",
  github_login: "lazyxgenius",
  display_name: "Lazyx",
};
const READS = {
  "GET /api/teams": { body: { teams: [] } },
  "GET /api/inbox": { body: { count: 0, items: [] } },
};

beforeEach(() => {
  window.history.replaceState(null, "", "/#/signin/done");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const steps = () => within(screen.getByText("Opening Home…").parentElement as HTMLElement);

describe("#/signin/done (WEB-29)", () => {
  it("ticks only what really happened while the session check runs", () => {
    stubFetch(READS);
    render(<SignInDone user={undefined} hosted />);
    expect(screen.getByRole("heading", { name: "Signing you in…" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "GitHub sent you back. Setting up your workspace; this takes a few seconds.",
      ),
    ).toBeInTheDocument();
    expect(steps().getByText("Checking your sign-in…")).toBeInTheDocument();
    expect(steps().getByText("Getting your account ready…")).toBeInTheDocument();
    expect(steps().queryByText("Account ready")).toBeNull();
  });

  it("signed in + Home's reads back → shown at least 400 ms, then Home (replace)", async () => {
    const fetchMock = stubFetch(READS);
    const started = Date.now();
    render(<SignInDone user={ME} hosted />);
    expect(steps().getByText("Signed in as lazyxgenius")).toBeInTheDocument();
    expect(await steps().findByText("Account ready")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/signin/done");
    const paths = fetchMock.mock.calls.map(([u]) => u as string);
    expect(paths).toEqual(expect.arrayContaining(["/api/teams", "/api/inbox"]));
    await waitFor(() => expect(window.location.hash).toBe("#/home"), { timeout: 2000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    expect(window.history.length).toBe(1);
  });

  it("goes on to next, and a failing read still opens it (Home says its own errors)", async () => {
    stubFetch({ "GET /api/teams": { status: 500 }, "GET /api/inbox": "network" });
    render(<SignInDone user={ME} next="/teams/t1?node=pm" hosted />);
    expect(screen.getByText("Taking you back…")).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/teams/t1?node=pm"), {
      timeout: 2000,
    });
  });

  it("a 401 from /api/auth/me is a failed sign-in, keeping next", async () => {
    stubFetch(READS);
    render(<SignInDone user={null} next="/domains" hosted />);
    await waitFor(() => expect(window.location.hash).toBe("#/signin?error=failed&next=%2Fdomains"));
  });

  it("self-hosted never went to GitHub; an account with no GitHub login shows its email", () => {
    stubFetch(READS);
    render(<SignInDone user={{ id: "u2", email: "ada@studio.dev" }} hosted={false} />);
    expect(
      screen.getByText("Setting up your workspace; this takes a few seconds."),
    ).toBeInTheDocument();
    expect(screen.getByText("Signed in as ada@studio.dev")).toBeInTheDocument();
  });

  // Last: getInbox shares its in-flight request, and this one never answers.
  it("waits for the account reads", async () => {
    stubFetch({ ...READS, "GET /api/inbox": "pending" });
    render(<SignInDone user={ME} hosted />);
    await act(() => new Promise((r) => setTimeout(r, 500)));
    expect(window.location.hash).toBe("#/signin/done");
    expect(screen.getByText("Getting your account ready…")).toBeInTheDocument();
  });
});
