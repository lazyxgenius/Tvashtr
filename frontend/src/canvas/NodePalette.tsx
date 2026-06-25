import {
  ClipboardCheck,
  DraftingCompass,
  OctagonX,
  PackageCheck,
  PenLine,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";

import type { CreateNodeBody } from "../lib/api";

// The canvas palette (P1.8d): drop blank primitives (thinker / worker / gate / Ship / Stop) or a
// pre-filled-but-editable role preset (PM / Architect / Engineer / Reviewer, seeded from the
// teams.py prompt constants — node-granularity drop-and-edit). Distinct from the left teams rail:
// this tray adds NODES to the open team. The parent fills in the drop `position`.

interface Chip {
  label: string;
  title: string;
  body: CreateNodeBody;
  Icon: typeof PenLine;
}

const PRIMITIVES: Chip[] = [
  {
    label: "Thinker",
    title: "A direct-LLM node (writes/refines the spec)",
    body: { node_kind: "thinker" },
    Icon: Sparkles,
  },
  {
    label: "Worker",
    title: "A sandboxed agent (reads & writes files)",
    body: { node_kind: "worker" },
    Icon: Wrench,
  },
  {
    label: "Gate",
    title: "A human approval checkpoint",
    body: { node_kind: "gate" },
    Icon: ShieldCheck,
  },
  {
    label: "Ship",
    title: "An ending that commits & ships",
    body: { node_kind: "terminal", terminal_kind: "ship" },
    Icon: PackageCheck,
  },
  {
    label: "Stop",
    title: "An ending that stops without shipping",
    body: { node_kind: "terminal", terminal_kind: "stop" },
    Icon: OctagonX,
  },
];

const PRESETS: Chip[] = [
  {
    label: "PM",
    title: "Pre-filled product manager (drafts the spec)",
    body: { node_kind: "thinker", preset: "pm" },
    Icon: PenLine,
  },
  {
    label: "Architect",
    title: "Pre-filled architect (adds the technical design)",
    body: { node_kind: "thinker", preset: "architect" },
    Icon: DraftingCompass,
  },
  {
    label: "Engineer",
    title: "Pre-filled engineer (builds & ships)",
    body: { node_kind: "worker", preset: "engineer" },
    Icon: Terminal,
  },
  {
    label: "Reviewer",
    title: "Pre-filled reviewer (checks against the spec)",
    body: { node_kind: "worker", preset: "reviewer" },
    Icon: ClipboardCheck,
  },
];

export function NodePalette({
  onAdd,
  disabled = false,
}: {
  onAdd: (body: CreateNodeBody) => void;
  disabled?: boolean;
}) {
  return (
    <div className="tv-palette" aria-label="Add nodes">
      <div className="tv-palette__group">
        <span className="tv-palette__label">Add</span>
        {PRIMITIVES.map((c) => (
          <button
            key={c.label}
            type="button"
            className="tv-palette__chip"
            title={c.title}
            disabled={disabled}
            onClick={() => onAdd(c.body)}
          >
            <c.Icon size={14} strokeWidth={1.7} />
            {c.label}
          </button>
        ))}
      </div>
      <div className="tv-palette__group">
        <span className="tv-palette__label">Presets</span>
        {PRESETS.map((c) => (
          <button
            key={c.label}
            type="button"
            className="tv-palette__chip tv-palette__chip--preset"
            title={c.title}
            disabled={disabled}
            onClick={() => onAdd(c.body)}
          >
            <c.Icon size={14} strokeWidth={1.7} />
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
