import "./live.css";

import { CornerDownRight, GitPullRequest } from "lucide-react";
import { useId } from "react";

import { Button, ButtonLink } from "../../../design-system/components";
import type { RunSummary } from "../../../lib/api/activity";
import { duration } from "./liveFormat";
import { StateGlyph } from "./StateGlyph";

/**
 * M2 — a finished run's summary row (Runs › Live-Done): what shipped, its rounds, time, cost and
 * passing tests, and the pull request. It takes the Now bar's row. M10 (Next-Finished): "Start the
 * next run from this" beside Open pull request, when the run can start one (`startNext`).
 */
export function DoneSummary({
  idea,
  summary,
  startNext,
}: {
  idea: string;
  summary: RunSummary;
  /** M10: only when the server says this run can start the next one (no dead buttons).
   *  `prNumber`: the unmerged pull request the next run can start from. */
  startNext?: { prNumber: number | null; onStart: () => void };
}) {
  const tipId = useId();
  const pr = summary.pr_number;
  const branch =
    summary.branch && summary.base_ref
      ? ` · branch ${summary.branch} → ${summary.base_ref}`
      : summary.branch
        ? ` · branch ${summary.branch}`
        : "";
  const stats: [string, string][] = [
    [String(summary.rounds), summary.rounds === 1 ? "round" : "rounds"],
    [duration(summary.elapsed_s), "total time"],
    [`$${summary.cost_usd.toFixed(2)}`, "cost"],
  ];
  if (summary.tests_passed != null) stats.push([String(summary.tests_passed), "tests passing"]);
  return (
    <section className="lv-done" aria-label="Run summary">
      <span className="lv-done__icon">
        <StateGlyph state="done" />
      </span>
      <div className="lv-done__what">
        <span className="lv-done__title">
          {pr != null ? `Shipped: pull request #${pr} is open` : "Done"}
        </span>
        <span className="lv-done__sub">
          {idea}
          {branch}
        </span>
      </div>
      <div className="lv-done__stats">
        {stats.map(([n, what]) => (
          <span key={what} className="lv-done__stat">
            <span className="lv-done__num">{n}</span>
            {what}
          </span>
        ))}
      </div>
      {(summary.pr_url || startNext) && (
        <div className="lv-done__actions">
          {summary.pr_url && (
            <ButtonLink
              variant="primary"
              size="sm"
              iconLeft={<GitPullRequest size={14} strokeWidth={1.6} aria-hidden />}
              href={summary.pr_url}
              target="_blank"
              rel="noreferrer"
            >
              {pr != null ? `Open pull request #${pr}` : "Open pull request"}
            </ButtonLink>
          )}
          {startNext && (
            <span className="lv-done__next">
              <Button
                variant="primary"
                size="sm"
                iconLeft={<CornerDownRight size={14} strokeWidth={2} aria-hidden />}
                aria-describedby={tipId}
                onClick={startNext.onStart}
              >
                Start the next run from this
              </Button>
              <span id={tipId} className="lv-done__tip" role="tooltip">
                <span className="lv-done__tip-title">
                  Start the next feature where this one ended
                </span>
                The new run gets this run’s final spec, your decisions and what the agents learned
                {startNext.prNumber != null
                  ? `, and can start from pull request #${startNext.prNumber}.`
                  : "."}{" "}
                It does not copy the agents’ full conversations: long histories make agents slower
                and less accurate.
                <span className="lv-done__tip-arrow" aria-hidden />
              </span>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
