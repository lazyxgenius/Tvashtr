import { Button } from "../../design-system/components";
import { DrawerConfirm } from "../DrawerConfirm";
import type { ContractUpdate } from "./routing";
import { replaceConfirmText, type TemplateApplication } from "./templates";

/** "Replace the instructions?" (PANEL-31, Flow-Templates-2). */
export function TemplateReplaceConfirm({
  title,
  fileAccess,
  onCancel,
  onReplace,
}: {
  /** The template's name ("Reviewer"). */
  title: string;
  fileAccess: TemplateApplication["fileAccess"];
  onCancel: () => void;
  onReplace: () => void;
}) {
  return (
    <DrawerConfirm
      title="Replace the instructions?"
      onCancel={onCancel}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onReplace}>
            Replace
          </Button>
        </>
      }
    >
      {replaceConfirmText(title, fileAccess)}
    </DrawerConfirm>
  );
}

/**
 * "Update the instructions?" (PANEL-36, Flow-Routing-2): the exact lines "Add lines" writes into the
 * instructions, as "+" rows (and "−" rows when it refreshes an older verdict block).
 */
export function RoutingUpdateConfirm({
  update,
  onCancel,
  onApply,
}: {
  update: ContractUpdate;
  onCancel: () => void;
  onApply: () => void;
}) {
  const replaces = update.removed.length > 0;
  return (
    <DrawerConfirm
      title="Update the instructions?"
      onCancel={onCancel}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onApply}>
            {replaces ? "Update lines" : "Add lines"}
          </Button>
        </>
      }
    >
      {replaces
        ? "This swaps the verdict-file lines for the ones your arrows need:"
        : "This adds the verdict-file lines your arrows need:"}
      <div className="nd-diff">
        {update.removed.map((line, i) => (
          <div key={`-${i}`} className="nd-diff__line nd-diff__line--del">
            − {line}
          </div>
        ))}
        {update.added.map((line, i) => (
          <div key={`+${i}`} className="nd-diff__line">
            + {line}
          </div>
        ))}
      </div>
    </DrawerConfirm>
  );
}
