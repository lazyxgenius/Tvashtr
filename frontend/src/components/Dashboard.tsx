import { useCallback, useEffect, useRef, useState } from "react";
import {
  DollarSign,
  GitBranch,
  KeyRound,
  LogOut,
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
  getTeams,
  listProviders,
  type ProviderCredential,
  removeProvider,
  type TeamSummary,
} from "../lib/api";
import { RUN_TERMINAL, runStatusPill } from "../lib/status";
import { useModalDialog } from "../lib/useModalDialog";
import { BackendDot } from "./BackendDot";
import { NewTeamDialog } from "./NewTeamDialog";
import { SecretsShelf } from "./SecretsShelf";
import { SkillsShelf } from "./SkillsShelf";
import { ToolsShelf } from "./ToolsShelf";

// The providers offered as datalist suggestions under the free-text field (any provider/model
// leading-slug is accepted; these are the proven in-repo ones).
const PROVIDER_SUGGESTIONS = ["openrouter", "openai", "gemini", "groq", "nvidia_nim"];

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
}: {
  user: AuthUser;
  onLogout: () => void;
  onOpenTeam: (teamId: string) => void;
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
                    return (
                      <li className="tv-dash__trow" key={t.team_graph_id}>
                        <button
                          type="button"
                          className="tv-dash__trow-open"
                          onClick={() => onOpenTeam(t.team_graph_id)}
                          aria-label={`Open ${t.name}`}
                        />
                        <div className="tv-dash__tcell tv-dash__team">
                          <span className="tv-dash__team-ic">
                            <Workflow size={16} strokeWidth={1.6} />
                          </span>
                          <span className="tv-dash__team-name">{t.name}</span>
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
                        <button
                          type="button"
                          className="tv-dash__trow-del"
                          onClick={() => setConfirmTeam(t)}
                          disabled={busy}
                          aria-label={`Delete ${t.name}`}
                        >
                          <Trash2 size={15} strokeWidth={1.8} />
                        </button>
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
                  {PROVIDER_SUGGESTIONS.map((p) => (
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
