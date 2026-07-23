import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  DollarSign,
  GitBranch,
  KeyRound,
  LogOut,
  Pencil,
  Play,
  Plus,
  Trash2,
  Workflow,
  X,
} from "lucide-react";

import {
  addProvider,
  type AuthUser,
  deleteTeam,
  getTeamRuns,
  getTeams,
  listProviders,
  type ProviderCredential,
  providerSuggestions,
  removeProvider,
  renameTeam,
  type TeamRunRow,
  type TeamSummary,
} from "../lib/api";
import { RUN_TERMINAL, runStatusPill } from "../lib/status";
import { useModalDialog } from "../lib/useModalDialog";
import { BackendDot } from "./BackendDot";
import { MemoryShelf } from "./MemoryShelf";
import { NewTeamDialog } from "./NewTeamDialog";
import { SecretsShelf } from "./SecretsShelf";
import { SkillsShelf } from "./SkillsShelf";
import { ToolsShelf } from "./ToolsShelf";

// M-runnable: the datalist suggestions under the free-text provider field are DERIVED from the
// backend-served provider catalogue (`providerSuggestions()`), never a hardcoded list — so there is
// one source of truth and nothing to keep in sync. Any provider/model leading-slug is still accepted.

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

/**
 * The post-login dashboard (F2c reskin) — the authed default, NOT the canvas. ONE unified teams
 * table where each team carries its latest run's status + its lifetime spend ("a run is a team that
 * ran"): open a team → the canvas; delete a team → stop its run + remove it (F2-delete). A real stat
 * strip (Teams / Active runs / Total spend), the New-team template picker, and the BYOK providers
 * shelf. Opening (or creating) a team routes to the canvas via `onOpenTeam`.
 */
export function Dashboard({
  user,
  onLogout,
  onOpenTeam,
  onOpenRun,
}: {
  user: AuthUser;
  onLogout: () => void;
  onOpenTeam: (teamId: string) => void;
  // Open one run from a team's history drill-down. Carries the owning team as well as the run:
  // the run view lives on that team's canvas, so the caller needs both to route there. Optional so
  // the dashboard still renders standalone (and in tests) without a run surface wired behind it.
  onOpenRun?: (runId: string, teamId: string) => void;
}) {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [providers, setProviders] = useState<ProviderCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  // Add-provider form.
  const [providerInput, setProviderInput] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

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
  // on mount) so the dashboard's first paint still costs exactly two requests, and held for one
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
      const [t, p] = await Promise.all([getTeams(), listProviders()]);
      if (!mountedRef.current) return;
      setTeams(t);
      setProviders(p);
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

  const handleAddProvider = useCallback(async () => {
    const provider = providerInput.trim();
    const key = keyInput.trim();
    if (!provider || !key) {
      setAddError("Enter a provider and an API key.");
      return;
    }
    setBusy(true);
    setAddError(null);
    try {
      await addProvider(provider, key);
      setProviderInput("");
      setKeyInput("");
      const p = await listProviders();
      if (mountedRef.current) setProviders(p);
    } catch {
      if (mountedRef.current) setAddError("Couldn't save that key — is the backend running?");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [providerInput, keyInput]);

  const handleRemoveProvider = useCallback(async (provider: string) => {
    setBusy(true);
    try {
      await removeProvider(provider);
      const p = await listProviders();
      if (mountedRef.current) setProviders(p);
    } catch {
      if (mountedRef.current) setError(true);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

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
    <div className="tv-dash">
      <header className="tv-dash__bar">
        <div className="tv-dash__brand">
          <img src="/mark-coral.png" alt="" width={25} height={25} />
          <span className="tv-dash__wordmark">Tvashtr</span>
        </div>
        <div className="tv-dash__bar-right">
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
        </div>
      </header>

      {error && (
        <div className="tv-dash__error" role="alert">
          Couldn't reach the backend — some sections may be stale.
        </div>
      )}

      <main className="tv-dash__main">
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
                    const pill = runStatusPill(t.last_run?.status ?? null);
                    const renaming = renamingId === t.team_graph_id;
                    const expanded = expandedId === t.team_graph_id;
                    return (
                      <li className="tv-dash__titem" key={t.team_graph_id}>
                        <div className="tv-dash__trow">
                          {/* The full-row open surface is withheld while the row is being renamed:
                              a click meant for the text field must not navigate away mid-edit. */}
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
                              <span className="tv-dash__team-name">{t.name}</span>
                            )}
                          </div>
                          <div className="tv-dash__tcell tv-dash__tcell--num">{t.node_count}</div>
                          <div className="tv-dash__tcell">
                            <span className={`tv-pill tv-pill--${pill.tone}`}>
                              <span className="tv-pill__dot" />
                              {pill.label}
                            </span>
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
                              className="tv-dash__trow-del"
                              onClick={() => setConfirmTeam(t)}
                              disabled={busy}
                              aria-label={`Delete ${t.name}`}
                            >
                              <Trash2 size={15} strokeWidth={1.8} />
                            </button>
                          </div>
                        </div>
                        {expanded && (
                          <div className="tv-dash__runs">
                            {runsLoading ? (
                              <p className="tv-dash__runs-empty">Loading runs…</p>
                            ) : runsError ? (
                              <p className="tv-dash__runs-empty" role="alert">
                                Couldn't load this team's runs — is the backend running?
                              </p>
                            ) : teamRuns.length === 0 ? (
                              <p className="tv-dash__runs-empty">This team hasn't run yet.</p>
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

          <section className="tv-dash__panel tv-dash__prov" aria-label="Your providers">
            <div className="tv-dash__prov-head">
              <div className="tv-dash__prov-lede">
                <div className="tv-dash__prov-title">
                  <KeyRound size={16} strokeWidth={1.7} />
                  <h2>Provider keys</h2>
                </div>
                <p className="tv-dash__prov-sub">
                  Bring your own keys — stored per account, encrypted. We only ever show the last 4
                  digits.
                </p>
              </div>
              <div className="tv-dash__prov-add">
                <input
                  className="tv-launch__input"
                  list="tv-provider-list"
                  placeholder="provider (e.g. openrouter)"
                  aria-label="Provider"
                  value={providerInput}
                  onChange={(e) => setProviderInput(e.target.value)}
                />
                <datalist id="tv-provider-list">
                  {providerSuggestions().map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                <input
                  className="tv-launch__input"
                  type="password"
                  placeholder="paste API key"
                  aria-label="API key"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleAddProvider();
                  }}
                />
                <button
                  type="button"
                  className="tv-btn tv-btn--sm"
                  onClick={() => void handleAddProvider()}
                  disabled={busy}
                >
                  Add key
                </button>
              </div>
            </div>
            {!loading && providers.length === 0 ? (
              <p className="tv-dash__prov-empty">
                Add your provider API keys so your teams can run.
              </p>
            ) : (
              <ul className="tv-dash__prov-list">
                {providers.map((p) => (
                  <li className="tv-dash__prov-chip" key={p.provider}>
                    <span className="tv-dash__prov-dot" />
                    <span className="tv-dash__prov-name">{p.provider}</span>
                    <span className="tv-dash__prov-last4">•••• {p.key_last4}</span>
                    <button
                      type="button"
                      className="tv-dash__prov-remove"
                      onClick={() => void handleRemoveProvider(p.provider)}
                      disabled={busy}
                      aria-label={`Remove ${p.provider}`}
                    >
                      <X size={15} strokeWidth={1.8} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {addError && (
              <div className="tv-dash__error" role="alert">
                {addError}
              </div>
            )}
          </section>
          <SecretsShelf />
          <ToolsShelf />
          <SkillsShelf />
          <MemoryShelf />
        </div>
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
                This permanently deletes the team and its run history, and can't be undone.
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
    </div>
  );
}
