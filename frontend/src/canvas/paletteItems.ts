import {
  BookOpen,
  ClipboardCheck,
  DraftingCompass,
  OctagonX,
  Package,
  PenLine,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";

import type { CreateNodeBody } from "../lib/api";

// F1b: the canvas node menu — the SINGLE SOURCE OF TRUTH reused by BOTH the top-left "Add to
// canvas" palette AND the inline node "+" picker. Add primitives (thinker / worker / gate / Ship /
// Stop) + role Presets (PM / Architect / Engineer / Reviewer, seeded from the teams.py prompt
// constants). **Ship + Stop stay SEPARATE** (CreateNodeBody.terminal_kind is required and post-drop
// kind editing is F1c's drawer). Lives in a NON-component module so NodePalette.tsx keeps Fast
// Refresh (react-refresh/only-export-components).
export interface PaletteChip {
  label: string;
  title: string;
  body: CreateNodeBody;
  Icon: typeof PenLine;
}

export const PALETTE_PRIMITIVES: PaletteChip[] = [
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
    Icon: Package,
  },
  {
    label: "Stop",
    title: "An ending that stops without shipping",
    body: { node_kind: "terminal", terminal_kind: "stop" },
    Icon: OctagonX,
  },
  {
    label: "Query domain",
    title: "Ask a Domain with citations (PolyRAG)",
    body: { node_kind: "domain_query", prompt: "{idea}" },
    Icon: BookOpen,
  },
];

export const PALETTE_PRESETS: PaletteChip[] = [
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
