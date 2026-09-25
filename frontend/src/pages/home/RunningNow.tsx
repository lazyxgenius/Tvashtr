import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { type RunListRow, stopRun } from "../../lib/api/runs";
import { navigate } from "../../lib/nav";
import { Badge, Button, ConfirmDialog, useToast } from "../../design-system/components";
import { useHome } from "./homeContext";
import { markRunEnded, refreshHome, useHomeData } from "./homeData";
import { SECTION_IDS, elapsedShort, money, runStatusLook } from "./homeFormat";
import { type PipelineChip, RunProgressStrip } from "./RunProgressStrip";
import "./home-runs.css";

const LIVE = new Set(["pending", "running", "awaiting_human"]);

function chipsOf(row: RunListRow): { chips: PipelineChip[]; loopBefore: Set<number> } {
  const progress = row.progress ?? [];
  const ended = !LIVE.has(row.status);
  const chips = progress.map<PipelineChip>((p) => ({
    id: p.node_id,
    label: p.label,
    role: p.role_name,
    kind: p.kind,
    // A run that just ended keeps its done chips; what was running is no longer "active".
    state: ended && (p.state === "active" || p.state === "waiting") ? "idle" : p.state,
  }));
  const loopBefore = new Set<number>();
  progress.forEach((p, i) => {
    const prev = progress[i - 1];
    if (prev && (p.loops_with === prev.node_id || prev.loops_with === p.node_id)) loopBefore.add(i);
  });
  return { chips, loopBefore };
}

function RunCard({ row, onStop }: { row: RunListRow; onStop: (row: RunListRow) => void }) {
  const look = runStatusLook(row.status);
  const live = LIVE.has(row.status);
  const teamId = row.team?.id ?? row.library_team_id;
  const cap = row.budget_cap_usd;
  const pct = cap && cap > 0 ? Math.min(100, Math.round((row.spent_usd / cap) * 100)) : 0;
  const { chips, loopBefore } = chipsOf(row);
  return (
    <article className="hm-run" aria-label={`${row.team?.name ?? "Run"}: ${row.idea}`}>
      <div className="hm-run__top">
        <span className="hm-run__team">{row.team?.name ?? "Run"}</span>
        <Badge variant={look.variant} dot>
          {look.label}
        </Badge>
        <span className="hm-run__age">{elapsedShort(row.created_at)}</span>
      </div>
      <div className="hm-run__idea">“{row.idea}”</div>
      {chips.length > 0 && (
        <div className="hm-run__chips">
          <RunProgressStrip chips={chips} loopBefore={loopBefore} label="Progress" />
        </div>
      )}
      {live && row.awaiting && (
        <div className="hm-run__waiting">
          <ShieldCheck size={13} strokeWidth={1.6} aria-hidden />
          Waiting for you at {row.awaiting.gate_role}
        </div>
      )}
      <div className="hm-run__foot">
        {cap ? (
          <>
            <div
              className="hm-meter"
              role="meter"
              aria-label="Budget used"
              aria-valuemin={0}
              aria-valuemax={cap}
              aria-valuenow={row.spent_usd}
            >
              <div className="hm-meter__fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="hm-run__spend">
              {money(row.spent_usd)} of {money(cap)}
            </span>
          </>
        ) : (
          <span className="hm-run__spend">{money(row.spent_usd)} spent</span>
        )}
        <span className="hm-run__actions">
          {teamId && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate({ page: "team", teamId, runId: row.run_id })}
            >
              Open
            </Button>
          )}
          {live && (
            <Button variant="ghost" size="sm" onClick={() => onStop(row)}>
              Stop
            </Button>
          )}
        </span>
      </div>
    </article>
  );
}

/**
 * Running now (HOME-70–79): a card per pending / running / awaiting run with its pipeline chips,
 * the "Waiting for you at …" line, spend of budget, and Open / Stop (HmF-Stop). A run that ends
 * while Home is open stays for a minute with its final badge; the section hides when empty.
 */
export function RunningNow() {
  const { active, ended } = useHomeData();
  const { reloadTeams } = useHome();
  const toast = useToast();
  const [stopping, setStopping] = useState<RunListRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (active.loading && !active.data) {
    return (
      <div className="hm-skel-card" style={{ height: 180 }} aria-hidden="true">
        <div className="hm-skel-bar" style={{ width: "30%", height: 14 }} />
        <div className="hm-skel-bar" style={{ width: "80%", height: 12 }} />
        <div className="hm-skel-bar" style={{ width: "60%", height: 12 }} />
      </div>
    );
  }

  const rows = [...(active.data ?? []), ...ended.map((e) => e.row)];
  const liveCount = (active.data ?? []).length;

  if (active.error && !active.data) {
    return (
      <section className="hm-section" aria-label="Running now">
        <div className="hm-section__head">
          <h2 className="hm-section__title">Running now</h2>
        </div>
        <div className="hm-section-error" role="alert">
          Couldn’t load running runs.{" "}
          <button type="button" className="hm-linkbtn" onClick={() => void refreshHome()}>
            Retry
          </button>
        </div>
      </section>
    );
  }
  if (rows.length === 0) return null;

  const confirmStop = async () => {
    if (!stopping) return;
    setBusy(true);
    setError(null);
    try {
      await stopRun(stopping.run_id);
      markRunEnded(stopping, "cancelled");
      setStopping(null);
      toast({ message: "Run stopped." });
      void refreshHome();
      void reloadTeams();
    } catch {
      setError("Couldn’t stop the run. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id={SECTION_IDS.runningNow}
      className="hm-section hm-target"
      tabIndex={-1}
      aria-label="Running now"
    >
      <div className="hm-section__head">
        <h2 className="hm-section__title">Running now</h2>
        {liveCount > 0 && <span className="hm-pill">{liveCount}</span>}
      </div>
      <div className="hm-grid2">
        {rows.map((r) => (
          <RunCard key={r.run_id} row={r} onStop={setStopping} />
        ))}
      </div>
      <ConfirmDialog
        open={stopping !== null}
        title="Stop this run?"
        confirmLabel="Stop run"
        cancelLabel="Keep running"
        busy={busy}
        error={error}
        onConfirm={() => void confirmStop()}
        onCancel={() => {
          setStopping(null);
          setError(null);
        }}
      >
        {stopping?.team?.name ?? "This team"} stops now and the run is marked Stopped. Anything
        already pushed stays on its branch. You can’t resume a stopped run.
      </ConfirmDialog>
    </section>
  );
}
