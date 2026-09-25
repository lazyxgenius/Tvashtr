import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, TriangleAlert } from "lucide-react";

import {
  Button,
  ConfirmDialog,
  Input,
  Tabs,
  useDismiss,
  useToast,
} from "../../design-system/components";
import type { TeamSummary } from "../../lib/api";
import { ApiError } from "../../lib/api";
import { deleteLibraryTeam, duplicateTeam, renameLibraryTeam } from "../../lib/api/teams";
import { navigate } from "../../lib/nav";
import { refreshBadges } from "../../lib/workspaceStatus";
import { useHome } from "./homeContext";
import { TeamCard, type TeamItemActions, TeamRow } from "./TeamItem";
import {
  deleteImpact,
  loadSort,
  loadView,
  saveSort,
  saveView,
  SORT_LABELS,
  sortTeams,
  TAB_EMPTY,
  tabCounts,
  type TeamSort,
  type TeamTab,
  teamTabOf,
  type TeamView,
} from "./teamFormat";
import "./teams.css";

const BLANK_NAME = "Give this team a name so you can tell it apart.";
const SORTS = Object.keys(SORT_LABELS) as TeamSort[];

/** Sort: {option} — a listbox of Last active, Name, Spend, Created (TEAMS-9). */
function SortPicker({ value, onChange }: { value: TeamSort; onChange: (s: TeamSort) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), wrap);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [open]);

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const els = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
    e.preventDefault();
  };

  return (
    <span className="ds-anchor" ref={wrap}>
      <button
        type="button"
        className="hm-sort"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="hm-sort__k">Sort:</span>
        {SORT_LABELS[value]}
        <span className="hm-sort__chev" aria-hidden="true">
          <ChevronDown size={14} strokeWidth={1.6} />
        </span>
      </button>
      {open && (
        <div
          ref={list}
          role="listbox"
          aria-label="Sort teams"
          className="hm-sort__list"
          onKeyDown={onListKey}
        >
          {SORTS.map((s) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={s === value}
              className="hm-sort__opt"
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
            >
              <span className="hm-sort__tick" aria-hidden="true">
                {s === value && <Check size={13} strokeWidth={2} />}
              </span>
              {SORT_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function SkeletonCards() {
  return (
    <div className="hm-teams__grid" aria-busy="true" aria-label="Loading teams">
      {[0, 1].map((i) => (
        <div key={i} className="hm-team hm-team--skeleton">
          <span className="hm-skel" style={{ width: "46%", height: 16 }} />
          <span className="hm-skel" style={{ width: "62%", height: 22 }} />
          <span className="hm-skel" style={{ width: "80%", height: 12 }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Teams (Home-Main, HmF-TeamTabs / TeamFind / TeamMenu): search, sort, grid/list, status tabs, and
 * each team's card with its pipeline strip, last run, counts, Run and ⋯ (open, start a run, run
 * history, rename, duplicate, delete).
 */
export function TeamsSection() {
  const {
    teams,
    teamsLoading,
    teamsError,
    reloadTeams,
    pickTeamForRun,
    openNewTeam,
    openRunHistory,
  } = useHome();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TeamSort>(loadSort);
  const [view, setView] = useState<TeamView>(loadView);
  const [tab, setTab] = useState<TeamTab>("all");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Summaries a rename returned, shown until the next team list load replaces them.
  const [patched, setPatched] = useState<Record<string, TeamSummary>>({});
  const [deleting, setDeleting] = useState<TeamSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => setPatched({}), [teams]);

  // After Duplicate: scroll to the copy and highlight it briefly (TEAMS-29).
  useEffect(() => {
    if (!flashId) return;
    const el = sectionRef.current?.querySelector(`[data-team-id="${CSS.escape(flashId)}"]`);
    if (el && "scrollIntoView" in el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const t = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(t);
  }, [flashId, teams]);

  const all = useMemo(() => teams.map((t) => patched[t.team_graph_id] ?? t), [teams, patched]);
  const counts = useMemo(() => tabCounts(all), [all]);
  const showTabs = all.length >= 2;
  const activeTab: TeamTab = showTabs ? tab : "all";
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      sortTeams(
        all.filter(
          (t) =>
            (activeTab === "all" || teamTabOf(t) === activeTab) &&
            (!q || t.name.toLowerCase().includes(q)),
        ),
        sort,
      ),
    [all, activeTab, q, sort],
  );

  const actions: TeamItemActions = {
    open: (t) => navigate({ page: "team", teamId: t.team_graph_id }),
    run: (t) => {
      pickTeamForRun(t.team_graph_id, { toast: true });
    },
    history: (t) => openRunHistory(t.team_graph_id),
    startRename: (t) => setRenamingId(t.team_graph_id),
    cancelRename: () => setRenamingId(null),
    saveName: async (t, name) => {
      try {
        const updated = await renameLibraryTeam(t.team_graph_id, name);
        setPatched((p) => ({ ...p, [t.team_graph_id]: { ...t, ...updated } }));
        setRenamingId(null);
        void reloadTeams();
        return null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) return BLANK_NAME;
        toast({ message: "Couldn’t rename the team — is the backend running?", tone: "error" });
        return "";
      }
    },
    duplicate: (t) => {
      void (async () => {
        try {
          const copy = await duplicateTeam(t.team_graph_id);
          await reloadTeams();
          setFlashId(copy.team_graph_id);
        } catch {
          toast({
            message: "Couldn’t duplicate the team — is the backend running?",
            tone: "error",
          });
        }
      })();
    },
    remove: (t) => {
      setDeleteError(null);
      setDeleting(t);
    },
  };

  const confirmDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteLibraryTeam(deleting.team_graph_id);
      toast({ message: `${deleting.name} deleted.` });
      setDeleting(null);
      await reloadTeams();
      void refreshBadges();
    } catch {
      setDeleteError("Couldn’t delete the team — is the backend running?");
    } finally {
      setDeleteBusy(false);
    }
  };

  const impact = deleting ? deleteImpact(deleting) : null;

  let body;
  if (teamsLoading && all.length === 0) {
    body = <SkeletonCards />;
  } else if (teamsError && all.length === 0) {
    body = (
      <div className="hm-card hm-teams__empty">
        <div className="hm-teams__empty-lede">
          Couldn’t load your teams — is the backend running?
        </div>
        <Button variant="secondary" size="sm" onClick={() => void reloadTeams()}>
          Try again
        </Button>
      </div>
    );
  } else if (all.length === 0) {
    body = (
      <div className="hm-card hm-teams__empty">
        <div className="hm-teams__empty-title">No teams yet</div>
        <div className="hm-teams__empty-lede">
          Start one from a template. You can change every agent later.
        </div>
        <div className="hm-teams__empty-actions">
          <Button variant="primary" size="sm" onClick={() => openNewTeam()}>
            New team
          </Button>
        </div>
      </div>
    );
  } else if (shown.length === 0 && q) {
    body = (
      <section className="hm-card hm-teams__empty">
        <span className="hm-teams__empty-icon" aria-hidden="true">
          <Search size={24} strokeWidth={1.6} />
        </span>
        <div className="hm-teams__empty-title">No teams match “{query.trim()}”</div>
        <div className="hm-teams__empty-lede">
          Try another word, or start a new team from a template.
        </div>
        <div className="hm-teams__empty-actions">
          <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
            Clear search
          </Button>
          <Button variant="primary" size="sm" onClick={() => openNewTeam()}>
            New team
          </Button>
        </div>
      </section>
    );
  } else if (shown.length === 0) {
    body = <div className="hm-teams__none">{TAB_EMPTY[activeTab]}</div>;
  } else if (view === "list") {
    body = (
      <section className="hm-card">
        <table className="hm-tlist">
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col">Status</th>
              <th scope="col">Last run</th>
              <th scope="col">Runs · spend</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <TeamRow
                key={t.team_graph_id}
                team={t}
                renaming={renamingId === t.team_graph_id}
                highlight={flashId === t.team_graph_id}
                actions={actions}
              />
            ))}
          </tbody>
        </table>
      </section>
    );
  } else {
    body = (
      <div className="hm-teams__grid">
        {shown.map((t) => (
          <TeamCard
            key={t.team_graph_id}
            team={t}
            renaming={renamingId === t.team_graph_id}
            highlight={flashId === t.team_graph_id}
            actions={actions}
          />
        ))}
      </div>
    );
  }

  return (
    <section className="hm-teams" id="home-teams" aria-label="Teams" ref={sectionRef}>
      <div className="hm-teams__bar">
        <h2 className="hm-teams__title">Teams</h2>
        <span className="hm-teams__tools">
          <Input
            size="sm"
            placeholder="Search teams"
            aria-label="Search teams"
            className="hm-teams__search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <SortPicker
            value={sort}
            onChange={(s) => {
              setSort(s);
              saveSort(s);
            }}
          />
          <Tabs<TeamView>
            variant="pill"
            aria-label="Team view"
            value={view}
            onChange={(v) => {
              setView(v);
              saveView(v);
            }}
            items={[
              { value: "grid", label: "Grid" },
              { value: "list", label: "List" },
            ]}
          />
        </span>
      </div>
      {showTabs && (
        <div>
          <Tabs<TeamTab>
            variant="pill"
            aria-label="Filter teams by status"
            value={activeTab}
            onChange={setTab}
            items={[
              { value: "all", label: "All", count: counts.all },
              { value: "needs_you", label: "Needs you", count: counts.needs_you },
              { value: "running", label: "Running", count: counts.running },
              { value: "not_run", label: "Not run yet", count: counts.not_run },
            ]}
          />
        </div>
      )}
      {body}
      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `Delete ${deleting.name}?` : ""}
        confirmLabel="Delete team"
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => {
          if (!deleteBusy) setDeleting(null);
        }}
        onConfirm={() => void confirmDelete()}
      >
        {impact?.body}
        {impact?.warning && (
          <div className="hm-impact">
            <TriangleAlert size={14} strokeWidth={1.6} aria-hidden />
            {impact.warning}
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}
