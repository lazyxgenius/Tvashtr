import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LandingPage } from "./LandingPage";

describe("LandingPage", () => {
  it("shows the pitch + both CTAs and NO canvas/team surface", () => {
    render(<LandingPage onGetStarted={vi.fn()} />);
    expect(screen.getByText(/Compose your own team of AI agents/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try the canvas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create your own team" })).toBeInTheDocument();
    // The logged-out landing must NOT render the canvas marker or any "create team" form.
    expect(screen.queryByText("the living canvas")).toBeNull();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("routes 'Try the canvas' to login and 'Create your own team' to register", () => {
    const onGetStarted = vi.fn();
    render(<LandingPage onGetStarted={onGetStarted} />);
    fireEvent.click(screen.getByRole("button", { name: "Try the canvas" }));
    expect(onGetStarted).toHaveBeenLastCalledWith("login");
    fireEvent.click(screen.getByRole("button", { name: "Create your own team" }));
    expect(onGetStarted).toHaveBeenLastCalledWith("register");
  });
});
