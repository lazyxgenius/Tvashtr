import { type ReactNode, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";

import { Button } from "../../design-system/components";
import {
  addDocumentVersion,
  type DocDetail,
  DocSaveError,
  type DocSaveErrorKind,
  type DocVersion,
} from "../../lib/api/docs";
import { getMarkdown, PRD_EDITOR_EXTENSIONS } from "../../lib/prdEditor";
import { DocColumns } from "./DocPanes";

const SAVE_FAILED = "Couldn't save — try again.";

/**
 * Live edit (Docs-EditLive, DOCS-26..32): the shared spec's latest version in the TipTap markdown
 * editor, with the toolbar and a footer that saves it as the next version. The save names the version
 * the edit started on, so an agent's newer version is never overwritten silently (409
 * `stale_version`); a run that ended meanwhile refuses too (409 `run_finished`). Both say so plainly.
 */
export function DocEditor({
  detail,
  rail,
  aside,
  onDirty,
  onSaved,
  onRefresh,
  onCompare,
  onDiscard,
}: {
  detail: DocDetail;
  rail: ReactNode;
  aside: ReactNode;
  onDirty: (dirty: boolean) => void;
  onSaved: (version: DocVersion) => void;
  /** Reload the document (someone saved a newer version, or the run ended). */
  onRefresh: () => void;
  /** "Compare": the version this edit started on against the newest. */
  onCompare: (from: number) => void;
  onDiscard: () => void;
}) {
  const latestNo = detail.versions.at(-1)?.version_no ?? 0;
  // The version this edit started on; after a stale refusal, the newest (the user has been told).
  const startedOn = useRef(latestNo);
  const [base, setBase] = useState(latestNo);
  const baseline = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ kind: DocSaveErrorKind; message: string } | null>(null);

  const editor = useEditor({
    extensions: PRD_EDITOR_EXTENSIONS,
    // Seeded once: a refetch while editing (a newer version landed) never replaces the edit.
    content: detail.versions.at(-1)?.content ?? "",
    autofocus: "end",
    // The loaded spec as the editor writes it back; an update can land before `onCreate`.
    onCreate: ({ editor }) => {
      baseline.current ??= getMarkdown(editor);
    },
    onUpdate: ({ editor }) => {
      const markdown = getMarkdown(editor);
      baseline.current ??= markdown;
      setDirty(markdown !== baseline.current);
    },
  });
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e?.isActive("heading", { level: 1 }) ?? false,
      h2: e?.isActive("heading", { level: 2 }) ?? false,
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      list: e?.isActive("bulletList") ?? false,
      code: e?.isActive("code") ?? false,
    }),
  });

  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    editor?.setEditable(!saving);
  }, [editor, saving]);

  const finished = error?.kind === "run_finished";
  const next = latestNo + 1;
  const save = async () => {
    if (!editor || !dirty || saving || finished) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await addDocumentVersion(detail.id, getMarkdown(editor), { baseVersionNo: base }));
    } catch (err) {
      if (
        err instanceof DocSaveError &&
        (err.kind === "stale_version" || err.kind === "run_finished")
      ) {
        setError({ kind: err.kind, message: err.message });
        if (err.latestVersionNo) setBase(err.latestVersionNo);
        onRefresh();
      } else {
        setError({ kind: "other", message: SAVE_FAILED });
      }
    } finally {
      setSaving(false);
    }
  };

  const tool = (label: string, title: string, on: boolean, run: () => void, className = "") => (
    <button
      type="button"
      className={`dv-tool${className ? ` ${className}` : ""}`}
      aria-pressed={on}
      title={title}
      // Keep the editor's selection: the command runs on it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  );
  const chain = () => editor?.chain().focus();

  return (
    <>
      <DocColumns rail={rail} aside={aside}>
        <div className="dv-live">
          <span className="dv-live__dot" aria-hidden />
          <span>
            <b>The run is live.</b> Save and agents pick up your edit at their next step.
          </span>
        </div>
        {editor && active && (
          <div className="dv-tools" role="toolbar" aria-label="Formatting">
            {tool(
              "H1",
              "Heading",
              active.h1,
              () => chain()?.toggleHeading({ level: 1 }).run(),
              "dv-tool--strong",
            )}
            {tool(
              "H2",
              "Subheading",
              active.h2,
              () => chain()?.toggleHeading({ level: 2 }).run(),
              "dv-tool--strong",
            )}
            {tool("B", "Bold", active.bold, () => chain()?.toggleBold().run(), "dv-tool--bold")}
            {tool(
              "I",
              "Italic",
              active.italic,
              () => chain()?.toggleItalic().run(),
              "dv-tool--italic",
            )}
            {tool("• List", "Bulleted list", active.list, () => chain()?.toggleBulletList().run())}
            {tool("Code", "Inline code", active.code, () => chain()?.toggleCode().run())}
          </div>
        )}
        <EditorContent editor={editor} className="dv-editor dv-md" />
        {error && (
          <p className="dv-saveerr" role="alert">
            {error.message}
            {error.kind === "stale_version" && (
              <Button variant="secondary" size="sm" onClick={() => onCompare(startedOn.current)}>
                Compare
              </Button>
            )}
          </p>
        )}
      </DocColumns>
      <footer className="dv-foot">
        <span className="dv-foot__state">
          {dirty && <span className="dv-foot__dot" aria-hidden />}
          {dirty ? "Unsaved edit" : "No changes yet"} · saves as v{next}
        </span>
        <div className="dv-foot__actions">
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void save()}
            disabled={!dirty || finished}
            loading={saving}
          >
            Save as v{next}
          </Button>
        </div>
      </footer>
    </>
  );
}
