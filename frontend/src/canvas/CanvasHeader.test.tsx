import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CanvasHeader } from "./CanvasHeader";

afterEach(() => {
  delete document.documentElement.dataset.tvashtrDesktop;
});

describe("CanvasHeader (PANEL-1)", () => {
  it("shows the site's actual host on the website", () => {
    render(<CanvasHeader />);
    expect(screen.getByText("the living canvas")).toBeInTheDocument();
    expect(screen.getByTestId("env-chip")).toHaveTextContent(window.location.host);
  });

  it("shows 'Tvashtr Desktop' inside the app, and the account menu when signed in", () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    render(<CanvasHeader user={{ email: "lazyx@tvashtr.dev", display_name: "Lazyx" }} />);
    expect(screen.getByTestId("env-chip")).toHaveTextContent("Tvashtr Desktop");
    expect(screen.getByRole("button", { name: "Account" })).toHaveTextContent("L");
  });
});
