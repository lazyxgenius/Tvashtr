import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";

import { addDocumentVersion, type DocumentDetail, getDocument } from "../lib/api";
import { getMarkdown, PRD_EDITOR_EXTENSIONS } from "../lib/prdEditor";

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
 * The PM panel: the product's spec, with a version list. While the run is **in-flight**
 * (`editable`), the **latest** version renders in a TipTap markdown editor — a human edit,
 * saved explicitly, becomes a new `created_by:"human"` DocumentVersion the running agents
 * re-source on their next node entry (J3, P1.7b live steering). A terminal run, or any
 * **older** version, renders read-only (the plain-text view). Fetches once on open and
 * refetches whenever the document id changes; the poll loop never re-fetches the doc, so an
 * in-progress edit is never clobbered.
 */
export function PrdView({
  documentId,
  emptyHint,
  editable,
}: {
  documentId: string | null;
  emptyHint: string;
  editable: boolean;
}) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    setSavedNote(null);
    setSaveError(false);
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

  const handleSave = useCallback(
    async (markdown: string) => {
      if (!documentId) return;
      setSaving(true);
      setSaveError(false);
      try {
        const added = await addDocumentVersion(documentId, markdown);
        // The POST response is partial (no id/created_by) — refetch for the full version list.
        const fresh = await getDocument(documentId);
        setDoc(fresh);
        const latest = fresh.versions.at(-1) ?? null;
        setSelectedId(latest ? latest.id : null);
        setSavedNote(`Saved v${added.version_no} — the agents read it on their next round.`);
      } catch {
        setSaveError(true);
      } finally {
        setSaving(false);
      }
    },
    [documentId],
  );

  const onDirty = useCallback(() => setSavedNote(null), []);

  if (!documentId) return <div className="tv-scroll"><p className="tv-panel-note">{emptyHint}</p></div>;
  if (state === "idle" || state === "loading")
    return <div className="tv-scroll"><p className="tv-panel-note">Loading the spec…</p></div>;
  if (state === "error" || !doc)
    return <div className="tv-scroll"><p className="tv-panel-note">Couldn't load the spec.</p></div>;

  const latest = doc.versions.at(-1) ?? null;
  const selected = doc.versions.find((v) => v.id === selectedId) ?? latest;
  const isLatestSelected = selected !== null && selected.id === latest?.id;
  const showEditor = editable && isLatestSelected && selected !== null;

  return (
    <div className="tv-scroll">
      <div className="tv-prd__title">{doc.title}</div>
      <div className="tv-prd__meta">
        {doc.doc_type} · updated {stamp(doc.updated_at)}
      </div>

      {doc.versions.length > 0 && (
        <div className="tv-prd__versions">
          {doc.versions.map((v) => {
            const isLive = editable && v.id === latest?.id;
            return (
              <button
                key={v.id}
                type="button"
                className={`tv-prd__version${v.id === selected?.id ? " tv-prd__version--active" : ""}`}
                onClick={() => setSelectedId(v.id)}
                title={`${v.created_by} · ${stamp(v.created_at)}`}
              >
                <span className="tv-prd__version-no">v{v.version_no}</span>
                <span>{v.created_by}</span>
                {isLive && <span className="tv-prd__live">live</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="tv-prd__divider" />

      {!selected ? (
        <p className="tv-panel-note">This spec has no versions yet.</p>
      ) : showEditor ? (
        <PrdEditor
          markdown={selected.content}
          onSave={handleSave}
          saving={saving}
          savedNote={savedNote}
          saveError={saveError}
          onDirty={onDirty}
        />
      ) : (
        <>
          {editable && !isLatestSelected && latest && (
            <p className="tv-prd__viewing">
              Viewing v{selected.version_no} — only the live (latest) version is editable.{" "}
              <button
                type="button"
                className="tv-btn--link"
                onClick={() => setSelectedId(latest.id)}
              >
                Go to the live version →
              </button>
            </p>
          )}
          <div className="tv-prd__content">{selected.content}</div>
        </>
      )}
    </div>
  );
}

/**
 * The live-steering editor (P1.7b): the latest PRD version in a TipTap markdown editor.
 * Save is **explicit and dirty-aware** (enabled only when the markdown actually changed) and
 * **not autosaving** — every Save is a deliberate new version. The framing copy always says
 * the agents read it on their NEXT round (never "now"): a save propagates on the next node read.
 */
function PrdEditor({
  markdown,
  onSave,
  saving,
  savedNote,
  saveError,
  onDirty,
}: {
  markdown: string;
  onSave: (markdown: string) => void;
  saving: boolean;
  savedNote: string | null;
  saveError: boolean;
  onDirty: () => void;
}) {
  const baselineRef = useRef(markdown);
  const [dirty, setDirty] = useState(false);

  const editor = useEditor({
    extensions: PRD_EDITOR_EXTENSIONS,
    content: markdown,
    onUpdate: ({ editor }) => {
      const changed = getMarkdown(editor) !== baselineRef.current;
      setDirty(changed);
      if (changed) onDirty();
    },
  });

  // External content change (a doc switch or a post-save refetch hands down new markdown):
  // reset the doc + baseline so the editor tracks the new latest without reading dirty.
  useEffect(() => {
    if (!editor) return;
    baselineRef.current = markdown;
    if (getMarkdown(editor) !== markdown) editor.commands.setContent(markdown);
    setDirty(false);
  }, [markdown, editor]);

  // Lock the surface while a save is in flight.
  useEffect(() => {
    editor?.setEditable(!saving);
  }, [editor, saving]);

  const handleSave = () => {
    if (!editor || !dirty || saving) return;
    onSave(getMarkdown(editor));
  };

  return (
    <div className="tv-prd__editwrap">
      <p className="tv-prd__steer">
        This is the live spec — saving creates a new version the agents read on their next round.
      </p>
      <EditorContent editor={editor} className="tv-prd__editor" />
      <div className="tv-prd__editbar">
        <button className="tv-btn" type="button" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save new version"}
        </button>
        {dirty ? (
          <span className="tv-prd__dirty">Unsaved changes</span>
        ) : savedNote ? (
          <span className="tv-prd__saved">{savedNote}</span>
        ) : null}
        {saveError && <span className="tv-prd__saveerr">Couldn't save — try again.</span>}
      </div>
    </div>
  );
}
