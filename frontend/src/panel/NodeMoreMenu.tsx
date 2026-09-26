import { FileText, Maximize2, MoreHorizontal, Pencil, Trash } from "lucide-react";

import { IconButton, Menu, type MenuEntry } from "../design-system/components";

const icon = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;

/**
 * The header's ⋯ menu (PANEL-23, Flow-More-1): Open in focus view, Rename, Open its documents and
 * Delete agent ("Its arrows are removed too"). The menu opens 240px wide under the header's
 * buttons, 20px in from the drawer's right edge (panel.css).
 */
export function NodeMoreMenu({
  onOpenFocus,
  onRename,
  onOpenDocs,
  onDelete,
}: {
  /** Omitted in the focus view (it is already open). */
  onOpenFocus?: () => void;
  onRename: () => void;
  onOpenDocs: () => void;
  onDelete: () => void;
}) {
  const items: MenuEntry[] = [
    ...(onOpenFocus
      ? [
          {
            key: "focus",
            label: "Open in focus view",
            icon: <Maximize2 {...icon} />,
            onSelect: onOpenFocus,
          },
        ]
      : []),
    { key: "rename", label: "Rename", icon: <Pencil {...icon} />, onSelect: onRename },
    {
      key: "docs",
      label: "Open its documents",
      icon: <FileText {...icon} />,
      onSelect: onOpenDocs,
    },
    "separator",
    {
      key: "delete",
      label: "Delete agent",
      description: "Its arrows are removed too",
      icon: <Trash {...icon} />,
      danger: true,
      onSelect: onDelete,
    },
  ];
  return (
    <Menu
      label="More actions"
      items={items}
      trigger={(props) => (
        <IconButton size="sm" aria-label="More actions" title="More actions" {...props}>
          <MoreHorizontal size={16} strokeWidth={1.7} />
        </IconButton>
      )}
    />
  );
}
