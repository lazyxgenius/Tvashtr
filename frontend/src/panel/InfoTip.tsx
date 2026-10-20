import { Info } from "lucide-react";

/** The ⓘ next to a label: the one-line explanation lives in its tooltip (and its accessible name). */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="nd-info" title={text} aria-label={text} role="img" tabIndex={0}>
      <Info size={13} strokeWidth={1.7} aria-hidden />
    </span>
  );
}
