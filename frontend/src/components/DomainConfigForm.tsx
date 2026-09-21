import { useMemo, useState } from "react";

import {
  EMBEDDING_PRESETS,
  normalizeEmbeddingModel,
  parseDomainConfig,
  providerOfEmbedding,
  type DomainConfig,
} from "../lib/domains";

function withRerank(cfg: DomainConfig): DomainConfig {
  const rr = cfg.retrieval.rerank;
  return {
    ...cfg,
    retrieval: {
      ...cfg.retrieval,
      mode: cfg.retrieval.mode || "dense",
      rerank: {
        enabled: Boolean(rr?.enabled),
        model: rr?.model ?? null,
        top_n: Number(rr?.top_n) > 0 ? Number(rr?.top_n) : 20,
      },
      graph: { enabled: Boolean(cfg.retrieval.graph?.enabled) },
    },
  };
}

function asConfig(initial: Record<string, unknown>): DomainConfig {
  return withRerank(
    parseDomainConfig(initial) ?? {
      chunking: { strategy: "fixed", size: 800, overlap: 100 },
      embedding: { model: "text-embedding-3-small" },
      retrieval: { top_k: 8, mode: "dense" },
      generation: { model: null },
    },
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
        next = withRerank(ok);
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
            <select
              className="tv-launch__input"
              aria-label="Embedding model"
              value={normalizeEmbeddingModel(cfg.embedding.model)}
              onChange={(e) =>
                setCfg({ ...cfg, embedding: { ...cfg.embedding, model: e.target.value } })
              }
            >
              {EMBEDDING_PRESETS.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.label}
                </option>
              ))}
              {/* Keep unknown saved slugs selectable so we do not silently rewrite on open. */}
              {!EMBEDDING_PRESETS.some(
                (p) => p.slug === normalizeEmbeddingModel(cfg.embedding.model),
              ) && (
                <option value={normalizeEmbeddingModel(cfg.embedding.model)}>
                  Custom: {normalizeEmbeddingModel(cfg.embedding.model)}
                </option>
              )}
            </select>
            <span className="tv-field__hint">
              1536-dim only (pgvector). Provider{" "}
              <strong>{providerOfEmbedding(cfg.embedding.model)}</strong> — add that
              provider&apos;s API key under Dashboard → Engines before ingest/Ask. OpenRouter
              preset uses your OpenRouter key (still OpenAI upstream billing via OpenRouter; not
              covered by SuperGrok/subscription).
            </span>
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
            <select
              className="tv-launch__input"
              aria-label="Retrieval mode"
              value={cfg.retrieval.mode}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: { ...cfg.retrieval, mode: e.target.value },
                })
              }
            >
              <option value="dense">dense</option>
              <option value="lexical">lexical</option>
              <option value="hybrid">hybrid</option>
            </select>
            <span className="tv-field__hint">
              dense = pgvector cosine; lexical = Postgres full-text; hybrid = RRF fusion of both.
            </span>
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Rerank enabled</span>
            <input
              type="checkbox"
              aria-label="Rerank enabled"
              checked={Boolean(cfg.retrieval.rerank?.enabled)}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: {
                    ...cfg.retrieval,
                    rerank: {
                      enabled: e.target.checked,
                      model: cfg.retrieval.rerank?.model ?? null,
                      top_n: cfg.retrieval.rerank?.top_n ?? 20,
                    },
                  },
                })
              }
            />
            <span className="tv-field__hint">
              v1: expands the candidate pool to Top N before cutting to Top K. No paid rerank
              provider is called; model is reserved for a future LiteLLM hook (passthrough when
              empty).
            </span>
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Rerank top N</span>
            <input
              className="tv-launch__input"
              type="number"
              aria-label="Rerank top N"
              value={cfg.retrieval.rerank?.top_n ?? 20}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: {
                    ...cfg.retrieval,
                    rerank: {
                      enabled: Boolean(cfg.retrieval.rerank?.enabled),
                      model: cfg.retrieval.rerank?.model ?? null,
                      top_n: Number(e.target.value),
                    },
                  },
                })
              }
            />
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Rerank model</span>
            <input
              className="tv-launch__input"
              aria-label="Rerank model"
              placeholder="optional — passthrough when empty"
              value={cfg.retrieval.rerank?.model ?? ""}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: {
                    ...cfg.retrieval,
                    rerank: {
                      enabled: Boolean(cfg.retrieval.rerank?.enabled),
                      model: e.target.value.trim() ? e.target.value : null,
                      top_n: cfg.retrieval.rerank?.top_n ?? 20,
                    },
                  },
                })
              }
            />
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Graph-lite mention expansion</span>
            <input
              type="checkbox"
              aria-label="Graph-lite mention expansion"
              checked={Boolean(cfg.retrieval.graph?.enabled)}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: {
                    ...cfg.retrieval,
                    graph: { enabled: e.target.checked },
                  },
                })
              }
            />
            <span className="tv-field__hint">
              When enabled, retrieve may append up to 4 neighbor chunks that share capitalized
              mentions with the top hits. No Neo4j / no entity ingest. Default off.
            </span>
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
