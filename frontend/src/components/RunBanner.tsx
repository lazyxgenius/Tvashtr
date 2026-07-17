import type { CostRow, RunRow } from "../lib/api";
import { deriveOverall } from "../lib/status";

function Item({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-tertiary)" }}>{label}</span>
      <span
        style={{
          fontFamily: "var(--font-code)",
          fontSize: "var(--fs-caption)",
          color: "var(--text-secondary)",
        }}
      >
        {value}
      </span>
    </span>
  );
}

/** A quiet, hairline-bordered status line — the canvas stays the star. */
export function RunBanner({
  runId,
  run,
  workflowStatus,
  costs,
}: {
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
  costs: CostRow[];
}) {
  const { tone, label } = deriveOverall(run, workflowStatus);
  const cost = run?.cost_total_usd;
  const totalFromRows = costs.reduce((sum, c) => sum + c.cost_usd, 0);

  return (
    <div
      className="tv-card inline-flex flex-wrap items-center gap-x-5 gap-y-2"
      style={{ borderRadius: "var(--radius-md)", padding: "8px 16px" }}
    >
      <span className={`tv-pill tv-pill--${tone}`}>
        <span className="tv-pill__dot" />
        {label}
      </span>
      <Item label="run" value={runId ? runId.slice(0, 8) : "—"} />
      {cost != null ? (
        <Item label="cost" value={`$${cost.toFixed(4)}`} />
      ) : (
        costs.length > 0 && <Item label="cost" value={`$${totalFromRows.toFixed(4)}`} />
      )}
      {run?.pr_url ? (
        // M-h1b: a hosted run's deliverable is the opened pull request — surface it as a clickable
        // link (it supersedes the raw branch/ship text; the PR IS what the hosted user came for).
        <a
          href={run.pr_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-baseline gap-1.5"
          style={{
            fontFamily: "var(--font-code)",
            fontSize: "var(--fs-caption)",
            color: "var(--accent)",
          }}
        >
          Opened PR →
        </a>
      ) : run?.ship_branch ? (
        // M-brownfield: a brownfield run landed on a real branch in the user's repo — surface it
        // (the branch IS the deliverable; the redundant ship tag is omitted for this run).
        <Item label="branch" value={run.ship_branch} />
      ) : (
        run?.ship_tag && (
          <Item
            label="ship"
            value={run.ship_commit_sha ? run.ship_commit_sha.slice(0, 9) : run.ship_tag}
          />
        )
      )}
    </div>
  );
}
