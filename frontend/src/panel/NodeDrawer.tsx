import type { ReactNode } from "react";

/**
 * The agent drawer shell (PANEL-10): a 384px `aside "<Name> settings"` — header, tabs, a body that
 * scrolls on its own, and a pinned footer. Above 1280px it docks and pushes the canvas; at 1280px
 * or less it floats over the canvas with a left shadow (CSS). A `sub` view (`SubView`: the Output
 * format editor, the add forms) takes the body's and the footer's place under the same header and
 * tabs; the body stays mounted underneath. Focus mode is `NodeFocusView`.
 */
export function NodeDrawer({
  name,
  label,
  header,
  tabs,
  footer,
  children,
  bare = false,
  sub,
  overlay,
  toast,
}: {
  name: string;
  /** The aside's accessible name (default "<Name> settings"). */
  label?: string;
  header: ReactNode;
  tabs?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** The children own their padding and scroll (the older gate / endpoint bodies). */
  bare?: boolean;
  /** A sub-view in place of the body and the footer. */
  sub?: ReactNode;
  /** A drawer-scoped confirm (`DrawerConfirm`), drawn over the drawer only. */
  overlay?: ReactNode;
  /** The drawer's toast host (`DrawerToast`), just above the footer. */
  toast?: ReactNode;
}) {
  return (
    <aside className="nd-drawer nd-drawer--dock" aria-label={label ?? `${name} settings`}>
      {header}
      {tabs}
      {/* Under a sub-view the body stays mounted (hidden), so Back finds it as it was left. */}
      <div
        className={`nd-body${bare ? " nd-body--bare" : ""}`}
        role={tabs ? "tabpanel" : undefined}
        hidden={sub ? true : undefined}
      >
        {bare ? children : <div className="nd-body__inner">{children}</div>}
      </div>
      {sub ?? footer}
      {toast}
      {overlay}
    </aside>
  );
}
