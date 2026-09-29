import { BookOpen, PackageCheck, ShieldCheck, X, Zap } from "lucide-react";

import type { CreateNodeBody } from "../lib/api";

// F1b: the canvas node menu — the SINGLE SOURCE OF TRUTH reused by BOTH the top-left "Add to
// canvas" palette AND the inline node "+" picker. Ruling 2 (DmF-Canvas-1): Agent · Gate · Ship ·
// Stop · Query domain, no Presets row. "Agent" is a blank worker (every agent runs the agent loop
// since M-unify); role starting points (PM / Architect / Engineer / Reviewer) come from the drawer's
// Templates. The API still accepts `node_kind: "thinker"` and `preset`. **Ship + Stop stay
// SEPARATE** (CreateNodeBody.terminal_kind is required). Lives in a NON-component module so
// NodePalette.tsx keeps Fast Refresh (react-refresh/only-export-components).
export interface PaletteChip {
  label: string;
  title: string;
  body: CreateNodeBody;
  Icon: typeof Zap;
}

export const PALETTE_PRIMITIVES: PaletteChip[] = [
  {
    label: "Agent",
    title: "A blank agent (reads & writes files; start it from a template)",
    body: { node_kind: "worker" },
    Icon: Zap,
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
    Icon: X,
  },
  {
    label: "Query domain",
    title: "Ask a Domain with citations (PolyRAG)",
    body: { node_kind: "domain_query", prompt: "{idea}" },
    Icon: BookOpen,
  },
];
