import "./live.css";

import { ButtonLink } from "../../../design-system/components";
import type { RunSummary } from "../../../lib/api/activity";
import { duration } from "./liveFormat";
import { StateGlyph } from "./StateGlyph";

/**
 * M2 — a finished run's summary row (Runs › Live-Done): what shipped, its rounds, time, cost and
 * passing tests, and the pull request. It takes the Now bar's row. "Start the next run from this"
 * arrives with M10.
 */
export function DoneSummary({ idea, summary }: { idea: string; summary: RunSummary }) {
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
      {summary.pr_url && (
        <div className="lv-done__actions">
          <ButtonLink
            variant="primary"
            size="sm"
            href={summary.pr_url}
            target="_blank"
            rel="noreferrer"
          >
            {pr != null ? `Open pull request #${pr}` : "Open pull request"}
          </ButtonLink>
        </div>
      )}
    </section>
  );
}
