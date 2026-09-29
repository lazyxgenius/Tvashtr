import { ClipboardCheck, FileText, Layers, type LucideIcon, Terminal, Zap } from "lucide-react";

/** The glyph each built-in template carries in the Templates menu and the chooser. */
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  pm: Zap,
  architect: Layers,
  engineer: Terminal,
  reviewer: ClipboardCheck,
};

export function templateIcon(key: string): LucideIcon {
  return TEMPLATE_ICONS[key] ?? FileText;
}
