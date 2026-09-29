import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { RadioCard, RadioCardGroup } from "./RadioCard";

const VALUES = ["a", "b", "c"] as const;

function Group({
  initial = null,
  indicator = false,
  onChange = () => {},
}: {
  initial?: string | null;
  indicator?: boolean;
  onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <RadioCardGroup
      label="Pick one"
      value={value}
      values={VALUES}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    >
      {VALUES.map((v) => (
        <RadioCard
          key={v}
          value={v}
          indicator={indicator}
          title={`Card ${v}`}
          description={`About ${v}`}
        >
          {v === "a" && <button type="button">Inside {v}</button>}
        </RadioCard>
      ))}
    </RadioCardGroup>
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("RadioCardGroup — one tab stop, arrow keys move the choice", () => {
  it("names each radio by its title, describes it by its text, and checks only the value", () => {
    render(<Group initial="b" />);
    expect(screen.getByRole("radiogroup", { name: "Pick one" })).toBeInTheDocument();
    expect(radio("Card b")).toHaveAttribute("aria-checked", "true");
    expect(radio("Card b")).toHaveAccessibleDescription("About b");
    expect(radio("Card a")).toHaveAttribute("aria-checked", "false");
  });

  it("makes only the checked card tabbable, or the first when none is checked", () => {
    const { unmount } = render(<Group initial="c" />);
    expect(radio("Card c")).toHaveAttribute("tabindex", "0");
    expect(radio("Card a")).toHaveAttribute("tabindex", "-1");
    unmount();
    render(<Group />);
    expect(radio("Card a")).toHaveAttribute("tabindex", "0");
    expect(radio("Card b")).toHaveAttribute("tabindex", "-1");
  });

  it("moves the choice and the focus with the arrow keys, wrapping at both ends", () => {
    const onChange = vi.fn();
    render(<Group initial="a" onChange={onChange} />);
    radio("Card a").focus();
    fireEvent.keyDown(radio("Card a"), { key: "ArrowDown" });
    expect(radio("Card b")).toHaveAttribute("aria-checked", "true");
    expect(radio("Card b")).toHaveFocus();
    fireEvent.keyDown(radio("Card b"), { key: "ArrowRight" });
    fireEvent.keyDown(radio("Card c"), { key: "ArrowDown" });
    expect(radio("Card a")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radio("Card a"), { key: "ArrowUp" });
    expect(radio("Card c")).toHaveFocus();
    expect(onChange.mock.calls.map((c) => c[0] as string)).toEqual(["b", "c", "a", "c"]);
  });

  it("selects the focused card with Space, and any card by a click", () => {
    render(<Group />);
    fireEvent.keyDown(radio("Card b"), { key: " " });
    expect(radio("Card b")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByText("About c"));
    expect(radio("Card c")).toHaveAttribute("aria-checked", "true");
  });

  it("with an indicator the circle is the radio and the card's buttons sit outside it", () => {
    const onChange = vi.fn();
    render(<Group initial="b" indicator onChange={onChange} />);
    const button = screen.getByRole("button", { name: "Inside a" });
    expect(radio("Card a")).not.toContainElement(button);
    // Keys typed on a button inside a card never move the choice.
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(radio("Card a")).toHaveAttribute("aria-checked", "true");
  });
});
