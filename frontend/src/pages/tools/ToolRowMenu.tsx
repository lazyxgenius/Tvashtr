/**
 * A tool row's ⋯ (TkF-ToolMenu-1, TOOL-48): a 240px menu — Edit connection (the tool's page),
 * Duplicate, Turn on for agents…, and Remove from Toolkit. The page runs each action; items that
 * open a dialog park focus on the ⋯ first, so the dialog hands it back there when it closes.
 */
import { Check, Layers, MoreHorizontal, Pencil, Trash } from "lucide-react";
import { useRef } from "react";

import { IconButton, Menu } from "../../design-system/components";

const icon = (Glyph: typeof Check) => <Glyph size={15} strokeWidth={1.6} aria-hidden />;

export function ToolRowMenu({
  name,
  onEdit,
  onDuplicate,
  onTurnOn,
  onRemove,
}: {
  name: string;
  onEdit: () => void;
  onDuplicate: () => void;
  onTurnOn: () => void;
  onRemove: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = `More actions for ${name}`;
  const then = (fn: () => void) => () => {
    triggerRef.current?.focus();
    fn();
  };

  return (
    <span className="tk-rowmenu">
      <Menu
        label={label}
        width={252}
        items={[
          { key: "edit", label: "Edit connection", icon: icon(Pencil), onSelect: onEdit },
          { key: "duplicate", label: "Duplicate", icon: icon(Layers), onSelect: then(onDuplicate) },
          {
            key: "turn-on",
            label: "Turn on for agents…",
            icon: icon(Check),
            onSelect: then(onTurnOn),
          },
          "separator",
          {
            key: "remove",
            label: "Remove from Toolkit",
            icon: icon(Trash),
            danger: true,
            onSelect: then(onRemove),
          },
        ]}
        trigger={(props) => (
          <IconButton ref={triggerRef} size="sm" aria-label={label} {...props}>
            <MoreHorizontal size={15} strokeWidth={1.6} aria-hidden />
          </IconButton>
        )}
      />
    </span>
  );
}
