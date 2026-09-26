/**
 * "Disconnect Claude?" (ENG-42/43, EnF-ClaudeDisconnect-1): who the disconnect affects, then
 * Cancel / Disconnect. Disconnecting sticks across relaunches (bridge v5, B1); the toast offers
 * "Add anthropic key" when no key takes over.
 */
import { useState } from "react";

import { ConfirmDialog, useToast } from "../../design-system/components";
import { toSubscriptionStatus } from "../../lib/api/engines";
import type { SubscriptionProviderId } from "../../lib/engines";
import { enginesBridge } from "./engineBridge";
import { useEngines } from "./enginesData";
import { disconnectCopy, disconnectFailed } from "./subscriptionModel";

export function DisconnectDialog({
  sub,
  onClose,
  onAddKey,
}: {
  sub: SubscriptionProviderId | null;
  onClose: () => void;
  onAddKey: (provider: string) => void;
}) {
  const engines = useEngines();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = sub ? disconnectCopy(engines.inputs, sub) : null;

  // While the bridge disconnects, Escape and the scrim do nothing (Cancel is disabled too): the
  // dialog stays up to show the result.
  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    if (!sub || !copy) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await enginesBridge()?.disconnect?.(sub);
      const next = toSubscriptionStatus(answer);
      if (!next) throw new Error("no status");
      engines.setSubscription(next);
      setBusy(false);
      onClose();
      const provider = copy.addKeyProvider;
      toast({
        message: copy.toast,
        action: provider
          ? { label: `Add ${provider} key`, onClick: () => onAddKey(provider) }
          : undefined,
      });
    } catch {
      setBusy(false);
      setError(disconnectFailed(sub));
    }
  };

  return (
    <ConfirmDialog
      open={sub !== null}
      title={copy?.title ?? ""}
      confirmLabel="Disconnect"
      onConfirm={() => void confirm()}
      onCancel={close}
      busy={busy}
      error={error}
    >
      {copy?.body}
    </ConfirmDialog>
  );
}
