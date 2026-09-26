/**
 * A stored secret's ⋯ (TkF-SecretMenu-1..2, SECRET-13/14): a 240px menu — Replace value, See tools
 * that use it, Copy ${NAME}, Delete secret — and the "Tools that use <NAME>" popover, both hanging
 * from the same ⋯. Replace and Delete are the page's dialogs; Copy is the page's clipboard write.
 */
import { KeyRound, Layers, MoreHorizontal, Server, Trash } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconButton, Menu, Popover } from "../../design-system/components";
import type { SecretRef } from "../../lib/api/tools";
import { refOf } from "./secretFormat";
import { ToolsUsingSecretList } from "./ToolsUsingSecretPopover";

const icon = (Glyph: typeof KeyRound) => <Glyph size={15} strokeWidth={1.6} aria-hidden />;

export function SecretRowMenu({
  name,
  usedBy,
  onReplace,
  onCopy,
  onDelete,
}: {
  name: string;
  usedBy: SecretRef[];
  onReplace: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const label = `More actions for ${name}`;

  // The popover is a small dialog: focus moves into it, and back to the ⋯ when it closes with
  // nothing else focused (Escape; an outside click keeps whatever was clicked).
  useEffect(() => {
    if (!toolsOpen) return;
    const trigger = triggerRef.current;
    const pop = popRef.current?.closest<HTMLElement>(".ds-popover");
    (pop?.querySelector<HTMLElement>("a, button") ?? pop)?.focus();
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body) trigger?.focus();
    };
  }, [toolsOpen]);

  // A menu item unmounts with the menu: park focus on the ⋯ first so a dialog opened from it
  // returns there when it closes.
  const then = (fn: () => void) => () => {
    triggerRef.current?.focus();
    fn();
  };

  return (
    <span className="sc-rowmenu">
      <Popover
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        align="end"
        width={326}
        label={`Tools that use ${name}`}
        className="sc-uses"
        trigger={
          <Menu
            label={label}
            width={252}
            items={[
              {
                key: "replace",
                label: "Replace value",
                icon: icon(KeyRound),
                onSelect: then(onReplace),
              },
              {
                key: "tools",
                label: "See tools that use it",
                icon: icon(Server),
                onSelect: () => setToolsOpen(true),
              },
              {
                key: "copy",
                label: `Copy ${refOf(name)}`,
                icon: icon(Layers),
                onSelect: then(onCopy),
              },
              "separator",
              {
                key: "delete",
                label: "Delete secret",
                icon: icon(Trash),
                danger: true,
                onSelect: then(onDelete),
              },
            ]}
            trigger={(props) => (
              <IconButton
                ref={triggerRef}
                size="sm"
                aria-label={label}
                {...props}
                onClick={() => {
                  setToolsOpen(false);
                  props.onClick();
                }}
              >
                <MoreHorizontal size={15} strokeWidth={1.6} aria-hidden />
              </IconButton>
            )}
          />
        }
      >
        <div ref={popRef} className="sc-uses__body">
          <ToolsUsingSecretList usedBy={usedBy} />
        </div>
      </Popover>
    </span>
  );
}
