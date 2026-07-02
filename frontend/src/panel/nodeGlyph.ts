import {
  ClipboardCheck,
  DraftingCompass,
  type LucideIcon,
  OctagonX,
  PackageCheck,
  PenLine,
  ShieldCheck,
  Terminal,
} from "lucide-react";

// F1c: the config-drawer header badge glyph for a node — the SAME icon vocabulary the canvas card
// uses (`AgentNodeCard`), so the drawer reads as "this node": a gate → shield, a terminal → package
// (ship) / octagon (stop), an agent/completion → its role glyph (fallback `Terminal`, matching the
// card). The entry-node `Zap` swap is a canvas-only treatment; the drawer keeps the role glyph.
const ROLE_ICON: Record<string, LucideIcon> = {
  pm: PenLine,
  architect: DraftingCompass,
  engineer: Terminal,
  reviewer: ClipboardCheck,
};

export function glyphForNode(kind: string, roleName: string, terminalKind?: string): LucideIcon {
  if (kind === "gate") return ShieldCheck;
  if (kind === "terminal") return terminalKind === "ship" ? PackageCheck : OctagonX;
  return ROLE_ICON[roleName] ?? Terminal;
}
