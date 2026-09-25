import type { ReactNode } from "react";
import {
  BookOpen,
  ChevronRight,
  ClipboardCheck,
  Layers,
  Lightbulb,
  PackageCheck,
  ShieldCheck,
  Terminal,
  Wrench,
  Zap,
} from "lucide-react";

import type { TeamShape } from "../../lib/api";

/** Chip sizes the designs use: team card 22, first-time template 20, New team card 18, list row 14. */
export type StripSize = 22 | 20 | 18 | 14;

const ICON_PX: Record<StripSize, number> = { 22: 12, 20: 11, 18: 9, 14: 7 };

function roleIcon(role: string, kind: string, px: number): ReactNode {
  const p = { size: px, strokeWidth: 1.8, "aria-hidden": true } as const;
  switch (role) {
    case "pm":
      return <Zap {...p} />;
    case "architect":
      return <Layers {...p} />;
    case "engineer":
      return <Terminal {...p} />;
    case "reviewer":
      return <ClipboardCheck {...p} />;
    case "gate":
      return <ShieldCheck {...p} />;
    case "ship":
      return <PackageCheck {...p} />;
    case "domain_query":
      return <BookOpen {...p} />;
    default:
      if (kind === "gate") return <ShieldCheck {...p} />;
      if (kind === "terminal") return <PackageCheck {...p} />;
      if (kind === "worker") return <Wrench {...p} />;
      if (kind === "domain_query") return <BookOpen {...p} />;
      return <Lightbulb {...p} />;
  }
}

/**
 * A team's shape as a row of role chips (TEAMS-14): the main path from the start node to Ship,
 * chevrons between chips and ⇄ between two nodes joined by a loop-back edge. Used by team cards,
 * list rows, the New team dialog and the first-time templates.
 */
export function PipelineStrip({
  shape,
  size = 22,
}: {
  shape: TeamShape | undefined;
  size?: StripSize;
}) {
  const nodes = shape?.nodes ?? [];
  if (nodes.length === 0) return null;
  const loopPairs = new Set(
    (shape?.loops ?? []).map((l) => `${Math.min(l.from, l.to)}:${Math.max(l.from, l.to)}`),
  );
  const out: ReactNode[] = [];
  nodes.forEach((n, i) => {
    if (i > 0) {
      out.push(
        loopPairs.has(`${i - 1}:${i}`) ? (
          <span key={`sep-${i}`} className="hm-strip__loop" aria-hidden="true">
            ⇄
          </span>
        ) : (
          <span key={`sep-${i}`} className="hm-strip__chev" aria-hidden="true">
            <ChevronRight size={11} strokeWidth={2} />
          </span>
        ),
      );
    }
    out.push(
      <span
        key={`n-${i}`}
        className={`hm-strip__chip hm-strip__chip--${size}`}
        title={n.label}
        role="img"
        aria-label={n.label}
      >
        {roleIcon(n.role, n.kind, ICON_PX[size])}
      </span>,
    );
  });
  return <div className="hm-strip">{out}</div>;
}
