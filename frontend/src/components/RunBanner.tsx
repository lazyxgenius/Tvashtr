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
      {run?.ship_tag && (
        <Item
          label="ship"
          value={run.ship_commit_sha ? run.ship_commit_sha.slice(0, 9) : run.ship_tag}
        />
      )}
    </div>
  );
}
