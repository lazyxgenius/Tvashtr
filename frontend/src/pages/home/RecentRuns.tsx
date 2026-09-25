import { Check, ChevronDown } from "lucide-react";
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";

import { type RunListRow, type RunStatusFilter, listRunsPage } from "../../lib/api/runs";
import { navigate } from "../../lib/nav";
import { formatRelativeTime } from "../../lib/time";
import { Popover } from "../../design-system/components";
import { useHome } from "./homeContext";
import { useHomeData } from "./homeData";
import { runStatusLook } from "./homeFormat";
import { GithubIcon } from "./homeIcons";
import { RunHistorySheet } from "./RunHistorySheet";
import "./home-runs.css";

const PAGE = 5;

const FILTERS: { value: RunStatusFilter; label: string }[] = [
  { value: "all", label: "All runs" },
  { value: "running", label: "Running" },
  { value: "needs_you", label: "Needs you" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "stopped", label: "Stopped" },
];

function openRun(row: RunListRow) {
  const teamId = row.team?.id ?? row.library_team_id;
  if (teamId) navigate({ page: "team", teamId, runId: row.run_id });
}

function RunEnd({ row }: { row: RunListRow }) {
  if (row.status === "completed") {
    if (row.pr_url) {
      return (
        <span className="hm-recent__pr-wrap">
          <a
            className="hm-recent__pr"
            href={row.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e: MouseEvent) => e.stopPropagation()}
          >
            <GithubIcon size={12} />
            PR #{row.pr_number ?? ""}
          </a>
          <span className="hm-recent__tip" role="tooltip">
            Opens{" "}
            <span className="hm-recent__tip-code">{row.pr_url.replace(/^https?:\/\//, "")}</span> in
            a new tab
          </span>
        </span>
      );
    }
    const folder = row.target?.kind === "desktop_folder" || row.target?.kind === "local";
    return (
      <span className="hm-recent__status">
        {folder && row.ship_branch ? `Branch ${row.ship_branch}` : "Shipped"}
      </span>
    );
  }
  return <span className="hm-recent__status">{runStatusLook(row.status).label}</span>;
}

/**
 * Recent runs (HOME-83–86, HmF-RunsFilter): the account's runs newest first, five at a time with
 * Show more, a status filter, PR links for shipped runs, and a row click that opens the run. A
 * team's full history (HmF-History) opens as a sheet when a team card asks for it.
 */
export function RecentRuns() {
  const { teams, historyTeamId, setHistoryTeamId, pickTeamForRun } = useHome();
  const { version } = useHomeData();
  const [filter, setFilter] = useState<RunStatusFilter>("all");
  const [rows, setRows] = useState<RunListRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(false);
  const shown = useRef(PAGE);
  const trigger = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (f: RunStatusFilter, limit: number) => {
    try {
      const page = await listRunsPage({ status: f, limit });
      setRows(page.runs);
      setCursor(page.next_cursor);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  // Refetch on filter change and after every Home action / poll (keeping what's shown).
  useEffect(() => {
    void load(filter, shown.current);
  }, [filter, version, load]);

  const showMore = async () => {
    if (!cursor) return;
    setMore(true);
    try {
      const page = await listRunsPage({ status: filter, limit: PAGE, cursor });
      setRows((r) => [...(r ?? []), ...page.runs]);
      setCursor(page.next_cursor);
      shown.current += PAGE;
    } catch {
      setError(true);
    } finally {
      setMore(false);
    }
  };

  const pick = (f: RunStatusFilter) => {
    setOpen(false);
    trigger.current?.focus();
    if (f === filter) return;
    shown.current = PAGE;
    setRows(null);
    setFilter(f);
  };

  const historyTeam = teams.find((t) => t.team_graph_id === historyTeamId);
  const history = (
    <RunHistorySheet
      teamId={historyTeamId}
      teamName={historyTeam?.name ?? "This team"}
      onClose={() => setHistoryTeamId(null)}
      onStartRun={(id) => pickTeamForRun(id)}
    />
  );

  if (rows === null && !error && filter === "all") {
    return (
      <>
        <div className="hm-skel-card" style={{ height: 260 }} aria-hidden="true">
          <div className="hm-skel-bar" style={{ width: "30%", height: 14 }} />
          <div className="hm-skel-bar" style={{ width: "80%", height: 12 }} />
          <div className="hm-skel-bar" style={{ width: "60%", height: 12 }} />
        </div>
        {history}
      </>
    );
  }

  const label = FILTERS.find((f) => f.value === filter)?.label ?? "All runs";

  return (
    <section className="hm-card hm-card--open" aria-label="Recent runs">
      <div className="hm-card__head">
        <h2 className="hm-section__title hm-section__title--side">Recent runs</h2>
        <span className="hm-recent__filter">
          <Popover
            open={open}
            onClose={() => setOpen(false)}
            width={162}
            role="listbox"
            label="Filter runs"
            className="hm-pop--filter"
            trigger={
              <button
                ref={trigger}
                type="button"
                className="hm-picker hm-picker--filter"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
              >
                {label}
                <span className="hm-picker__chev">
                  <ChevronDown size={14} strokeWidth={1.6} aria-hidden />
                </span>
              </button>
            }
          >
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="option"
                aria-selected={f.value === filter}
                className="hm-filter-opt"
                onClick={() => pick(f.value)}
              >
                <span className="hm-filter-opt__check">
                  {f.value === filter && <Check size={13} strokeWidth={2} aria-hidden />}
                </span>
                {f.label}
              </button>
            ))}
          </Popover>
        </span>
      </div>
      {error && !rows ? (
        <div className="hm-recent__empty" role="alert">
          Couldn’t load your runs.{" "}
          <button type="button" className="hm-linkbtn" onClick={() => void load(filter, PAGE)}>
            Retry
          </button>
        </div>
      ) : rows && rows.length === 0 ? (
        <div className="hm-recent__empty">
          {filter === "all" ? "No runs yet." : "No runs match this filter."}
        </div>
      ) : (
        <ul className="hm-recent">
          {(rows ?? []).map((r) => {
            const look = runStatusLook(r.status);
            return (
              <li key={r.run_id} className="hm-recent__row">
                <span
                  className="hm-recent__dot"
                  title={look.label}
                  style={{ background: look.dot }}
                />
                <div className="hm-recent__body">
                  <button type="button" className="hm-recent__idea" onClick={() => openRun(r)}>
                    <span>{r.idea}</span>
                  </button>
                  <div className="hm-recent__meta">
                    {r.team?.name ?? "Run"} · {formatRelativeTime(r.created_at)}
                  </div>
                </div>
                <RunEnd row={r} />
              </li>
            );
          })}
        </ul>
      )}
      {cursor && rows && rows.length > 0 && (
        <div className="hm-recent__more">
          <a
            href="#"
            className="hm-recent__more-link"
            aria-busy={more || undefined}
            onClick={(e) => {
              e.preventDefault();
              void showMore();
            }}
          >
            Show more
          </a>
        </div>
      )}
      {history}
    </section>
  );
}
