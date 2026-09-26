/**
 * "Delete <NAME>?" (TkF-SecretMenu-5, SECRET-18): the see-the-impact confirmation. It names the
 * tools that use the secret and the agents that lose them, read from each tool's page data
 * (`GET /api/tool-library/{id}` → `used_by_agents`), so it opens once those have loaded (or
 * failed: the sentence then leaves the agents out). Same geometry as the other secret dialogs.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "../../design-system/components";
import { type SecretRef, deleteSecret, getTool } from "../../lib/api/tools";
import { useModalDialog } from "../../lib/useModalDialog";
import { agentNames } from "../tools/toolFormat";
import { deleteImpact } from "./secretFormat";

const DELETE_FAILED = "Couldn’t delete the secret. Try again.";
// Past this, open without the agent names rather than leave the click unanswered.
const AGENTS_WAIT_MS = 3000;

/** The agent names of the tools `ids`, or [] when they can't load in time. */
function useAgentsOf(ids: string[]): string[] | null {
  const key = ids.join("\n");
  const [agents, setAgents] = useState<string[] | null>(ids.length === 0 ? [] : null);
  useEffect(() => {
    const toolIds = key ? key.split("\n") : [];
    if (toolIds.length === 0) return;
    let live = true;
    const timer = setTimeout(() => live && setAgents([]), AGENTS_WAIT_MS);
    void Promise.allSettled(toolIds.map((id) => getTool(id))).then((results) => {
      if (!live) return;
      clearTimeout(timer);
      const rows = results.flatMap((r) => (r.status === "fulfilled" ? r.value.used_by_agents : []));
      setAgents((prev) => prev ?? agentNames(rows));
    });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  return agents;
}

export function DeleteSecretDialog({
  name,
  usedBy,
  onClose,
  onDeleted,
}: {
  name: string;
  usedBy: SecretRef[];
  onClose: () => void;
  /** Called once the server has deleted it. */
  onDeleted: () => void;
}) {
  const agents = useAgentsOf(usedBy.map((t) => t.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = () => {
    if (!busy) onClose();
  };
  const ref = useModalDialog<HTMLDivElement>(agents !== null, cancel);
  if (agents === null) return null;

  const title = `Delete ${name}?`;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteSecret(name);
      onDeleted();
    } catch {
      setBusy(false);
      setError(DELETE_FAILED);
    }
  };

  return createPortal(
    <>
      <div className="ds-scrim" onClick={cancel} aria-hidden />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="ds-dialog sc-dialog sc-dialog--confirm"
        tabIndex={-1}
      >
        <h2 className="ds-dialog__title">{title}</h2>
        <div className="ds-dialog__body">{deleteImpact(usedBy, agents)}</div>
        {error && (
          <div className="sc-dialog__error" role="alert">
            {error}
          </div>
        )}
        <div className="ds-dialog__actions">
          <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void confirm()} loading={busy}>
            Delete secret
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
