import type { AuthMode } from "./LoginScreen";

/**
 * The logged-out landing page (M-accounts Slice B). Product name + a short pitch + two CTAs. NO
 * canvas, NO team data, NO "create team" surface — the CTAs route into the login / register screen
 * (the only way into the product). A pure presentational component: it owns no data and no auth.
 */
export function LandingPage({ onGetStarted }: { onGetStarted: (mode: AuthMode) => void }) {
  return (
    <div className="tv-landing">
      <div className="tv-landing__hero tv-card">
        <div className="tv-landing__brand">
          <img src="/mark-coral.png" alt="" style={{ width: 32, height: 32 }} />
          <span className="tv-landing__wordmark">Tvashtr</span>
        </div>
        <h1 className="tv-landing__headline">
          Compose your own team of AI agents — and watch it ship.
        </h1>
        <p className="tv-landing__lede">
          A living canvas where you author the team, steer the work as it happens, and take a
          product idea — or a feature request against your real codebase — to working, reviewed
          software.
        </p>
        <div className="tv-landing__cta">
          <button
            type="button"
            className="tv-btn tv-landing__cta-primary"
            onClick={() => onGetStarted("login")}
          >
            Try the canvas
          </button>
          <button
            type="button"
            className="tv-btn tv-btn--ghost"
            onClick={() => onGetStarted("register")}
          >
            Create your own team
          </button>
        </div>
        <p className="tv-landing__foot">Log in or create an account to get started.</p>
      </div>
    </div>
  );
}
