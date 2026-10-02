import type { LiveState } from "../../../lib/api/activity";

const P = {
  check: <path d="M20 6 9 17l-5-5" />,
  play: <path d="M6 4l14 8-14 8V4z" />,
  terminal: (
    <>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </>
  ),
  hand: (
    <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8l-1.5-1.5a2 2 0 0 0-3 2.6L6 20h11a4 4 0 0 0 4-4v-5a2 2 0 0 0-3 0" />
  ),
  retry: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  pause: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  alert: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="4" />,
  carried: (
    <>
      <path d="m15 10 5 5-5 5" />
      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
    </>
  ),
  ship: (
    <>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <path d="M6 9v12" />
    </>
  ),
};

const GLYPH: Partial<Record<LiveState, keyof typeof P>> = {
  done: "check",
  working: "play",
  running_command: "terminal",
  needs_you: "hand",
  retrying: "retry",
  quiet: "pause",
  stalled: "alert",
  failed: "alert",
  carried_over: "carried",
};

/** The small stroke icon a state is drawn with (the boards' Lucide set). */
export function StateGlyph({ state, ship = false }: { state: LiveState; ship?: boolean }) {
  const name = ship ? "ship" : (GLYPH[state] ?? "dot");
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  );
}
