import type { ReactNode } from "react";
import { BookOpen, Home, KeyRound, Wrench } from "lucide-react";

export type DashView = "home" | "domains" | "engines" | "tools";

const NAV: { id: DashView; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "domains", label: "Domains", icon: BookOpen },
  { id: "engines", label: "Engines", icon: KeyRound },
  { id: "tools", label: "Tools", icon: Wrench },
];

/**
 * Dashboard app shell — sticky left nav (Home / Domains / Engines / Tools) + main content column.
 * Account chip stays in the top bar (passed as `barRight`); optional `navFooter` for a chip in the rail.
 */
export function AppShell({
  view,
  onNavigate,
  brand,
  barRight,
  navFooter,
  children,
}: {
  view: DashView;
  onNavigate: (v: DashView) => void;
  brand: ReactNode;
  barRight?: ReactNode;
  navFooter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="tv-dash tv-shell">
      <header className="tv-dash__bar">
        <div className="tv-dash__brand">{brand}</div>
        {barRight && <div className="tv-dash__bar-right">{barRight}</div>}
      </header>
      <div className="tv-shell__body">
        <nav className="tv-shell__nav" aria-label="Dashboard">
          <ul className="tv-shell__nav-list">
            {NAV.map(({ id, label, icon: Icon }) => {
              const active = view === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`tv-shell__nav-btn${active ? " tv-shell__nav-btn--active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => onNavigate(id)}
                  >
                    <Icon size={16} strokeWidth={1.8} aria-hidden />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
          {navFooter && <div className="tv-shell__nav-foot">{navFooter}</div>}
        </nav>
        <div className="tv-shell__main">{children}</div>
      </div>
    </div>
  );
}
