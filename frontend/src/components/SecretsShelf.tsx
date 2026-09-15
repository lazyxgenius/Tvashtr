import { useEffect, useRef, useState } from "react";
import { KeyRound, X } from "lucide-react";

import { addSecret, listSecrets, type McpSecretName, removeSecret } from "../lib/api";

/**
 * M-tools C7.A — the account's central **MCP secrets** shelf, beside the Providers shelf. The values
 * a node's MCP `tool_config` references as `${NAME}`, stored per account encrypted-at-rest and
 * resolved server-side at run time. Only the NAME is ever shown back — never the value.
 */
export function SecretsShelf() {
  const [secrets, setSecrets] = useState<McpSecretName[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [valueInput, setValueInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const reload = async () => {
    const s = await listSecrets();
    if (mounted.current) setSecrets(s);
  };

  useEffect(() => {
    mounted.current = true;
    listSecrets()
      .then((s) => mounted.current && setSecrets(s))
      .catch(() => {})
      .finally(() => mounted.current && setLoading(false));
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleAdd = async () => {
    const name = nameInput.trim();
    const value = valueInput.trim();
    if (name === "" || value === "") {
      setError("A name and a value are both required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addSecret(name, value);
      setNameInput("");
      setValueInput("");
      await reload();
    } catch {
      if (mounted.current) setError("Couldn't save the secret.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const handleRemove = async (name: string) => {
    try {
      await removeSecret(name);
      await reload();
    } catch {
      if (mounted.current) setError("Couldn't remove the secret.");
    }
  };

  return (
    <section className="tv-dash__panel tv-dash__prov tv-tools-section" aria-label="Your MCP secrets">
      <div className="tv-tools-section__head">
        <div className="tv-dash__prov-title">
          <KeyRound size={16} strokeWidth={1.7} />
          <h2>MCP secrets</h2>
        </div>
        <p className="tv-dash__prov-sub">
          The values a node&rsquo;s tools reference as <code>${"{NAME}"}</code> — stored per
          account, encrypted. We never show a value back.
        </p>
      </div>
      <div className="tv-tools-section__form tv-dash__prov-add--labeled">
        <label className="tv-field">
          <span className="tv-field__label">Name</span>
          <input
            className="tv-launch__input"
            aria-label="Secret name"
            placeholder="e.g. GITHUB_TOKEN"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <span className="tv-field__hint">Referenced in tool configs as ${"{NAME}"}.</span>
        </label>
        <label className="tv-field">
          <span className="tv-field__label">Value</span>
          <input
            className="tv-launch__input"
            type="password"
            aria-label="Secret value"
            placeholder="Paste the secret value"
            value={valueInput}
            onChange={(e) => setValueInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
            }}
          />
        </label>
        <button
          type="button"
          className="tv-btn tv-btn--sm"
          onClick={() => void handleAdd()}
          disabled={busy}
        >
          Add secret
        </button>
      </div>
      {!loading && secrets.length === 0 ? (
        <p className="tv-dash__prov-empty">
          Add a secret so a node&rsquo;s MCP tools can reference it as ${"{NAME}"}.
        </p>
      ) : (
        <ul className="tv-dash__prov-list">
          {secrets.map((s) => (
            <li className="tv-dash__prov-chip" key={s.name}>
              <span className="tv-dash__prov-dot" />
              <span className="tv-dash__prov-name">{s.name}</span>
              <span className="tv-dash__prov-last4">••••</span>
              <button
                className="tv-dash__prov-remove"
                aria-label={`Remove ${s.name}`}
                onClick={() => void handleRemove(s.name)}
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="tv-dash__error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
