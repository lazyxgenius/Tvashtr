/**
 * A domain's ⋯ menu (DM-13, OQ-28; DmF-Menu-1…4), on its card and in its page header: Open (card
 * only), Ask a question, Rename, Duplicate settings, Copy domain ID, a separator and Delete…
 * (danger). It owns the Rename and Delete dialogs and the duplicate / copy toasts; the caller
 * reloads on `onChanged` and leaves (or drops the card) on `onDeleted`.
 */
import { useState } from "react";
import { ArrowRight, Copy, Ellipsis, Layers, MessageSquare, Pencil, Trash } from "lucide-react";

import { IconButton, Menu, type MenuEntry, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import { type DomainListItem, duplicateDomain } from "../../lib/api/domains";
import { navigate } from "../../lib/nav";
import { DeleteDomainDialog } from "./DeleteDomainDialog";
import { RenameDomainDialog } from "./RenameDomainDialog";

const ICON = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;

/** Put the raw UUID on the clipboard (DM-17). */
function copyDomainId(domainId: string, toast: ReturnType<typeof useToast>): void {
  const failed = () => toast({ message: "Couldn’t copy the domain ID.", tone: "error" });
  if (!navigator.clipboard) {
    failed();
    return;
  }
  navigator.clipboard
    .writeText(domainId)
    .then(() => toast({ message: "Domain ID copied." }))
    .catch(failed);
}

export function DomainMenu({
  domain,
  where,
  existingNames,
  onChanged,
  onDeleted,
}: {
  domain: DomainListItem;
  /** The card's menu opens the domain; the header's (on its page) starts at Ask a question. */
  where: "card" | "header";
  /** Every domain name on the account, for the rename clash check. */
  existingNames: string[];
  /** Renamed or duplicated: reload the list / page (and the nav). */
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const open = { page: "domains", domainId: domain.domain_id } as const;
  const label = `More actions for ${domain.name}`;

  const duplicate = () => {
    duplicateDomain(domain.domain_id)
      .then((copy) => {
        onChanged();
        toast({
          message: `Copied the settings to “${copy.name}”.`,
          action: {
            label: "Open",
            onClick: () => navigate({ page: "domains", domainId: copy.domain_id }),
          },
        });
      })
      .catch((e: unknown) =>
        toast({
          message:
            e instanceof ApiError && e.status < 500 && e.message
              ? e.message
              : "Couldn’t copy the settings — is the backend running?",
          tone: "error",
        }),
      );
  };

  const items: MenuEntry[] = [
    ...(where === "card"
      ? [
          {
            key: "open",
            label: "Open",
            icon: <ArrowRight {...ICON} />,
            onSelect: () => navigate(open),
          },
        ]
      : []),
    {
      key: "ask",
      label: "Ask a question",
      icon: <MessageSquare {...ICON} />,
      onSelect: () => navigate({ ...open, tab: "ask" }),
    },
    {
      key: "rename",
      label: "Rename",
      icon: <Pencil {...ICON} />,
      onSelect: () => setDialog("rename"),
    },
    {
      key: "duplicate",
      label: "Duplicate settings",
      icon: <Layers {...ICON} />,
      onSelect: duplicate,
    },
    {
      key: "copy",
      label: "Copy domain ID",
      icon: <Copy {...ICON} />,
      onSelect: () => copyDomainId(domain.domain_id, toast),
    },
    "separator",
    {
      key: "delete",
      label: "Delete…",
      icon: <Trash {...ICON} />,
      danger: true,
      onSelect: () => setDialog("delete"),
    },
  ];

  return (
    <>
      <Menu
        label={label}
        items={items}
        width={210}
        trigger={
          where === "header"
            ? (props) => (
                <IconButton size="sm" variant="outline" aria-label={label} {...props}>
                  <Ellipsis size={16} strokeWidth={1.6} aria-hidden />
                </IconButton>
              )
            : undefined
        }
      />
      {dialog === "rename" && (
        <RenameDomainDialog
          domain={domain}
          existingNames={existingNames}
          onClose={() => setDialog(null)}
          onRenamed={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
      {dialog === "delete" && (
        <DeleteDomainDialog
          domain={domain}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            toast({ message: `${domain.name} deleted` });
            onDeleted();
          }}
        />
      )}
    </>
  );
}
