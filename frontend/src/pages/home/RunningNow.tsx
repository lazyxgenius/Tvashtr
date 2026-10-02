import { RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { type RunListRow, type RunLive, stopRun } from "../../lib/api/runs";
import { navigate } from "../../lib/nav";
import { StopRunDialog } from "../../components/StopRunDialog";
import { Badge, Button, useToast } from "../../design-system/components";
import { useHome } from "./homeContext";
import { markRunEnded, refreshHome, useHomeData } from "./homeData";
import {
  SECTION_IDS,
  durationShort,
  elapsedShort,
  liveLook,
  money,
  runStatusLook,
} from "./homeFormat";
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

/** The current-activity line's words (Live-Home): what the step does now, or how long it's been
 *  silent when Quiet / Stalled. */
function liveLine(row: RunListRow, step: RunLive): { text: string; aside: string } {
  const since = durationShort(step.last_event_at);
  if (step.live_state === "stalled")
    return {
      text: `no update for ${since}${row.pr_url ? "" : " · nothing shipped yet"}`,
      aside: "",
    };
  if (step.live_state === "quiet")
    return {
      text: `no update for ${since} · usually still thinking`,
      aside: durationShort(step.activity_started_at),
    };
  return { text: step.activity, aside: since && `${since} ago` };
}

function RunCard({
  row,
  fresh,
  onStop,
  resumable = false,
}: {
  row: RunListRow;
  fresh: boolean;
  onStop: (row: RunListRow) => void;
  /** M3: Needs you offers Resume for this stalled run. */
  resumable?: boolean;
}) {
  const live = LIVE.has(row.status);
  const look = runStatusLook(row.status);
  // M2: a live run that is Quiet, Stalled or Needs you says so beside its status badge.
  const liveBadge = live ? liveLook(row.live_state) : null;
  // The waiting-for-you line already says what a gate needs, so it isn't repeated.
  const step = live && !row.awaiting ? row.live : null;
  const line = step ? liveLine(row, step) : null;
  const teamId = row.team?.id ?? row.library_team_id;
  const cap = row.budget_cap_usd;
  const pct = cap && cap > 0 ? Math.min(100, Math.round((row.spent_usd / cap) * 100)) : 0;
  const { chips, loopBefore } = chipsOf(row);
  return (
    <article
      className={[
        "hm-run",
        fresh && "hm-run--new",
        live && row.live_state === "stalled" && "hm-run--stalled",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`${row.team?.name ?? "Run"}: ${row.idea}`}
    >
      <div className="hm-run__top">
        <span className="hm-run__team">{row.team?.name ?? "Run"}</span>
        <Badge variant={look.variant} dot>
          {look.label}
        </Badge>
        {liveBadge && (
          <Badge variant={liveBadge.variant} dot>
            {liveBadge.label}
          </Badge>
        )}
        <span className="hm-run__age">{elapsedShort(row.created_at)}</span>
      </div>
      <div className="hm-run__idea">“{row.idea}”</div>
      {chips.length > 0 && (
        <div className="hm-run__chips">
          <RunProgressStrip chips={chips} loopBefore={loopBefore} label="Progress" />
        </div>
      )}
      {step && line && (
        <div className="hm-run__live">
          <b>{step.label}</b>
          {` · ${line.text}`}
          {line.aside && <span className="hm-run__live-aside">{line.aside}</span>}
          {/* M3 (Live-Home): a stalled run's Resume opens it with "Resume run #12" open. */}
          {resumable && teamId && step.live_state === "stalled" && (
            <button
              type="button"
              className="hm-run__resume"
              onClick={() => navigate({ page: "team", teamId, runId: row.run_id, resume: true })}
            >
              <RotateCcw size={13} strokeWidth={1.6} aria-hidden />
              Resume
            </button>
          )}
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
  const { active, ended, justLaunched, inbox } = useHomeData();
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
  // M3: the stalled runs Needs you offers Resume for (the server's `resume`).
  const resumable = new Set(
    (inbox.data?.items ?? []).flatMap((i) =>
      i.kind === "run_stalled" && i.resume ? [i.run.id] : [],
    ),
  );

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
  if (rows.length === 0) {
    // The empty state HmF-FirstTime-7 draws.
    return (
      <section
        id={SECTION_IDS.runningNow}
        className="hm-section hm-target"
        tabIndex={-1}
        aria-label="Running now"
      >
        <div className="hm-section__head">
          <h2 className="hm-section__title">Running now</h2>
        </div>
        <div className="hm-run-empty">Nothing is running. Start a run above, or open a team.</div>
      </section>
    );
  }

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
        {/* M2 (Live-Home): the cards follow each run as it happens. */}
        <span className="hm-section__aside">Updates as it happens</span>
      </div>
      <div className="hm-grid2">
        {rows.map((r) => (
          <RunCard
            key={r.run_id}
            row={r}
            fresh={r.run_id === justLaunched}
            onStop={setStopping}
            resumable={resumable.has(r.run_id)}
          />
        ))}
      </div>
      <StopRunDialog
        open={stopping !== null}
        teamName={stopping?.team?.name}
        busy={busy}
        error={error}
        onConfirm={() => void confirmStop()}
        onCancel={() => {
          setStopping(null);
          setError(null);
        }}
      />
    </section>
  );
}
