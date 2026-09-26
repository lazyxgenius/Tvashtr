/**
 * The Add key sheet (ENG-61..74): one right-hand Sheet (520px) shared by the Overview, the API keys
 * page, its suggested-keys banner and the Domains embeddings section.
 *
 * - Provider: the ProviderCombobox, possibly picked in advance (ENG-74). The hint under it says what
 *   the key covers ("Covers models that start with anthropic/, like …"), the provider's own hint
 *   (huggingface) or, for a provider no agent runs on (NVIDIA NIM), exactly that. A provider that
 *   already has a key says the save replaces it (OQ-5).
 * - Other: a Model prefix field; "mistral/" → "Just the part before the slash: mistral." (ENG-70).
 * - API key (password, never kept after the sheet closes), the encryption note, the "your Claude
 *   subscription still runs first" note when that subscription is connected, and the footer's
 *   "Used by …" / "Covers mistral/… models".
 * - Save key stays enabled (OQ-4): saving with nothing filled says "Enter a provider and an API
 *   key."; a 4xx shows the server's words, a network failure says the key wasn't saved; the values
 *   stay put either way (ENG-71..73).
 * - After a save: the new key tops the table (the banner, the embeddings section and the nav badges
 *   recompute from it) and a toast says what the key changed, with one action — "Add xai" opens
 *   this sheet again for the next key, "Open Domains" goes to Domains (ENG-58, ENG-60, OQ-7).
 */
import { Lock, Monitor, TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";

import { Button, Input, Sheet, useToast } from "../../design-system/components";
import { saveKey } from "../../lib/api/engines";
import { ApiDetailError } from "../../lib/api/runs";
import { navigate } from "../../lib/nav";
import { monogramOf } from "./engineModel";
import { useEngines } from "./enginesData";
import { ProviderCombobox } from "./ProviderCombobox";
import {
  ADD_KEY_TITLES,
  EMBEDDINGS_KEY_TITLES,
  ENCRYPTION_NOTE,
  FORM_EMPTY_ERROR,
  NO_PICK,
  PREFIX_HELPER,
  type ProviderPick,
  SAVE_NETWORK_ERROR,
  type SaveToastAction,
  type SheetHint,
  effectiveProvider,
  filterOptions,
  footerNote,
  pickerOptions,
  prefixError,
  replaceHint,
  saveToast,
  sheetHint,
  subscriptionNote,
} from "./sheetModel";

/** What opened the sheet: a provider picked in advance, whether it is an embeddings key, and
 *  whether it came from the suggested-keys banner (the toast then says "Add <q> too, so …") or an
 *  Overview row (the toast then says "… still needs <q> for the website."). */
export interface AddKeyRequest {
  provider?: string;
  embeddings?: boolean;
  banner?: boolean;
  row?: boolean;
}

/** Opens the sheet again (a toast's "Add <q>"; an Overview row's toast keeps its wording). */
export type OpenAddKey = (
  provider?: string,
  options?: { embeddings?: boolean; row?: boolean },
) => void;

function HintLine({ hint }: { hint: SheetHint }) {
  if (hint.kind === "covers") {
    return (
      <span className="eng-sheet__hint">
        Covers models that start with <code>{hint.prefix}</code>
        {hint.example ? `, like ${hint.example}.` : "."}
      </span>
    );
  }
  const at = hint.strong ? hint.text.indexOf(hint.strong) : -1;
  if (!hint.strong || at < 0) return <span className="eng-sheet__hint">{hint.text}</span>;
  return (
    <span className="eng-sheet__hint">
      {hint.text.slice(0, at)}
      <b>{hint.strong}</b>
      {hint.text.slice(at + hint.strong.length)}
    </span>
  );
}

function errorText(e: unknown): string {
  if (e instanceof ApiDetailError && e.status >= 400 && e.status < 500 && e.detail) {
    return e.message;
  }
  return SAVE_NETWORK_ERROR;
}

function AddKeyForm({
  request,
  onClose,
  onAddKey,
  onSaved,
}: {
  request: AddKeyRequest;
  onClose: () => void;
  onAddKey: OpenAddKey;
  onSaved?: (provider: string) => void;
}) {
  const { inputs, keys, setKeys } = useEngines();
  const toast = useToast();
  const formId = useId();
  const prefixRef = useRef<HTMLInputElement>(null);
  const [pick, setPick] = useState<ProviderPick>(
    request.provider ? { kind: "provider", provider: request.provider } : NO_PICK,
  );
  const [prefix, setPrefix] = useState("");
  const [secret, setSecret] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const titles = request.embeddings ? EMBEDDINGS_KEY_TITLES : ADD_KEY_TITLES;
  const options = useMemo(() => pickerOptions(inputs), [inputs]);
  const provider = effectiveProvider(pick, prefix);
  const typedError = pick.kind === "other" ? prefixError(prefix) : null;
  const hint = pick.kind === "provider" ? sheetHint(inputs, pick.provider) : null;
  const replacing = provider ? replaceHint(inputs, provider) : null;
  const subNote = provider ? subscriptionNote(inputs, provider) : null;
  const note = footerNote(inputs, pick, prefix);

  // "Other" moves the typing to the prefix field.
  useEffect(() => {
    if (pick.kind === "other") prefixRef.current?.focus();
  }, [pick.kind]);

  const close = () => {
    if (!busy) onClose();
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const apiKey = secret.trim();
    if (typedError) return; // the field already says what's wrong
    if (!provider || !apiKey) {
      setFormError(FORM_EMPTY_ERROR);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const saved = await saveKey(provider, apiKey);
      const next = {
        provider,
        key_last4: saved.key_last4,
        created_at: saved.created_at,
        updated_at: saved.updated_at,
      };
      const nextKeys = keys.some((k) => k.provider === provider)
        ? keys.map((k) => (k.provider === provider ? next : k))
        : [next, ...keys];
      setKeys(nextKeys);
      onClose();
      onSaved?.(provider);
      const done = saveToast({ ...inputs, keys: nextKeys }, provider, saved.replaced, {
        banner: request.banner,
        embeddings: request.embeddings,
        row: request.row,
      });
      toast({
        message: done.message,
        action: done.action
          ? { label: done.action.label, onClick: runAction(done.action) }
          : undefined,
      });
    } catch (err) {
      setFormError(errorText(err));
      setBusy(false);
    }
  };

  const runAction = (action: SaveToastAction) => () => {
    if (action.kind === "open-domains") navigate({ page: "domains" });
    else onAddKey(action.provider, { embeddings: action.embeddings, row: request.row });
  };

  const clearFormError = () => {
    if (formError) setFormError(null);
  };

  return (
    <Sheet
      open
      title={titles.title}
      subtitle={titles.subtitle}
      onClose={close}
      footerNote={note ?? undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" form={formId} loading={busy}>
            Save key
          </Button>
        </>
      }
    >
      {/* Save key (in the footer) submits this form, so Enter in a field saves (ENG-67). */}
      <form id={formId} className="eng-sheet__form" onSubmit={(e) => void submit(e)} noValidate>
        {formError && (
          <div role="alert" className="eng-sheet__error">
            <span className="eng-sheet__icon">
              <TriangleAlert size={14} strokeWidth={1.6} aria-hidden />
            </span>
            <span>{formError}</span>
          </div>
        )}
        <ProviderCombobox
          options={options}
          filter={(q) => filterOptions(inputs, options, q)}
          pick={pick}
          pickedMonogram={
            pick.kind === "provider" ? monogramOf(inputs.directory, pick.provider) : ""
          }
          onPick={(next) => {
            setPick(next);
            clearFormError();
          }}
          invalid={Boolean(formError) && pick.kind === "none"}
        >
          {hint && <HintLine hint={hint} />}
          {pick.kind === "provider" && replacing && (
            <span className="eng-sheet__hint">{replacing}</span>
          )}
        </ProviderCombobox>
        {pick.kind === "other" && (
          <Input
            ref={prefixRef}
            label="Model prefix"
            helper={PREFIX_HELPER}
            error={typedError ?? undefined}
            autoComplete="off"
            spellCheck={false}
            value={prefix}
            onChange={(e) => {
              setPrefix(e.target.value);
              clearFormError();
            }}
          />
        )}
        {pick.kind === "other" && replacing && !typedError && (
          <span className="eng-sheet__hint">{replacing}</span>
        )}
        <Input
          label="API key"
          type="password"
          placeholder="Paste the key"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(e) => {
            setSecret(e.target.value);
            clearFormError();
          }}
        />
        <div className="eng-sheet__note eng-sheet__note--sunk">
          <span className="eng-sheet__icon">
            <Lock size={13} strokeWidth={1.6} aria-hidden />
          </span>
          <span>{ENCRYPTION_NOTE}</span>
        </div>
        {subNote && (
          <div className="eng-sheet__note eng-sheet__note--line">
            <span className="eng-sheet__icon">
              <Monitor size={13} strokeWidth={1.6} aria-hidden />
            </span>
            <span>{subNote}</span>
          </div>
        )}
      </form>
    </Sheet>
  );
}

/** The sheet, or nothing while closed. Each open starts empty (the key is never kept). */
export function AddKeySheet({
  request,
  onClose,
  onAddKey,
  onSaved,
}: {
  request: (AddKeyRequest & { seq: number }) | null;
  onClose: () => void;
  onAddKey: OpenAddKey;
  /** A key was saved (the Overview flashes its row, ENG-23). */
  onSaved?: (provider: string) => void;
}) {
  return request ? (
    <AddKeyForm
      key={request.seq}
      request={request}
      onClose={onClose}
      onAddKey={onAddKey}
      onSaved={onSaved}
    />
  ) : null;
}
