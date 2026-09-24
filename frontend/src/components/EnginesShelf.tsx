import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import {
  addProvider,
  listProviders,
  listSubscriptionStatuses,
  type ProviderCredential,
  providerSuggestions,
  removeProvider,
} from "../lib/api";
import {
  displayNameForSubscription,
  enginesApiKeysEmpty,
  enginesApiKeysLede,
  enginesNeedsInstallHint,
  enginesShelfSubtitle,
  enginesSubscriptionsCallout,
  SUBSCRIPTION_DISCLOSURE,
  SUBSCRIPTION_PROVIDERS,
  type SubscriptionCardState,
  type SubscriptionProviderId,
  type SubscriptionStatus,
} from "../lib/engines";

/** Hardcoded install docs — do not pull extra keys over IPC. */
const INSTALL_URLS: Record<SubscriptionProviderId, string> = {
  claude: "https://docs.anthropic.com/en/docs/claude-code/overview",
  grok: "https://docs.x.ai/build/cli/reference",
  codex: "https://developers.openai.com/codex",
};

function desktopEngines(): TvashtrDesktopBridge["engines"] | null {
  const d = window.tvashtrDesktop;
  if (d && typeof d === "object" && d.engines) return d.engines;
  return null;
}

function disconnectedStatus(provider: SubscriptionProviderId): SubscriptionStatus {
  return {
    provider,
    connected: false,
    state: "disconnected",
    account_hint: null,
    source: null,
    checked_at: null,
  };
}

function mergeStatuses(rows: SubscriptionStatus[]): SubscriptionStatus[] {
  const byId = new Map<SubscriptionProviderId, SubscriptionStatus>();
  for (const id of SUBSCRIPTION_PROVIDERS) {
    byId.set(id, disconnectedStatus(id));
  }
  for (const row of rows) {
    if (byId.has(row.provider)) byId.set(row.provider, row);
  }
  return SUBSCRIPTION_PROVIDERS.map((id) => byId.get(id)!);
}

function pillLabel(state: SubscriptionCardState): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "checking":
      return "Checking…";
    case "needs_install":
      return "Needs install";
    case "needs_login":
      return "Needs login";
    case "api_key":
      return "On an API key";
    case "error":
      return "Error";
    case "disconnected":
    default:
      return "Disconnected";
  }
}

// M-subs-desktop (A3): the Electron MAIN process pushes every status change to the server mirror
// (at launch and on connect / refresh / disconnect), so this card never writes the mirror itself.

/**
 * Engines shelf — subscription cards (Desktop Connect) + restyled BYOK API keys.
 * Same shelf on web and desktop; subscription actions are disabled on web.
 */
export function EnginesShelf() {
  const [providers, setProviders] = useState<ProviderCredential[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionStatus[]>(() =>
    SUBSCRIPTION_PROVIDERS.map(disconnectedStatus),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<SubscriptionProviderId | null>(null);
  const [providerInput, setProviderInput] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  // Providers whose Connect just opened the vendor's own login in Terminal (M-subs-desktop §3.0).
  const [loginOpened, setLoginOpened] = useState<Partial<Record<SubscriptionProviderId, boolean>>>(
    {},
  );
  const mounted = useRef(true);

  const isDesktop = desktopEngines() !== null;

  const reloadProviders = useCallback(async () => {
    const p = await listProviders();
    if (mounted.current) setProviders(p);
  }, []);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const [p, mirror] = await Promise.all([listProviders(), listSubscriptionStatuses()]);
        if (!mounted.current) return;
        setProviders(p);
        let rows = mergeStatuses(mirror);
        const engines = desktopEngines();
        if (engines?.getStatus) {
          try {
            const live = await engines.getStatus();
            if (mounted.current && Array.isArray(live) && live.length > 0) {
              rows = mergeStatuses(live);
            }
          } catch {
            /* keep mirror */
          }
        }
        if (mounted.current) setSubscriptions(rows);
      } catch {
        /* shelf still renders with defaults */
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  const setStatusFor = useCallback((status: SubscriptionStatus) => {
    setSubscriptions((prev) => prev.map((s) => (s.provider === status.provider ? status : s)));
    if (status.connected) setLoginOpened((prev) => ({ ...prev, [status.provider]: false }));
  }, []);

  // The main process re-asks the CLI when the window regains focus after a Terminal login.
  useEffect(() => {
    const engines = desktopEngines();
    if (!engines?.onStatus) return;
    return engines.onStatus((status) => {
      if (mounted.current && status && SUBSCRIPTION_PROVIDERS.includes(status.provider)) {
        setStatusFor(status);
      }
    });
  }, [setStatusFor]);

  const handleConnect = useCallback(
    async (provider: SubscriptionProviderId) => {
      const engines = desktopEngines();
      if (!engines) return;
      setActionBusy(provider);
      try {
        const status = await engines.connect(provider);
        if (!mounted.current) return;
        setStatusFor(status);
        if (!status.connected && status.state !== "needs_install") {
          setLoginOpened((prev) => ({ ...prev, [provider]: true }));
        }
      } catch {
        /* leave prior status */
      } finally {
        if (mounted.current) setActionBusy(null);
      }
    },
    [setStatusFor],
  );

  const handleDisconnect = useCallback(
    async (provider: SubscriptionProviderId) => {
      const engines = desktopEngines();
      if (!engines) return;
      setActionBusy(provider);
      try {
        const status = await engines.disconnect(provider);
        if (!mounted.current) return;
        setStatusFor(status);
      } catch {
        /* leave prior status */
      } finally {
        if (mounted.current) setActionBusy(null);
      }
    },
    [setStatusFor],
  );

  const handleRefresh = useCallback(
    async (provider: SubscriptionProviderId) => {
      const engines = desktopEngines();
      if (!engines) return;
      setActionBusy(provider);
      try {
        const status = await engines.refresh(provider);
        if (!mounted.current) return;
        setStatusFor(status);
      } catch {
        /* leave prior status */
      } finally {
        if (mounted.current) setActionBusy(null);
      }
    },
    [setStatusFor],
  );

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
      await reloadProviders();
    } catch {
      if (mounted.current) setAddError("Couldn't save that key — is the backend running?");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [providerInput, keyInput, reloadProviders]);

  const handleRemoveProvider = useCallback(
    async (provider: string) => {
      setBusy(true);
      try {
        await removeProvider(provider);
        await reloadProviders();
      } catch {
        if (mounted.current) setAddError("Couldn't remove that key.");
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [reloadProviders],
  );

  return (
    <section className="tv-dash__panel tv-engines" aria-label="Engines">
      <div className="tv-engines__title-row">
        <h2>Engines</h2>
      </div>
      <p className="tv-engines__sub">{enginesShelfSubtitle()}</p>

      <section className="tv-engines__section" aria-labelledby="tv-engines-subs">
        <h3 id="tv-engines-subs" className="tv-engines__section-title">
          Subscriptions
        </h3>
        <div className="tv-engines__callout" role="note">
          {enginesSubscriptionsCallout(isDesktop)}
        </div>
        <p className="tv-engines__disclosure" role="note" aria-label="How subscriptions work">
          {SUBSCRIPTION_DISCLOSURE}
        </p>
        <div className="tv-engines__cards">
          {subscriptions.map((s) => {
            const name = displayNameForSubscription(s.provider);
            const cardBusy = actionBusy === s.provider;
            const connected = s.state === "connected" || s.connected;
            return (
              <div
                key={s.provider}
                className={`tv-engines__card${connected ? " tv-engines__card--connected" : ""}`}
              >
                <div className="tv-engines__card-head">
                  <span className="tv-engines__card-name">{name}</span>
                  <span className="tv-engines__pill">{pillLabel(s.state)}</span>
                </div>
                {s.account_hint && <p className="tv-engines__hint">{s.account_hint}</p>}
                {s.state === "api_key" && (
                  <p className="tv-engines__hint">
                    {name === "Claude" ? "Claude Code" : name} is signed in with an API key, not
                    your {name} subscription — Connect to sign in with your subscription.
                  </p>
                )}
                {loginOpened[s.provider] && !connected && isDesktop && (
                  <p className="tv-engines__hint" role="status">
                    Finish signing in to {name} in the Terminal window that just opened, then come
                    back — Tvashtr checks again automatically.
                  </p>
                )}
                {s.state === "needs_install" && isDesktop && (
                  <p className="tv-engines__hint">
                    {enginesNeedsInstallHint(name)}{" "}
                    <a href={INSTALL_URLS[s.provider]} target="_blank" rel="noreferrer">
                      Install {name} CLI
                    </a>
                  </p>
                )}
                <div className="tv-engines__actions">
                  {s.state === "needs_install" && isDesktop ? (
                    <button
                      type="button"
                      className="tv-btn tv-btn--sm"
                      disabled={cardBusy}
                      onClick={() => void handleRefresh(s.provider)}
                      aria-label={`I've installed it — Refresh ${name}`}
                    >
                      I&rsquo;ve installed it — Refresh
                    </button>
                  ) : connected && isDesktop ? (
                    <>
                      <button
                        type="button"
                        className="tv-btn tv-btn--sm"
                        disabled={cardBusy}
                        onClick={() => void handleDisconnect(s.provider)}
                        aria-label={`Disconnect ${name}`}
                      >
                        Disconnect
                      </button>
                      <button
                        type="button"
                        className="tv-btn tv-btn--sm tv-btn--ghost"
                        disabled={cardBusy}
                        onClick={() => void handleRefresh(s.provider)}
                        aria-label={`Refresh ${name}`}
                      >
                        Refresh
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="tv-btn tv-btn--sm"
                      disabled={!isDesktop || cardBusy}
                      onClick={() => void handleConnect(s.provider)}
                      aria-label={`Connect ${name}`}
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section
        className="tv-engines__section tv-engines__section--byok"
        aria-labelledby="tv-engines-keys"
      >
        <h3 id="tv-engines-keys" className="tv-engines__section-title">
          API keys
        </h3>
        <p className="tv-engines__section-lede">{enginesApiKeysLede()}</p>
        <div className="tv-engines__byok-form">
          <label className="tv-field">
            <span className="tv-field__label">Provider</span>
            <input
              className="tv-launch__input"
              list="tv-provider-list"
              placeholder="e.g. openrouter"
              aria-label="Provider"
              value={providerInput}
              onChange={(e) => setProviderInput(e.target.value)}
            />
            <span className="tv-field__hint">Must match the model slug prefix (openrouter/…, huggingface/…). Domains HF BGE-small embeds need a free <strong>huggingface</strong> token (create at huggingface.co). Gemini embeds need <strong>gemini</strong>.</span>
          </label>
          <datalist id="tv-provider-list">
            {providerSuggestions().map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <label className="tv-field">
            <span className="tv-field__label">API key</span>
            <input
              className="tv-launch__input"
              type="password"
              placeholder="Paste the secret key"
              aria-label="API key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAddProvider();
              }}
            />
          </label>
          <button
            type="button"
            className="tv-btn tv-btn--sm"
            onClick={() => void handleAddProvider()}
            disabled={busy}
          >
            Add key
          </button>
        </div>
        {!loading && providers.length === 0 ? (
          <p className="tv-dash__prov-empty">{enginesApiKeysEmpty()}</p>
        ) : (
          <ul className="tv-dash__prov-list">
            {providers.map((p) => (
              <li className="tv-dash__prov-chip tv-dash__prov-chip--key" key={p.provider}>
                <span className="tv-dash__prov-dot" />
                <span className="tv-dash__prov-name">{p.provider}</span>
                <span className="tv-dash__prov-last4" title={`Saved key ending in ${p.key_last4}`}>
                  Saved · •••• {p.key_last4}
                </span>
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
    </section>
  );
}
