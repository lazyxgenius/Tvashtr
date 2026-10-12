import type { CostRow, RunRow } from "../lib/api";
import { spendText } from "../lib/desktopRepos";
import { deriveOverall } from "../lib/status";
import { VersionTag } from "./VersionTag";

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
  const totalFromRows = costs.reduce((sum, c) => sum + c.cost_usd, 0);
  // M-desk-5 L1: a live run's figure is its rows so far, worded like the toolbar chip at every
  // poll — and a Desktop run routed to subscriptions names them before its first row.
  const cost =
    run?.cost_total_usd ??
    (costs.length > 0 || run?.ran_on?.subscriptions.length ? totalFromRows : null);

  return (
    <div
      className="tv-card inline-flex shrink-0 flex-nowrap items-center gap-x-5 gap-y-2 whitespace-nowrap"
      style={{ borderRadius: "var(--radius-md)", padding: "8px 16px" }}
    >
      <span className={`tv-pill tv-pill--${tone}`}>
        <span className="tv-pill__dot" />
        {label}
      </span>
      <Item label="run" value={runId ? runId.slice(0, 8) : "—"} />
      {run?.team_version_number != null && <VersionTag number={run.team_version_number} />}
      {cost != null && <Item label="cost" value={spendText(`$${cost.toFixed(4)}`, run?.ran_on)} />}
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
