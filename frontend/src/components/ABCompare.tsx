import { useCallback, useEffect, useRef, useState } from "react";

import { type ABComparison, type ABSide, getABComparison, startABRuns } from "../lib/api";
import { abHeadline, abSideStatus, isSideTerminal, teamShapeLabel } from "../lib/abCompare";
import { reviewerVerdictLabel } from "../lib/status";

function costLabel(cost: number | null): string {
  return cost != null ? `$${cost.toFixed(4)}` : "—";
}

/** One config side of the pair: its label + shape, a status pill, what shipped, its cost, and —
 *  for the review_loop side — the per-round verdict history with the persisted reasons under each
 *  changes_requested round (the same `.tv-verdict*` vocabulary the single-run Reviewer panel uses). */
function SideCard({ side }: { side: ABSide }) {
  const status = abSideStatus(side);
  return (
    <section className="tv-ab__card">
      <header className="tv-ab__card-head">
        <span className="tv-ab__config">
          <span className="tv-ab__config-label">{side.pair_label}</span>
          <span className="tv-ab__shape">{teamShapeLabel(side.team_shape)}</span>
        </span>
        <span className={`tv-pill tv-pill--${status.tone}`}>
          <span className="tv-pill__dot" />
          {status.label}
        </span>
      </header>

      <dl className="tv-ab__metrics">
        <div className="tv-ab__metric">
          <dt className="tv-ab__metric-key">Shipped</dt>
          <dd className="tv-ab__metric-val">{side.ship_tag ?? "—"}</dd>
        </div>
        <div className="tv-ab__metric">
          <dt className="tv-ab__metric-key">Cost</dt>
          <dd className="tv-ab__metric-val">{costLabel(side.cost_total_usd)}</dd>
        </div>
      </dl>

      {side.team_shape === "review_loop" && (
        <div className="tv-ab__rounds">
          <div className="tv-ab__rounds-head">Review</div>
          {side.review_rounds.length === 0 ? (
            <p className="tv-panel-note">No review yet.</p>
          ) : (
            <ol className="tv-verdicts">
              {side.review_rounds.map((r) => {
                const v = reviewerVerdictLabel(r.outcome);
                return (
                  <li key={r.iteration} className={`tv-verdict tv-verdict--${v.tone}`}>
                    <div className="tv-verdict__line">
                      <span className="tv-verdict__round">Round {r.iteration}</span>
                      <span className="tv-verdict__label">{v.label}</span>
                    </div>
                    {r.outcome_detail && <p className="tv-verdict__reasons">{r.outcome_detail}</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The A/B comparison view (§14.3): launch one idea through the two v1 team configs and show the
 * measurable delta side by side. Polls the pair until every present side is terminal (mirroring
 * App.tsx's poll discipline — mounted-guarded, cleared on terminal/unmount). Tolerates a
 * single-side pair (a partial-launch / runtime-failed pair, §15) and non-terminal sides honestly.
 */
export function ABCompare() {
  const [pairId, setPairId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ABComparison | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);

  const sides = comparison?.sides ?? [];
  // All PRESENT sides terminal — for a single-side pair this is just that one side.
  const allTerminal = sides.length > 0 && sides.every(isSideTerminal);
  const inFlight = pairId !== null && !allTerminal;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pull = useCallback(async () => {
    if (!pairId) return;
    try {
      const c = await getABComparison(pairId);
      if (!mountedRef.current) return;
      setComparison(c);
    } catch {
      /* transient — keep the last snapshot and retry next tick */
    }
  }, [pairId]);

  // Poll while a pair is in flight; stop once every present side is terminal.
  useEffect(() => {
    if (!pairId || allTerminal) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void pull();
    };
    tick();
    const handle = setInterval(tick, 1800);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [pairId, allTerminal, pull]);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setError(false);
    setComparison(null);
    setPairId(null);
    try {
      const id = await startABRuns();
      setPairId(id);
    } catch {
      setError(true);
    } finally {
      setStarting(false);
    }
  }, []);

  const buttonLabel = starting
    ? "Starting…"
    : inFlight
      ? "Running…"
      : pairId
        ? "Run another comparison"
        : "Run A/B comparison";
  const headline = comparison ? abHeadline(sides) : null;

  return (
    <div className="tv-ab">
      <div className="tv-ab__bar">
        <button
          className="tv-btn"
          onClick={() => void handleStart()}
          disabled={starting || inFlight}
        >
          {buttonLabel}
        </button>
        <p className="tv-ab__hint">
          One idea, two team configs — A (no review) vs B (review loop) — run side by side so the
          review gate's effect on what ships is legible.
        </p>
        {error && (
          <span className="tv-ab__error">
            Couldn't start the comparison — is the backend running?
          </span>
        )}
      </div>

      {headline && (
        <div className={`tv-ab__headline tv-ab__headline--${headline.tone}`}>
          {headline.headline}
        </div>
      )}

      {comparison ? (
        <div className="tv-ab__grid">
          {sides.map((side) => (
            <SideCard key={side.pair_label} side={side} />
          ))}
        </div>
      ) : (
        !starting && (
          <p className="tv-panel-note tv-ab__empty">
            No comparison yet. Run one and both team configs build the same idea side by side.
          </p>
        )
      )}
    </div>
  );
}
