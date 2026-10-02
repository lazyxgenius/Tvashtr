import { ChevronDown, FlaskConical, History, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Badge, Button, IconButton, Select } from "../design-system/components";
import { getTeamRuns, type TeamRunRow } from "../lib/api";
import type { TeamVersion, TeamVersions } from "../lib/api/versions";
import { useTicker } from "../lib/useTicker";
import { runLook, runMeta, runsPill, versionAge } from "../lib/versionFormat";
import { LoadState } from "../panel/runs/RunsTab";
import type { Loaded } from "../panel/runs/useLoaded";
import { useLoaded } from "../panel/runs/useLoaded";
import { VersionTag } from "../components/VersionTag";
import { useDockedPanel } from "./useDockedPanel";
import { VersionChanges, VersionRestore } from "./VersionDialogs";

/** The panel shows this many versions, then "Show N older versions". */
const SHOWN = 5;

type Dialog = { kind: "changes" | "restore"; number: number };

/**
 * M5 — History (Ver-History / Ver-RunTag), opened from the header's version chip: Versions (each
 * version with its summary, who and when, its runs, What changed and Restore) and Runs (each run
 * with the version it used). The Team file panel's 420px shell.
 */
export function HistoryPanel({
  teamId,
  versions,
  revision,
  guard,
  onRestored,
  onClose,
}: {
  teamId: string;
  /** The page's versions summary (the chip reads the same one). */
  versions: Loaded<TeamVersions>;
  /** Bumped whenever the canvas's graph changes: the runs are read again. */
  revision: number;
  /** Run an action through the agent drawer's unsaved guard. */
  guard: (proceed: () => void) => void;
  /** After a restore: the page reloads the team graph and the versions. */
  onRestored: () => void;
  onClose: () => void;
}) {
  const close = useDockedPanel(onClose);
  const [tab, setTab] = useState<"versions" | "runs">("versions");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  return (
    <aside className="cv-file" aria-label="History">
      <header className="cv-file__head">
        <span className="cv-file__icon">
          <History size={16} strokeWidth={1.6} aria-hidden />
        </span>
        <div className="cv-file__titles">
          <div className="cv-file__title">History</div>
          <div className="cv-file__sub">Every save is a version. Nothing is ever deleted.</div>
        </div>
        <IconButton ref={close} size="sm" aria-label="Close" title="Close" onClick={onClose}>
          <X size={16} strokeWidth={1.6} aria-hidden />
        </IconButton>
      </header>
      {tab === "versions" ? (
        <VersionsTab
          tab={<Seg tab={tab} onTab={setTab} />}
          versions={versions}
          onOpen={(kind, number) => setDialog({ kind, number })}
        />
      ) : (
        <RunsTab tab={<Seg tab={tab} onTab={setTab} />} teamId={teamId} revision={revision} />
      )}
      <footer className="cv-file__foot">
        <span className="cv-hist__foot">
          Edits stay a draft until you save. Starting a run saves them first, so every run has a
          version.
        </span>
      </footer>
      {dialog?.kind === "changes" && (
        <VersionChanges
          teamId={teamId}
          number={dialog.number}
          current={versions.value?.current ?? dialog.number}
          onRestore={(number) => setDialog({ kind: "restore", number })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "restore" && (
        <VersionRestore
          teamId={teamId}
          number={dialog.number}
          guard={guard}
          onRestored={() => {
            setDialog(null);
            onRestored();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </aside>
  );
}

function Seg({
  tab,
  onTab,
}: {
  tab: "versions" | "runs";
  onTab: (tab: "versions" | "runs") => void;
}) {
  const items = [
    ["versions", "Versions"],
    ["runs", "Runs"],
  ] as const;
  return (
    <div className="tv-seg cv-file__seg" role="group" aria-label="Show">
      {items.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={`tv-seg__btn${tab === value ? " tv-seg__btn--active" : ""}`}
          aria-pressed={tab === value}
          onClick={() => onTab(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function VersionsTab({
  tab,
  versions,
  onOpen,
}: {
  tab: ReactNode;
  versions: Loaded<TeamVersions>;
  onOpen: (kind: Dialog["kind"], number: number) => void;
}) {
  const [all, setAll] = useState(false);
  const now = useTicker();
  const v = versions.value;
  const shown = v ? (all ? v.versions : v.versions.slice(0, SHOWN)) : [];
  const older = v ? v.versions.length - shown.length : 0;
  return (
    <div className="cv-hist__body">
      <div className="cv-hist__top">
        {tab}
        {v && (
          <span className="cv-hist__count">
            {older > 0
              ? `${shown.length} of ${v.total} versions`
              : `${v.total} version${v.total === 1 ? "" : "s"}`}
          </span>
        )}
      </div>
      {v ? (
        <>
          <ol className="cv-hist__list">
            {shown.map((row, i) => (
              <VersionRow
                key={row.number}
                row={row}
                current={row.number === v.current}
                now={now}
                last={i === shown.length - 1}
                onOpen={onOpen}
              />
            ))}
          </ol>
          {older > 0 && (
            <button type="button" className="cv-hist__more" onClick={() => setAll(true)}>
              <ChevronDown size={13} strokeWidth={1.6} aria-hidden />
              Show {older} older version{older === 1 ? "" : "s"}
            </button>
          )}
        </>
      ) : (
        <LoadState
          state={versions.state === "error" ? "error" : "loading"}
          loading="Loading the versions"
          error="Couldn’t load the versions."
          onRetry={versions.retry}
        />
      )}
    </div>
  );
}

function VersionRow({
  row,
  current,
  now,
  last,
  onOpen,
}: {
  row: TeamVersion;
  current: boolean;
  /** The time now (a 60 s tick: "2m ago" ages while the panel sits open). */
  now: number;
  last: boolean;
  onOpen: (kind: Dialog["kind"], number: number) => void;
}) {
  return (
    <li className={`cv-hist__ver${current ? " cv-hist__ver--now" : ""}`}>
      {!last && <span className="cv-hist__line" aria-hidden />}
      <span className="cv-hist__dot" aria-hidden />
      <div className="cv-hist__l1">
        <span className="cv-hist__num">v{row.number}</span>
        {current && <span className="cv-now">Now</span>}
        <span className="cv-hist__when">
          {versionAge(row.created_at, now)} · {row.author}
        </span>
      </div>
      <div className="cv-hist__sum">{row.note || row.summary}</div>
      <div className="cv-hist__l3">
        <span className="cv-pill">{runsPill(row.runs)}</span>
        {/* M7 (R6, Set-Checked): how this version's tests went, next to it. */}
        {row.tests && !row.tests.running && (
          <span
            className={`cv-tpill${row.tests.passed === row.tests.total ? " cv-tpill--good" : ""}`}
          >
            <FlaskConical size={12} strokeWidth={2} aria-hidden />
            Tests {row.tests.passed} of {row.tests.total}
          </span>
        )}
        <span className="cv-hist__acts">
          <button
            type="button"
            className="cv-link"
            aria-label={`What changed in v${row.number}`}
            onClick={() => onOpen("changes", row.number)}
          >
            What changed
          </button>
          {!current && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Restore v${row.number}`}
              onClick={() => onOpen("restore", row.number)}
            >
              Restore
            </Button>
          )}
        </span>
      </div>
    </li>
  );
}

function RunsTab({ tab, teamId, revision }: { tab: ReactNode; teamId: string; revision: number }) {
  const runs = useLoaded(`${teamId}:${revision}`, () => getTeamRuns(teamId), { keep: true });
  const [filter, setFilter] = useState("all");
  const list: TeamRunRow[] = runs.value ?? [];
  const numbers = [...new Set(list.map((r) => r.team_version_number))]
    .filter((n): n is number => n != null)
    .sort((a, b) => b - a);
  const shown =
    filter === "all" ? list : list.filter((r) => String(r.team_version_number) === filter);
  return (
    <div className="cv-hist__body">
      <div className="cv-hist__top">
        {tab}
        <Select
          aria-label="Version"
          className="cv-hist__filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          options={[
            { value: "all", label: "All versions" },
            ...numbers.map((n) => ({ value: String(n), label: `v${n}` })),
          ]}
        />
      </div>
      <div className="cv-hist__intro">
        Each run keeps the version it started with, even if you change the team later.
      </div>
      {runs.value ? (
        <ul className="cv-hist__runs">
          {shown.map((r) => {
            const look = runLook(r.status);
            return (
              <li key={r.run_id} className="cv-hist__run">
                <div className="cv-hist__run-l1">
                  <span className="cv-hist__run-n">
                    {r.number != null ? `run #${r.number}` : "run"}
                  </span>
                  <Badge variant={look.variant} dot>
                    {look.label}
                  </Badge>
                  {r.team_version_number != null && <VersionTag number={r.team_version_number} />}
                </div>
                <div className="cv-hist__task">{r.idea}</div>
                <div className="cv-hist__meta">{runMeta(r)}</div>
              </li>
            );
          })}
        </ul>
      ) : (
        <LoadState
          state={runs.state === "error" ? "error" : "loading"}
          loading="Loading the runs"
          error="Couldn’t load the runs."
          onRetry={runs.retry}
        />
      )}
    </div>
  );
}
