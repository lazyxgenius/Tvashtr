import type { ReactNode } from "react";

import { ConfirmDialog } from "../design-system/components";

/** The Stop confirmation (HmF-Stop): Home's Running now and the run view's pinned callout. */
export function StopRunDialog({
  open,
  teamName,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  teamName: string | null | undefined;
  busy?: boolean;
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title="Stop this run?"
      confirmLabel="Stop run"
      cancelLabel="Keep running"
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {teamName ?? "This team"} stops now and the run is marked Stopped. Anything already pushed
      stays on its branch. You can resume it later from the step it stopped at.
    </ConfirmDialog>
  );
}
