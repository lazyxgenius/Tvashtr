/**
 * Rename a domain (DM-14, DmF-Menu-2): a 460px dialog with the Name field prefilled and selected,
 * Cancel and Save name. The name rule is checked here first (empty, over 120 characters, another
 * domain's name ignoring case) and again by the server, whose copy shows under the field.
 */
import { useEffect, useRef, useState } from "react";

import { Button, Input } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import { renameDomain } from "../../lib/api/domains";
import { DomainDialog } from "./DomainDialog";
import { domainNameProblem } from "./domainFormat";

export function RenameDomainDialog({
  domain,
  existingNames,
  onClose,
  onRenamed,
}: {
  domain: { domain_id: string; name: string };
  /** Every domain name on the account (this one's is left out of the clash check). */
  existingNames: string[];
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const [name, setName] = useState(domain.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const save = async () => {
    const clean = name.trim();
    if (clean === domain.name) {
      onClose();
      return;
    }
    const others = existingNames.filter(
      (n) => n.trim().toLowerCase() !== domain.name.trim().toLowerCase(),
    );
    const problem = domainNameProblem(clean, others);
    if (problem) {
      setError(problem);
      input.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await renameDomain(domain.domain_id, clean);
      onRenamed(clean);
    } catch (e) {
      setSaving(false);
      setError(
        e instanceof ApiError && e.message
          ? e.message
          : "Couldn’t reach Tvashtr — is the backend running?",
      );
      input.current?.focus();
    }
  };

  return (
    <DomainDialog
      title="Rename domain"
      width={460}
      top={220}
      locked={saving}
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            Save name
          </Button>
        </>
      }
    >
      <Input
        ref={input}
        label="Name"
        value={name}
        maxLength={200}
        error={error ?? undefined}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
      />
    </DomainDialog>
  );
}
