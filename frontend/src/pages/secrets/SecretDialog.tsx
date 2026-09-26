/**
 * The secret dialog (TkF-AddSecret-1..3, TkF-SecretFix-1, Toolkit-ReplaceSecret): 500px, three modes.
 * - `add`: "Add a secret" — Name + Value, the name rule checked before saving (SECRET-9/10) and the
 *   server's 409 "already exists" shown under Name (SECRET-11).
 * - `add-prefilled`: "Add <NAME>" — the Name is fixed (disabled) because a tool already uses it
 *   (SECRET-19, from a banner, a missing row or a tool's "Add secret").
 * - `replace`: "Replace <NAME>" — a new value for a stored secret (SECRET-16).
 * Save stays disabled until every field has text. A value is only ever typed into a password field
 * and never shown again. The caller reloads, toasts and refreshes the nav badges in `onSaved`.
 */
import { Lock } from "lucide-react";
import { type FormEvent, useState } from "react";
import { createPortal } from "react-dom";

import { Button, Input } from "../../design-system/components";
import { type SecretRef, createSecret, replaceSecret } from "../../lib/api/tools";
import { ApiDetailError } from "../../lib/api/runs";
import { useModalDialog } from "../../lib/useModalDialog";
import { joinNames, secretNameError } from "./secretFormat";

export type SecretDialogMode =
  | { kind: "add" }
  | { kind: "add-prefilled"; name: string }
  | { kind: "replace"; name: string; usedBy: SecretRef[] };

const NAME_HELPER = "Capital letters, numbers and _. Tools use it as ${NAME}.";
const SAVE_FAILED = "Couldn’t save the secret. Try again.";

function titleOf(mode: SecretDialogMode): string {
  if (mode.kind === "add") return "Add a secret";
  return mode.kind === "replace" ? `Replace ${mode.name}` : `Add ${mode.name}`;
}

function replaceLede(usedBy: SecretRef[]): string {
  const first = "The old value is deleted when you save.";
  if (usedBy.length === 0) return first;
  const names = usedBy.map((t) => t.name);
  return `${first} ${joinNames(names)} ${names.length > 1 ? "pick" : "picks"} up the new one on ${names.length > 1 ? "their" : "its"} next run.`;
}

export function SecretDialog({
  mode,
  onClose,
  onSaved,
}: {
  mode: SecretDialogMode;
  onClose: () => void;
  /** Called with the saved name once the server has it. */
  onSaved: (name: string) => void;
}) {
  const fixedName = mode.kind === "add" ? null : mode.name;
  const [name, setName] = useState(fixedName ?? "");
  const [value, setValue] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useModalDialog<HTMLDivElement>(true, () => {
    if (!busy) onClose();
  });

  const title = titleOf(mode);
  const replacing = mode.kind === "replace";
  const canSave = Boolean(name.trim() && value.trim()) && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const n = fixedName ?? name.trim();
    if (!fixedName) {
      const err = secretNameError(n);
      if (err) {
        setNameError(err);
        return;
      }
    }
    setBusy(true);
    setFormError(null);
    try {
      if (replacing) await replaceSecret(n, value);
      else await createSecret(n, value);
      onSaved(n);
    } catch (err) {
      setBusy(false);
      const status = err instanceof ApiDetailError ? err.status : 0;
      const message = err instanceof Error && err.message ? err.message : SAVE_FAILED;
      // 409 (taken) and a 422 about the name belong under Name; anything else under the form.
      if (!fixedName && (status === 409 || (status === 422 && /capital letters/i.test(message))))
        setNameError(message);
      else setFormError(status >= 400 && status < 500 ? message : SAVE_FAILED);
    }
  };

  return createPortal(
    <>
      <div className="ds-scrim" onClick={() => !busy && onClose()} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`ds-dialog sc-dialog${replacing ? " sc-dialog--replace" : ""}`}
        tabIndex={-1}
      >
        <form className="sc-dialog__form" onSubmit={(e) => void submit(e)} noValidate>
          <h2 className="sc-dialog__title">{title}</h2>
          {mode.kind === "replace" && <p className="sc-dialog__lede">{replaceLede(mode.usedBy)}</p>}
          <Input
            label="Name"
            placeholder={replacing ? undefined : "e.g. GITHUB_TOKEN"}
            helper={
              replacing
                ? "Names can’t be changed. Delete and add a new secret instead."
                : NAME_HELPER
            }
            error={nameError ?? undefined}
            value={name}
            disabled={fixedName !== null}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
          />
          <Input
            label={replacing ? "New value" : "Value"}
            type="password"
            placeholder={replacing ? "Paste the new value" : "Paste the secret value"}
            value={value}
            autoComplete="new-password"
            onChange={(e) => {
              setValue(e.target.value);
              setFormError(null);
            }}
          />
          {!replacing && (
            <span className="sc-dialog__note">
              <Lock size={12} strokeWidth={1.6} aria-hidden />
              Stored encrypted. We never show a value again.
            </span>
          )}
          {formError && (
            <div className="sc-dialog__error" role="alert">
              {formError}
            </div>
          )}
          <div className="sc-dialog__actions">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSave} loading={busy}>
              {replacing ? "Replace value" : "Save secret"}
            </Button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}
