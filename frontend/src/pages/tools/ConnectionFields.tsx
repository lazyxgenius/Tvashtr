/**
 * The Connection form (TkF-AddTool-2..4, TOOL-34..39), shared by the Add tool wizard and the tool
 * page: "Where it runs" (Local command / Remote URL), the URL and headers or the command, arguments
 * and environment, the `${` hint, and "Advanced (raw JSON)" kept in sync both ways.
 *
 * The caller owns the form and the raw-JSON draft (`raw` is null while the JSON simply mirrors the
 * form; it holds your text while you edit it, with its error when it doesn't parse).
 */
import { KeyRound } from "lucide-react";
import { useId } from "react";

import { Input, cx } from "../../design-system/components";
import { KeyValueRows } from "./KeyValueRows";
import { RawJsonDisclosure } from "./RawJsonDisclosure";
import {
  type ConnectionForm,
  type SecretOption,
  configText,
  configToForm,
  misplacedRefNote,
  parseConfigText,
} from "./connectionForm";
import type { Transport } from "./toolConfig";

export interface RawDraft {
  text: string;
  error: string | null;
}

export function ConnectionFields({
  form,
  onChange,
  raw,
  onRawChange,
  rawOpen,
  onRawToggle,
  errors,
  options,
  stored,
  suggestion,
}: {
  form: ConnectionForm;
  onChange: (form: ConnectionForm) => void;
  raw: RawDraft | null;
  onRawChange: (raw: RawDraft | null) => void;
  rawOpen: boolean;
  onRawToggle: () => void;
  /** "Next" found the URL / command missing. */
  errors: { url?: string | null; command?: string | null };
  options: SecretOption[];
  stored: Set<string> | null;
  suggestion: string;
}) {
  const id = useId();
  // A form edit: the raw JSON follows the form again.
  const edit = (patch: Partial<ConnectionForm>) => {
    onRawChange(null);
    onChange({ ...form, ...patch });
  };
  const editRaw = (text: string) => {
    const parsed = parseConfigText(text);
    if ("error" in parsed) {
      onRawChange({ text, error: parsed.error });
      return;
    }
    onRawChange({ text, error: null });
    onChange(configToForm(parsed.config, form));
  };
  const remote = form.transport === "remote";
  const seg = (value: Transport, label: string, title?: string) => (
    <button
      type="button"
      className={cx("tv-seg__btn", form.transport === value && "tv-seg__btn--active")}
      aria-pressed={form.transport === value}
      title={title}
      onClick={() => edit({ transport: value })}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="tk-wiz__field">
        <span id={`${id}-where`} className="tk-wiz__label">
          Where it runs
        </span>
        <div className="tv-seg tk-wiz__seg" role="group" aria-labelledby={`${id}-where`}>
          {seg("local", "Local command", "Runs in the agent’s sandbox")}
          {seg("remote", "Remote URL")}
        </div>
      </div>

      {remote ? (
        <Input
          label="URL"
          type="url"
          autoComplete="off"
          spellCheck={false}
          value={form.url}
          error={errors.url ?? undefined}
          onChange={(e) => edit({ url: e.target.value })}
        />
      ) : (
        <div className="tk-wiz__cmd">
          <Input
            label="Command"
            autoComplete="off"
            spellCheck={false}
            value={form.command}
            error={errors.command ?? undefined}
            onChange={(e) => edit({ command: e.target.value })}
          />
          <Input
            label="Arguments"
            optional
            helper="Space-separated."
            autoComplete="off"
            spellCheck={false}
            value={form.args}
            onChange={(e) => edit({ args: e.target.value })}
          />
        </div>
      )}

      {misplacedRefNote(form) && <p className="tk-wiz__refnote">{misplacedRefNote(form)}</p>}

      <KeyValueRows
        key={form.transport}
        kind={remote ? "header" : "env"}
        rows={remote ? form.headers : form.env}
        onChange={(rows) => edit(remote ? { headers: rows } : { env: rows })}
        options={options}
        stored={stored}
        suggestion={suggestion}
      />

      {remote && (
        <div className="tk-wiz__hint">
          <span className="tk-wiz__hint-icon">
            <KeyRound size={14} strokeWidth={1.6} aria-hidden />
          </span>
          <span>
            Type <code>{"${"}</code> to pick a secret. The value stays out of the config and is
            filled in at run time.
          </span>
        </div>
      )}

      <RawJsonDisclosure
        open={rawOpen}
        onToggle={onRawToggle}
        text={raw?.text ?? configText(form)}
        error={raw?.error ?? null}
        onChange={editRaw}
      />
    </>
  );
}
