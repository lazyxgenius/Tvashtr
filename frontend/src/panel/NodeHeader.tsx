import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Lock, Maximize2, Minimize2, X, type LucideIcon } from "lucide-react";

import { Badge, IconButton } from "../design-system/components";
import type { StatusBadge } from "./nodeBadges";

export interface HeaderRename {
  /** Enter (or leaving the fields): the new name and description, trimmed; the name isn't blank. */
  onCommit: (name: string, description: string) => void;
  /** Escape. */
  onCancel: () => void;
}

/**
 * The drawer header (PANEL-11/12): the role glyph, the agent's name and one-line description, the
 * Focus mode / More actions / Close buttons, and a row of badges under them. With `rename` the name
 * and description turn into fields (PANEL-24, Q18). `focused` is the focus view's one-row header
 * (Desktop-Focus): a larger glyph and name, the badges beside them, then Dock to the side / More
 * actions / Close.
 */
export function NodeHeader({
  glyph: Glyph,
  name,
  description,
  placeholder,
  badges,
  onFocus,
  focused = false,
  more,
  rename,
  onClose,
}: {
  glyph: LucideIcon;
  name: string;
  description: string;
  /** Shown in the description's place while it's empty ("Add a short description"). */
  placeholder?: string;
  badges?: ReactNode;
  /** Opens the focus view (or docks back when `focused`). Omitted: no button. */
  onFocus?: () => void;
  focused?: boolean;
  /** The ⋯ menu (`NodeMoreMenu`). Omitted: no button. */
  more?: ReactNode;
  /** Renaming: the name and description are editable. */
  rename?: HeaderRename | null;
  onClose: () => void;
}) {
  const titles = rename ? (
    <RenameFields name={name} description={description} {...rename} />
  ) : (
    <div className="nd-head__titles">
      <h2 className="nd-head__name" title={name}>
        {name}
      </h2>
      {(description || placeholder) && (
        <div className="nd-head__desc">{description || placeholder}</div>
      )}
    </div>
  );
  if (focused) {
    return (
      <header className="fx-head">
        <span className="fx-glyph" aria-hidden>
          <Glyph size={17} strokeWidth={1.6} />
        </span>
        {titles}
        {badges && <div className="fx-head__badges">{badges}</div>}
        <div className="nd-head__actions fx-head__actions">
          {onFocus && (
            <IconButton
              size="sm"
              aria-label="Dock to the side"
              title="Dock to the side"
              onClick={onFocus}
            >
              <Minimize2 size={15} strokeWidth={1.6} />
            </IconButton>
          )}
          {more}
          <IconButton size="sm" aria-label="Close" title="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.6} />
          </IconButton>
        </div>
      </header>
    );
  }
  return (
    <header className="nd-head">
      <div className="nd-head__row">
        <span className="nd-glyph" aria-hidden>
          <Glyph size={16} strokeWidth={1.7} />
        </span>
        {titles}
        <div className="nd-head__actions">
          {onFocus && (
            <IconButton size="sm" aria-label="Focus mode" title="Focus mode" onClick={onFocus}>
              <Maximize2 size={15} strokeWidth={1.7} />
            </IconButton>
          )}
          {more}
          <IconButton size="sm" aria-label="Close panel" title="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.7} />
          </IconButton>
        </div>
      </div>
      {badges && <div className="nd-badges">{badges}</div>}
    </header>
  );
}

/** The inline rename: Enter keeps it (in the draft), Escape puts the old name back. */
function RenameFields({
  name,
  description,
  onCommit,
  onCancel,
}: {
  name: string;
  description: string;
} & HeaderRename) {
  const [nextName, setNextName] = useState(name);
  const [nextDescription, setNextDescription] = useState(description);
  const [blank, setBlank] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Start in the name, selected, so typing replaces it.
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const commit = () => {
    if (!nextName.trim()) {
      setBlank(true);
      nameRef.current?.focus();
      return;
    }
    onCommit(nextName.trim(), nextDescription.trim());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      // Only the rename: not the drawer or a dialog under it.
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };
  // Clicking away keeps a valid name and drops a blank one.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (nextName.trim()) commit();
    else onCancel();
  };

  return (
    <div className="nd-rename" onBlur={onBlur}>
      <input
        ref={nameRef}
        className="nd-rename__name"
        aria-label="Agent name"
        value={nextName}
        maxLength={60}
        aria-invalid={blank}
        onChange={(e) => {
          setNextName(e.target.value);
          if (e.target.value.trim()) setBlank(false);
        }}
        onKeyDown={onKeyDown}
      />
      <input
        className="nd-rename__desc"
        aria-label="Short description"
        placeholder="Add a short description"
        value={nextDescription}
        maxLength={120}
        onChange={(e) => setNextDescription(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {blank && (
        <div className="nd-rename__hint nd-rename__hint--error" role="alert">
          An agent name is required.
        </div>
      )}
    </div>
  );
}

/** Status · access · model (PANEL-13/14/15). The status badge jumps to the Runs tab. */
export function NodeBadges({
  status,
  editsAllowed,
  model,
  onOpenRuns,
}: {
  status: StatusBadge;
  /** Null hides the File access badge (a new agent's header shows status and model only). */
  editsAllowed: boolean | null;
  /** The friendly model name, or null when the agent needs a model. */
  model: string | null;
  onOpenRuns?: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="nd-badge-btn"
        title="See the last run"
        onClick={onOpenRuns}
        disabled={!onOpenRuns}
      >
        <Badge variant={status.variant} dot={status.dot}>
          {status.label}
        </Badge>
      </button>
      {editsAllowed === true && <Badge variant="accent">Can edit files</Badge>}
      {editsAllowed === false && (
        <Badge variant="neutral">
          <Lock size={11} strokeWidth={1.8} aria-hidden />
          Read-only
        </Badge>
      )}
      {model ? (
        <Badge variant="neutral">{model}</Badge>
      ) : (
        <Badge variant="warning">Needs a model</Badge>
      )}
    </>
  );
}
