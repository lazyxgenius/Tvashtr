/**
 * "Change access" on a connector's page: Read only or Read & write for the whole connection (the
 * first of the two gates; each agent has its own).
 */
import { useState } from "react";

import { Button, Dialog } from "../../design-system/components";
import {
  type Connection,
  type ConnectorAccess,
  connectorRefusal,
  updateConnection,
} from "../../lib/api/connectors";
import { AccessChoice } from "./connectParts";

export function ChangeAccessDialog({
  connection,
  onClose,
  onSaved,
}: {
  connection: Connection;
  onClose: () => void;
  onSaved: (connection: Connection) => void;
}) {
  const [access, setAccess] = useState<ConnectorAccess>(connection.access);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await updateConnection(connection.id, { access }));
    } catch (e) {
      setBusy(false);
      setError(connectorRefusal(e)?.message ?? "Couldn’t change the access. Try again.");
    }
  };

  return (
    <Dialog
      open
      title="Change access"
      onClose={() => !busy && onClose()}
      width={480}
      closeButton={false}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={access === connection.access}
            loading={busy}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <AccessChoice
        value={access}
        onChange={setAccess}
        disabled={busy}
        hint={
          access === "write"
            ? "Each agent stays read only until you choose Read & write for it in its Skills & tools tab."
            : "Read only applies at once, also to a run that is going."
        }
      />
      {error && (
        <div className="cn-error" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
