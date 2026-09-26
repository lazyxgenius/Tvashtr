/**
 * Delete a domain (DM-15, DmF-Menu-3): a 500px dialog that says what goes, adds the honest in-use
 * line when a team uses it as a step (OQ-14), and asks for the domain's name before **Delete
 * domain** (primary with a trash icon, OQ-29) turns on. No Undo: the delete is immediate.
 */
import { useEffect, useRef, useState } from "react";
import { Trash } from "lucide-react";

import { Button, Input } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import { type DomainListItem, removeDomain } from "../../lib/api/domains";
import { DomainDialog } from "./DomainDialog";
import { deleteDomainInUse, deleteDomainText } from "./domainFormat";

export function DeleteDomainDialog({
  domain,
  onClose,
  onDeleted,
}: {
  domain: Pick<DomainListItem, "domain_id" | "name" | "files" | "usage">;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const inUse = deleteDomainInUse(domain);
  const confirmed = typed.trim() === domain.name.trim();

  useEffect(() => {
    input.current?.focus();
  }, []);

  const remove = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeDomain(domain.domain_id);
      onDeleted();
    } catch (e) {
      // Already gone (another tab deleted it): the outcome the user asked for.
      if (e instanceof ApiError && e.status === 404) {
        onDeleted();
        return;
      }
      setBusy(false);
      setError(
        e instanceof ApiError && e.status < 500 && e.message
          ? e.message
          : "Couldn’t delete it — is the backend running?",
      );
    }
  };

  return (
    <DomainDialog
      title={`Delete ${domain.name}?`}
      width={500}
      top={200}
      locked={busy}
      onClose={onClose}
      onSubmit={() => void remove()}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="dm-btn-inline"
            disabled={!confirmed}
            loading={busy}
          >
            <Trash size={15} strokeWidth={1.6} aria-hidden />
            <span>Delete domain</span>
          </Button>
        </>
      }
    >
      <p className="dm-dlg__text">{deleteDomainText(domain)}</p>
      {inUse && <p className="dm-dlg__text">{inUse}</p>}
      <Input
        ref={input}
        label="Type the domain name to confirm"
        value={typed}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setTyped(e.target.value)}
      />
      {error && (
        <p className="dm-dlg__error" role="alert">
          {error}
        </p>
      )}
    </DomainDialog>
  );
}
