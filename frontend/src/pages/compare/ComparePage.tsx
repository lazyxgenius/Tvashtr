import "../../canvas/chrome.css";
import "../../panel/run/live/live.css";
import "../home/home-runs.css";
import "./compare.css";

import { ArrowLeft, Info, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CanvasHeader } from "../../canvas/CanvasHeader";
import { CompareChanges } from "../../canvas/VersionDialogs";
import { Button, Checkbox, IconButton, Input, Select, Tabs } from "../../design-system/components";
import {
  type CompareStart,
  type CompareVersion,
  getCompareChanges,
  getCompareStart,
  startCompare,
} from "../../lib/api/compare";
import { listRecentTasks } from "../../lib/api/myAgents";
import { navigate } from "../../lib/nav";
import { runsPill, versionAge } from "../../lib/versionFormat";
import { LoadState } from "../../panel/runs/RunsTab";
import { useLoaded } from "../../panel/runs/useLoaded";
import { money } from "../home/homeFormat";
import { GithubIcon } from "../home/homeIcons";
import type { ShellUser } from "../shell/Shell";
import { CompareView } from "./CompareView";

type Tab = "compare" | "versions";
// The board's "Task sets" tab arrives with M9 (brief §2.4: no dead tabs).
const TABS = [
  { value: "compare" as const, label: "Compare" },
  { value: "versions" as const, label: "Versions" },
];

/** "now", "yesterday", "3 days ago" (the boards' word for a version saved this minute is "now"). */
const when = (iso: string) => versionAge(iso).replace(/^just now$/, "now");
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Yesterday · 3 runs · Added the Spec approval gate" (no runs: left out). */
const caption = (v: CompareVersion) =>
  [capital(when(v.when)), v.runs > 0 && runsPill(v.runs), v.summary].filter(Boolean).join(" · ");
const options = (versions: CompareVersion[]) =>
  versions.map((v) => ({ value: String(v.number), label: `v${v.number} · ${when(v.when)}` }));

type Pick = { a: number | null; b: number | null };

/**
 * M8 — Compare versions (Quality › Cmp-*), full-window like the team canvas: the canvas header, the
 * "Compare versions" bar, the Compare / Versions tabs. Compare shows the start form, or the compare
 * the address names (its lanes, then its results); with no compare named, the team's compare that
 * is still going opens.
 */
export function ComparePage({
  teamId,
  compareId,
  tab,
  user,
  onLogout,
}: {
  teamId: string;
  compareId?: string;
  tab?: "versions";
  user?: ShellUser | null;
  onLogout?: () => void;
}) {
  // Read again on every move (a compare that has ended since is no longer "the one going").
  const start = useLoaded(
    `${teamId}:${compareId ?? ""}:${tab ?? ""}`,
    () => getCompareStart(teamId),
    { keep: true },
  );
  const s = start.value;
  const [pick, setPick] = useState<Pick | null>(null);
  const current: Tab = tab ?? "compare";

  const fresh = start.state === "ready" ? s?.latest : null;
  useEffect(() => {
    if (!compareId && fresh && (fresh.status === "waiting" || fresh.status === "running"))
      navigate({ page: "compare", teamId, compareId: fresh.id, tab }, { replace: true });
  }, [compareId, fresh, teamId, tab]);

  const toCanvas = () => navigate({ page: "team", teamId });
  const loading = (
    <LoadState
      state={start.state === "error" ? "error" : "loading"}
      loading="Loading the versions"
      error="Couldn’t load the versions."
      onRetry={start.retry}
    />
  );
  return (
    <div className="cmp-page">
      <CanvasHeader user={user} onLogout={onLogout} />
      <div className="cmp-bar">
        <IconButton
          variant="outline"
          aria-label="Back to the canvas"
          title="Back to the canvas"
          onClick={toCanvas}
        >
          <ArrowLeft size={16} strokeWidth={1.6} />
        </IconButton>
        <div className="cmp-bar__titles">
          <h1 className="cmp-bar__title">Compare versions</h1>
          <span className="cmp-bar__team">{s?.team.name ?? ""}</span>
        </div>
      </div>
      <div className="cmp-tabs">
        <Tabs<Tab>
          variant="line"
          aria-label="Compare versions"
          items={TABS}
          value={current}
          onChange={(t) =>
            navigate(
              { page: "compare", teamId, compareId, tab: t === "versions" ? t : undefined },
              { replace: true },
            )
          }
        />
      </div>
      <main className="cmp-main">
        {current === "versions" ? (
          s ? (
            <Versions
              start={s}
              onPick={(a, b) => {
                setPick({ a, b });
                navigate({ page: "compare", teamId }, { replace: true });
              }}
            />
          ) : (
            loading
          )
        ) : compareId ? (
          <CompareView key={compareId} id={compareId} teamId={teamId} />
        ) : s ? (
          <Start teamId={teamId} start={s} pick={pick ?? s.defaults} onPick={setPick} />
        ) : (
          loading
        )}
      </main>
    </div>
  );
}

/** Cmp-Start / Cmp-OneVersion. */
function Start({
  teamId,
  start,
  pick,
  onPick,
}: {
  teamId: string;
  start: CompareStart;
  pick: Pick;
  onPick: (p: Pick) => void;
}) {
  const one = start.versions.length < 2;
  const a = one ? (start.versions[0]?.number ?? null) : pick.a;
  const b = one ? null : pick.b;
  const versionOf = (n: number | null) => start.versions.find((v) => v.number === n);
  const latest = start.versions.find((v) => v.current) ?? start.versions[0];

  const [task, setTask] = useState("");
  const typed = useRef(false);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);

  // M6's recent tasks: the team's newest task, unless the person has typed already.
  useEffect(() => {
    let live = true;
    listRecentTasks("", 20).then(
      (tasks) => {
        const mine = tasks.find((t) => t.team?.id === teamId);
        if (live && mine && !typed.current) setTask(mine.task);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [teamId]);

  // The defaults' change count comes with the page; another pair asks.
  const pair = a !== null && b !== null && a !== b;
  const isDefault = a === start.defaults.a && b === start.defaults.b;
  const other = useLoaded(pair && !isDefault ? `${teamId}:${a}:${b}` : null, () =>
    getCompareChanges(teamId, a as number, b as number),
  );
  const changes = !pair ? 0 : isDefault ? start.changes : (other.value?.rows.length ?? 0);

  const canStart = !busy && pair && task.trim() !== "";
  const go = () => {
    if (!canStart) return;
    setBusy(true);
    setError(null);
    startCompare(teamId, {
      a,
      b,
      task: task.trim(),
      auto_approve: auto,
    }).then(
      (made) => navigate({ page: "compare", teamId, compareId: made.id }, { replace: true }),
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      },
    );
  };

  const side = (label: "A" | "B", value: number | null, onChange: (n: number) => void) => {
    const v = versionOf(value);
    return (
      <div className="cmp-pick__card">
        <div className="cmp-pick__row">
          <span className="cmp-tile">{label}</span>
          {label === "B" && one ? (
            <Select aria-label="Version B" disabled>
              <option value="">No other version</option>
            </Select>
          ) : (
            <Select
              aria-label={`Version ${label}`}
              options={options(start.versions)}
              value={value === null ? "" : String(value)}
              onChange={(e) => onChange(Number(e.target.value))}
            />
          )}
        </div>
        {v && <div className="cmp-pick__cap">{caption(v)}</div>}
      </div>
    );
  };

  return (
    <div className="cmp-narrow">
      <div>
        <h2 className="cmp-h2">Run the same task on two versions</h2>
        <p className="cmp-lede">
          Both run at the same time on separate copies of the repo. Nothing ships and no pull
          request is opened.
        </p>
      </div>
      <div className="cmp-pick">
        {side("A", a, (n) => onPick({ a: n, b }))}
        <div className="cmp-pick__vs">
          <span>vs</span>
          {changes > 0 && (
            <button type="button" className="cmp-link" onClick={() => setShowChanges(true)}>
              {changes} {changes === 1 ? "change" : "changes"}
            </button>
          )}
        </div>
        {side("B", b, (n) => onPick({ a, b: n }))}
      </div>
      {one && (
        <div className="cmp-callout">
          <Info size={16} strokeWidth={1.6} aria-hidden />
          <div>This team has one version. Save a change as v2, then compare the two.</div>
        </div>
      )}
      <div className="cmp-start__on">
        <span className="cmp-eyebrow">Run them on</span>
        <Input
          label="Task"
          value={task}
          onChange={(e) => {
            typed.current = true;
            setTask(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
        {start.target && (
          <div className="cmp-start__repo">
            <GithubIcon size={14} />
            <code>{start.target.repo}</code>
            {start.target.base_ref && (
              <>
                {" · starts from "}
                <code>{start.target.base_ref}</code>
              </>
            )}
          </div>
        )}
      </div>
      <Checkbox
        label="Approve gates automatically"
        description="So both versions are treated the same. Turn this off to review each spec yourself."
        checked={auto}
        onChange={(e) => setAuto(e.target.checked)}
      />
      <div className="cmp-start__foot">
        <span>
          {start.estimate && (
            <>
              About <b>{money(start.estimate.cost_usd)}</b> on your keys · about{" "}
              {start.estimate.minutes} min
            </>
          )}
        </span>
        <Button variant="primary" className="cv-btn-flush" disabled={!canStart} onClick={go}>
          <Play size={14} fill="currentColor" strokeWidth={0} aria-hidden />
          <span>Start compare</span>
        </Button>
      </div>
      {error && (
        <div className="cmp-start__error" role="alert">
          {error}
        </div>
      )}
      {showChanges && a !== null && b !== null && (
        <CompareChanges
          teamId={teamId}
          a={a}
          b={b}
          current={latest?.number ?? b}
          onClose={() => setShowChanges(false)}
        />
      )}
    </div>
  );
}

/** Cmp-Versions: History's rows; "Compare with v<current>" puts that version in A. */
function Versions({
  start,
  onPick,
}: {
  start: CompareStart;
  onPick: (a: number, b: number) => void;
}) {
  const latest = start.versions.find((v) => v.current) ?? start.versions[0];
  return (
    <div className="cmp-narrow">
      <div>
        <h2 className="cmp-h2">Versions</h2>
        {latest && (
          <p className="cmp-lede">
            Pick a version to run it against v{latest.number} on the same task.
          </p>
        )}
      </div>
      <ol className="cmp-vers">
        {start.versions.map((v, i) => (
          <li key={v.number} className={`cv-hist__ver${v.current ? " cv-hist__ver--now" : ""}`}>
            {i < start.versions.length - 1 && <span className="cv-hist__line" aria-hidden />}
            <span className="cv-hist__dot" aria-hidden />
            <div className="cv-hist__l1">
              <span className="cv-hist__num">v{v.number}</span>
              <span className="cv-hist__when">{when(v.when)}</span>
            </div>
            <div className="cv-hist__sum">{v.summary}</div>
            <div className="cv-hist__l3">
              <span className="cv-pill">{runsPill(v.runs)}</span>
              <span className="cv-hist__acts">
                {v.current ? (
                  <span className="cv-now">Current</span>
                ) : (
                  latest && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onPick(v.number, latest.number)}
                    >
                      Compare with v{latest.number}
                    </Button>
                  )
                )}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
