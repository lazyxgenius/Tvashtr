import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

import {
  deleteDomain,
  getDomain,
  listDomains,
  updateDomain,
  type DomainDetail,
  type DomainSummary,
} from "../lib/api";
import { labelForDomainTemplate } from "../lib/domains";
import { DomainConfigForm } from "./DomainConfigForm";
import { NewDomainDialog } from "./NewDomainDialog";

type DetailTab = "overview" | "config";

export function DomainsPage() {
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DomainDetail | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const rows = await listDomains();
      if (mountedRef.current) {
        setDomains(rows);
        setError(null);
      }
    } catch {
      if (mountedRef.current) setError("Couldn't load domains — is the backend running?");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    getDomain(selectedId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load domain.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  if (selectedId && detail) {
    return (
      <div className="tv-domains">
        <header className="tv-dash__page-head tv-domains__detail-head">
          <button
            type="button"
            className="tv-btn tv-btn--ghost"
            onClick={() => {
              setSelectedId(null);
              setTab("overview");
            }}
          >
            ← Domains
          </button>
          <h1 className="tv-dash__page-title">{detail.name}</h1>
          <p className="tv-dash__page-lede">
            {labelForDomainTemplate(detail.template)} · {detail.status}
          </p>
        </header>
        <div className="tv-domains__tabs" role="tablist" aria-label="Domain sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "overview"}
            className={`tv-domains__tab${tab === "overview" ? " tv-domains__tab--active" : ""}`}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "config"}
            className={`tv-domains__tab${tab === "config" ? " tv-domains__tab--active" : ""}`}
            onClick={() => setTab("config")}
          >
            Config
          </button>
        </div>
        {tab === "overview" && (
          <section className="tv-domains__panel" aria-label="Overview">
            <dl className="tv-domains__meta">
              <div>
                <dt>Template</dt>
                <dd>{labelForDomainTemplate(detail.template)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{detail.status}</dd>
              </div>
              <div>
                <dt>Documents</dt>
                <dd>{detail.doc_count} (ingest arrives in a later phase)</dd>
              </div>
              <div>
                <dt>Embedding model</dt>
                <dd>
                  {String(
                    (detail.config as { embedding?: { model?: string } })?.embedding?.model ?? "—",
                  )}
                </dd>
              </div>
            </dl>
            <p className="tv-domains__hint">
              Upload, chat, and agent query land in later phases. Configure chunking and retrieval
              under Config; set provider keys under Engines before ingest.
            </p>
            <button
              type="button"
              className="tv-btn tv-btn--danger"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    await deleteDomain(detail.domain_id);
                    setSelectedId(null);
                    await refresh();
                  } finally {
                    if (mountedRef.current) setBusy(false);
                  }
                })();
              }}
            >
              Delete domain
            </button>
          </section>
        )}
        {tab === "config" && (
          <section className="tv-domains__panel" aria-label="Config">
            <DomainConfigForm
              initial={detail.config}
              onSave={async (config) => {
                const updated = await updateDomain(detail.domain_id, { config });
                setDetail(updated);
                await refresh();
              }}
            />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="tv-domains">
      <header className="tv-dash__page-head">
        <div className="tv-domains__list-head">
          <div>
            <h1 className="tv-dash__page-title">Domains</h1>
            <p className="tv-dash__page-lede">
              Config-driven knowledge corpora — create a domain, tune retrieval config, then ingest
              in a later phase.
            </p>
          </div>
          <button type="button" className="tv-btn" onClick={() => setPicking(true)}>
            <Plus size={15} strokeWidth={2} />
            New domain
          </button>
        </div>
      </header>
      {error && (
        <div className="tv-dash__error" role="alert">
          {error}
        </div>
      )}
      {domains.length === 0 ? (
        <p className="tv-domains__empty">No domains yet. Create one from a template to get started.</p>
      ) : (
        <ul className="tv-domains__list">
          {domains.map((d) => (
            <li key={d.domain_id}>
              <button
                type="button"
                className="tv-domains__card"
                onClick={() => setSelectedId(d.domain_id)}
              >
                <span className="tv-domains__card-name">{d.name}</span>
                <span className="tv-domains__card-meta">
                  {labelForDomainTemplate(d.template)} · {d.doc_count} docs · {d.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <NewDomainDialog
          onCreated={(id) => {
            setPicking(false);
            setSelectedId(id);
            void refresh();
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
