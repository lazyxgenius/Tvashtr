/**
 * Small pieces every Engines page shares: the page header, the OK / warn status line, the provider
 * monogram tile, a section card with its uppercase title, the subscription disclosure and the
 * load-failed / loading states (ENG-78).
 */
import { Circle, CircleCheck, History, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../design-system/components";
import { SUBSCRIPTION_DISCLOSURE } from "../../lib/engines";

export function EnginesHead({
  title,
  lede,
  actions,
  titleId,
}: {
  title: string;
  lede: string;
  actions?: ReactNode;
  /** An id for the h1, when a region is labelled by it. */
  titleId?: string;
}) {
  return (
    <div className="eng-head">
      <div>
        <h1 className="eng-head__title" id={titleId}>
          {title}
        </h1>
        <p className="eng-head__lede">{lede}</p>
      </div>
      <div className="eng-head__actions">{actions}</div>
    </div>
  );
}

export type StatusTone = "ok" | "warn" | "muted" | "busy";

/** "✓ Always available" / "⚠ No API key [Add key]" / "○ Not open on this computer" /
 *  "↺ Checking…". */
export function StatusLine({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const icon =
    tone === "ok" ? (
      <CircleCheck size={14} strokeWidth={1.6} aria-hidden />
    ) : tone === "warn" ? (
      <TriangleAlert size={14} strokeWidth={1.6} aria-hidden />
    ) : tone === "busy" ? (
      <History size={13} strokeWidth={1.6} aria-hidden />
    ) : (
      <Circle size={13} strokeWidth={1.6} aria-hidden />
    );
  return (
    <span className={`eng-status eng-status--${tone}`}>
      {icon}
      {children}
    </span>
  );
}

/** The provider's letter tile (A anthropic, R openrouter — not always the first letter). */
export function MonogramTile({ letter }: { letter: string }) {
  return (
    <span className="eng-mono" aria-hidden>
      {letter}
    </span>
  );
}

/** A bordered section with the design's uppercase title row. */
export function EnginesSection({
  title,
  titleId,
  children,
}: {
  title: string;
  titleId?: string;
  children: ReactNode;
}) {
  return (
    <section className="eng-card" aria-labelledby={titleId}>
      <div className="eng-card__head">
        <div className="eng-card__head-row">
          <span className="eng-card__title" id={titleId}>
            {title}
          </span>
        </div>
      </div>
      {children}
    </section>
  );
}

/** The compliance disclosure (exact wording — see SUBSCRIPTION_DISCLOSURE). */
export function EnginesDisclosure() {
  return (
    <div className="eng-disclosure" role="note">
      <span className="eng-disclosure__icon">
        <Info size={14} strokeWidth={1.6} aria-hidden />
      </span>
      <span>{SUBSCRIPTION_DISCLOSURE}</span>
    </div>
  );
}

/** ENG-78: a failed load says so, with Retry — never a silently empty page. */
export function EnginesLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="eng-loaderr" role="alert">
      <TriangleAlert size={14} strokeWidth={1.6} aria-hidden />
      <span>Couldn’t load your engines — is the backend running?</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** ENG-78: skeleton rows while keys, subscriptions and usage load. */
export function EnginesSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="eng-card eng-skel" aria-busy="true" aria-label="Loading your engines">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="eng-skel__row">
          <span className="eng-skel__bar eng-skel__bar--short" />
          <span className="eng-skel__bar" />
        </div>
      ))}
    </div>
  );
}
