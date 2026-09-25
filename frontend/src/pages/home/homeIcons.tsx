import {
  ClipboardCheck,
  Layers,
  PackageCheck,
  Pencil,
  Search,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";

/** The GitHub mark (lucide dropped brand icons; this is the path the design uses). */
export function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

/** The design's filled "play" triangle on Launch / Run. */
export function PlayIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3l14 9-14 9V3z" />
    </svg>
  );
}

/** The icon inside a pipeline chip, by role / node kind (PM ⚡, Architect layers, gate shield…). */
export function ChipIcon({ role, kind }: { role: string; kind: string }) {
  const p = { size: 12, strokeWidth: 1.8, "aria-hidden": true } as const;
  const r = role.toLowerCase();
  if (kind === "gate" || r.endsWith("gate") || r === "approval") return <ShieldCheck {...p} />;
  if (r === "ship" || (kind === "terminal" && r !== "stop")) return <PackageCheck {...p} />;
  if (r === "pm") return <Zap {...p} />;
  if (r === "architect") return <Layers {...p} />;
  if (r === "engineer") return <Terminal {...p} />;
  if (r === "reviewer") return <ClipboardCheck {...p} />;
  if (kind === "domain_query" || r === "domain_query") return <Search {...p} />;
  if (kind === "completion" || kind === "thinker") return <Zap {...p} />;
  return <Pencil {...p} />;
}
