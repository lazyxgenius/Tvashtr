import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  Badge,
  Button,
  ConfirmDialog,
  Input,
  Menu,
  Sheet,
  Switch,
  Tabs,
  ToastProvider,
  useToast,
} from ".";

describe("Button", () => {
  it("carries the design-system variant and size classes", () => {
    render(
      <Button variant="secondary" size="sm">
        Open
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Open" });
    expect(b.className).toContain("ds-btn--secondary");
    expect(b.className).toContain("ds-btn--sm");
    expect(b).toHaveAttribute("type", "button");
  });

  it("is disabled and busy while loading", () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
  });
});

describe("Badge", () => {
  it("renders a dot when asked", () => {
    const { container } = render(
      <Badge variant="warning" dot>
        Awaiting you
      </Badge>,
    );
    expect(container.querySelector(".ds-badge__dot")).not.toBeNull();
    expect(screen.getByText("Awaiting you").className).toContain("ds-badge--warning");
  });
});

describe("Tabs", () => {
  it("selects on click and moves with the arrow keys", async () => {
    const onChange = vi.fn();
    function Harness() {
      const [v, setV] = useState("setup");
      return (
        <Tabs
          items={[
            { value: "setup", label: "Setup" },
            { value: "skills", label: "Skills & tools", count: 4 },
            { value: "memory", label: "Memory" },
          ]}
          value={v}
          onChange={(nv) => {
            setV(nv);
            onChange(nv);
          }}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Setup" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Skills & tools/ })).toHaveTextContent("4");
    await userEvent.click(screen.getByRole("tab", { name: "Memory" }));
    expect(onChange).toHaveBeenLastCalledWith("memory");
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("setup");
    expect(screen.getByRole("tab", { name: "Setup" })).toHaveFocus();
  });
});

describe("Switch", () => {
  it("reports the new checked state", async () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Images" onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole("switch", { name: "Images" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe("Input", () => {
  it("links its label and announces an error", () => {
    render(<Input label="Name" error="Give the team a name." />);
    const box = screen.getByLabelText("Name");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Give the team a name.");
  });
});

describe("Menu", () => {
  it("opens, runs the chosen action, and closes", async () => {
    const onRemove = vi.fn();
    render(
      <Menu
        label="More actions for github"
        items={[
          { key: "dup", label: "Duplicate", onSelect: vi.fn() },
          "separator",
          { key: "rm", label: "Remove from Toolkit", danger: true, onSelect: onRemove },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "More actions for github" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Remove from Toolkit" })).toHaveFocus();
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove from Toolkit" }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape", async () => {
    render(<Menu label="More" items={[{ key: "a", label: "A", onSelect: vi.fn() }]} />);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("ConfirmDialog", () => {
  it("shows the impact and confirms or cancels", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Remove github from Toolkit?"
        confirmLabel="Remove tool"
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        3 agents in 2 teams use it.
      </ConfirmDialog>,
    );
    const dlg = screen.getByRole("alertdialog", { name: "Remove github from Toolkit?" });
    expect(dlg).toHaveTextContent("3 agents in 2 teams use it.");
    await userEvent.click(screen.getByRole("button", { name: "Remove tool" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("Sheet", () => {
  it("renders title, body and footer and closes", async () => {
    const onClose = vi.fn();
    render(
      <Sheet
        open
        title="Add an API key"
        subtitle="For website runs"
        onClose={onClose}
        footer={<Button size="sm">Save key</Button>}
      >
        body
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Add an API key" })).toHaveTextContent(
      "For website runs",
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Toast", () => {
  it("shows a message with an Undo that runs once and dismisses", async () => {
    const undo = vi.fn();
    function Harness() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() =>
            toast({ message: "Removed pytest-review", action: { label: "Undo", onClick: undo } })
          }
        >
          go
        </button>
      );
    }
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByRole("status")).toHaveTextContent("Removed pytest-review");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Removed pytest-review")).toBeNull();
  });

  it("is a no-op outside a provider", () => {
    function Lone() {
      const toast = useToast();
      toast({ message: "x" });
      return null;
    }
    expect(() => render(<Lone />)).not.toThrow();
  });
});

describe("overlay stack", () => {
  it("Escape inside a sheet closes the open menu first, not the sheet", async () => {
    const onClose = vi.fn();
    render(
      <Sheet open title="Add a tool" onClose={onClose}>
        <Menu label="More" items={[{ key: "a", label: "A", onSelect: vi.fn() }]} />
      </Sheet>,
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
