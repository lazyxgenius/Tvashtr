import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthWizard } from "./AuthWizard";

// Interaction uses fireEvent (the repo convention — deterministic, no user-event/timer coupling).
// The wizard calls the real api.ts login/register, so we stub fetch and assert the path it hits, the
// error mapping, and the flow (account FIRST, then — sign-up only — the two throwaway questions).
// Ports the deleted LoginScreen.test.tsx behaviors + adds the wizard-specific state-machine checks.

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

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthWizard", () => {
  it("renders the account step FIRST — Email + Password + the mode toggle, sign-in default", () => {
    render(<AuthWizard onAuthed={vi.fn()} />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    // sign-in default: the submit reads "Sign in" and the toggle offers to create an account
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create an account/i })).toBeInTheDocument();
    // no progress bar / onboarding questions on the sign-in path
    expect(screen.queryByText(/Step \d of 3/)).toBeNull();
  });

  it("HOSTED posture shows ONLY 'Continue with GitHub' (no email/password)", () => {
    const url = "https://github.com/apps/tvashtr/installations/new";
    render(<AuthWizard onAuthed={vi.fn()} hosted githubInstallUrl={url} />);
    const link = screen.getByRole("link", { name: /Continue with GitHub/i });
    expect(link).toHaveAttribute("href", url); // links to the App's install URL
    // the email/password door is entirely absent in hosted mode
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("self-hosted (hosted=false, the default) renders the email/password form UNCHANGED", () => {
    render(<AuthWizard onAuthed={vi.fn()} />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    // and no GitHub door leaks into the self-hosted wizard
    expect(screen.queryByRole("link", { name: /Continue with GitHub/i })).toBeNull();
  });

  it("initialMode='register' opens in sign-up — Create-account submit + the 3-step progress bar", () => {
    render(<AuthWizard onAuthed={vi.fn()} initialMode="register" />);
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("sign-in: submit → POST /api/auth/login → 'Enter Tvashtr' → onAuthed(user)", async () => {
    const user = { id: "u1", email: "a@b.co" };
    const fetchMock = stubFetch(200, user);
    const onAuthed = vi.fn();
    render(<AuthWizard onAuthed={onAuthed} />);

    fill("a@b.co", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // account step holds the identity and advances to success — it does NOT call onAuthed yet.
    const enter = await screen.findByRole("button", { name: /Enter Tvashtr/ });
    expect(onAuthed).not.toHaveBeenCalled();
    const call = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    expect(urlOf(call)).toBe("/api/auth/login");
    expect(call[1]?.method).toBe("POST");

    fireEvent.click(enter);
    expect(onAuthed).toHaveBeenCalledWith(user);
  });

  it("sign-up: submit → POST /api/auth/register → advances to the role question, no onAuthed yet", async () => {
    const user = { id: "u2", email: "new@b.co" };
    const fetchMock = stubFetch(200, user);
    const onAuthed = vi.fn();
    render(<AuthWizard onAuthed={onAuthed} initialMode="register" />);

    fill("new@b.co", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("What's your role?")).toBeInTheDocument();
    expect(onAuthed).not.toHaveBeenCalled();
    expect(urlOf(fetchMock.mock.calls[0])).toBe("/api/auth/register");
  });

  it("full sign-up happy path: register → role → building → Enter Tvashtr → onAuthed once", async () => {
    const user = { id: "u3", email: "new@b.co" };
    stubFetch(200, user);
    const onAuthed = vi.fn();
    render(<AuthWizard onAuthed={onAuthed} initialMode="register" />);

    fill("new@b.co", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    // role step
    await screen.findByText("What's your role?");
    fireEvent.click(screen.getByRole("button", { name: /Engineer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // building step
    expect(screen.getByText("What are you building?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /A fresh idea/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // success
    fireEvent.click(await screen.findByRole("button", { name: /Enter Tvashtr/ }));
    expect(onAuthed).toHaveBeenCalledTimes(1);
    expect(onAuthed).toHaveBeenCalledWith(user);
  });

  it("Continue is disabled until a card is picked — on BOTH the role and building steps", async () => {
    stubFetch(200, { id: "u4", email: "new@b.co" });
    render(<AuthWizard onAuthed={vi.fn()} initialMode="register" />);

    fill("new@b.co", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    // role step: Continue disabled until a role is chosen
    const roleContinue = await screen.findByRole("button", { name: /Continue/ });
    expect(roleContinue).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Founder/ }));
    expect(screen.getByRole("button", { name: /Continue/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // building step: Continue disabled again until a building option is chosen
    expect(screen.getByText("What are you building?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Against my repo/ }));
    expect(screen.getByRole("button", { name: /Continue/ })).toBeEnabled();
  });

  it("401 on sign-in → inline alert 'Incorrect email or password.' and onAuthed NOT called", async () => {
    stubFetch(401);
    const onAuthed = vi.fn();
    render(<AuthWizard onAuthed={onAuthed} />);

    fill("a@b.co", "wrongpassword");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(onAuthed).not.toHaveBeenCalled();
    // stayed on the account step — no success finish appeared
    expect(screen.queryByRole("button", { name: /Enter Tvashtr/ })).toBeNull();
  });

  it("409 on sign-up → inline alert 'already has an account'", async () => {
    stubFetch(409);
    render(<AuthWizard onAuthed={vi.fn()} initialMode="register" />);

    fill("taken@b.co", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already has an account");
    // did not advance to the questions
    expect(screen.queryByText("What's your role?")).toBeNull();
  });

  it("422 → the validation-mapping error", async () => {
    stubFetch(422);
    render(<AuthWizard onAuthed={vi.fn()} initialMode="register" />);

    fill("bad", "short");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a valid email and a password of at least 8 characters.",
    );
  });

  it("sign-in path does NOT render the role/building questions — account → success", async () => {
    stubFetch(200, { id: "u5", email: "a@b.co" });
    render(<AuthWizard onAuthed={vi.fn()} />);

    fill("a@b.co", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByRole("button", { name: /Enter Tvashtr/ });
    expect(screen.queryByText("What's your role?")).toBeNull();
    expect(screen.queryByText("What are you building?")).toBeNull();
    // and no progress bar on the sign-in success step
    expect(screen.queryByText(/Step \d of 3/)).toBeNull();
  });
});
