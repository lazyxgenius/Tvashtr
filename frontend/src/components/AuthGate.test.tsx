import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AuthGate } from "./AuthGate";

// Mock the heavy <App/> so this test targets AuthGate's gating logic (which screen renders), not the
// whole canvas + its poll surface.
vi.mock("../App", () => ({ default: () => <div>APP STUB</div> }));

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
  it("renders the login screen when getMe resolves unauthenticated (401)", async () => {
    stubMe(401);
    render(<AuthGate />);
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByText("APP STUB")).toBeNull();
  });

  it("renders the app when getMe resolves an authenticated user", async () => {
    stubMe(200, { id: "u1", email: "operator@tvashtr.local" });
    render(<AuthGate />);
    expect(await screen.findByText("APP STUB")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });
});
