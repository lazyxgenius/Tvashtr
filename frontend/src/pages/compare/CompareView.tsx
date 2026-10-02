import {
  ArrowRight,
  Check,
  CircleCheck,
  CircleX,
  Clock,
  Info,
  ListChecks,
  RotateCcw,
  Square,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { VersionRestore } from "../../canvas/VersionDialogs";
import { Badge, type BadgeVariant, Button, ConfirmDialog } from "../../design-system/components";
import {
  type Compare,
  type CompareRow,
  type CompareSide,
  type CompareStatus,
  type SetCell,
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

/**
 * A compare: its two lanes while it waits or runs, its results once it has them. M9: a compare on a
 * task set shows its per-task table instead of the lanes (Set-Running, Set-Results).
 */
export function CompareView({
  id,
  teamId,
  onCompareOn,
}: {
  id: string;
  teamId: string;
  /** "Compare on <set>": the Compare tab with that set chosen. */
  onCompareOn: (setId: string) => void;
}) {
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
    compare.set ? (
      <SetResults c={compare} teamId={teamId} onRestored={refresh} />
    ) : (
      <Results c={compare} teamId={teamId} onRestored={refresh} onCompareOn={onCompareOn} />
    )
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
  const set = c.set ?? null;
  const waiting = c.runs_waiting ?? 0;
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
          {set
            ? `v${v("A")} and v${v("B")} on ${set.name}`
            : `v${v("A")} and v${v("B")} on “${c.task}”`}
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
              onClick={() => {
                setError(null); // a fresh ask: never the last attempt's error
                setAsk(true);
              }}
            >
              <Square size={14} strokeWidth={1.6} aria-hidden />
              <span>Stop compare</span>
            </Button>
          )}
        </span>
      </div>
      {set ? (
        <>
          <p className="cmp-set__started">
            {c.started ?? 0} of {set.count * 2} runs started
            {waiting > 0 && ` · ${waiting} waiting for a free slot`}
          </p>
          <SetTable c={c} teamId={teamId} label="Tasks" />
        </>
      ) : (
        <div className="cmp-lanes">
          {c.sides.map((s) => (
            <Lane key={s.label} side={s} c={c} teamId={teamId} />
          ))}
        </div>
      )}
      <p className="cmp-foot">
        <Info size={14} strokeWidth={1.6} aria-hidden />
        {c.auto_approve
          ? "Gates are approved automatically in this compare."
          : "You approve each gate yourself in this compare."}{" "}
        {/* Cmp-Queued: Home lists runs, and a waiting compare has none yet. */}
        {set
          ? "You can leave; it carries on by itself."
          : c.status === "waiting"
            ? "You can leave; it starts on its own when two of your run slots are free."
            : "You can leave; Home shows it under Running now."}
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
      {current.text && (
        <>
          {sep}
          {current.text}
        </>
      )}
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
          <span className="cmp-lane__open">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openRun(teamId, side.run_id as string)}
            >
              Open run
            </Button>
          </span>
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
  onCompareOn,
}: {
  c: Compare;
  teamId: string;
  onRestored: () => void;
  onCompareOn: (setId: string) => void;
}) {
  const r = c.results as NonNullable<Compare["results"]>;
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
      {/* M9 (Cmp-Results): the team's task set, when it has one. */}
      {r.sample && (
        <div className="cmp-callout cmp-sample">
          <Info size={18} strokeWidth={1.6} aria-hidden />
          <div className="cmp-sample__text">
            <div className="cmp-sample__title">One task is a small sample</div>
            <div>
              Run the {r.sample.name} task set ({r.sample.count}{" "}
              {r.sample.count === 1 ? "task" : "tasks"}) before you rely on this.
            </div>
            <div className="cmp-sample__acts">
              <Button
                variant="secondary"
                size="sm"
                className="cv-btn-flush"
                onClick={() => onCompareOn((r.sample as NonNullable<typeof r.sample>).set_id)}
              >
                <ListChecks size={14} strokeWidth={1.6} aria-hidden />
                <span>Compare on {r.sample.name}</span>
              </Button>
            </div>
          </div>
        </div>
      )}
      <Foot r={r} teamId={teamId} onRestored={onRestored}>
        v{r.current_version} is your current version.
      </Foot>
    </div>
  );
}

/** The results' last line: the words, Restore vN and Done. */
function Foot({
  r,
  teamId,
  onRestored,
  children,
}: {
  r: NonNullable<Compare["results"]>;
  teamId: string;
  onRestored: () => void;
  children: ReactNode;
}) {
  const [restoring, setRestoring] = useState(false);
  return (
    <div className="cmp-res__foot">
      <span>{children}</span>
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

const rounds = (n: number) => `${n} ${n === 1 ? "round" : "rounds"}`;

/** One side of one task (Set-Running / Set-Results): its state, or ✓/✗ with rounds · cost · note. */
function SetCellView({ cell }: { cell: SetCell }) {
  if (cell.status === "waiting")
    return (
      <span className="cmp-set__cell cmp-set__cell--muted">
        <Clock size={14} strokeWidth={1.6} aria-hidden />
        Waiting for a free slot
      </span>
    );
  if (cell.status === "running") {
    // "Engineer · round 2" → "Working · **Engineer** · round 2"
    const [who, ...rest] = (cell.now ?? "").split(" · ");
    return (
      <span className="cmp-set__cell">
        <span className="cmp-set__live" aria-hidden />
        <span>
          Working
          {who && (
            <>
              {" · "}
              <b>{who}</b>
              {rest.length > 0 && ` · ${rest.join(" · ")}`}
            </>
          )}
        </span>
      </span>
    );
  }
  if (cell.status === "stopped")
    return <span className="cmp-set__cell cmp-set__cell--muted">Stopped</span>;
  const failed = cell.status === "failed" || cell.check === "failed";
  const mark =
    cell.status === "failed" ? "Failed" : failed ? "Hidden check failed" : "Hidden check passed";
  return (
    <span className="cmp-set__cell">
      {(cell.check || cell.status === "failed") && (
        <span title={mark} className={`cmp-set__mark${failed ? " cmp-set__mark--failed" : ""}`}>
          {failed ? (
            <CircleX size={15} strokeWidth={1.6} aria-label={mark} />
          ) : (
            <CircleCheck size={15} strokeWidth={1.6} aria-label={mark} />
          )}
        </span>
      )}
      {rounds(cell.rounds)} · <code className="cmp-set__cost">{money(cell.cost_usd)}</code>
      {cell.note && <span className="cmp-set__note">{cell.note}</span>}
    </span>
  );
}

/** A set compare's per-task table; a cell with a run opens it. */
function SetTable({ c, teamId, label }: { c: Compare; teamId: string; label: string }) {
  const v = (side: "A" | "B") => c.sides.find((s) => s.label === side)?.version;
  return (
    <div className="cmp-res__wrap">
      <table className="cmp-set__table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">A · v{v("A")}</th>
            <th scope="col">B · v{v("B")}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {(c.items ?? []).map((it, i) => (
            <tr key={i}>
              <th scope="row">{it.task}</th>
              {[it.a, it.b].map((cell, j) => (
                <td key={j}>
                  {cell.run_id ? (
                    <button
                      type="button"
                      className="cmp-set__open"
                      onClick={() => openRun(teamId, cell.run_id as string)}
                    >
                      <SetCellView cell={cell} />
                    </button>
                  ) : (
                    <SetCellView cell={cell} />
                  )}
                </td>
              ))}
              <td>
                {it.badge && (
                  <span
                    className={`cmp-set__badge${/better/.test(it.badge) ? " cmp-set__badge--good" : /more/.test(it.badge) ? " cmp-set__badge--warn" : ""}`}
                  >
                    {it.badge}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Set-Results: the four cards, the per-task table, Restore vN and Done. */
function SetResults({
  c,
  teamId,
  onRestored,
}: {
  c: Compare;
  teamId: string;
  onRestored: () => void;
}) {
  const r = c.results as NonNullable<Compare["results"]>;
  const set = c.set as NonNullable<Compare["set"]>;
  const [look, variant] = COMPARE_LOOK[c.status];
  const v = (side: "A" | "B") => c.sides.find((s) => s.label === side)?.version;
  const sub = [
    `${set.count} ${set.count === 1 ? "task" : "tasks"} · run side by side`,
    c.ended_at && `finished ${versionAge(c.ended_at, Date.now(), true)}`,
    `${money(c.cost_usd)} in all`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="cmp-res">
      <div className="cmp-res__head">
        <div>
          <h2 className="cmp-h2">
            v{v("A")} and v{v("B")} on {set.name}
          </h2>
          <p className="cmp-res__sub">{sub}</p>
        </div>
        <Badge variant={variant} dot>
          {look}
        </Badge>
      </div>
      {(r.cards ?? []).length > 0 && (
        <div className="cmp-cards">
          {(r.cards ?? []).map((k) => (
            <div key={k.key} className="cmp-card" role="group" aria-label={k.label}>
              <span className="cmp-eyebrow">{k.label}</span>
              <div className="cmp-card__vals">
                <span className="cmp-card__a">
                  v{v("A")} {k.a}
                </span>
                <ArrowRight size={14} strokeWidth={1.6} aria-hidden />
                <span className="cmp-card__b">
                  v{v("B")} {k.b}
                </span>
              </div>
              <span className={`cmp-card__note${k.tone ? ` cmp-card__note--${k.tone}` : ""}`}>
                {k.note}
              </span>
            </div>
          ))}
        </div>
      )}
      <SetTable c={c} teamId={teamId} label="Results" />
      <Foot r={r} teamId={teamId} onRestored={onRestored}>
        Click any result to open that run. v{r.current_version} is your current version.
      </Foot>
    </div>
  );
}
