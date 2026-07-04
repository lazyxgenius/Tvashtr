import { type CSSProperties, useEffect, useRef, useState } from "react";

import "../landing.css";
import type { AuthMode } from "./AuthWizard";

/* ============================================================
   F4 — the premium logged-out landing, rebuilt from
   design/Tvashtr Frontend Overhaul/Landing.dc.html.

   FE-only + STATIC: it owns no data and no auth. The CTAs call
   back into `onGetStarted(mode)` (the preserved M-accounts Slice B
   contract), which AuthGate routes to the login/register screen —
   the only way into the product. Both auth modes stay reachable:
   "Sign in" -> login, "Start building"/"Get started" -> register.

   Two scroll-reactive centrepieces live in landing.css:
   1. the hero stage parallaxes on document scroll; a JS fit-scale
      (useFitScale) shrinks the fixed 470x392 board to fit narrow
      columns.
   2. the how-it-works nodes assemble on scroll (view() timeline).
   Both degrade to a readable static state under the F0
   prefers-reduced-motion guard (extend.css).
   ============================================================ */

// Allow inline CSS custom properties (--range / --len) alongside typed CSS props.
type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

type IconId =
  | "arrow"
  | "zap"
  | "compass"
  | "shield"
  | "terminal"
  | "clipboard"
  | "package"
  | "check"
  | "git"
  | "lock"
  | "users"
  | "file"
  | "eye"
  | "code"
  | "building"
  | "branch";

/** A stroke icon referencing the ported <symbol> defs (rendered once by <LandingDefs/>). */
function Icon({ id, size = 16, stroke = 1.8 }: { id: IconId; size?: number; stroke?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <use href={`#i-${id}`} />
    </svg>
  );
}

/** The icon symbol library (lucide geometry, ported verbatim from the design). */
function LandingDefs() {
  return (
    <svg className="tv-lp__defs" aria-hidden="true">
      <defs>
        <symbol id="i-arrow" viewBox="0 0 24 24">
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </symbol>
        <symbol id="i-zap" viewBox="0 0 24 24">
          <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
        </symbol>
        <symbol id="i-compass" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.8" />
          <path d="m3.5 20.5 7-9.8" />
          <path d="m13.6 10.6 6.9 9.9" />
          <path d="M9.8 15.2 12 12" />
        </symbol>
        <symbol id="i-shield" viewBox="0 0 24 24">
          <path d="M20 13c0 5-3.5 7.4-7.66 8.95a1 1 0 0 1-.67 0C7.5 20.4 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="m9 12 2 2 4-4" />
        </symbol>
        <symbol id="i-terminal" viewBox="0 0 24 24">
          <path d="m4 17 6-6-6-6" />
          <path d="M12 19h8" />
        </symbol>
        <symbol id="i-clipboard" viewBox="0 0 24 24">
          <rect width="8" height="4" x="8" y="2" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="m9 14 2 2 4-4" />
        </symbol>
        <symbol id="i-package" viewBox="0 0 24 24">
          <path d="m16 16 2 2 4-4" />
          <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
          <path d="M3.29 7 12 12l8.71-5" />
          <path d="M12 22V12" />
        </symbol>
        <symbol id="i-check" viewBox="0 0 24 24">
          <path d="M20 6 9 17l-5-5" />
        </symbol>
        <symbol id="i-git" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M3 12h6" />
          <path d="M15 12h6" />
        </symbol>
        <symbol id="i-lock" viewBox="0 0 24 24">
          <rect width="18" height="11" x="3" y="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </symbol>
        <symbol id="i-users" viewBox="0 0 24 24">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </symbol>
        <symbol id="i-file" viewBox="0 0 24 24">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v5h5" />
          <path d="M9 13h6" />
          <path d="M9 17h4" />
        </symbol>
        <symbol id="i-eye" viewBox="0 0 24 24">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </symbol>
        <symbol id="i-code" viewBox="0 0 24 24">
          <path d="m16 18 6-6-6-6" />
          <path d="m8 6-6 6 6 6" />
        </symbol>
        <symbol id="i-building" viewBox="0 0 24 24">
          <rect width="16" height="20" x="4" y="2" rx="2" />
          <path d="M9 22v-4h6v4" />
          <path d="M8 6h.01" />
          <path d="M16 6h.01" />
          <path d="M12 6h.01" />
          <path d="M12 10h.01" />
          <path d="M16 10h.01" />
          <path d="M8 10h.01" />
          <path d="M12 14h.01" />
        </symbol>
        <symbol id="i-branch" viewBox="0 0 24 24">
          <path d="M6 3v12" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </symbol>
      </defs>
    </svg>
  );
}

/**
 * Fit a fixed-width board (baseW) into its responsive container: scale down when the container is
 * narrower, centre (left offset) when wider. Guards jsdom (clientWidth 0 -> scale 1) and older envs
 * (no ResizeObserver). Mirrors the design's measure logic.
 */
function useFitScale(baseW: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; left: number }>({ scale: 1, left: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const scale = w > 0 ? Math.min(1, w / baseW) : 1;
      const left = w > baseW ? (w - baseW) / 2 : 0;
      setFit((prev) =>
        Math.abs(prev.scale - scale) > 0.002 || Math.abs(prev.left - left) > 0.5
          ? { scale, left }
          : prev,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [baseW]);

  return { ref, scale: fit.scale, left: fit.left };
}

/* ---- static content ---- */

const TRUST_CHIPS: { icon: IconId; label: string }[] = [
  { icon: "git", label: "git-aware" },
  { icon: "lock", label: "bring your own keys" },
  { icon: "clipboard", label: "every PR reviewed" },
];

const STAGE_NODES: {
  key: string;
  glyph: IconId;
  name: string;
  x: number;
  y: number;
  w: number;
  accent: boolean;
  delay: number;
}[] = [
  { key: "pm", glyph: "zap", name: "PM", x: 14, y: 74, w: 118, accent: true, delay: 0 },
  {
    key: "arch",
    glyph: "compass",
    name: "Architect",
    x: 180,
    y: 128,
    w: 128,
    accent: false,
    delay: 1,
  },
  {
    key: "eng",
    glyph: "terminal",
    name: "Engineer",
    x: 352,
    y: 232,
    w: 122,
    accent: false,
    delay: 2.6,
  },
  {
    key: "rev",
    glyph: "clipboard",
    name: "Reviewer",
    x: 196,
    y: 268,
    w: 128,
    accent: false,
    delay: 3.6,
  },
];

const STEPS = [
  { num: "1", title: "Author the team", sub: "Drop nodes, wire the flow" },
  { num: "2", title: "Run it", sub: "Watch the work move" },
  { num: "3", title: "It ships", sub: "A reviewed change" },
];

type HiwNode = {
  id: string;
  glyph: IconId;
  label: string;
  sub: string;
  x: number;
  y: number;
  kind?: "start" | "gate" | "term";
};

const HIW_NODES: HiwNode[] = [
  {
    id: "pm",
    glyph: "zap",
    label: "Product manager",
    sub: "drafts the spec",
    x: 14,
    y: 66,
    kind: "start",
  },
  { id: "arch", glyph: "compass", label: "Architect", sub: "adds the design", x: 196, y: 66 },
  {
    id: "gate",
    glyph: "shield",
    label: "PRD approval",
    sub: "your call",
    x: 376,
    y: 70,
    kind: "gate",
  },
  { id: "eng", glyph: "terminal", label: "Engineers", sub: "build it", x: 542, y: 66 },
  { id: "rev", glyph: "clipboard", label: "Reviewer", sub: "checks the work", x: 716, y: 66 },
  { id: "ship", glyph: "package", label: "Ship", sub: "reviewed PR", x: 886, y: 70, kind: "term" },
];

const hiwWidth = (n: HiwNode) => (n.kind === "gate" ? 150 : n.kind === "term" ? 116 : 158);

const HIW_EDGES = HIW_NODES.slice(0, -1).map((a, i) => {
  const b = HIW_NODES[i + 1];
  const aw = hiwWidth(a);
  const sx = a.x + aw;
  const sy = a.y + 22;
  const tx = b.x;
  const ty = b.y + 22;
  const dx = Math.max(30, (tx - sx) * 0.5);
  return {
    d: `M${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`,
    len: tx - sx + 60,
    last: i === HIW_NODES.length - 2,
    range: `cover ${8 + i * 10}% cover ${28 + i * 10}%`,
  };
});

function hiwCardStyle(n: HiwNode): CSSProperties {
  const done = n.kind === "term";
  const accent = n.kind === "start" || n.kind === "gate";
  return {
    padding: n.kind === "gate" ? "8px 13px" : "10px 12px",
    borderRadius: n.kind === "gate" ? 999 : 12,
    background: done
      ? "color-mix(in srgb, var(--sage-100) 50%, var(--surface-card))"
      : "var(--surface-card)",
    borderColor: done ? "var(--sage-500)" : accent ? "var(--coral-200)" : "var(--border-hairline)",
  };
}

function hiwGlyphStyle(n: HiwNode): CSSProperties {
  const done = n.kind === "term";
  const accent = n.kind === "start" || n.kind === "gate";
  return {
    background: accent
      ? "var(--coral-100)"
      : done
        ? "color-mix(in srgb, var(--sage-100) 70%, var(--surface-card))"
        : "var(--panel-300)",
    color: accent
      ? "var(--coral-700)"
      : done
        ? "color-mix(in srgb, var(--sage-500) 66%, var(--ink-900))"
        : "var(--ink-700)",
    border: accent ? "1px solid var(--coral-200)" : "none",
  };
}

const DIFFS: { icon: IconId; title: string; body: string }[] = [
  {
    icon: "users",
    title: "Your team is yours",
    body: "Compose the roles, the prompts, and the wiring on a canvas. Save it, re-run it, fork it. It is not a fixed product flow — it is your process.",
  },
  {
    icon: "file",
    title: "Steerable live documents",
    body: "The PRD is a living document the team reads as it works. Edit it mid-run and your changes reach the agents on their next read.",
  },
  {
    icon: "eye",
    title: "Per-node legibility",
    body: "Open any node and read exactly what it did — the prompt, the model, the run feed, and the reviewer’s verdict for every round.",
  },
];

const PERSONAS: { icon: IconId; title: string; body: string }[] = [
  {
    icon: "code",
    title: "Engineers",
    body: "Point a team at your repo, wire the review loop the way you actually review, and get a reviewed PR back.",
  },
  {
    icon: "building",
    title: "Founders",
    body: "Turn an idea into a spec, a prototype, then shipped code — without assembling a whole team first.",
  },
  {
    icon: "branch",
    title: "Solo builders",
    body: "Run a small studio of agents that take work end to end while you stay in the loop at the gates that matter.",
  },
];

export function LandingPage({ onGetStarted }: { onGetStarted: (mode: AuthMode) => void }) {
  const hero = useFitScale(470);
  const hiw = useFitScale(1000);

  return (
    <div className="tv-lp">
      <LandingDefs />

      <a className="tv-lp__skip" href="#main-content">
        Skip to content
      </a>

      {/* NAV */}
      <nav className="tv-lp__nav" aria-label="Primary">
        <a className="tv-lp__brand" href="#top">
          <img src="/mark-coral.png" alt="" width={26} height={26} />
          <span className="tv-lp__wordmark">Tvashtr</span>
        </a>
        <div className="tv-lp__nav-links">
          <a className="tv-lp__nav-link" href="#how">
            How it works
          </a>
          <a className="tv-lp__nav-link tv-lp__nav-link--wide" href="#why">
            Why it&rsquo;s different
          </a>
          <a className="tv-lp__nav-link tv-lp__nav-link--wide" href="#who">
            Who it&rsquo;s for
          </a>
          <button
            type="button"
            className="tv-lp__nav-link tv-lp__nav-signin"
            onClick={() => onGetStarted("login")}
          >
            Sign in
          </button>
          <button type="button" className="tv-lp__nav-cta" onClick={() => onGetStarted("register")}>
            Get started
            <Icon id="arrow" size={14} />
          </button>
        </div>
      </nav>

      <main className="tv-lp__main" id="main-content" tabIndex={-1}>
        {/* HERO */}
        <header className="tv-lp__hero" id="top">
          <div className="tv-lp__hero-wash" />
          <img className="tv-lp__hero-mark" src="/mark-coral.png" alt="" width={520} height={520} />
          <div className="tv-lp__hero-inner">
            <div className="tv-lp__hero-copy">
              <div className="tv-lp__badge">
                <span className="tv-lp__badge-dot" />
                <span>Compose your own team of AI agents</span>
              </div>
              <h1 className="tv-lp__headline">
                Build the team,
                <br />
                not just <span className="tv-lp__headline-em">use</span> one.
              </h1>
              <p className="tv-lp__lede">
                Tvashtr is a visual canvas where you author and run your own team of AI agents —
                taking an idea, or a feature request against your real repo, all the way to
                reviewed, shipped code.
              </p>
              <div className="tv-lp__cta-row">
                <button
                  type="button"
                  className="tv-lp__cta tv-lp__cta--primary"
                  onClick={() => onGetStarted("register")}
                >
                  Start building
                  <Icon id="arrow" size={16} stroke={1.9} />
                </button>
                <a className="tv-lp__cta tv-lp__cta--ghost" href="#how">
                  See how it works
                </a>
              </div>
              <div className="tv-lp__chips">
                {TRUST_CHIPS.map((c) => (
                  <span className="tv-lp__chip" key={c.label}>
                    <Icon id={c.icon} size={14} stroke={1.7} />
                    {c.label}
                  </span>
                ))}
              </div>
            </div>

            {/* ALIVE HERO STAGE */}
            <div className="tv-lp__hero-stage" ref={hero.ref} style={{ height: 392 * hero.scale }}>
              <div
                className="tv-lp__hero-stage-inner"
                style={{ transform: `translateX(${hero.left}px) scale(${hero.scale})` }}
              >
                <div className="tv-lp__stage-grid" />
                <div className="tv-lp__stage-live">
                  <span className="tv-lp__stage-live-dot" />
                  Live · weaving
                </div>
                <svg className="tv-lp__stage-edges" viewBox="0 0 470 392">
                  <path
                    className="tv-lp__flow-edge"
                    d="M86 96 C 140 96, 150 150, 200 150"
                    fill="none"
                    strokeWidth={2}
                    strokeDasharray="3 7"
                    strokeLinecap="round"
                    style={{ stroke: "var(--lp-flow)" }}
                  />
                  <path
                    d="M86 96 C 140 96, 150 96, 196 96"
                    fill="none"
                    strokeWidth={1.6}
                    style={{ stroke: "var(--border-strong)" }}
                  />
                  <path
                    className="tv-lp__flow-edge"
                    d="M282 150 C 330 150, 330 96, 372 96"
                    fill="none"
                    strokeWidth={2}
                    strokeDasharray="3 7"
                    strokeLinecap="round"
                    style={{ stroke: "var(--lp-flow)" }}
                  />
                  <path
                    d="M282 150 C 330 150, 330 250, 372 250"
                    fill="none"
                    strokeWidth={1.6}
                    style={{ stroke: "var(--border-strong)" }}
                  />
                  <path
                    d="M372 96 C 405 96, 405 280, 250 290"
                    fill="none"
                    strokeWidth={1.8}
                    strokeDasharray="6 5"
                    style={{
                      stroke: "color-mix(in srgb, var(--accent) 45%, var(--border-strong))",
                    }}
                  />
                </svg>

                {STAGE_NODES.map((n) => (
                  <div
                    key={n.key}
                    className="tv-lp__stage-node tv-lp__stage-node--wave"
                    style={{ left: n.x, top: n.y, width: n.w, animationDelay: `${n.delay}s` }}
                  >
                    <div className="tv-lp__stage-row">
                      <span
                        className={`tv-lp__stage-glyph ${
                          n.accent ? "tv-lp__stage-glyph--accent" : "tv-lp__stage-glyph--panel"
                        }`}
                      >
                        <Icon id={n.glyph} size={13} stroke={1.6} />
                      </span>
                      <span className="tv-lp__stage-name">{n.name}</span>
                    </div>
                  </div>
                ))}

                <div className="tv-lp__stage-gate" style={{ left: 352, top: 78, width: 104 }}>
                  <div className="tv-lp__stage-gate-row">
                    <Icon id="shield" size={14} stroke={1.7} />
                    <span>approve</span>
                  </div>
                </div>

                <div className="tv-lp__stage-ship" style={{ left: 40, top: 290, width: 96 }}>
                  <div className="tv-lp__stage-ship-row">
                    <Icon id="package" size={14} stroke={1.7} />
                    <span>Shipped</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* WEDGE */}
        <section className="tv-lp__section tv-lp__wedge" id="why">
          <div className="tv-lp__wedge-head tv-lp__reveal">
            <span className="tv-lp__eyebrow">The gap</span>
            <h2 className="tv-lp__h2">
              Agent frameworks make you hand-wire everything. Coding agents hide their team.
            </h2>
            <p className="tv-lp__section-lede">
              You either glue together a framework and own every edge of the orchestration, or you
              hand the whole job to an opaque agent and hope. Tvashtr sits in between:{" "}
              <strong>composable like a framework, legible like a teammate</strong> — and it works
              against your real codebase.
            </p>
          </div>
          <div className="tv-lp__compare">
            <div className="tv-lp__compare-card tv-lp__reveal">
              <div className="tv-lp__compare-label">// without Tvashtr</div>
              <ul className="tv-lp__compare-list">
                <li>Wire orchestration by hand, or trust a black box</li>
                <li>No view into what each agent actually did</li>
                <li>Demos on toy repos, not your codebase</li>
              </ul>
            </div>
            <div className="tv-lp__compare-card tv-lp__compare-card--with tv-lp__reveal">
              <div className="tv-lp__compare-label">// with Tvashtr</div>
              <ul className="tv-lp__compare-list">
                <li>Draw the team on a canvas, wire it your way</li>
                <li>Open any node, read exactly what it did</li>
                <li>Runs against your real repo, ships a reviewed PR</li>
              </ul>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS — scroll-assembling */}
        <section className="tv-lp__how" id="how">
          <div className="tv-lp__how-wash" />
          <div className="tv-lp__how-inner">
            <div className="tv-lp__how-head">
              <div className="tv-lp__eyebrow">How it works</div>
              <h2 className="tv-lp__h2">The team assembles as you scroll.</h2>
            </div>

            <div className="tv-lp__steps">
              {STEPS.map((s) => (
                <div className="tv-lp__step" key={s.num}>
                  <span className="tv-lp__step-num">{s.num}</span>
                  <div className="tv-lp__step-text">
                    <div className="tv-lp__step-title">{s.title}</div>
                    <div className="tv-lp__step-sub">{s.sub}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="tv-lp__hiw-stage" ref={hiw.ref} style={{ height: 200 * hiw.scale }}>
              <div
                className="tv-lp__hiw-inner"
                style={{ left: hiw.left, transform: `scale(${hiw.scale})` }}
              >
                <svg className="tv-lp__hiw-edges" viewBox="0 0 1000 200">
                  {HIW_EDGES.map((e) => (
                    <path
                      key={e.d}
                      className="tv-lp__hiw-edge"
                      d={e.d}
                      style={
                        {
                          stroke: e.last ? "var(--sage-500)" : "var(--border-strong)",
                          strokeDasharray: String(e.len),
                          "--len": e.len,
                          "--range": e.range,
                        } as CSSVars
                      }
                    />
                  ))}
                </svg>
                {HIW_NODES.map((n, i) => (
                  <div
                    key={n.id}
                    className="tv-lp__hiw-node"
                    style={
                      {
                        left: n.x,
                        top: n.y,
                        width: hiwWidth(n),
                        "--range": `cover ${5 + i * 10}% cover ${30 + i * 10}%`,
                      } as CSSVars
                    }
                  >
                    <div className="tv-lp__hiw-card" style={hiwCardStyle(n)}>
                      <span className="tv-lp__hiw-glyph" style={hiwGlyphStyle(n)}>
                        <Icon id={n.glyph} size={15} stroke={1.6} />
                      </span>
                      <div className="tv-lp__hiw-text">
                        <div className="tv-lp__hiw-label">{n.label}</div>
                        <div className="tv-lp__hiw-sub">{n.sub}</div>
                      </div>
                      {n.kind === "term" && (
                        <span className="tv-lp__hiw-done">
                          <Icon id="check" size={11} stroke={3} />
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* DIFFERENTIATORS */}
        <section className="tv-lp__section">
          <div className="tv-lp__diffs-head tv-lp__reveal">
            <div className="tv-lp__eyebrow">Why Tvashtr</div>
            <h2 className="tv-lp__h2">Composable. Legible. Steerable.</h2>
          </div>
          <div className="tv-lp__diff-grid">
            {DIFFS.map((d) => (
              <div className="tv-lp__diff-card tv-lp__reveal" key={d.title}>
                <span className="tv-lp__diff-icon">
                  <Icon id={d.icon} size={21} stroke={1.6} />
                </span>
                <h3 className="tv-lp__diff-title">{d.title}</h3>
                <p className="tv-lp__diff-body">{d.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FOR WHOM */}
        <section className="tv-lp__section tv-lp__who" id="who">
          <div className="tv-lp__who-grid">
            <div className="tv-lp__who-intro tv-lp__reveal">
              <div className="tv-lp__eyebrow">Who it&rsquo;s for</div>
              <h2 className="tv-lp__h2">For people who want the team to be theirs.</h2>
              <p>Power users who think in process — and want to shape it, not inherit it.</p>
            </div>
            <div className="tv-lp__who-list">
              {PERSONAS.map((p) => (
                <div className="tv-lp__persona tv-lp__reveal" key={p.title}>
                  <span className="tv-lp__persona-icon">
                    <Icon id={p.icon} size={20} stroke={1.6} />
                  </span>
                  <div>
                    <div className="tv-lp__persona-title">{p.title}</div>
                    <div className="tv-lp__persona-body">{p.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CLOSING CTA */}
        <section className="tv-lp__closing">
          <div className="tv-lp__closing-panel tv-lp__reveal">
            <img
              className="tv-lp__closing-mark"
              src="/mark-coral.png"
              alt=""
              width={360}
              height={360}
            />
            <div className="tv-lp__closing-inner">
              <h2 className="tv-lp__closing-h2">Start weaving.</h2>
              <p className="tv-lp__closing-lede">
                Bring your keys, point it at a repo, and compose a team that ships. Nothing here yet
                — start a thread and it&rsquo;ll appear on the loom.
              </p>
              <button
                type="button"
                className="tv-lp__cta tv-lp__cta--primary tv-lp__cta--lg"
                onClick={() => onGetStarted("register")}
              >
                Get started
                <Icon id="arrow" size={16} stroke={1.9} />
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="tv-lp__footer">
        <div className="tv-lp__footer-brand">
          <img src="/mark-charcoal.png" alt="" width={22} height={22} />
          <span className="tv-lp__footer-word">Tvashtr</span>
          <span className="tv-lp__footer-tag">the celestial artisan</span>
        </div>
        <div className="tv-lp__footer-note">Composed teams that ship reviewed code.</div>
      </footer>
    </div>
  );
}
