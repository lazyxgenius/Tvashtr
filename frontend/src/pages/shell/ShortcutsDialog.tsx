import { Button, Dialog } from "../../design-system/components";

const ROWS: [string, string][] = [
  ["Search and actions", "⌘K"],
  ["Start a run", "N"],
  ["New team", "T"],
  ["Show shortcuts", "?"],
  ["Close a menu or sheet", "Esc"],
];

/** Keyboard shortcuts (TEAMS-58, HmF-Account-2): 500px, one row per shortcut, [Done]. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      title="Keyboard shortcuts"
      onClose={onClose}
      closeButton={false}
      footer={
        <Button variant="primary" size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="ds-dialog__body">Work from the keyboard anywhere in the dashboard.</div>
      <div>
        {ROWS.map(([label, key]) => (
          <div key={label} className="sh-keys__row">
            <span>{label}</span>
            <kbd className="sh-keys__kbd">{key}</kbd>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
