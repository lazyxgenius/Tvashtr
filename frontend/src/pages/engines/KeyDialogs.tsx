/**
 * The API keys page's two confirms (Eng-Flow-Key-3/4, EnF-KeyUsed-3/4):
 * - Replace (ENG-56): "Replace the <p> key", a New key field, Replace key → the row's last 4 and
 *   Added update, toast "<p> key replaced. Writer uses it on its next run.".
 * - Remove (ENG-57): the impact first ("Writer in Docs team uses deepseek. Docs team can’t run on the
 *   website, or on Desktop, until you add a key again. You can’t undo this."), a line when one of
 *   those teams has a run in progress (OQ-21), a danger Remove key (OQ-14), toast "<p> key removed.".
 * The secret is sent once and never kept or shown (ENG-80); errors stay in the dialog with the value.
 */
import { type FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button, ConfirmDialog, Input, useToast } from "../../design-system/components";
import { ApiDetailError } from "../../lib/api/runs";
import { removeKey, saveKey } from "../../lib/api/engines";
import { listTeams } from "../../lib/api/teams";
import { useModalDialog } from "../../lib/useModalDialog";
import { useEngines } from "./enginesData";
import { inFlightLine, removeCopy, replaceCopy } from "./keysModel";

/** ENG-72/73: a 4xx shows the server's own words; a network failure or 5xx says the key is safe. */
function errorText(e: unknown, action: "save" | "remove"): string {
  if (e instanceof ApiDetailError && e.status >= 400 && e.status < 500 && e.detail) {
    return e.message;
  }
  return action === "save"
    ? "Couldn’t save that key — is the backend running? Your key wasn’t saved. Try again."
    : "Couldn’t remove that key — is the backend running? The key is still saved. Try again.";
}

// ---- Replace ----

function ReplaceForm({ provider, onClose }: { provider: string; onClose: () => void }) {
  const { inputs, keys, setKeys } = useEngines();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = replaceCopy(inputs, provider);
  const cancel = () => {
    if (!busy) onClose();
  };
  const ref = useModalDialog<HTMLFormElement>(true, cancel);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const secret = value.trim();
    if (!secret) {
      setError("Paste the new key.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await saveKey(provider, secret);
      const next = {
        provider,
        key_last4: saved.key_last4,
        created_at: saved.created_at,
        updated_at: saved.updated_at,
      };
      setKeys(
        keys.some((k) => k.provider === provider)
          ? keys.map((k) => (k.provider === provider ? next : k))
          : [...keys, next],
      );
      onClose();
      toast({ message: copy.toast });
    } catch (err) {
      setError(errorText(err, "save"));
      setBusy(false);
    }
  };

  return createPortal(
    <>
      <div className="ds-scrim" onClick={cancel} aria-hidden />
      <form
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={copy.title}
        className="ds-dialog"
        tabIndex={-1}
        onSubmit={(e) => void submit(e)}
        noValidate
      >
        <h2 className="ds-dialog__title">{copy.title}</h2>
        <div className="ds-dialog__body">{copy.body}</div>
        <Input
          label="New key"
          type="password"
          placeholder="Paste the new key"
          autoComplete="off"
          spellCheck={false}
          value={value}
          error={error ?? undefined}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
        />
        <div className="ds-dialog__actions">
          <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={busy}>
            Replace key
          </Button>
        </div>
      </form>
    </>,
    document.body,
  );
}

export function ReplaceKeyDialog({
  provider,
  onClose,
}: {
  provider: string | null;
  onClose: () => void;
}) {
  // Keyed by provider so a new open starts with an empty field.
  return provider ? <ReplaceForm key={provider} provider={provider} onClose={onClose} /> : null;
}

// ---- Remove ----

/** The names of `teamIds` with a run pending, running or waiting on a gate (null while unknown). */
function useRunningTeams(teamIds: readonly string[], names: Map<string, string>): string[] {
  const [running, setRunning] = useState<string[]>([]);
  const idsKey = teamIds.join(",");
  useEffect(() => {
    if (!idsKey) return;
    let live = true;
    const ids = new Set(idsKey.split(","));
    listTeams()
      .then((teams) => {
        if (!live) return;
        setRunning(
          teams
            .filter(
              (t) =>
                ids.has(t.team_graph_id) &&
                (t.active_run_count ?? 0) + (t.awaiting_run_count ?? 0) > 0,
            )
            .map((t) => names.get(t.team_graph_id) ?? t.name),
        );
      })
      .catch(() => {
        // Unknown: say nothing rather than guess.
      });
    return () => {
      live = false;
    };
    // `names` is derived from the same usage as the ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  return running;
}

function RemoveConfirm({ provider, onClose }: { provider: string; onClose: () => void }) {
  const { inputs, keys, setKeys } = useEngines();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = removeCopy(inputs, provider);
  const names = new Map(inputs.usage.teams.map((t) => [t.team_id, t.name]));
  const running = useRunningTeams(copy.teamIds, names);
  const inFlight = inFlightLine(inputs, provider, running);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeKey(provider);
      setKeys(keys.filter((k) => k.provider !== provider));
      onClose();
      toast({ message: copy.toast });
    } catch (err) {
      setError(errorText(err, "remove"));
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open
      title={copy.title}
      confirmLabel="Remove key"
      tone="danger"
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      {copy.body}
      {inFlight && <p className="eng-dialog__inflight">{inFlight}</p>}
    </ConfirmDialog>
  );
}

export function RemoveKeyDialog({
  provider,
  onClose,
}: {
  provider: string | null;
  onClose: () => void;
}) {
  return provider ? <RemoveConfirm key={provider} provider={provider} onClose={onClose} /> : null;
}
