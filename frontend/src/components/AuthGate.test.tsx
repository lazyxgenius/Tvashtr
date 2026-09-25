import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "./AuthGate";

// Mock the heavy authed surfaces so this test targets AuthGate's ROUTING (which screen renders), not
// the canvas/dashboard data + poll surfaces. The landing + login screens stay real (presentational).
vi.mock("../pages/Workspace", () => ({ Workspace: () => <div>DASHBOARD STUB</div> }));

function stubMe(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthGate", () => {
  it("shows the LANDING page (not the canvas, not login) when unauthenticated (401)", async () => {
    stubMe(401);
    render(<AuthGate />);
    // The logged-out default is the landing page — its CTA, not the login form or the canvas.
    expect(await screen.findByRole("button", { name: "Start building" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByText("APP STUB")).toBeNull();
    expect(screen.queryByText("DASHBOARD STUB")).toBeNull();
  });

  it("routes a landing CTA to the login/register screen", async () => {
    stubMe(401);
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole("button", { name: "Start building" }));
    expect(await screen.findByLabelText("Email")).toBeInTheDocument(); // the login screen
  });

  it("renders the DASHBOARD (not the canvas) when authenticated", async () => {
    stubMe(200, { id: "u1", email: "operator@tvashtr.local" });
    render(<AuthGate />);
    expect(await screen.findByText("DASHBOARD STUB")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByText("APP STUB")).toBeNull();
  });
});
