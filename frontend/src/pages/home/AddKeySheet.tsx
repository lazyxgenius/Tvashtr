import { ChevronDown, Lock } from "lucide-react";
import { useRef, useState } from "react";

import { addProvider, ApiError } from "../../lib/api";
import type { ProviderDirectoryEntry } from "../../lib/api/home";
import {
  Button,
  Input,
  LetterTile,
  Popover,
  Sheet,
  useToast,
} from "../../design-system/components";
import { type AddKeysRequest, useAddKeysHandler } from "./homeData";

interface Sequence extends AddKeysRequest {
  index: number;
  saved: number;
}

function exampleFor(provider: string, directory: ProviderDirectoryEntry[]): string | null {
  return directory.find((d) => d.provider === provider)?.example_model ?? null;
}

/**
 * "Add an API key" (HmF-Launch-3/4, HmF-FixSetup, HmF-Retry-2): a right sheet that walks through
 * the missing providers one key at a time — "Key 1 of 2 · then xai" — and ends with a toast
 * ("Keys saved. {Team} can run on the website."). Anything on Home starts it with
 * `requestAddKeys({teamName, providers})`.
 */
export function AddKeySheet({
  directory,
  desktop,
}: {
  directory: ProviderDirectoryEntry[];
  desktop: boolean;
}) {
  const toast = useToast();
  const [seq, setSeq] = useState<Sequence | null>(null);
  const [provider, setProvider] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);

  useAddKeysHandler((req) => {
    if (req.providers.length === 0) return;
    setSeq({ ...req, index: 0, saved: 0 });
    setProvider(req.providers[0] ?? "");
    setKey("");
    setError(null);
  });

  const close = () => {
    const s = seq;
    setSeq(null);
    setPickOpen(false);
    if (s && s.saved > 0) s.onDone?.();
  };

  const save = async () => {
    if (!seq) return;
    if (!key.trim()) {
      setError("Paste the key first.");
      keyRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addProvider(provider, key.trim());
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof ApiError && e.status === 422
          ? "That key wasn’t accepted. Check it and try again."
          : "Couldn’t save the key — is the backend running?",
      );
      return;
    }
    setBusy(false);
    const next = seq.index + 1;
    if (next < seq.providers.length) {
      setSeq({ ...seq, index: next, saved: seq.saved + 1 });
      setProvider(seq.providers[next] ?? "");
      setKey("");
      return;
    }
    const where = desktop ? "on this computer" : "on the website";
    toast({
      message:
        seq.providers.length === 1
          ? `${provider} key saved. ${seq.teamName} can run ${where}.`
          : `Keys saved. ${seq.teamName} can run ${where}.`,
    });
    setSeq(null);
    seq.onDone?.();
  };

  if (!seq) return null;
  const n = seq.providers.length;
  const note =
    n === 1
      ? `Used by ${seq.teamName}`
      : seq.index < n - 1
        ? `Key ${seq.index + 1} of ${n} · then ${seq.providers[seq.index + 1]}`
        : `Key ${n} of ${n}`;
  const example = exampleFor(provider, directory);
  const choices = directory.length
    ? directory
    : seq.providers.map((p) => ({ provider: p, monogram: p.charAt(0).toUpperCase() }));

  return (
    <Sheet
      open
      title="Add an API key"
      subtitle="For website runs, and Desktop runs without a subscription"
      onClose={close}
      footerNote={note}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => void save()} loading={busy}>
            Save key
          </Button>
        </>
      }
    >
      <div className="hm-key__field">
        <span className="hm-key__label" id="hm-key-provider">
          Provider
        </span>
        <Popover
          open={pickOpen}
          onClose={() => setPickOpen(false)}
          width={472}
          role="listbox"
          label="Provider"
          trigger={
            <button
              type="button"
              className="hm-key__provider"
              aria-haspopup="listbox"
              aria-expanded={pickOpen}
              aria-labelledby="hm-key-provider"
              onClick={() => setPickOpen((o) => !o)}
            >
              <LetterTile name={provider} tone="dark" />
              <span className="hm-key__provider-name">{provider}</span>
              <span className="hm-picker__chev">
                <ChevronDown size={15} strokeWidth={1.6} aria-hidden />
              </span>
            </button>
          }
        >
          {choices.map((c) => (
            <button
              key={c.provider}
              type="button"
              role="option"
              aria-selected={c.provider === provider}
              className="ds-option"
              onClick={() => {
                setProvider(c.provider);
                setPickOpen(false);
              }}
            >
              <LetterTile name={c.monogram || c.provider} tone="dark" />
              <span className="hm-key__provider-name">{c.provider}</span>
            </button>
          ))}
        </Popover>
        <span className="hm-key__hint">
          Covers models that start with <code>{provider}/</code>
          {example ? `, like ${example}.` : "."}
        </span>
      </div>
      <Input
        ref={keyRef}
        label="API key"
        type="password"
        placeholder="Paste the key"
        autoComplete="off"
        value={key}
        error={error ?? undefined}
        onChange={(e) => {
          setKey(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
      />
      <div className="hm-key__note">
        <span className="hm-key__note-icon">
          <Lock size={13} strokeWidth={1.6} aria-hidden />
        </span>
        <span>
          Saved encrypted. After you save, you’ll only see •••• and the last 4 characters.
        </span>
      </div>
    </Sheet>
  );
}
