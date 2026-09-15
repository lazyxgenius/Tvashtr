import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { createDomain, getDomainTemplates, type DomainTemplate } from "../lib/api";
import { useModalDialog } from "../lib/useModalDialog";

export function NewDomainDialog({
  onCreated,
  onClose,
}: {
  onCreated: (domainId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [templates, setTemplates] = useState<DomainTemplate[]>([]);
  const [selected, setSelected] = useState<string>("blank");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useModalDialog<HTMLDivElement>(true, onClose);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDomainTemplates()
      .then((t) => {
        if (!cancelled) {
          setTemplates(t);
          if (t.length) setSelected(t[0].template);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load domain templates — is the backend running?");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give this domain a name so you can tell it apart.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createDomain(selected, trimmed);
      onCreated(created.domain_id);
    } catch {
      if (mountedRef.current) {
        setError("Couldn't create the domain — is the backend running?");
        setCreating(false);
      }
    }
  };

  return (
    <>
      <div className="tv-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="tv-dash__dialog tv-card"
        role="dialog"
        aria-modal="true"
        aria-label="New domain"
        ref={dialogRef}
      >
        <header className="tv-dash__dialog-head">
          <h2 className="tv-dash__dialog-title">New domain</h2>
          <button type="button" className="tv-panel__close" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={1.7} />
          </button>
        </header>
        <div className="tv-dash__dialog-body">
          <label className="tv-field">
            <span className="tv-field__label">Name</span>
            <input
              className="tv-launch__input"
              value={name}
              aria-label="Domain name"
              placeholder="e.g. Support docs"
              autoComplete="off"
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
            />
          </label>
          <div className="tv-field">
            <span className="tv-field__label">Template</span>
            <ul className="tv-dash__templates">
              {templates.map((c) => (
                <li key={c.template}>
                  <button
                    type="button"
                    className={`tv-dash__template${
                      selected === c.template ? " tv-dash__template--active" : ""
                    }`}
                    aria-pressed={selected === c.template}
                    onClick={() => setSelected(c.template)}
                  >
                    <span className="tv-dash__template-name">{c.name}</span>
                    <span className="tv-dash__template-desc">{c.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {error && (
            <div className="tv-dash__error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer className="tv-dash__dialog-foot">
          <button type="button" className="tv-btn" onClick={() => void create()} disabled={creating}>
            {creating ? "Creating…" : "Create domain"}
          </button>
          <button type="button" className="tv-btn tv-btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </>
  );
}
