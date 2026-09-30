/**
 * A connection row's ⋯ (CnF-Disc-1): Open, Change project (only where the connector has projects)
 * and Disconnect. Items that open a sheet or a dialog park focus on the ⋯ first, so it comes back
 * there when that closes.
 */
import { ChevronRight, MoreHorizontal, RefreshCw, Unplug } from "lucide-react";
import { useRef } from "react";

import { IconButton, Menu, type MenuEntry } from "../../design-system/components";

const icon = (Glyph: typeof ChevronRight) => <Glyph size={14} strokeWidth={1.6} aria-hidden />;

export function ConnectorRowMenu({
  name,
  size = "sm",
  onOpen,
  onChangeProject,
  onDisconnect,
}: {
  name: string;
  size?: "sm" | "md";
  /** Absent on the connector's own page. */
  onOpen?: () => void;
  /** Absent when the connector has no project to pick. */
  onChangeProject?: () => void;
  onDisconnect?: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = `More actions for ${name}`;
  const then = (fn: () => void) => () => {
    triggerRef.current?.focus();
    fn();
  };
  const items: MenuEntry[] = [];
  if (onOpen)
    items.push({ key: "open", label: "Open", icon: icon(ChevronRight), onSelect: onOpen });
  if (onChangeProject) {
    items.push({
      key: "project",
      label: "Change project",
      icon: icon(RefreshCw),
      onSelect: then(onChangeProject),
    });
  }
  if (onDisconnect) {
    if (items.length > 0) items.push("separator");
    items.push({
      key: "disconnect",
      label: "Disconnect",
      icon: icon(Unplug),
      danger: true,
      onSelect: then(onDisconnect),
    });
  }

  return (
    <span className="tk-rowmenu">
      <Menu
        label={label}
        width={230}
        items={items}
        trigger={(props) => (
          <IconButton ref={triggerRef} size={size} aria-label={label} {...props}>
            <MoreHorizontal size={15} strokeWidth={1.6} aria-hidden />
          </IconButton>
        )}
      />
    </span>
  );
}
