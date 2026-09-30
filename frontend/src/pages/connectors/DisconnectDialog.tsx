/**
 * "Disconnect <name>?" (CnF-Disc-2): the see-the-impact confirmation. It names the agents that
 * lose access, by team, from the connector's page data (`GET /api/connectors/{id}` →
 * `used_by_agents`, `revoke_hint`), so it opens once that has loaded — or failed or taken too
 * long, when it falls back to the row's counts. The connector's page passes what it already shows
 * (`detail`). There is no undo.
 */
import { useEffect, useState } from "react";

import { ConfirmDialog } from "../../design-system/components";
import {
  type Connection,
  type ConnectionDetail,
  deleteConnection,
  getConnection,
} from "../../lib/api/connectors";
import { disconnectImpact } from "./connectorFormat";

// Past this, open with the counts alone rather than leave the click unanswered.
const DETAIL_WAIT_MS = 3000;

/** The connection's page data: null while loading, `{ detail: null }` when it couldn't load. */
function useDetail(connection: Connection, known: ConnectionDetail | undefined) {
  const [found, setFound] = useState<{ detail: ConnectionDetail | null } | null>(
    known ? { detail: known } : null,
  );
  const skip = known !== undefined;
  useEffect(() => {
    if (skip) return;
    let live = true;
    const timer = setTimeout(() => live && setFound((f) => f ?? { detail: null }), DETAIL_WAIT_MS);
    getConnection(connection.id).then(
      (detail) => live && setFound((f) => f ?? { detail }),
      () => live && setFound((f) => f ?? { detail: null }),
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [connection.id, skip]);
  return found;
}

export function DisconnectDialog({
  connection,
  detail: known,
  onClose,
  onDisconnected,
}: {
  connection: Connection;
  /** The connector's page: what it already shows, so nothing is loaded again. */
  detail?: ConnectionDetail;
  onClose: () => void;
  /** Called once the server has removed it. */
  onDisconnected: () => void;
}) {
  const found = useDetail(connection, known);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteConnection(connection.id);
      onDisconnected();
    } catch {
      setBusy(false);
      setError(`Couldn’t disconnect ${connection.name}. Try again.`);
    }
  };

  return (
    <ConfirmDialog
      open={found !== null}
      title={`Disconnect ${connection.name}?`}
      confirmLabel="Disconnect"
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={() => !busy && onClose()}
    >
      {found && disconnectImpact(connection, found.detail)}
    </ConfirmDialog>
  );
}
