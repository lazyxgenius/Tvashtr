import { useCallback, useEffect, useRef, useState } from "react";

import {
  addProvider,
  type AuthUser,
  createTeam,
  getTeams,
  listProviders,
  listRuns,
  type ProviderCredential,
  removeProvider,
  type RunSummary,
  type TeamSummary,
} from "../lib/api";
import { BackendDot } from "./BackendDot";

// The providers offered as datalist suggestions under the free-text field (any provider/model
// leading-slug is accepted; these are the proven in-repo ones).
const PROVIDER_SUGGESTIONS = ["openrouter", "openai", "gemini", "groq", "nvidia_nim"];

/**
 * The post-login dashboard (M-accounts Slice B) — the authed default, NOT the canvas. Shows the
 * account's teams (open one → the canvas), previous runs, and providers (`provider · •••• last4`)
 * with add/remove. A fresh account lands with a seeded starter team but NO providers/runs, so the
 * providers + runs sections show their empty-state prompts. Opening (or creating) a team routes to
 * the canvas via `onOpenTeam`.
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
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [providers, setProviders] = useState<ProviderCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  // Add-provider form.
  const [providerInput, setProviderInput] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const [t, r, p] = await Promise.all([getTeams(), listRuns(), listProviders()]);
      if (!mountedRef.current) return;
      setTeams(t);
      setRuns(r);
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

  const handleCreateTeam = useCallback(async () => {
    setBusy(true);
    try {
      const created = await createTeam("review_loop", "New team");
      onOpenTeam(created.team_graph_id);
    } catch {
      if (mountedRef.current) {
        setError(true);
        setBusy(false);
      }
    }
  }, [onOpenTeam]);

  return (
    <div className="tv-dash">
      <header className="tv-dash__bar">
        <div className="tv-dash__brand">
          <img src="/mark-coral.png" alt="" style={{ width: 24, height: 24 }} />
          <span className="tv-dash__wordmark">Tvashtr</span>
          <span className="tv-dash__eyebrow">your dashboard</span>
        </div>
        <div className="tv-dash__bar-right">
          <span className="tv-dash__email">{user.email}</span>
          <button type="button" className="tv-btn tv-btn--ghost tv-btn--sm" onClick={onLogout}>
            Log out
          </button>
          <BackendDot />
        </div>
      </header>

      {error && (
        <div className="tv-dash__error" role="alert">
          Couldn't reach the backend — some sections may be stale.
        </div>
      )}

      <main className="tv-dash__grid">
        {/* Teams */}
        <section className="tv-dash__card tv-card" aria-label="Your teams">
          <div className="tv-dash__card-head">
            <h2 className="tv-dash__card-title">Your teams</h2>
            <button
              type="button"
              className="tv-btn tv-btn--sm"
              onClick={() => void handleCreateTeam()}
              disabled={busy}
            >
              + New team
            </button>
          </div>
          {loading ? (
            <p className="tv-dash__muted">Loading…</p>
          ) : teams.length === 0 ? (
            <p className="tv-dash__empty">Create your first team to get started.</p>
          ) : (
            <ul className="tv-dash__list">
              {teams.map((t) => (
                <li key={t.team_graph_id}>
                  <button
                    type="button"
                    className="tv-dash__row tv-dash__row--btn"
                    onClick={() => onOpenTeam(t.team_graph_id)}
                  >
                    <span className="tv-dash__row-title">{t.name}</span>
                    <span className="tv-dash__row-meta">{t.node_count} nodes →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Providers */}
        <section className="tv-dash__card tv-card" aria-label="Your providers">
          <div className="tv-dash__card-head">
            <h2 className="tv-dash__card-title">Provider API keys</h2>
          </div>
          {!loading && providers.length === 0 && (
            <p className="tv-dash__empty">Add your provider API keys so your teams can run.</p>
          )}
          {providers.length > 0 && (
            <ul className="tv-dash__list">
              {providers.map((p) => (
                <li key={p.provider} className="tv-dash__row">
                  <span className="tv-dash__row-title">{p.provider}</span>
                  <span className="tv-dash__row-meta">•••• {p.key_last4}</span>
                  <button
                    type="button"
                    className="tv-btn tv-btn--link tv-dash__remove"
                    onClick={() => void handleRemoveProvider(p.provider)}
                    disabled={busy}
                    aria-label={`Remove ${p.provider}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="tv-dash__add">
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
          {addError && (
            <div className="tv-dash__error" role="alert">
              {addError}
            </div>
          )}
        </section>

        {/* Runs */}
        <section className="tv-dash__card tv-card tv-dash__card--wide" aria-label="Your runs">
          <div className="tv-dash__card-head">
            <h2 className="tv-dash__card-title">Previous runs</h2>
          </div>
          {loading ? (
            <p className="tv-dash__muted">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="tv-dash__empty">No runs yet — open a team and run it.</p>
          ) : (
            <ul className="tv-dash__list">
              {runs.map((r) => (
                <li key={r.run_id} className="tv-dash__row">
                  <span className="tv-dash__row-title">{r.idea || "(untitled run)"}</span>
                  <span className="tv-dash__row-meta">{r.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
