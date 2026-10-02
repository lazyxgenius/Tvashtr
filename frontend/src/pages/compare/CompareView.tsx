import { Check, Info, RotateCcw, Square } from "lucide-react";
import { useState } from "react";

import { VersionRestore } from "../../canvas/VersionDialogs";
import { Badge, type BadgeVariant, Button, ConfirmDialog } from "../../design-system/components";
import {
  type Compare,
  type CompareRow,
  type CompareSide,
  type CompareStatus,
  type SideStatus,
  stopCompare,
} from "../../lib/api/compare";
import type { ProgressState } from "../../lib/api/runs";
import { navigate } from "../../lib/nav";
import { versionAge } from "../../lib/versionFormat";
import { LoadState } from "../../panel/runs/RunsTab";
import { LineIcon, LineWhat } from "../../panel/run/live/ActivityPanel";
import { agoLong, clock, currentLineIds, duration } from "../../panel/run/live/liveFormat";
import { money } from "../home/homeFormat";
import { type PipelineChip, RunProgressStrip } from "../home/RunProgressStrip";
import { useCompare } from "./useCompare";

const COMPARE_LOOK: Record<CompareStatus, [string, BadgeVariant]> = {
  waiting: ["Waiting", "warning"],
  running: ["Running", "accent"],
  finished: ["Finished", "success"],
  stopped: ["Stopped", "neutral"],
};
const SIDE_LOOK: Record<SideStatus, [string, BadgeVariant]> = {
  waiting: ["Waiting", "warning"],
  running: ["Running", "accent"],
  needs_you: ["Needs you", "warning"],
  finished: ["Finished", "success"],
  failed: ["Failed", "danger"],
  stopped: ["Stopped", "neutral"],
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const openRun = (teamId: string, runId: string) => navigate({ page: "team", teamId, runId });

/** A compare: its two lanes while it waits or runs, its results once it has them. */
export function CompareView({ id, teamId }: { id: string; teamId: string }) {
  const { compare, failed, refresh } = useCompare(id);
  if (!compare)
    return (
      <LoadState
        state={failed ? "error" : "loading"}
        loading="Loading the compare"
        error="Couldn’t load this compare."
        onRetry={refresh}
      />
    );
  return compare.results ? (
    <Results c={compare} teamId={teamId} onRestored={refresh} />
  ) : (
    <Running c={compare} teamId={teamId} onStopped={refresh} />
  );
}

/** Cmp-Running / Cmp-Queued / Cmp-NeedsYou, and Cmp-StopConfirm over them. */
function Running({ c, teamId, onStopped }: { c: Compare; teamId: string; onStopped: () => void }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [look, variant] = COMPARE_LOOK[c.status];
  const going = c.status === "waiting" || c.status === "running";
  const v = (label: "A" | "B") => c.sides.find((s) => s.label === label)?.version;
  const stop = () => {
    setBusy(true);
    setError(null);
    stopCompare(c.id).then(
      () => {
        setBusy(false);
        setAsk(false);
        onStopped();
      },
      (e: unknown) => {
        setBusy(false);
        setError(message(e));
      },
    );
  };
  return (
    <div>
      <div className="cmp-run__head">
        <h2 className="cmp-run__title">
          v{v("A")} and v{v("B")} on “{c.task}”
        </h2>
        <Badge variant={variant} dot>
          {look}
        </Badge>
        <span className="cmp-run__meta">
          <span className="cmp-mono">
            {duration(c.elapsed_s)} · {money(c.cost_usd)} so far
          </span>
          {going && (
            <Button
              variant="secondary"
              size="sm"
              className="cv-btn-flush"
              onClick={() => setAsk(true)}
            >
              <Square size={14} strokeWidth={1.6} aria-hidden />
              <span>Stop compare</span>
            </Button>
          )}
        </span>
      </div>
      <div className="cmp-lanes">
        {c.sides.map((s) => (
          <Lane key={s.label} side={s} c={c} teamId={teamId} />
        ))}
      </div>
      <p className="cmp-foot">
        <Info size={14} strokeWidth={1.6} aria-hidden />
        {c.auto_approve
          ? "Gates are approved automatically in this compare."
          : "You approve each gate yourself in this compare."}{" "}
        You can leave; Home shows it under Running now.
      </p>
      <ConfirmDialog
        open={ask}
        title="Stop this compare?"
        confirmLabel="Stop compare"
        cancelLabel="Keep running"
        busy={busy}
        error={error}
        onConfirm={stop}
        onCancel={() => !busy && setAsk(false)}
      >
        Both runs stop now and are marked Stopped. Nothing ships in a compare.
      </ConfirmDialog>
    </div>
  );
}

/** Home's pipeline strip from a lane's chips: "⇄" between a loop's two nodes. */
function stripOf(side: CompareSide): { chips: PipelineChip[]; loopBefore: Set<number> } {
  const chips = side.strip.map<PipelineChip>((p) => ({
    id: p.node_id,
    label: p.label,
    role: p.role_name ?? p.label,
    kind: p.kind,
    state: p.state as ProgressState,
  }));
  const loopBefore = new Set<number>();
  side.strip.forEach((p, i) => {
    const prev = side.strip[i - 1];
    if (prev && (p.loops_with === prev.node_id || prev.loops_with === p.node_id)) loopBefore.add(i);
  });
  return { chips, loopBefore };
}

/** "Engineer · round 3" / "Approved in round 2" (the boards set "in …" without the dot). */
function Now({ current }: { current: NonNullable<CompareSide["current"]> }) {
  // ponytail: the separator is read off the words; a `sep` field from the server if more shapes come.
  const sep = /^in\b/.test(current.text) ? " " : " · ";
  return (
    <>
      <b>{current.label}</b>
      {sep}
      {current.text}
    </>
  );
}

function Lane({ side, c, teamId }: { side: CompareSide; c: Compare; teamId: string }) {
  const queued = side.status === "waiting" ? c.waiting : null;
  const [look, variant] = queued
    ? ["Waiting for a free slot", "warning" as const]
    : SIDE_LOOK[side.status];
  const { chips, loopBefore } = stripOf(side);
  const current = currentLineIds(side.lines);
  const running = side.status === "running";
  return (
    <section className="cmp-lane" aria-label={`Version ${side.label}`}>
      <div className="cmp-lane__head">
        <span className="cmp-tile">{side.label}</span>
        <span className="cmp-lane__v">v{side.version}</span>
        <Badge variant={variant} dot>
          {look}
        </Badge>
        <span className="cmp-lane__meta">
          {duration(side.elapsed_s)} · {money(side.cost_usd)}
        </span>
        {side.status === "needs_you" && side.run_id && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openRun(teamId, side.run_id as string)}
          >
            Open run
          </Button>
        )}
      </div>
      <div className="cmp-lane__strip">
        <RunProgressStrip chips={chips} loopBefore={loopBefore} label="Progress" />
        <span className="cmp-lane__now">
          {queued
            ? `Starts when 2 of your ${queued.limit} run slots are free`
            : side.current && <Now current={side.current} />}
        </span>
      </div>
      {queued ? (
        <div className="cmp-lane__queued">
          {queued.in_use === 1
            ? "1 run is using your slots now."
            : `${queued.in_use} runs are using your slots now.`}
        </div>
      ) : (
        <ol className="cmp-lane__lines">
          {side.lines.map((l) => {
            const now = current.has(l.id);
            const warn = l.tone === "warn" || l.kind === "gate_waiting";
            const live = now && running && !warn && l.kind !== "done";
            return (
              <li
                key={l.id}
                className={`lv-line${warn ? " cmp-line--warn" : live ? " cmp-line--now" : ""}`}
              >
                <span className="lv-line__time">{clock(l.at)}</span>
                <LineIcon line={l} />
                <span className="lv-line__who">{l.label}</span>
                <span className={`lv-line__what${now ? " lv-now-line" : ""}`}>
                  <LineWhat line={l} />
                </span>
                <span className="lv-line__extra">
                  {live && <span className="cmp-ago">{agoLong(l.at)}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Cell({ value, row, side }: { value: string; row: CompareRow; side: "a" | "b" }) {
  const better = row.better === side;
  const failed = row.key === "result" && value.startsWith("Failed");
  return (
    <td
      className={`cmp-res__cell${better ? " cmp-res__cell--better" : ""}${failed ? " cmp-res__cell--failed" : ""}`}
    >
      {better && <Check size={14} strokeWidth={2} aria-hidden />}
      {value}
    </td>
  );
}

/** Cmp-Results / Cmp-SideFailed: the headline, the table, Restore vN and Done. */
function Results({
  c,
  teamId,
  onRestored,
}: {
  c: Compare;
  teamId: string;
  onRestored: () => void;
}) {
  const r = c.results as NonNullable<Compare["results"]>;
  const [restoring, setRestoring] = useState(false);
  const [look, variant] = COMPARE_LOOK[c.status];
  const sub = [
    "Same task, same repo, at the same time",
    c.ended_at && `finished ${versionAge(c.ended_at, Date.now(), true)}`,
    `${money(c.cost_usd)} in all`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="cmp-res">
      <div className="cmp-res__head">
        <div>
          <h2 className="cmp-h2">{r.headline}</h2>
          <p className="cmp-res__sub">{sub}</p>
        </div>
        <Badge variant={variant} dot>
          {look}
        </Badge>
      </div>
      <div className="cmp-res__wrap">
        <table className="cmp-res__table" aria-label="Results">
          <colgroup>
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <td />
              {c.sides.map((s) => (
                <th key={s.label} scope="col">
                  <span className="cmp-res__side">
                    <span className="cmp-tile cmp-tile--sm">{s.label}</span>
                    <code>v{s.version}</code>
                    {s.run_id && (
                      <button
                        type="button"
                        className="cmp-link"
                        onClick={() => openRun(teamId, s.run_id as string)}
                      >
                        Open run
                      </button>
                    )}
                  </span>
                </th>
              ))}
              <th scope="col" className="cmp-res__diffhead">
                Difference
              </th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="cmp-res__label">
                  {row.label}
                </th>
                <Cell value={row.a} row={row} side="a" />
                <Cell value={row.b} row={row} side="b" />
                <td className="cmp-res__diff">{row.difference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cmp-res__foot">
        <span>v{r.current_version} is your current version.</span>
        <div className="cmp-res__acts">
          {r.restore != null && (
            <Button variant="secondary" className="cv-btn-flush" onClick={() => setRestoring(true)}>
              <RotateCcw size={14} strokeWidth={1.6} aria-hidden />
              <span>Restore v{r.restore}</span>
            </Button>
          )}
          <Button variant="primary" onClick={() => navigate({ page: "team", teamId })}>
            Done
          </Button>
        </div>
      </div>
      {restoring && r.restore != null && (
        <VersionRestore
          teamId={teamId}
          number={r.restore}
          guard={(proceed) => proceed()}
          onRestored={() => {
            setRestoring(false);
            onRestored();
          }}
          onClose={() => setRestoring(false)}
        />
      )}
    </div>
  );
}
