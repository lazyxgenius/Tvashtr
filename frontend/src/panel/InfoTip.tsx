import { Info } from "lucide-react";

/** The ⓘ next to a label: the one-line explanation lives in its tooltip (and its accessible name). */
export function InfoTip({ text, size = 13 }: { text: string; size?: number }) {
  return (
    <span className="nd-info" title={text} aria-label={text} role="img" tabIndex={0}>
      <Info size={size} strokeWidth={1.7} aria-hidden />
    </span>
  );
}
