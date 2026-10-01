/** A connection row's ⋯ menu, as CnF-Changes-4 draws it. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectorRowMenu } from "./ConnectorRowMenu";

afterEach(cleanup);

describe("ConnectorRowMenu", () => {
  it("is 242px wide, so its rows are 230px like the board's (5px padding, 1px border)", () => {
    render(
      <ConnectorRowMenu
        name="Supabase"
        onOpen={vi.fn()}
        onChangeProject={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions for Supabase" }));
    expect(screen.getByRole("menu")).toHaveStyle({ width: "242px" });
  });
});
