import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LoginScreen } from "./LoginScreen";

// Interaction uses fireEvent (the repo convention for these — deterministic, no user-event/timer
// coupling). The component calls the real api.ts login/register, so we stub fetch and assert the
// path it hits + the error mapping.

function jsonResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function stubFetch(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(status, body)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function urlOf(call: unknown[]): string {
  const input = call[0] as RequestInfo | URL;
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoginScreen", () => {
  it("renders email + password + the login/register toggle (login default)", () => {
    render(<LoginScreen onAuthed={vi.fn()} />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Register" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("login submit calls POST /api/auth/login and reports the authed user", async () => {
    const user = { id: "u1", email: "a@b.co" };
    const fetchMock = stubFetch(200, user);
    const onAuthed = vi.fn();
    render(<LoginScreen onAuthed={onAuthed} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(user));
    const call = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    expect(urlOf(call)).toBe("/api/auth/login");
    expect(call[1]?.method).toBe("POST");
  });

  it("register submit calls POST /api/auth/register", async () => {
    const user = { id: "u2", email: "new@b.co" };
    const fetchMock = stubFetch(200, user);
    const onAuthed = vi.fn();
    render(<LoginScreen onAuthed={onAuthed} />);

    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(user));
    expect(urlOf(fetchMock.mock.calls[0])).toBe("/api/auth/register");
  });

  it("shows the 401 error inline and does not call onAuthed", async () => {
    stubFetch(401);
    const onAuthed = vi.fn();
    render(<LoginScreen onAuthed={onAuthed} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrongpassword" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(onAuthed).not.toHaveBeenCalled();
  });

  it("shows the 409 error when the email is already taken (register)", async () => {
    stubFetch(409);
    render(<LoginScreen onAuthed={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "taken@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already has an account");
  });
});
