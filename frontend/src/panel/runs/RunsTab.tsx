import { type ReactNode, useState } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";

import { Badge, Button } from "../../design-system/components";
import type { NodeRound, NodeRuns } from "../../lib/api/nodes";
import { formatRelativeTime } from "../../lib/time";
import { statusBadge } from "../nodeBadges";
import { clipDetail, compactTokens, detailParts } from "./rounds";
import type { Loaded } from "./useLoaded";
import "./runs.css";

const roundTime = (r: NodeRound) => formatRelativeTime(r.ended_at ?? r.started_at ?? "");

/** A round's detail: `code` spans for backticked and path-like tokens. */
export function DetailText({ text }: { text: string }) {
  return (
    <>
      {detailParts(text).map((p, i) =>
        p.code ? (
          <code key={i} className="nd-code">
            {p.text}
          </code>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

/** Loading and error rows for a tab's data (a skeleton, then "<error>" + Retry). */
export function LoadState({
  state,
  loading,
  error,
  onRetry,
}: {
  state: "loading" | "error";
  loading: string;
  error: string;
  onRetry: () => void;
}) {
  if (state === "loading") {
    return (
      <div className="nd-mem__skel" role="status" aria-label={loading}>
        <span />
        <span />
      </div>
    );
  }
  return (
    <div className="nd-mem__error" role="alert">
      {error}
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** The tabs' empty card (Panel-RunsEmpty): an icon, a title and one line. */
export function EmptyCard({
  title,
  icon = <History size={28} strokeWidth={1.4} aria-hidden />,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="nd-runs__empty">
      <span className="nd-runs__empty-icon">{icon}</span>
      <div className="nd-runs__empty-title">{title}</div>
      <div className="nd-runs__empty-body">{children}</div>
    </div>
  );
}

/**
 * Runs (PANEL-72..74): this agent's latest round in its newest run ("Last run"), then that run's
 * earlier rounds, each expanding in place to its detail, tokens, cost and time.
 */
export function RunsTab({
  history,
  onOpenFocus,
}: {
  /** "idle" when the agent never ran (nothing to load). */
  history: Loaded<NodeRuns>;
  onOpenFocus?: () => void;
}) {
  if (history.state === "loading" || history.state === "error") {
    return (
      <LoadState
        state={history.state}
        loading="Loading runs"
        error="Couldn’t load this agent’s runs."
        onRetry={history.retry}
      />
    );
  }
  const rounds = history.value?.run?.rounds ?? [];
  if (rounds.length === 0) {
    return (
      <EmptyCard title="This agent hasn’t run yet">
        Press <b>Run this team</b> and what it did will show up here.
      </EmptyCard>
    );
  }
  const [last, ...earlier] = rounds;
  return (
    <div className="nd-runs">
      <div className="nd-section__head">
        <span className="nd-section__title">Last run</span>
      </div>
      <LastRunCard round={last} />
      {earlier.length > 0 && (
        <div className="nd-runs__earlier">
          <span className="nd-section__title">Earlier rounds</span>
          <ul className="nd-runs__list">
            {earlier.map((r) => (
              <RoundItem key={r.invocation_id} round={r} onOpenFocus={onOpenFocus} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LastRunCard({ round }: { round: NodeRound }) {
  const [all, setAll] = useState(false);
  const badge = statusBadge(round, false);
  const detail = round.outcome_detail?.trim() ?? "";
  const clipped = clipDetail(detail);
  const when = roundTime(round);
  return (
    <section className={`nd-lastrun nd-lastrun--${badge.variant}`} aria-label="Last run">
      <div className="nd-lastrun__head">
        <Badge variant={badge.variant} dot={badge.dot}>
          {badge.label}
        </Badge>
        <span className="nd-lastrun__when">
          Round {round.iteration}
          {when && ` · ${when}`}
        </span>
      </div>
      {detail && (
        <div className="nd-lastrun__detail">
          <DetailText text={clipped === null || all ? detail : clipped} />
          {clipped !== null && !all && " …"}
        </div>
      )}
      {clipped !== null && (
        <div className="nd-lastrun__more">
          <button type="button" className="nd-link" onClick={() => setAll(!all)}>
            {all ? "Show less" : "Show all"}
          </button>
        </div>
      )}
    </section>
  );
}

function RoundItem({ round, onOpenFocus }: { round: NodeRound; onOpenFocus?: () => void }) {
  const [open, setOpen] = useState(false);
  const badge = statusBadge(round, false);
  const when = roundTime(round);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className={`nd-round${open ? " nd-round--open" : ""}`}>
      <button
        type="button"
        className="nd-round__toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="nd-round__id">
          <span className="nd-round__n">Round {round.iteration}</span>
          <Badge variant={badge.variant} dot={badge.dot}>
            {badge.label}
          </Badge>
        </span>
        <span className="nd-round__when">
          {!open && when}
          <Chevron size={14} strokeWidth={1.6} aria-hidden />
        </span>
      </button>
      {open && (
        <>
          {round.outcome_detail && (
            <div className="nd-round__detail">
              <DetailText text={round.outcome_detail} />
            </div>
          )}
          <div className="nd-round__meta">
            {round.cost && <span>{compactTokens(round.cost.total_tokens)} tokens</span>}
            {round.cost && <span>${round.cost.cost_usd.toFixed(2)}</span>}
            {when && <span>{when}</span>}
          </div>
          {onOpenFocus && (
            <button type="button" className="nd-link nd-round__focus" onClick={onOpenFocus}>
              Open in focus view
            </button>
          )}
        </>
      )}
    </li>
  );
}
