/**
 * The overlay primitives every redesigned page reuses: the ⋯ Menu, an anchored Popover for pickers,
 * the ConfirmDialog that states the impact before a destructive action, the right-side Sheet, and
 * Toasts (with an optional Undo). Geometry is copied from the design file (menu 240px, dialog 500px,
 * sheet 520px, toast bottom-centre on ink).
 */
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, MoreHorizontal, X } from "lucide-react";

import { useModalDialog } from "../../lib/useModalDialog";
import { Button, IconButton } from "./primitives";
import { cx, type ToastOptions, ToastContext, useDismiss } from "./utils";

// ---- Menu (⋯) ----

export interface MenuItem {
  key: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export type MenuEntry = MenuItem | "separator";

/**
 * A ⋯ button that opens a menu of actions. `label` names the button for screen readers
 * ("More actions for github"). Arrow keys move between items; Escape and outside clicks close it.
 */
export function Menu({
  label,
  items,
  align = "end",
  size = "sm",
  trigger,
  width,
}: {
  label: string;
  items: MenuEntry[];
  align?: "start" | "end";
  size?: "sm" | "md";
  /** Custom trigger renderer; receives the props to spread onto a button. */
  trigger?: (props: {
    onClick: () => void;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    "aria-controls": string | undefined;
  }) => ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useDismiss(open, () => setOpen(false), wrapRef);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const els = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ??
        [],
    );
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    const next = (i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length;
    els[next]?.focus();
    e.preventDefault();
  };

  const triggerProps = {
    onClick: () => setOpen((o) => !o),
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
  };

  return (
    <span className="ds-anchor" ref={wrapRef}>
      {trigger ? (
        trigger(triggerProps)
      ) : (
        <IconButton size={size} aria-label={label} {...triggerProps}>
          <MoreHorizontal size={16} strokeWidth={1.8} aria-hidden />
        </IconButton>
      )}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={cx("ds-menu", align === "end" ? "ds-menu--end" : "ds-menu--start")}
          style={width ? { width } : undefined}
          onKeyDown={onKeyDown}
        >
          {items.map((it, i) =>
            it === "separator" ? (
              <div key={`sep-${i}`} className="ds-menu__sep" role="separator" />
            ) : (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                className={cx("ds-menu__item", it.danger && "ds-menu__item--danger")}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.icon && <span className="ds-menu__icon">{it.icon}</span>}
                <span>
                  <span className="ds-menu__label">{it.label}</span>
                  {it.description && <span className="ds-menu__desc">{it.description}</span>}
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </span>
  );
}

// ---- Popover (anchored picker) ----

/**
 * An anchored popover for pickers (team, repo, provider, sort). The caller renders the trigger
 * and the content; the popover handles outside-click / Escape dismissal.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  width,
  align = "start",
  label,
  className,
  role = "dialog",
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  width?: number;
  align?: "start" | "end";
  label?: string;
  className?: string;
  role?: "dialog" | "listbox";
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  useDismiss(open, onClose, wrapRef);
  return (
    <span className="ds-anchor" ref={wrapRef}>
      {trigger}
      {open && (
        <div
          role={role}
          aria-label={label}
          className={cx("ds-popover", className)}
          style={{
            width,
            top: "calc(100% + 4px)",
            ...(align === "end" ? { right: 0 } : { left: 0 }),
          }}
        >
          {children}
        </div>
      )}
    </span>
  );
}

// ---- ConfirmDialog ----

/**
 * The design's "see the impact" confirm: a serif question, one plain sentence saying who is
 * affected, and Cancel + the action. Escape / the scrim cancel; focus is trapped inside.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  busy = false,
  tone = "secondary",
  error,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  tone?: "secondary" | "primary" | "danger";
  error?: ReactNode;
}) {
  const ref = useModalDialog<HTMLDivElement>(open, onCancel);
  if (!open) return null;
  return createPortal(
    <>
      <div className="ds-scrim" onClick={onCancel} aria-hidden />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="ds-dialog"
        tabIndex={-1}
      >
        <h2 className="ds-dialog__title">{title}</h2>
        {children && <div className="ds-dialog__body">{children}</div>}
        {error && (
          <div className="ds-dialog__body" role="alert" style={{ color: "var(--danger)" }}>
            {error}
          </div>
        )}
        <div className="ds-dialog__actions">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone} size="sm" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** A plain modal dialog (e.g. keyboard shortcuts, new team) sharing the confirm's geometry. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  width = 500,
  closeButton = true,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Show the ✕ in the corner (dialogs that end on a single [Done] leave it out). */
  closeButton?: boolean;
}) {
  const ref = useModalDialog<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ds-dialog"
        style={{ width }}
        tabIndex={-1}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <h2 className="ds-dialog__title" style={{ flex: 1 }}>
            {title}
          </h2>
          {closeButton && (
            <IconButton size="sm" aria-label="Close" onClick={onClose}>
              <X size={16} strokeWidth={1.8} aria-hidden />
            </IconButton>
          )}
        </div>
        {children}
        {footer && <div className="ds-dialog__actions">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

// ---- Sheet ----

export function Sheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  footerNote,
  width = 520,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  footerNote?: ReactNode;
  width?: number;
}) {
  const ref = useModalDialog<HTMLElement>(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ds-sheet"
        style={{ width }}
        tabIndex={-1}
      >
        <header className="ds-sheet__head">
          <div className="ds-sheet__titles">
            <h2 className="ds-sheet__title">{title}</h2>
            {subtitle && <div className="ds-sheet__subtitle">{subtitle}</div>}
          </div>
          <IconButton size="sm" aria-label="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </header>
        <div className="ds-sheet__body">{children}</div>
        {(footer || footerNote) && (
          <footer className="ds-sheet__foot">
            {footerNote && <span className="ds-sheet__foot-note">{footerNote}</span>}
            {footer && <div className="ds-sheet__foot-actions">{footer}</div>}
          </footer>
        )}
      </aside>
    </>,
    document.body,
  );
}

// ---- Toasts ----

interface ToastEntry extends ToastOptions {
  id: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const h = timers.current.get(id);
    if (h) clearTimeout(h);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (t: ToastOptions) => {
      const id = nextId.current++;
      // Keep the stack short: the newest three.
      setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
      const ms = t.duration ?? (t.action ? 8000 : 5000);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ms),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((h) => clearTimeout(h));
  }, []);

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="ds-toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} role="status" className="ds-toast">
              <span className={cx("ds-toast__icon", t.tone === "error" && "ds-toast__icon--error")}>
                {t.tone === "error" ? (
                  <CircleAlert size={16} strokeWidth={1.8} aria-hidden />
                ) : (
                  <CircleCheck size={16} strokeWidth={1.8} aria-hidden />
                )}
              </span>
              <span>{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  className="ds-toast__action"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
