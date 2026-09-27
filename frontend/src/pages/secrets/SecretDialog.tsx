/**
 * The secret dialog (TkF-AddSecret-1..3, TkF-SecretFix-1, Toolkit-ReplaceSecret): 500px, three modes.
 * - `add`: "Add a secret" — Name + Value, the name rule checked before saving (SECRET-9/10) and the
 *   server's 409 "already exists" shown under Name (SECRET-11).
 * - `add-prefilled`: "Add <NAME>" — the Name is fixed (disabled) because a tool already uses it
 *   (SECRET-19, from a banner, a missing row or a tool's "Add secret"). A tool can reference a name
 *   no secret can be stored under (`${linear_token}`: runs read any `${name}`); then the dialog
 *   says what to write instead and opens the tool, with no Value field that could never save.
 * - `replace`: "Replace <NAME>" — a new value for a stored secret (SECRET-16).
 * - `add-many`: a tool's "Add secret" when it misses 2+ names ("Needs 2 secrets", spec Q3; not
 *   drawn) — one Value field per missing name. Save takes the ones you fill; a name that fails stays
 *   in the form with the error, and Cancel after a partial save still reports what was saved.
 * Save stays disabled until every field has text (add-many: until one has). A value is only ever typed into a password field
 * and never shown again. The caller reloads, toasts and refreshes the nav badges in `onSaved`.
 */
import { Lock } from "lucide-react";
import { type FormEvent, useState } from "react";
import { createPortal } from "react-dom";

import { Button, Input } from "../../design-system/components";
import { type SecretRef, createSecret, replaceSecret } from "../../lib/api/tools";
import { ApiDetailError } from "../../lib/api/runs";
import { navigate } from "../../lib/nav";
import { useModalDialog } from "../../lib/useModalDialog";
import { joinNames, refNameProblem, secretNameError } from "./secretFormat";
import "./secrets.css";

export type SecretDialogMode =
  | { kind: "add" }
  /** `tools`: who references the name (the fix for a rule-breaking one is in their config). */
  | { kind: "add-prefilled"; name: string; tools?: SecretRef[] }
  | { kind: "replace"; name: string; usedBy: SecretRef[] }
  | { kind: "add-many"; names: string[]; tool: string; toolId?: string };

const NAME_HELPER = "Capital letters, numbers and _. Tools use it as ${NAME}.";
const SAVE_FAILED = "Couldn’t save the secret. Try again.";

function titleOf(mode: SecretDialogMode): string {
  if (mode.kind === "add") return "Add a secret";
  if (mode.kind === "add-many") return `Add ${mode.names.length} secrets for ${mode.tool}`;
  return mode.kind === "replace" ? `Replace ${mode.name}` : `Add ${mode.name}`;
}

/** "Open <tool>": the tool's page, where its connection is edited. */
function OpenToolButton({ tool, onClose }: { tool: SecretRef; onClose: () => void }) {
  return (
    <Button
      size="sm"
      onClick={() => {
        onClose();
        navigate({ page: "tool", toolId: tool.id });
      }}
    >
      {`Open ${tool.name}`}
    </Button>
  );
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
  /** Called with the saved name(s) once the server has them. */
  onSaved: (names: string[]) => void;
}) {
  if (mode.kind === "add-many")
    return <AddManyDialog mode={mode} onClose={onClose} onSaved={onSaved} />;
  return <OneSecretDialog mode={mode} onClose={onClose} onSaved={onSaved} />;
}

function OneSecretDialog({
  mode,
  onClose,
  onSaved,
}: {
  mode: Exclude<SecretDialogMode, { kind: "add-many" }>;
  onClose: () => void;
  onSaved: (names: string[]) => void;
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
  // A referenced name no secret can be stored under: say what to write instead (the tool's fix).
  const badName = mode.kind === "add-prefilled" ? refNameProblem(mode.name) : null;
  const tools = mode.kind === "add-prefilled" ? (mode.tools ?? []) : [];
  const canSave = Boolean(name.trim() && value.trim()) && !busy && !badName;

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
      onSaved([n]);
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
            error={badName ?? nameError ?? undefined}
            value={name}
            disabled={fixedName !== null}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
          />
          {badName ? (
            <p className="sc-dialog__lede">
              {tools.length > 0
                ? `Change it in the connection of ${joinNames(tools.map((t) => t.name))}, then add the value.`
                : "Change it in the tool’s connection, then add the value."}
            </p>
          ) : (
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
          )}
          {!replacing && !badName && (
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
            {badName ? (
              tools.length === 1 && <OpenToolButton tool={tools[0]} onClose={onClose} />
            ) : (
              <Button type="submit" size="sm" disabled={!canSave} loading={busy}>
                {replacing ? "Replace value" : "Save secret"}
              </Button>
            )}
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}

/** One Value field per name a tool misses (spec Q3). */
function AddManyDialog({
  mode,
  onClose,
  onSaved,
}: {
  mode: Extract<SecretDialogMode, { kind: "add-many" }>;
  onClose: () => void;
  onSaved: (names: string[]) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  // Names saved so far: they leave the form (a later failure keeps only the rest).
  const [saved, setSaved] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = () => {
    if (busy) return;
    if (saved.length > 0) onSaved(saved);
    else onClose();
  };
  const ref = useModalDialog<HTMLDivElement>(true, cancel);

  const title = titleOf(mode);
  const names = mode.names.filter((n) => !saved.includes(n));
  // Names no secret can be stored under get the fix instead of a field.
  const bad = names.filter((n) => refNameProblem(n));
  const toolId = mode.toolId;
  const filled = names.filter((n) => !bad.includes(n) && values[n]?.trim());
  const canSave = filled.length > 0 && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setFormError(null);
    const done = [...saved];
    for (const n of filled) {
      try {
        await createSecret(n, values[n]);
        done.push(n);
      } catch (err) {
        const status = err instanceof ApiDetailError ? err.status : 0;
        const message = err instanceof Error && err.message ? err.message : SAVE_FAILED;
        setSaved(done);
        setBusy(false);
        setFormError(status >= 400 && status < 500 ? message : SAVE_FAILED);
        return;
      }
    }
    onSaved(done);
  };

  return createPortal(
    <>
      <div className="ds-scrim" onClick={cancel} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ds-dialog sc-dialog"
        tabIndex={-1}
      >
        <form className="sc-dialog__form" onSubmit={(e) => void submit(e)} noValidate>
          <h2 className="sc-dialog__title">{title}</h2>
          <p className="sc-dialog__lede">
            {`${mode.tool} uses ${joinNames(mode.names)}. It won’t connect until each has a value.`}
          </p>
          {names.map((n) =>
            bad.includes(n) ? (
              <div key={n} className="sc-dialog__bad">
                <span className="sc-dialog__badname">{n}</span>
                <span className="sc-dialog__error">{refNameProblem(n)}</span>
              </div>
            ) : (
              <Input
                key={n}
                label={n}
                type="password"
                placeholder="Paste the secret value"
                value={values[n] ?? ""}
                autoComplete="new-password"
                onChange={(e) => {
                  setValues((v) => ({ ...v, [n]: e.target.value }));
                  setFormError(null);
                }}
              />
            ),
          )}
          <span className="sc-dialog__note">
            <Lock size={12} strokeWidth={1.6} aria-hidden />
            Stored encrypted. We never show a value again.
          </span>
          {formError && (
            <div className="sc-dialog__error" role="alert">
              {formError}
            </div>
          )}
          <div className="sc-dialog__actions">
            <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
            {bad.length > 0 && toolId && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  cancel();
                  navigate({ page: "tool", toolId });
                }}
              >
                {`Open ${mode.tool}`}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={!canSave} loading={busy}>
              Save secrets
            </Button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}
