import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  DollarSign,
  GitBranch,
  LogOut,
  Pencil,
  Play,
  Plus,
  Trash2,
  Workflow,
  X,
} from "lucide-react";

import {
  type AuthUser,
  deleteTeam,
  getTeamRuns,
  getTeams,
  renameTeam,
  type TeamRunRow,
  type TeamSummary,
} from "../lib/api";
import { RUN_TERMINAL, runStatusPill } from "../lib/status";
import { formatRelativeTime } from "../lib/time";
import { useModalDialog } from "../lib/useModalDialog";
import { AppShell, type DashView } from "./AppShell";
import { BackendDot } from "./BackendDot";
import { DomainsPage } from "./DomainsPage";
import { EnginesShelf } from "./EnginesShelf";
import { MemoryShelf } from "./MemoryShelf";
import { NewTeamDialog } from "./NewTeamDialog";
import { SecretsShelf } from "./SecretsShelf";
import { SkillsShelf } from "./SkillsShelf";
import { ToolsShelf } from "./ToolsShelf";

export type { DashView };

// A friendly handle from the email's local-part (no new PII) — "ava@studio.dev" → "Ava".
function handleFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  if (!local) return "there";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

// A team's latest run is "active" when it exists and has NOT reached a terminal status (still
// running / awaiting a human) — the stat strip's Active-runs count and the delete warning key off it.
function isActive(t: TeamSummary): boolean {
  return t.last_run !== null && !RUN_TERMINAL.has(t.last_run.status);
}

// "Mar 14" — the design's compact created date.
function formatCreated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// First 8 hex chars of a UUID, enough to tell two "New team" rows apart.
function shortTeamId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

// Secondary label under the team name: updated/created time + id snippet.
function teamMetaLabel(t: TeamSummary): string {
  const stampIso = t.last_run?.at ?? t.created_at;
  const rel = formatRelativeTime(stampIso);
  const stamp = rel || formatCreated(stampIso);
  const kind = t.last_run ? "Updated" : "Created";
  return `${kind} ${stamp} · ${shortTeamId(t.team_graph_id)}`;
}

function lastRunErrorText(t: TeamSummary): string | null {
  if (t.last_run?.status !== "failed") return null;
  const extra = t.last_run.error?.trim();
  if (extra) return extra;
  const when = formatRelativeTime(t.last_run.at);
  return when ? `Last run failed ${when}.` : "Last run failed.";
}

/**
 * The post-login dashboard — the authed default, NOT the canvas. Split into Home / Engines / Tools
 * via left nav: Home is greeting + stats + teams; Engines is subscriptions + BYOK; Tools is MCP
 * secrets + tool/skill libraries (+ memory). Opening (or creating) a team routes to the canvas via
 * `onOpenTeam`. `initialView` lets the canvas deep-link back to Engines/Tools (Open Engines).
 */
export function Dashboard({
  user,
  onLogout,
  onOpenTeam,
  onOpenRun,
  initialView = "home",
}: {
  user: AuthUser;
  onLogout: () => void;
  onOpenTeam: (teamId: string) => void;
  // Open one run from a team's history drill-down. Carries the owning team as well as the run:
  // the run view lives on that team's canvas, so the caller needs both to route there. Optional so
  // the dashboard still renders standalone (and in tests) without a run surface wired behind it.
  onOpenRun?: (runId: string, teamId: string) => void;
  /** Landing page inside the dashboard shell (canvas "Open Engines" → "engines"). */
  initialView?: DashView;
}) {
  const [view, setView] = useState<DashView>(initialView);
  useEffect(() => {
    setView(initialView);
  }, [initialView]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  // UI: the account menu, the New-team picker, and the delete-confirm target.
  const [menuOpen, setMenuOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirmTeam, setConfirmTeam] = useState<TeamSummary | null>(null);

  // Inline rename: which row is being edited, and its draft name. One at a time — a table where
  // several rows are mid-edit has no obvious save semantics.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Run-history drill-down: which row is expanded, and that team's runs. Fetched ON EXPAND (never
  // on mount) so the dashboard's first paint still costs one teams request (engines load in EnginesShelf), and held for one
  // team at a time so an open panel can never show another team's history.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [teamRuns, setTeamRuns] = useState<TeamRunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  // A panel-local failure flag, distinct from the page-level `error` banner. Without it a failed
  // fetch and a never-run team are indistinguishable — both leave `teamRuns` empty — so a 500 would
  // tell a user with a dozen runs, in the panel's own voice, that their team has never run.
  const [runsError, setRunsError] = useState(false);
  // The team id of the MOST RECENT history request. Expanding B while A's fetch is still in flight
  // must not land A's runs under B — and `expandedId` read inside that fetch's closure is stale, so
  // liveness is tracked in a ref the resolve path can compare against.
  const runsRequestRef = useRef<string | null>(null);

  // A11y (Filler-A): trap focus in the delete-confirm dialog while a team is queued for deletion;
  // Escape / scrim close it, then focus returns to the row's delete button.
  const confirmDialogRef = useModalDialog<HTMLDivElement>(confirmTeam !== null, () =>
    setConfirmTeam(null),
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const t = await getTeams();
      if (!mountedRef.current) return;
      setTeams(t);
      setError(false);
    } catch {
      if (mountedRef.current) setError(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDeleteTeam = useCallback(
    async (teamId: string) => {
      setBusy(true);
      try {
        await deleteTeam(teamId);
        if (mountedRef.current) setConfirmTeam(null);
        await load();
      } catch {
        if (mountedRef.current) {
          setError(true);
          setConfirmTeam(null);
        }
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [load],
  );

  // Move focus into the rename field when the editor opens, so the row is immediately typeable
  // (and Escape/Enter land on it) without an autofocus attribute.
  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  const startRename = useCallback((t: TeamSummary) => {
    setRenamingId(t.team_graph_id);
    setRenameValue(t.name); // pre-filled: correcting a name should be an edit, not a re-type
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
  }, []);

  const handleRename = useCallback(
    async (teamId: string) => {
      const name = renameValue.trim();
      // Refused here as well as server-side (422): a blank name is a slip, and round-tripping it
      // just to be told no would clear the editor the user still needs.
      if (!name) return;
      setBusy(true);
      try {
        await renameTeam(teamId, name);
        if (mountedRef.current) cancelRename();
        await load();
      } catch {
        if (mountedRef.current) setError(true);
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [renameValue, cancelRename, load],
  );

  const toggleRuns = useCallback(
    async (teamId: string) => {
      if (expandedId === teamId) {
        runsRequestRef.current = null; // an in-flight fetch for this row is now stale
        setExpandedId(null);
        setTeamRuns([]);
        return;
      }
      runsRequestRef.current = teamId;
      setExpandedId(teamId);
      setTeamRuns([]);
      setRunsError(false); // a previous row's failure must not colour this one
      setRunsLoading(true);
      try {
        const rows = await getTeamRuns(teamId);
        // Drop the response if the user collapsed this row or expanded a different one while it
        // was in flight — otherwise one team's history renders under another team's name.
        if (!mountedRef.current || runsRequestRef.current !== teamId) return;
        setTeamRuns(rows);
      } catch {
        if (mountedRef.current && runsRequestRef.current === teamId) setRunsError(true);
      } finally {
        // Only the CURRENT request may clear the spinner; a stale one resolving late would
        // otherwise declare the new row loaded while it is still fetching.
        if (mountedRef.current && runsRequestRef.current === teamId) setRunsLoading(false);
      }
    },
    [expandedId],
  );

  const activeRuns = teams.filter(isActive).length;
  const totalSpend = teams.reduce((sum, t) => sum + (t.spend_usd ?? 0), 0);
  const handle = handleFromEmail(user.email);
  const initial = handle.charAt(0);

  return (
    <AppShell
      view={view}
      onNavigate={setView}
      brand={
        <>
          <img src="/mark-coral.png" alt="" width={25} height={25} />
          <span className="tv-dash__wordmark">Tvashtr</span>
        </>
      }
      barRight={
        <>
          <BackendDot />
          <div className="tv-avatar-wrap">
            <button
              type="button"
              className="tv-avatar"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Account"
              title="Account"
            >
              {initial}
            </button>
            {menuOpen && (
              <>
                <div
                  className="tv-avatarmenu__catch"
                  onClick={() => setMenuOpen(false)}
                  aria-hidden="true"
                />
                <div className="tv-avatarmenu">
                  <div className="tv-avatarmenu__id">
                    <span className="tv-avatarmenu__avatar">{initial}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="tv-avatarmenu__name">{handle}</div>
                      <div className="tv-avatarmenu__email">{user.email}</div>
                    </div>
                  </div>
                  <div className="tv-avatarmenu__divider" />
                  <button type="button" className="tv-avatarmenu__logout" onClick={onLogout}>
                    <LogOut size={15} strokeWidth={1.8} />
                    Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      }
    >
      {error && (
        <div className="tv-dash__error" role="alert">
          Couldn&apos;t reach the backend — some sections may be stale.
        </div>
      )}

      <main className="tv-dash__main">
        {view === "home" && (
          <>
            <div className="tv-dash__greet">
              <div>
                <h1 className="tv-dash__hello">Good to see you, {handle}.</h1>
                <p className="tv-dash__lede">
                  {activeRuns > 0
                    ? `${activeRuns} ${activeRuns === 1 ? "run is" : "runs are"} weaving. Pick a team up where you left off.`
                    : "Pick a team up where you left off, or start a new one."}
                </p>
              </div>
              <button type="button" className="tv-btn" onClick={() => setPicking(true)}>
                <Plus size={15} strokeWidth={2} />
                New team
              </button>
            </div>

            <div className="tv-dash__stats">
              <div className="tv-dash__stat">
                <span className="tv-dash__stat-ic">
                  <GitBranch size={20} strokeWidth={1.7} />
                </span>
                <div>
                  <div className="tv-dash__stat-num">{teams.length}</div>
                  <div className="tv-dash__stat-label">Teams in your library</div>
                </div>
              </div>
              <div className="tv-dash__stat">
                <span className="tv-dash__stat-ic tv-dash__stat-ic--runs">
                  <Play size={20} strokeWidth={1.7} />
                </span>
                <div>
                  <div className="tv-dash__stat-num">{activeRuns}</div>
                  <div className="tv-dash__stat-label">Active runs</div>
                </div>
              </div>
              <div className="tv-dash__stat">
                <span className="tv-dash__stat-ic tv-dash__stat-ic--spend">
                  <DollarSign size={20} strokeWidth={1.7} />
                </span>
                <div>
                  <div className="tv-dash__stat-num">${totalSpend.toFixed(2)}</div>
                  <div className="tv-dash__stat-label">Total spend</div>
                </div>
              </div>
            </div>

            <div className="tv-dash__stack">
              <section className="tv-dash__panel" aria-label="Your teams">
                <div className="tv-dash__panel-head">
                  <h2 className="tv-dash__panel-title">Your teams</h2>
                </div>
                {loading ? (
                  <p className="tv-dash__empty">Loading…</p>
                ) : teams.length === 0 ? (
                  <p className="tv-dash__empty">Create your first team to get started.</p>
                ) : (
                  <>
                    <div className="tv-dash__thead" aria-hidden="true">
                      <span className="tv-dash__th" />
                      <span className="tv-dash__th">Team</span>
                      <span className="tv-dash__th tv-dash__th--num">Nodes</span>
                      <span className="tv-dash__th">Status</span>
                      <span className="tv-dash__th">Spend</span>
                      <span className="tv-dash__th">Created</span>
                      <span className="tv-dash__th" />
                    </div>
                    <ul className="tv-dash__rows">
                      {teams.map((t) => {
                        const lastRun = t.last_run;
                        const failed = lastRun?.status === "failed";
                        const pill = runStatusPill(lastRun?.status ?? null);
                        const renaming = renamingId === t.team_graph_id;
                        const expanded = expandedId === t.team_graph_id;
                        return (
                          <li className="tv-dash__titem" key={t.team_graph_id}>
                            <div className="tv-dash__trow">
                              {!renaming && (
                                <button
                                  type="button"
                                  className="tv-dash__trow-open"
                                  onClick={() => onOpenTeam(t.team_graph_id)}
                                  aria-label={`Open ${t.name}`}
                                />
                              )}
                              <button
                                type="button"
                                className="tv-dash__trow-exp"
                                onClick={() => void toggleRuns(t.team_graph_id)}
                                aria-expanded={expanded}
                                aria-label={`${expanded ? "Hide" : "Show"} runs for ${t.name}`}
                              >
                                {expanded ? (
                                  <ChevronDown size={15} strokeWidth={1.9} />
                                ) : (
                                  <ChevronRight size={15} strokeWidth={1.9} />
                                )}
                              </button>
                              <div className="tv-dash__tcell tv-dash__team">
                                <span className="tv-dash__team-ic">
                                  <Workflow size={16} strokeWidth={1.6} />
                                </span>
                                {renaming ? (
                                  <span className="tv-dash__rename">
                                    <input
                                      ref={renameInputRef}
                                      className="tv-launch__input tv-dash__rename-input"
                                      aria-label="New team name"
                                      value={renameValue}
                                      onChange={(e) => setRenameValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") void handleRename(t.team_graph_id);
                                        if (e.key === "Escape") cancelRename();
                                      }}
                                    />
                                    <button
                                      type="button"
                                      className="tv-dash__rename-act"
                                      onClick={() => void handleRename(t.team_graph_id)}
                                      disabled={busy}
                                      aria-label="Save name"
                                    >
                                      <Check size={15} strokeWidth={2} />
                                    </button>
                                    <button
                                      type="button"
                                      className="tv-dash__rename-act"
                                      onClick={cancelRename}
                                      aria-label="Cancel rename"
                                    >
                                      <X size={15} strokeWidth={1.9} />
                                    </button>
                                  </span>
                                ) : (
                                  <span className="tv-dash__team-copy">
                                    <span className="tv-dash__team-name">{t.name}</span>
                                    <span className="tv-dash__team-meta">{teamMetaLabel(t)}</span>
                                  </span>
                                )}
                              </div>
                              <div className="tv-dash__tcell tv-dash__tcell--num">{t.node_count}</div>
                              <div className="tv-dash__tcell">
                                {failed ? (
                                  <button
                                    type="button"
                                    className={`tv-pill tv-pill--${pill.tone} tv-dash__status-btn`}
                                    onClick={() =>
                                      lastRun && onOpenRun?.(lastRun.run_id, t.team_graph_id)
                                    }
                                    aria-label={`Failed — view last run of ${t.name}`}
                                  >
                                    <span className="tv-pill__dot" />
                                    {pill.label}
                                  </button>
                                ) : (
                                  <span className={`tv-pill tv-pill--${pill.tone}`}>
                                    <span className="tv-pill__dot" />
                                    {pill.label}
                                  </span>
                                )}
                              </div>
                              <div className="tv-dash__tcell tv-dash__tcell--spend">
                                ${(t.spend_usd ?? 0).toFixed(2)}
                              </div>
                              <div className="tv-dash__tcell tv-dash__tcell--created">
                                {formatCreated(t.created_at)}
                              </div>
                              <div className="tv-dash__trow-acts">
                                {!renaming && (
                                  <button
                                    type="button"
                                    className="tv-dash__trow-act"
                                    onClick={() => startRename(t)}
                                    disabled={busy}
                                    aria-label={`Rename ${t.name}`}
                                  >
                                    <Pencil size={14} strokeWidth={1.8} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="tv-dash__trow-del tv-dash__trow-del--quiet"
                                  onClick={() => setConfirmTeam(t)}
                                  disabled={busy}
                                  aria-label={`Delete ${t.name}`}
                                >
                                  <Trash2 size={15} strokeWidth={1.8} />
                                </button>
                              </div>
                            </div>
                            {failed && (
                              <div
                                className="tv-dash__recover"
                                role="group"
                                aria-label={`Recover ${t.name}`}
                              >
                                <p className="tv-dash__recover-msg">{lastRunErrorText(t)}</p>
                                <div className="tv-dash__recover-acts">
                                  <button
                                    type="button"
                                    className="tv-btn tv-btn--sm"
                                    onClick={() =>
                                      lastRun && onOpenRun?.(lastRun.run_id, t.team_graph_id)
                                    }
                                    aria-label={`View last run of ${t.name}`}
                                  >
                                    View last run
                                  </button>
                                  <button
                                    type="button"
                                    className="tv-btn tv-btn--sm tv-btn--ghost"
                                    onClick={() => onOpenTeam(t.team_graph_id)}
                                    aria-label={`Retry ${t.name}`}
                                  >
                                    Retry
                                  </button>
                                </div>
                              </div>
                            )}
                            {expanded && (
                              <div className="tv-dash__runs">
                                {runsLoading ? (
                                  <p className="tv-dash__runs-empty">Loading runs…</p>
                                ) : runsError ? (
                                  <p className="tv-dash__runs-empty" role="alert">
                                    Couldn&apos;t load this team&apos;s runs — is the backend running?
                                  </p>
                                ) : teamRuns.length === 0 ? (
                                  <p className="tv-dash__runs-empty">This team hasn&apos;t run yet.</p>
                                ) : (
                                  <ul className="tv-dash__runs-list">
                                    {teamRuns.map((r) => {
                                      const rp = runStatusPill(r.status);
                                      return (
                                        <li key={r.run_id}>
                                          <button
                                            type="button"
                                            className="tv-dash__runrow"
                                            onClick={() => onOpenRun?.(r.run_id, t.team_graph_id)}
                                            aria-label={`Open run: ${r.idea}`}
                                          >
                                            <span className="tv-dash__runrow-idea">{r.idea}</span>
                                            <span className={`tv-pill tv-pill--${rp.tone}`}>
                                              <span className="tv-pill__dot" />
                                              {rp.label}
                                            </span>
                                            <span className="tv-dash__runrow-spend">
                                              ${(r.cost_total_usd ?? 0).toFixed(2)}
                                            </span>
                                            <span className="tv-dash__runrow-at">
                                              {formatCreated(r.created_at)}
                                            </span>
                                          </button>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </section>
            </div>
          </>
        )}

        {view === "domains" && (
          <div className="tv-dash__stack">
            <DomainsPage />
          </div>
        )}

        {view === "engines" && (
          <div className="tv-dash__stack">
            <EnginesShelf />
          </div>
        )}

        {view === "tools" && (
          <div className="tv-dash__stack tv-dash__tools-page">
            <header className="tv-dash__page-head">
              <h1 className="tv-dash__page-title">Tools</h1>
              <p className="tv-dash__page-lede">
                MCP secrets, reusable tool and skill libraries, and account memory — used by any
                team&apos;s nodes.
              </p>
            </header>
            <SecretsShelf />
            <ToolsShelf />
            <SkillsShelf />
            <MemoryShelf />
          </div>
        )}
      </main>

      {picking && (
        <NewTeamDialog
          onOpenTeam={(id) => {
            setPicking(false);
            onOpenTeam(id);
          }}
          onClose={() => setPicking(false)}
        />
      )}

      {confirmTeam && (
        <>
          <div className="tv-scrim" onClick={() => setConfirmTeam(null)} aria-hidden="true" />
          <div
            className="tv-dash__dialog tv-card"
            role="dialog"
            aria-modal="true"
            aria-label={`Delete ${confirmTeam.name}`}
            ref={confirmDialogRef}
          >
            <header className="tv-dash__dialog-head">
              <h2 className="tv-dash__dialog-title">Delete {confirmTeam.name}?</h2>
              <button
                type="button"
                className="tv-panel__close"
                onClick={() => setConfirmTeam(null)}
                aria-label="Close"
              >
                <X size={16} strokeWidth={1.7} />
              </button>
            </header>
            <div className="tv-dash__dialog-body">
              <p className="tv-dash__dialog-text">
                This permanently deletes the team and its run history, and can&apos;t be undone.
              </p>
              {isActive(confirmTeam) && (
                <p className="tv-dash__dialog-warn">
                  A run is in progress — deleting will stop it.
                </p>
              )}
            </div>
            <footer className="tv-dash__dialog-foot">
              <button
                type="button"
                className="tv-btn tv-btn--danger"
                onClick={() => void handleDeleteTeam(confirmTeam.team_graph_id)}
                disabled={busy}
              >
                Delete
              </button>
              <button
                type="button"
                className="tv-btn tv-btn--ghost"
                onClick={() => setConfirmTeam(null)}
              >
                Cancel
              </button>
            </footer>
          </div>
        </>
      )}
    </AppShell>
  );
}
