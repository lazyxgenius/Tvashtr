import { useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  Code2,
  GitBranch,
  Lock,
  type LucideIcon,
  Mail,
  PenLine,
  Terminal,
} from "lucide-react";

import { ApiError, type AuthUser, login, register } from "../lib/api";

// The auth mode — shared with the landing CTAs (M-accounts Slice B) so "Get started" opens the
// wizard pre-set to register and "Sign in" opens it to login. (Moved here from LoginScreen in F3.)
export type AuthMode = "login" | "register";

/**
 * F3 — the guided auth wizard. Replaces the standalone centered LoginScreen with a two-panel
 * (brand + form) flow whose visual + copy source of truth is
 * design/Tvashtr Frontend Overhaul/AuthWizard.dc.html.
 *
 * The account step is FIRST (this reorders the mockup, which put it last): the user authenticates
 * via the EXISTING api.ts login()/register() (reskin the door, don't rebuild the lock), and only
 * THEN — on the sign-up path — answers two throwaway onboarding questions before the finish.
 *
 * Flow:
 *   sign-up: account → role → building → success ("Enter Tvashtr") → onAuthed(user)
 *   sign-in: account → success ("Enter Tvashtr") → onAuthed(user)
 *
 * The role + building answers live in this component's state ONLY (for the brand-panel recap chips)
 * and are DISCARDED on entry — nothing is persisted, nothing is threaded into the Dashboard.
 * `onAuthed` fires only at the final "Enter Tvashtr" (both paths); after a successful account step the
 * identity is HELD in state, so the wizard stays a self-contained logged-out view until the finish.
 */
type Step = "account" | "role" | "building" | "success";

type Option = { val: string; title: string; sub: string; Icon: LucideIcon };

const ROLE_OPTS: Option[] = [
  {
    val: "engineer",
    title: "Engineer",
    sub: "Ship reviewed code into a real repo",
    Icon: Terminal,
  },
  { val: "founder", title: "Founder", sub: "Idea → spec → prototype, fast", Icon: Building2 },
  { val: "solo", title: "Solo builder", sub: "Run a small studio of agents", Icon: Code2 },
];

const BUILD_OPTS: Option[] = [
  { val: "greenfield", title: "A fresh idea", sub: "Start from a blank canvas", Icon: PenLine },
  {
    val: "repo",
    title: "Against my repo",
    sub: "Point a team at an existing codebase",
    Icon: GitBranch,
  },
];

type BrandCopy = { eyebrow: string; headline: string; sub: string };

/** Brand-panel copy per step (remapped for the account-FIRST order — §Copy deltas 1). */
function brandCopy(mode: AuthMode, step: Step): BrandCopy {
  if (step === "success") {
    return {
      eyebrow: "Ready",
      headline: "The loom is warm.",
      sub: "Your canvas is ready — let's compose your first team.",
    };
  }
  if (step === "role") {
    return {
      eyebrow: "Step 2 of 3",
      headline: "Who's at the loom?",
      sub: "Tell us your role — it just sets the scene. Nothing here is saved.",
    };
  }
  if (step === "building") {
    return {
      eyebrow: "Step 3 of 3",
      headline: "What are we weaving?",
      sub: "A fresh idea or your own codebase — the canvas fits either.",
    };
  }
  return mode === "register"
    ? {
        eyebrow: "Welcome",
        headline: "Compose your team.",
        sub: "Author and run your own team of AI agents — create your account to begin.",
      }
    : {
        eyebrow: "Welcome back",
        headline: "Pick the thread back up.",
        sub: "Your teams and runs are right where you left them.",
      };
}

/** A single-select onboarding card (role / building). A real <button> so it is keyboard-focusable
 *  with an accessible name (the title), and aria-pressed indicates the selected state. */
function OptionCard({
  opt,
  selected,
  onSelect,
}: {
  opt: Option;
  selected: boolean;
  onSelect: () => void;
}) {
  const { Icon } = opt;
  return (
    <button
      type="button"
      className={`tv-authwiz__opt${selected ? " tv-authwiz__opt--on" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="tv-authwiz__opt-icon">
        <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
      </span>
      <span className="tv-authwiz__opt-text">
        <span className="tv-authwiz__opt-title">{opt.title}</span>
        <span className="tv-authwiz__opt-sub">{opt.sub}</span>
      </span>
      <span className="tv-authwiz__opt-check">
        <Check size={13} strokeWidth={3} aria-hidden="true" />
      </span>
    </button>
  );
}

export function AuthWizard({
  onAuthed,
  initialMode = "login",
  onBack,
}: {
  onAuthed: (user: AuthUser) => void;
  initialMode?: AuthMode;
  onBack?: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [step, setStep] = useState<Step>("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The identity is HELD after the account step and only surfaced to onAuthed at "Enter Tvashtr".
  const [user, setUser] = useState<AuthUser | null>(null);
  // Throwaway onboarding answers — for the recap chips only; discarded on entry (no persistence).
  const [role, setRole] = useState<string | null>(null);
  const [building, setBuilding] = useState<string | null>(null);

  const isSignup = mode === "register";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const authed = isSignup ? await register(email, password) : await login(email, password);
      setUser(authed);
      // Hold the identity; DON'T call onAuthed yet. Sign-up detours through the two questions;
      // sign-in jumps straight to the success step.
      setStep(isSignup ? "role" : "success");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401) setError("Incorrect email or password.");
      else if (status === 409) setError("That email already has an account — try logging in.");
      else if (status === 422)
        setError("Enter a valid email and a password of at least 8 characters.");
      else setError("Something went wrong. Is the backend running?");
    } finally {
      setBusy(false);
    }
  };

  const toggleMode = () => {
    setMode((m) => (m === "login" ? "register" : "login"));
    setError(null);
  };

  const enter = () => {
    if (user) onAuthed(user);
  };

  const brand = brandCopy(mode, step);
  const showProgress = isSignup && step !== "success";
  const stepIndex = step === "account" ? 1 : step === "role" ? 2 : 3;

  // Recap chips echo the picked answers on the brand panel (sign-up, pre-success).
  const chips: { label: string; Icon: LucideIcon }[] = [];
  if (isSignup && step !== "success") {
    const r = ROLE_OPTS.find((o) => o.val === role);
    const b = BUILD_OPTS.find((o) => o.val === building);
    if (r) chips.push({ label: r.title, Icon: r.Icon });
    if (b) chips.push({ label: b.title, Icon: b.Icon });
  }

  return (
    <div className="tv-authwiz">
      {/* BRAND PANEL — folds away ≤720px (see index.css) */}
      <aside className="tv-authwiz__brand">
        <div className="tv-authwiz__brand-wash" />
        <img
          className="tv-authwiz__brand-mark"
          src="/mark-coral.png"
          alt=""
          width={460}
          height={460}
        />
        <div className="tv-authwiz__brand-inner">
          <div className="tv-authwiz__brand-logo">
            <img src="/mark-coral.png" alt="" width={28} height={28} />
            <span className="tv-authwiz__brand-word">Tvashtr</span>
          </div>
          <div>
            <div className="tv-authwiz__eyebrow">{brand.eyebrow}</div>
            <h1 className="tv-authwiz__brand-headline">{brand.headline}</h1>
            <p className="tv-authwiz__brand-sub">{brand.sub}</p>
            {chips.length > 0 && (
              <div className="tv-authwiz__recap">
                {chips.map((c) => (
                  <span className="tv-authwiz__chip" key={c.label}>
                    <c.Icon size={13} strokeWidth={1.7} aria-hidden="true" />
                    {c.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <p className="tv-authwiz__brand-foot">
            The loom remembers — threads you can pick back up.
          </p>
        </div>
      </aside>

      {/* FORM PANEL */}
      <div className="tv-authwiz__panel">
        <div className="tv-authwiz__form">
          {showProgress && (
            <div className="tv-authwiz__progress">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`tv-authwiz__seg${stepIndex >= i ? " tv-authwiz__seg--on" : ""}`}
                />
              ))}
              <span className="tv-authwiz__steplabel">Step {stepIndex} of 3</span>
            </div>
          )}

          {step === "account" && (
            <div className="tv-authwiz__step">
              <h2 className="tv-authwiz__h2">
                {isSignup ? "Create your account" : "Welcome back"}
              </h2>
              <p className="tv-authwiz__lede">
                {isSignup
                  ? "Your email and password — that's all we keep."
                  : "Sign in to your teams and runs."}
              </p>
              <div className="tv-authwiz__fields">
                <label className="tv-authwiz__field">
                  <span className="tv-authwiz__label">Email</span>
                  <span className="tv-authwiz__inputwrap">
                    <Mail
                      className="tv-authwiz__inputicon"
                      size={16}
                      strokeWidth={1.6}
                      aria-hidden="true"
                    />
                    <input
                      className="tv-authwiz__input"
                      type="email"
                      autoComplete="email"
                      value={email}
                      aria-label="Email"
                      placeholder="you@studio.dev"
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError(null);
                      }}
                    />
                  </span>
                </label>
                <label className="tv-authwiz__field">
                  <span className="tv-authwiz__label">Password</span>
                  <span className="tv-authwiz__inputwrap">
                    <Lock
                      className="tv-authwiz__inputicon"
                      size={16}
                      strokeWidth={1.6}
                      aria-hidden="true"
                    />
                    <input
                      className="tv-authwiz__input"
                      type="password"
                      autoComplete={isSignup ? "new-password" : "current-password"}
                      value={password}
                      aria-label="Password"
                      placeholder={isSignup ? "At least 8 characters" : "Your password"}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submit();
                      }}
                    />
                  </span>
                </label>
                {error && (
                  <div className="tv-auth__error" role="alert">
                    {error}
                  </div>
                )}
                <button
                  type="button"
                  className="tv-btn tv-authwiz__submit"
                  onClick={() => void submit()}
                  disabled={busy}
                >
                  {busy ? "…" : isSignup ? "Create account" : "Sign in"}
                </button>
              </div>
              <div className="tv-authwiz__account-nav">
                {onBack && (
                  <button type="button" className="tv-btn tv-btn--link" onClick={onBack}>
                    ← Back
                  </button>
                )}
                <button type="button" className="tv-authwiz__toggle" onClick={toggleMode}>
                  {isSignup ? "Already have an account? " : "New here? "}
                  <span className="tv-authwiz__toggle-em">
                    {isSignup ? "Sign in" : "Create an account"}
                  </span>
                </button>
              </div>
              <p className="tv-authwiz__fineprint">
                Only your email and password are stored. Your keys go straight to your providers,
                and we only ever keep the last four digits.
              </p>
            </div>
          )}

          {step === "role" && (
            <div className="tv-authwiz__step">
              <h2 className="tv-authwiz__h2">{"What's your role?"}</h2>
              <p className="tv-authwiz__lede">{"This isn't saved — it just sets the scene."}</p>
              <div className="tv-authwiz__opts">
                {ROLE_OPTS.map((o) => (
                  <OptionCard
                    key={o.val}
                    opt={o}
                    selected={role === o.val}
                    onSelect={() => setRole(o.val)}
                  />
                ))}
              </div>
              <div className="tv-authwiz__nav tv-authwiz__nav--end">
                <button
                  type="button"
                  className="tv-btn tv-authwiz__continue"
                  onClick={() => setStep("building")}
                  disabled={!role}
                >
                  Continue
                  <ArrowRight size={15} strokeWidth={1.9} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {step === "building" && (
            <div className="tv-authwiz__step">
              <h2 className="tv-authwiz__h2">What are you building?</h2>
              <p className="tv-authwiz__lede">
                Start from a fresh idea, or point a team at a repo you already have.
              </p>
              <div className="tv-authwiz__opts">
                {BUILD_OPTS.map((o) => (
                  <OptionCard
                    key={o.val}
                    opt={o}
                    selected={building === o.val}
                    onSelect={() => setBuilding(o.val)}
                  />
                ))}
              </div>
              <div className="tv-authwiz__nav">
                <button
                  type="button"
                  className="tv-btn tv-btn--link"
                  onClick={() => setStep("role")}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  className="tv-btn tv-authwiz__continue"
                  onClick={() => setStep("success")}
                  disabled={!building}
                >
                  Continue
                  <ArrowRight size={15} strokeWidth={1.9} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {step === "success" && (
            <div className="tv-authwiz__step tv-authwiz__success">
              <span className="tv-authwiz__success-badge">
                <Check size={28} strokeWidth={2.4} aria-hidden="true" />
              </span>
              <h2 className="tv-authwiz__success-h2">{"You're in."}</h2>
              <p className="tv-authwiz__success-sub">
                {isSignup
                  ? "Your canvas is ready — start a thread and it'll appear on the loom."
                  : "Your teams and runs are right where you left them."}
              </p>
              <button type="button" className="tv-btn tv-authwiz__enter" onClick={enter}>
                Enter Tvashtr
                <ArrowRight size={16} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
