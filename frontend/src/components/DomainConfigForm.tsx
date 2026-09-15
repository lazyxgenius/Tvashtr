import { useMemo, useState } from "react";

import { parseDomainConfig, type DomainConfig } from "../lib/domains";

function asConfig(initial: Record<string, unknown>): DomainConfig {
  return (
    parseDomainConfig(initial) ?? {
      chunking: { strategy: "fixed", size: 800, overlap: 100 },
      embedding: { model: "text-embedding-3-small" },
      retrieval: { top_k: 8, mode: "dense" },
      generation: { model: null },
    }
  );
}

export function DomainConfigForm({
  initial,
  onSave,
}: {
  initial: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => Promise<void>;
}) {
  const seed = useMemo(() => asConfig(initial), [initial]);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [cfg, setCfg] = useState<DomainConfig>(seed);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(seed, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError(null);
    let next: DomainConfig = cfg;
    if (mode === "json") {
      try {
        const parsed = JSON.parse(jsonText) as unknown;
        const ok = parseDomainConfig(parsed);
        if (!ok) {
          setError("JSON must include chunking, embedding, retrieval, and generation objects.");
          return;
        }
        next = ok;
      } catch {
        setError("Invalid JSON.");
        return;
      }
    }
    setSaving(true);
    try {
      await onSave(next as unknown as Record<string, unknown>);
      setCfg(next);
      setJsonText(JSON.stringify(next, null, 2));
    } catch {
      setError("Couldn't save config.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tv-domains__config">
      <div className="tv-domains__config-modes">
        <button
          type="button"
          className={`tv-btn tv-btn--ghost${mode === "form" ? " tv-domains__tab--active" : ""}`}
          onClick={() => {
            setMode("form");
            try {
              setCfg(asConfig(JSON.parse(jsonText)));
            } catch {
              /* keep current cfg if JSON invalid while switching */
            }
          }}
        >
          Form
        </button>
        <button
          type="button"
          className={`tv-btn tv-btn--ghost${mode === "json" ? " tv-domains__tab--active" : ""}`}
          onClick={() => {
            setJsonText(JSON.stringify(cfg, null, 2));
            setMode("json");
          }}
        >
          Raw JSON
        </button>
      </div>

      {mode === "form" ? (
        <div className="tv-domains__config-grid">
          <label className="tv-field">
            <span className="tv-field__label">Chunk size</span>
            <input
              className="tv-launch__input"
              type="number"
              aria-label="Chunk size"
              value={cfg.chunking.size}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  chunking: { ...cfg.chunking, size: Number(e.target.value) },
                })
              }
            />
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Chunk overlap</span>
            <input
              className="tv-launch__input"
              type="number"
              aria-label="Chunk overlap"
              value={cfg.chunking.overlap}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  chunking: { ...cfg.chunking, overlap: Number(e.target.value) },
                })
              }
            />
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Embedding model</span>
            <input
              className="tv-launch__input"
              aria-label="Embedding model"
              value={cfg.embedding.model}
              onChange={(e) =>
                setCfg({ ...cfg, embedding: { ...cfg.embedding, model: e.target.value } })
              }
            />
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Top K</span>
            <input
              className="tv-launch__input"
              type="number"
              aria-label="Top K"
              value={cfg.retrieval.top_k}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: { ...cfg.retrieval, top_k: Number(e.target.value) },
                })
              }
            />
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Retrieval mode</span>
            <input
              className="tv-launch__input"
              aria-label="Retrieval mode"
              value={cfg.retrieval.mode}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: { ...cfg.retrieval, mode: e.target.value },
                })
              }
            />
            <span className="tv-field__hint">Phase 1: dense only. Hybrid arrives later.</span>
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Generation model</span>
            <input
              className="tv-launch__input"
              aria-label="Generation model"
              value={cfg.generation.model ?? ""}
              placeholder="null = account default later"
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  generation: { model: e.target.value.trim() ? e.target.value : null },
                })
              }
            />
          </label>
        </div>
      ) : (
        <label className="tv-field">
          <span className="tv-field__label">Config JSON</span>
          <textarea
            className="tv-launch__input tv-domains__json"
            aria-label="Config JSON"
            rows={16}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
          />
        </label>
      )}

      {error && (
        <div className="tv-dash__error" role="alert">
          {error}
        </div>
      )}

      <button type="button" className="tv-btn" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save config"}
      </button>
    </div>
  );
}
