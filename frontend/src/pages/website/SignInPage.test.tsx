import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Config } from "../../lib/api";
import { SIGNIN_HELP_URL } from "../../lib/desktopDownload";
import { HOSTED_CONFIG, stubFetch } from "../desktop/desktopTestUtils";
import { SignInPage } from "./SignInPage";

const HOSTED = HOSTED_CONFIG as unknown as Config;
const SELF_HOSTED = { ...HOSTED_CONFIG, hosted_mode: false } as unknown as Config;
const USER = { id: "u1", email: "ada@studio.dev" };

beforeEach(() => {
  window.history.replaceState(null, "", "/#/signin");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The GitHub door's form (a plain GET to the server's sign-in start, WEB-27). */
function startForm(button: HTMLElement): HTMLFormElement {
  const form = button.closest("form");
  if (!form) throw new Error("no form");
  expect(form.getAttribute("method")).toBe("get");
  expect(form.getAttribute("action")).toBe("/api/auth/github/start");
  return form;
}

describe("hosted: Continue with GitHub (WEB-27)", () => {
  it("is a GET to /api/auth/github/start carrying next, loading until the page unloads", () => {
    render(<SignInPage next="/teams/t1" config={HOSTED} onAuthed={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Sign in to Tvashtr" })).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Continue with GitHub" });
    const form = startForm(button);
    expect(new FormData(form).get("next")).toBe("/teams/t1");
    fireEvent.submit(form);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    // Back from GitHub through the bfcache: the button works again.
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("sends no next when there is none; no email form; the Mac app line is honest", () => {
    render(<SignInPage config={HOSTED} onAuthed={vi.fn()} />);
    const form = startForm(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect([...new FormData(form).keys()]).toEqual([]);
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByText("New here? Signing in creates your account.")).toBeInTheDocument();
    expect(
      screen.getByText("Using the Mac app? Sign in from the app with the same GitHub account."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to the website" })).toHaveAttribute(
      "href",
      "#/welcome",
    );
  });

  it("shows no door until /api/config has answered", () => {
    render(<SignInPage config={null} onAuthed={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "← Back to the website" })).toBeInTheDocument();
  });
});

describe("the error variants (WEB-30)", () => {
  it.each([
    ["cancelled", "GitHub said the request was cancelled. Nothing was changed. You can try again."],
    ["failed", "GitHub didn’t complete the sign-in. Nothing was changed. You can try again."],
    [
      "expired",
      "That sign-in took too long or was started in another tab. Nothing was changed. You can try again.",
    ],
  ] as const)("%s says what happened and Try again restarts with the same next", (error, copy) => {
    render(<SignInPage error={error} next="/domains" config={HOSTED} onAuthed={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Sign-in didn’t finish" })).toBeInTheDocument();
    expect(screen.getByText(copy)).toBeInTheDocument();
    const form = startForm(screen.getByRole("button", { name: "Try again" }));
    expect(new FormData(form).get("next")).toBe("/domains");
    const help = screen.getByRole("link", { name: "read the sign-in help" });
    expect(help).toHaveAttribute("href", SIGNIN_HELP_URL);
    expect(help).toHaveAttribute("target", "_blank");
    expect(help).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText(/pop-ups/)).toBeNull();
  });

  it("self-hosted never met GitHub: its own copy, and Try again shows the form", () => {
    render(<SignInPage error="failed" next="/domains" config={SELF_HOSTED} onAuthed={vi.fn()} />);
    expect(
      screen.getByText("The sign-in didn’t complete. Nothing was changed. You can try again."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(window.location.hash).toBe("#/signin?next=%2Fdomains");
  });
});

describe("self-hosted: email and password (WEB-28)", () => {
  function fill(email: string, password: string) {
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  }

  it("signs in straight to #/signin/done — no extra steps", async () => {
    const fetchMock = stubFetch({ "POST /api/auth/login": { body: USER } });
    const onAuthed = vi.fn();
    render(<SignInPage next="/domains" config={SELF_HOSTED} onAuthed={onAuthed} />);
    expect(screen.queryByRole("button", { name: "Continue with GitHub" })).toBeNull();
    fill("ada@studio.dev", "a-good-password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(USER));
    expect(window.location.hash).toBe("#/signin/done?next=%2Fdomains");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({
      email: "ada@studio.dev",
      password: "a-good-password",
    });
  });

  it("Create an account switches the button and registers", async () => {
    const fetchMock = stubFetch({ "POST /api/auth/register": { body: USER } });
    const onAuthed = vi.fn();
    render(<SignInPage config={SELF_HOSTED} onAuthed={onAuthed} />);
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByText(/Already have an account\?/)).toBeInTheDocument();
    fill("ada@studio.dev", "a-good-password");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(USER));
    expect(fetchMock.mock.calls[0][0] as string).toBe("/api/auth/register");
    expect(window.location.hash).toBe("#/signin/done");
  });

  it.each([
    [401, "Incorrect email or password."],
    [409, "That email already has an account — try logging in."],
    [422, "Enter a valid email and a password of at least 8 characters."],
    [500, "Something went wrong. Is the backend running?"],
  ])("a %i answer says why", async (status, copy) => {
    stubFetch({ "POST /api/auth/login": { status } });
    const onAuthed = vi.fn();
    render(<SignInPage config={SELF_HOSTED} onAuthed={onAuthed} />);
    fill("ada@studio.dev", "short");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    expect(onAuthed).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/signin");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});
