import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button, Input, Sheet, useDismiss } from "../../../design-system/components";
import {
  getProviderDirectoryOnce,
  type ProviderDirectoryEntry,
  type SavedKey,
  saveProviderKey,
} from "../../../lib/api/desktop";
import { ApiError } from "../../../lib/api";
import { ChevronDownIcon } from "../icons";
import { SheetNote } from "./UsePlanSheet";

const EMPTY_FORM = "Enter a provider and an API key.";
const SAVE_FAILED =
  "Couldn’t save that key — is the backend running? Your key wasn’t saved. Try again.";

/**
 * The setup's "Add an API key" sheet (DT-26, DtF-Key-2). Unlike the Engines page's sheet it says
 * "Works on Desktop and on the website", shows the provider in mono without a monogram and has no
 * "Used by" line. The provider comes pre-picked (the first plan that can't run here); providers
 * that serve no model Tvashtr can run (NVIDIA NIM) are listed but can't be picked. Save posts
 * `/api/providers`: nothing filled in → ENG-71, a 422 → the server's words under the key (ENG-73),
 * no answer or a 5xx → ENG-72 with the values kept.
 */
export function SetupKeySheet({
  open,
  prePick,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The provider to start from (DT-26 pre-pick); ignored when it can't be picked. */
  prePick: string | null;
  onClose: () => void;
  onSaved: (key: SavedKey) => void;
}) {
  const [directory, setDirectory] = useState<ProviderDirectoryEntry[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void getProviderDirectoryOnce().then((list) => {
      if (alive) setDirectory(list);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  // Every opening starts clean from the pre-pick. Only an opening resets: a plan status that
  // arrives while the sheet is open changes the pre-pick, but must not wipe what the user typed.
  const prePickRef = useRef(prePick);
  prePickRef.current = prePick;
  useEffect(() => {
    if (!open) return;
    setProvider(prePickRef.current);
    setApiKey("");
    setFormError(null);
    setKeyError(null);
    setSaving(false);
  }, [open]);

  // A pre-pick the directory says can't serve a model is dropped (NIM is never pre-picked).
  useEffect(() => {
    if (!provider) return;
    const entry = directory.find((e) => e.provider === provider);
    if (entry && !entry.serves_models) setProvider(null);
  }, [directory, provider]);

  const entry = directory.find((e) => e.provider === provider) ?? null;

  const save = useCallback(async () => {
    const key = apiKey.trim();
    if (!provider || !key) {
      setFormError(EMPTY_FORM);
      return;
    }
    setFormError(null);
    setKeyError(null);
    setSaving(true);
    try {
      const saved = await saveProviderKey(provider, key);
      setSaving(false);
      onSaved(saved);
    } catch (e) {
      setSaving(false);
      if (e instanceof ApiError && e.status === 422) setKeyError(e.message);
      else if (e instanceof ApiError && e.status === 401)
        return; // the sign-in seam takes over
      else if (e instanceof ApiError && e.status < 500) setFormError(e.message);
      else setFormError(SAVE_FAILED);
    }
  }, [apiKey, onSaved, provider]);

  return (
    <Sheet
      open={open}
      title="Add an API key"
      subtitle="Works on Desktop and on the website"
      onClose={onClose}
      footerNote="Pay the provider per use"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
            Save key
          </Button>
        </>
      }
    >
      <form
        className="st-sheet st-key-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {formError && (
          <div className="st-key-form__error" role="alert">
            {formError}
          </div>
        )}
        <ProviderPicker
          directory={directory}
          value={provider}
          onChange={(p) => {
            setProvider(p);
            setFormError(null);
          }}
          hint={
            provider
              ? `Covers models that start with ${provider}/${
                  entry?.example_model ? `, like ${entry.example_model}` : ""
                }.`
              : null
          }
        />
        <Input
          label="API key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          error={keyError ?? undefined}
          onChange={(e) => {
            setApiKey(e.target.value);
            setKeyError(null);
            setFormError(null);
          }}
        />
        <SheetNote>
          Saved encrypted on your account. After you save, you’ll only see •••• and the last 4
          characters.
        </SheetNote>
      </form>
    </Sheet>
  );
}

/**
 * The Provider combobox: a 40px mono button that opens a listbox of the directory's providers.
 * Providers with `serves_models: false` are shown disabled with their hint. Keyboard: ↓/↑ move
 * over the pickable options, Enter picks, Escape closes only the list (the shared overlay stack).
 */
function ProviderPicker({
  directory,
  value,
  onChange,
  hint,
}: {
  directory: ProviderDirectoryEntry[];
  value: string | null;
  onChange: (provider: string) => void;
  hint: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const labelId = useId();
  const listId = useId();
  const hintId = useId();
  const valueId = useId();

  // The pre-pick may not be in the directory yet (still loading): show it all the same.
  const options = useMemo(() => {
    if (!value || directory.some((e) => e.provider === value)) return directory;
    return [
      {
        provider: value,
        name: value,
        label: "",
        example_model: null,
        hint: null,
        serves_models: true,
      },
      ...directory,
    ];
  }, [directory, value]);
  const pickable = options.filter((e) => e.serves_models).map((e) => e.provider);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);
  useDismiss(open, close, wrapRef);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  const openList = () => {
    setActive(value && pickable.includes(value) ? value : (pickable[0] ?? null));
    setOpen(true);
  };
  const pick = (p: string) => {
    onChange(p);
    close();
  };
  const move = (by: 1 | -1) => {
    if (pickable.length === 0) return;
    const at = active ? pickable.indexOf(active) : -1;
    const next = at === -1 ? 0 : (at + by + pickable.length) % pickable.length;
    setActive(pickable[next]);
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive((e.key === "Home" ? pickable[0] : pickable[pickable.length - 1]) ?? null);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (active) pick(active);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const optionId = (p: string) => `${listId}-${p}`;
  return (
    <div className="st-provider" ref={wrapRef}>
      <span className="st-provider__label" id={labelId}>
        Provider
      </span>
      <div className="st-provider__anchor">
        <button
          ref={buttonRef}
          type="button"
          className="st-provider__button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-labelledby={`${labelId} ${valueId}`}
          aria-describedby={hint ? hintId : undefined}
          onClick={() => (open ? close() : openList())}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              openList();
            }
          }}
        >
          <span
            id={valueId}
            className={value ? "st-provider__value" : "st-provider__value is-empty"}
          >
            {value ?? "Choose a provider"}
          </span>
          <ChevronDownIcon className="st-provider__chevron" />
        </button>
        {open && (
          <ul
            ref={listRef}
            id={listId}
            className="st-provider__list"
            role="listbox"
            aria-labelledby={labelId}
            tabIndex={-1}
            aria-activedescendant={active ? optionId(active) : undefined}
            onKeyDown={onListKey}
          >
            {options.map((e) => (
              <li
                key={e.provider}
                id={optionId(e.provider)}
                role="option"
                aria-selected={e.provider === value}
                aria-disabled={!e.serves_models || undefined}
                className={[
                  "st-provider__option",
                  e.provider === active && "is-active",
                  !e.serves_models && "is-disabled",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseDown={(ev) => ev.preventDefault()}
                onMouseEnter={() => e.serves_models && setActive(e.provider)}
                onClick={() => e.serves_models && pick(e.provider)}
              >
                <span className="st-provider__slug">{e.provider}</span>
                <span className="st-provider__desc">
                  {e.serves_models ? e.label || e.name : (e.hint ?? "")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {hint && (
        <span className="st-provider__hint" id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}
