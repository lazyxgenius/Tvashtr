import { useEffect, useState } from "react";

import { type DocumentDetail, getDocument } from "../lib/api";

type LoadState = "idle" | "loading" | "ready" | "error";

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The PM panel: the product's spec (latest version) rendered as plain, readable
 * text, with a version list. Fetches once on open and refetches whenever the
 * document id changes (e.g. a Phase-1 edit creates a new doc). No markdown lib.
 */
export function PrdView({
  documentId,
  emptyHint,
}: {
  documentId: string | null;
  emptyHint: string;
}) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!documentId) {
      setDoc(null);
      setState("idle");
      setSelectedId(null);
      return;
    }
    let cancelled = false;
    setState("loading");
    getDocument(documentId)
      .then((d) => {
        if (cancelled) return;
        setDoc(d);
        setState("ready");
        const latest = d.versions.length ? d.versions[d.versions.length - 1] : null;
        setSelectedId(latest ? latest.id : null);
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  if (!documentId) return <div className="tv-scroll"><p className="tv-panel-note">{emptyHint}</p></div>;
  if (state === "idle" || state === "loading")
    return <div className="tv-scroll"><p className="tv-panel-note">Loading the spec…</p></div>;
  if (state === "error" || !doc)
    return <div className="tv-scroll"><p className="tv-panel-note">Couldn't load the spec.</p></div>;

  const selected = doc.versions.find((v) => v.id === selectedId) ?? doc.versions.at(-1) ?? null;

  return (
    <div className="tv-scroll">
      <div className="tv-prd__title">{doc.title}</div>
      <div className="tv-prd__meta">
        {doc.doc_type} · updated {stamp(doc.updated_at)}
      </div>

      {doc.versions.length > 0 && (
        <div className="tv-prd__versions">
          {doc.versions.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`tv-prd__version${v.id === selected?.id ? " tv-prd__version--active" : ""}`}
              onClick={() => setSelectedId(v.id)}
              title={`${v.created_by} · ${stamp(v.created_at)}`}
            >
              <span className="tv-prd__version-no">v{v.version_no}</span>
              <span>{v.created_by}</span>
            </button>
          ))}
        </div>
      )}

      <div className="tv-prd__divider" />

      {selected ? (
        <div className="tv-prd__content">{selected.content}</div>
      ) : (
        <p className="tv-panel-note">This spec has no versions yet.</p>
      )}
    </div>
  );
}
