import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

import {
  deleteDomain,
  deleteDomainDocument,
  getDomain,
  ingestDomain,
  listDomainDocuments,
  listDomains,
  updateDomain,
  uploadDomainDocument,
  type DomainDetail,
  type DomainDocumentSummary,
  type DomainSummary,
} from "../lib/api";
import { labelForDomainTemplate } from "../lib/domains";
import { DomainConfigForm } from "./DomainConfigForm";
import { NewDomainDialog } from "./NewDomainDialog";

type DetailTab = "overview" | "documents" | "config";

export function DomainsPage() {
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DomainDetail | null>(null);
  const [documents, setDocuments] = useState<DomainDocumentSummary[]>([]);
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
      setDocuments([]);
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
    listDomainDocuments(selectedId)
      .then((rows) => {
        if (!cancelled) setDocuments(rows);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load documents.");
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
            aria-selected={tab === "documents"}
            className={`tv-domains__tab${tab === "documents" ? " tv-domains__tab--active" : ""}`}
            onClick={() => setTab("documents")}
          >
            Documents
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
                <dd>{detail.doc_count}</dd>
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
              Upload and ingest documents under Documents. Chat arrives in Phase 3. Configure
              chunking and retrieval under Config; set provider keys under Engines before ingest.
            </p>
            <button
              type="button"
              className="tv-btn tv-btn--danger"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("Delete this domain? This cannot be undone.")) {
                  return;
                }
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
        {tab === "documents" && (
          <section className="tv-domains__panel" aria-label="Documents">
            <div className="tv-domains__docs-actions">
              <label className="tv-btn tv-btn--ghost">
                Upload
                <input
                  type="file"
                  accept=".pdf,.md,.txt,.html,application/pdf,text/plain,text/markdown,text/html"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    void (async () => {
                      setBusy(true);
                      try {
                        await uploadDomainDocument(detail.domain_id, f);
                        setDocuments(await listDomainDocuments(detail.domain_id));
                        setDetail(await getDomain(detail.domain_id));
                        await refresh();
                        setError(null);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Upload failed");
                      } finally {
                        if (mountedRef.current) setBusy(false);
                      }
                    })();
                  }}
                />
              </label>
              <button
                type="button"
                className="tv-btn"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    try {
                      await ingestDomain(detail.domain_id);
                      setDocuments(await listDomainDocuments(detail.domain_id));
                      setDetail(await getDomain(detail.domain_id));
                      await refresh();
                      setError(null);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Ingest failed");
                    } finally {
                      if (mountedRef.current) setBusy(false);
                    }
                  })();
                }}
              >
                Ingest
              </button>
            </div>
            {error && (
              <div className="tv-dash__error" role="alert">
                {error}
              </div>
            )}
            {documents.length === 0 ? (
              <p className="tv-domains__empty">
                No documents yet. Upload a pdf, md, txt, or html file (max 10 MiB).
              </p>
            ) : (
              <ul className="tv-domains__docs-list">
                {documents.map((doc) => (
                  <li key={doc.document_id} className="tv-domains__docs-row">
                    <span className="tv-domains__docs-name">{doc.filename}</span>
                    <span className="tv-domains__docs-status">{doc.ingest_status}</span>
                    {doc.error_message ? (
                      <span className="tv-domains__docs-err">{doc.error_message}</span>
                    ) : null}
                    <button
                      type="button"
                      className="tv-btn tv-btn--ghost"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm("Delete this document? This cannot be undone.")) {
                          return;
                        }
                        void (async () => {
                          setBusy(true);
                          try {
                            await deleteDomainDocument(detail.domain_id, doc.document_id);
                            setDocuments(await listDomainDocuments(detail.domain_id));
                            setDetail(await getDomain(detail.domain_id));
                            await refresh();
                          } finally {
                            if (mountedRef.current) setBusy(false);
                          }
                        })();
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {tab === "config" && (
          <section className="tv-domains__panel" aria-label="Config">
            <DomainConfigForm
              key={detail.domain_id}
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
              Config-driven knowledge corpora — create a domain, upload docs, ingest with your
              Engines keys.
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
