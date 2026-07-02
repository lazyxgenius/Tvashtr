import { type ReactNode } from "react";
import { type LucideIcon, Maximize, PanelRight, X } from "lucide-react";

// F1c: the panel viewing mode. A session-STICKY preference (App owns the state): "drawer" docks the
// panel to the right as a flex child that pushes the canvas; "modal" lifts it into a centered pop-up
// over a click-to-close scrim (canvas full-width behind). NOT persisted — a reload starts docked.
export type PanelMode = "drawer" | "modal";

/**
 * F1c — the shared premium config-drawer chrome. Both the author (`TeamNodePanel`) and run-view
 * (`SidePanel`) panels wrap their body in this, so the drawer⇄modal toggle + scrim live in ONE
 * place. It renders the design's 384px right drawer (or the centered modal), a header (a glyph
 * badge + a display-font title + a status/identity subtitle + the dock⇄pop-up toggle + the close),
 * and the body region — consuming F0's `--drawer-w` / `--shadow-drawer` / `--shadow-pop` tokens +
 * the `tv-pop-in` / `tv-modal-in` / `tv-fade-in` keyframes (see `panel.css`).
 *
 * In modal mode a click-to-close scrim renders behind the panel; clicking it (or the toggle's dock
 * icon) snaps back to the docked drawer / closes. The header toggle icon + title flip with the mode
 * (`Maximize` / "Open as a pop-up" when docked; `PanelRight` / "Dock to the side" when popped).
 */
export function DrawerShell({
  glyph: Glyph,
  title,
  subtitle,
  ariaLabel,
  panelMode,
  onTogglePanelMode,
  onClose,
  children,
}: {
  glyph: LucideIcon;
  title: string;
  subtitle: string;
  ariaLabel: string;
  panelMode: PanelMode;
  onTogglePanelMode?: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const isModal = panelMode === "modal";
  const ToggleIcon = isModal ? PanelRight : Maximize;
  const toggleLabel = isModal ? "Dock to the side" : "Open as a pop-up";

  const shell = (
    <aside className={`tv-panel${isModal ? " tv-panel--modal" : ""}`} aria-label={ariaLabel}>
      <header className="tv-panel__head">
        <div className="tv-panel__id">
          <div className="tv-panel__idrow">
            <span className="tv-panel__badge" aria-hidden>
              <Glyph size={16} strokeWidth={1.6} />
            </span>
            <div className="tv-panel__title" title={title}>
              {title}
            </div>
          </div>
          <div className="tv-panel__subtitle">{subtitle}</div>
        </div>
        <div className="tv-panel__actions">
          <button
            type="button"
            className="tv-panel__ctl"
            onClick={onTogglePanelMode}
            aria-label={toggleLabel}
            title={toggleLabel}
          >
            <ToggleIcon size={15} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className="tv-panel__ctl"
            onClick={onClose}
            aria-label="Close panel"
            title="Close"
          >
            <X size={16} strokeWidth={1.7} />
          </button>
        </div>
      </header>
      <div className="tv-panel__body">{children}</div>
    </aside>
  );

  if (!isModal) return shell;
  return (
    <>
      {/* Click-to-close scrim behind the centered modal — dims the full-width canvas. */}
      <div className="tv-scrim" onClick={onClose} aria-hidden />
      {shell}
    </>
  );
}
