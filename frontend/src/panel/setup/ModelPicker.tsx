import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Check, CircleCheck, KeyRound, Monitor, Plus } from "lucide-react";

import { Button, Input, LetterTile, useDismiss } from "../../design-system/components";
import { addProvider, type Capability, type ProviderCatalogueEntry } from "../../lib/api";
import { DESKTOP_MAC_DMG_URL } from "../../lib/desktopDownload";
import {
  customModelProblem,
  isCatalogueModel,
  landingModel,
  type ModelGroup,
  modelGroups,
  pickerNote,
  searchGroups,
  shortId,
  subscriptionStateText,
} from "./modelCatalog";
import type { CredentialCover } from "./modelCopy";
import { ModelButton } from "./ModelButton";

export interface ModelPickerProps {
  model: string;
  onPick: (slug: string) => void;
  /** The button's text when no model is set ("Choose a model" / "None"). */
  emptyLabel: string;
  /** The listbox's accessible name. */
  label: string;
  /** The backup model can be "None". */
  allowNone?: boolean;
  catalogue: readonly ProviderCatalogueEntry[];
  seat: Capability;
  cover: CredentialCover | null;
  desktop: boolean;
  /** A key pasted into a "No key yet" group was saved to the account (Engines). */
  onKeySaved?: (group: ModelGroup) => void;
  /** "Add a provider": Engines › API keys. */
  onAddProvider?: () => void;
}

// The design opens the listbox upward, 8px above the button (bottom: 44px on a 36px button), its
// right edge on the button's. It is positioned against the viewport so the drawer body's scrolling
// can't clip its search field; it keeps to the drawer and opens downward when there's no room.
const GAP = 8;
const EDGE = 8;
const MIN_ABOVE = 240;

function placeListbox(button: HTMLElement): CSSProperties {
  const r = button.getBoundingClientRect();
  const frame = button.closest(".nd-drawer")?.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const top = Math.max(frame?.top ?? 0, 0) + EDGE;
  const bottom = Math.min(frame && frame.bottom > 0 ? frame.bottom : vh, vh) - EDGE;
  const above = r.top - GAP - top;
  const below = bottom - (r.bottom + GAP);
  const right = Math.max(vw - r.right, 0);
  if (above >= MIN_ABOVE || above >= below) {
    return { right, bottom: vh - r.top + GAP, maxHeight: Math.max(above, 0) };
  }
  return { right, top: r.bottom + GAP, maxHeight: Math.max(below, 0) };
}

function StateLine({ group }: { group: ModelGroup }) {
  if (group.state === "subscription" && group.subscription) {
    return (
      <span className="nd-lb__state">
        <Monitor size={12} strokeWidth={1.6} aria-hidden />
        {subscriptionStateText(group.subscription)}
      </span>
    );
  }
  if (group.state === "key") {
    return (
      <span className="nd-lb__state">
        <KeyRound size={12} strokeWidth={1.6} aria-hidden />
        API key
      </span>
    );
  }
  return (
    <span className="nd-lb__state nd-lb__state--warn">
      <AlertTriangle size={12} strokeWidth={1.6} aria-hidden />
      No key yet
    </span>
  );
}

/**
 * The model picker (PANEL-41..45): the model button and its listbox — search, the honest note, one
 * group per provider that has models for this agent's seat (with how the account runs it), an
 * inline key field for a provider with no key yet, "Add a provider" and "Use a custom model ID".
 * The backup model's picker also offers "None". Arrows move between models, Enter picks, Esc closes.
 */
export function ModelPicker({
  model,
  onPick,
  emptyLabel,
  label,
  allowNone = false,
  catalogue,
  seat,
  cover,
  desktop,
  onKeySaved,
  onAddProvider,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState<string | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const slug = model.trim();

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery("");
    setCustom(null);
    setCustomError(null);
    setKeyError(null);
    if (refocus) buttonRef.current?.focus();
  }, []);
  useDismiss(open, close, wrapRef);

  // Place the listbox before it paints, and keep it on the button while the page scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      if (buttonRef.current) setPlace(placeListbox(buttonRef.current));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open && custom === null) searchRef.current?.focus();
  }, [open, custom]);

  const all = modelGroups(catalogue, seat, cover, { desktop, current: slug });
  const groups = searchGroups(all, query);
  const note = pickerNote(all);

  const pick = (next: string) => {
    onPick(next);
    close();
  };

  const saveKey = async (group: ModelGroup) => {
    const value = (keys[group.provider] ?? "").trim();
    if (!value) {
      document.getElementById(`${listId}-key-${group.provider}`)?.focus();
      return;
    }
    setBusy(group.provider);
    setKeyError(null);
    try {
      await addProvider(group.provider, value);
      setKeys((k) => ({ ...k, [group.provider]: "" }));
      onKeySaved?.(group);
      const next = landingModel(group, catalogue, seat);
      if (next) onPick(next);
      close();
    } catch {
      setKeyError(group.provider);
    } finally {
      setBusy(null);
    }
  };

  const openCustom = () => {
    const seed = query.includes("/")
      ? query.trim()
      : slug && !isCatalogueModel(slug, catalogue)
        ? slug
        : "";
    setCustom(seed);
    setCustomError(null);
  };
  const applyCustom = () => {
    const text = (custom ?? "").trim();
    const problem = customModelProblem(text);
    if (problem) {
      setCustomError(problem);
      return;
    }
    pick(text);
  };

  // Arrows walk the models (from the search field too); Home/End jump to the ends.
  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const target = e.target as HTMLElement;
    if (target !== searchRef.current && target.getAttribute("role") !== "option") return;
    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (options.length === 0) return;
    e.preventDefault();
    const at = options.indexOf(target as HTMLButtonElement);
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    else if (e.key === "ArrowDown") next = at === -1 ? 0 : Math.min(at + 1, options.length - 1);
    else if (at <= 0) {
      searchRef.current?.focus();
      return;
    } else next = at - 1;
    options[next].focus();
  };

  const option = (value: string, text: string, extraClass = "") => {
    const selected = value === slug;
    return (
      <button
        key={value || "none"}
        type="button"
        role="option"
        aria-selected={selected}
        className={`nd-lb__opt${selected ? " nd-lb__opt--on" : ""}${extraClass}`}
        onClick={() => pick(value)}
      >
        {text}
        {selected && (
          <span className="nd-lb__check" aria-hidden>
            <Check size={14} strokeWidth={2} />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="nd-picker" ref={wrapRef}>
      <ModelButton
        buttonRef={buttonRef}
        model={model}
        emptyLabel={emptyLabel}
        catalogued={catalogue.length === 0 || isCatalogueModel(slug, catalogue)}
        expanded={open}
        controls={open ? listId : undefined}
        onOpen={() => (open ? close() : setOpen(true))}
      />
      {open && (
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={label}
          className="nd-lb"
          style={place ?? { visibility: "hidden" }}
          onKeyDown={onListKeyDown}
        >
          <div className="nd-lb__search">
            <Input
              ref={searchRef}
              size="sm"
              aria-label="Search models"
              placeholder="Search models"
              value={query}
              disabled={custom !== null}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const first = listRef.current?.querySelector<HTMLButtonElement>('[role="option"]');
                first?.click();
              }}
            />
          </div>
          <div className="nd-lb__note">
            <CircleCheck size={12} strokeWidth={1.6} aria-hidden />
            {note}
          </div>
          <div className="nd-lb__groups">
            {custom !== null ? (
              <div className="nd-lb__custom">
                <Input
                  size="sm"
                  mono
                  aria-label="Custom model ID"
                  placeholder="provider/model"
                  value={custom}
                  autoFocus
                  onChange={(e) => {
                    setCustom(e.target.value);
                    setCustomError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyCustom();
                    }
                  }}
                />
                <p
                  className={customError ? "nd-lb__err" : "nd-lb__custom-hint"}
                  role={customError ? "alert" : undefined}
                >
                  {customError ??
                    "The provider’s own name for the model. It runs on that provider’s key."}
                </p>
                <div className="nd-lb__custom-actions">
                  <Button variant="ghost" size="sm" onClick={() => setCustom(null)}>
                    Back
                  </Button>
                  <Button variant="secondary" size="sm" onClick={applyCustom}>
                    Use this model
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {allowNone && !query.trim() && option("", "None", " nd-lb__opt--none")}
                {groups.map((g) => {
                  const headId = `${listId}-${g.provider}`;
                  const keyId = `${listId}-key-${g.provider}`;
                  return (
                    <div key={g.provider} role="group" aria-labelledby={headId}>
                      <div className="nd-lb__head" id={headId}>
                        <LetterTile name={g.provider} tone="dark" />
                        <span className="nd-lb__name">{g.provider}</span>
                        <StateLine group={g} />
                      </div>
                      {g.state === "none" ? (
                        <>
                          {g.desktopExplainer && (
                            <div className="nd-lb__explain">
                              <Monitor size={12} strokeWidth={1.6} aria-hidden /> Your Claude or
                              Grok subscription can run agents in{" "}
                              <a
                                href={DESKTOP_MAC_DMG_URL}
                                className="nd-lb__dl"
                                title="Download Tvashtr Desktop for Mac"
                              >
                                Tvashtr Desktop
                              </a>
                              . On the website, add an API key.
                            </div>
                          )}
                          <div
                            className={`nd-lb__key${g.desktopExplainer ? " nd-lb__key--after" : ""}`}
                          >
                            <Input
                              id={keyId}
                              size="sm"
                              type="password"
                              autoComplete="off"
                              aria-label={`Paste your ${g.label} API key`}
                              placeholder={`Paste your ${g.label} API key`}
                              value={keys[g.provider] ?? ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                setKeys((k) => ({ ...k, [g.provider]: value }));
                                if (keyError === g.provider) setKeyError(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void saveKey(g);
                                }
                              }}
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={busy === g.provider}
                              onClick={() => void saveKey(g)}
                            >
                              Add
                            </Button>
                          </div>
                          {keyError === g.provider && (
                            <p className="nd-lb__err nd-lb__err--key" role="alert">
                              Couldn’t save that key. Try again.
                            </p>
                          )}
                        </>
                      ) : (
                        g.models.map((m) => option(m, shortId(m)))
                      )}
                    </div>
                  );
                })}
                {groups.length === 0 && (
                  <p className="nd-lb__empty">No models match “{query.trim()}”.</p>
                )}
              </>
            )}
          </div>
          <div className="nd-lb__foot">
            <button
              type="button"
              className="nd-lb__add"
              onClick={() => {
                close(false);
                onAddProvider?.();
              }}
            >
              <Plus size={13} strokeWidth={1.6} aria-hidden />
              Add a provider
            </button>
            {custom === null && (
              <button type="button" className="nd-lb__custom-link" onClick={openCustom}>
                Use a custom model ID
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
