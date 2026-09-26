import type { ReactNode } from "react";
import { Lock, Maximize2, Minimize2, MoreHorizontal, X, type LucideIcon } from "lucide-react";

import { Badge, IconButton } from "../design-system/components";
import type { StatusBadge } from "./nodeBadges";

/**
 * The drawer header (PANEL-11/12): the role glyph, the agent's name and one-line description, the
 * Focus mode / More actions / Close buttons, and a row of badges under them.
 */
export function NodeHeader({
  glyph: Glyph,
  name,
  description,
  badges,
  onFocus,
  focused = false,
  onMore,
  moreExpanded,
  onClose,
}: {
  glyph: LucideIcon;
  name: string;
  description: string;
  badges?: ReactNode;
  /** Opens the focus view (or docks back when `focused`). Omitted: no button. */
  onFocus?: () => void;
  focused?: boolean;
  /** Opens the ⋯ menu. Omitted: no button. */
  onMore?: () => void;
  moreExpanded?: boolean;
  onClose: () => void;
}) {
  return (
    <header className="nd-head">
      <div className="nd-head__row">
        <span className="nd-glyph" aria-hidden>
          <Glyph size={16} strokeWidth={1.7} />
        </span>
        <div className="nd-head__titles">
          <h2 className="nd-head__name" title={name}>
            {name}
          </h2>
          {description && <div className="nd-head__desc">{description}</div>}
        </div>
        <div className="nd-head__actions">
          {onFocus && (
            <IconButton
              size="sm"
              aria-label={focused ? "Dock to the side" : "Focus mode"}
              title={focused ? "Dock to the side" : "Focus mode"}
              onClick={onFocus}
            >
              {focused ? (
                <Minimize2 size={15} strokeWidth={1.7} />
              ) : (
                <Maximize2 size={15} strokeWidth={1.7} />
              )}
            </IconButton>
          )}
          {onMore && (
            <IconButton
              size="sm"
              aria-label="More actions"
              title="More actions"
              aria-haspopup="menu"
              aria-expanded={moreExpanded ?? false}
              onClick={onMore}
            >
              <MoreHorizontal size={16} strokeWidth={1.7} />
            </IconButton>
          )}
          <IconButton size="sm" aria-label="Close panel" title="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.7} />
          </IconButton>
        </div>
      </div>
      {badges && <div className="nd-badges">{badges}</div>}
    </header>
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
  editsAllowed: boolean;
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
      {editsAllowed ? (
        <Badge variant="accent">Can edit files</Badge>
      ) : (
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
