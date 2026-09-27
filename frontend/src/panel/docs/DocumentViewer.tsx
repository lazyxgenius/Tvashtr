import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, FileText, Pencil, X } from "lucide-react";

import { Button, ConfirmDialog, IconButton, Menu, useToast } from "../../design-system/components";
import {
  type DocDetail,
  type DocVersion,
  getDocument,
  listRunDocs,
  type RunDoc,
  type TeamRun,
} from "../../lib/api/docs";
import { useModalDialog } from "../../lib/useModalDialog";
import { whenShort } from "../runs/rounds";
import { useLoaded } from "../runs/useLoaded";
import type { LeaveGuard } from "../useUnsavedGuard";
import { DocEditor } from "./DocEditor";
import { DocAside, DocBody, DocColumns, DocRail, RunLine } from "./DocPanes";
import { type DocPlace, detailLabel, docSubtitle, pickVersions } from "./docView";
import "../focus/focus.css";
import "./viewer.css";

export interface DocumentViewerProps {
  docId: string;
  /** The version shown (none: the latest) and the one it's compared with. */
  place: DocPlace;
  /** The team's runs: the rail's 'Run “…” · 31m ago' reads when the run last moved. */
  runs?: readonly TeamRun[] | null;
  /** Show another document or version (the address follows). */
  onPlace: (docId: string, place: DocPlace) => void;
  onClose: () => void;
  /** The canvas asks here before it leaves (Back to teams) while an edit is unsaved. */
  guardRef?: MutableRefObject<LeaveGuard | null>;
}

/**
 * The document viewer (Docs-Viewer, DOCS-18..36): one run document as a 1240px dialog over the
 * canvas or the focus view — the run's documents on the left, the document in the middle, its
 * versions and readers on the right. Compare shows two versions' changes inline; Edit (the shared
 * spec of a live run, latest version) saves your edit as the next version.
 */
export function DocumentViewer({
  docId,
  place,
  runs,
  onPlace,
  onClose,
  guardRef,
}: DocumentViewerProps) {
  const toast = useToast();
  const loaded = useLoaded(docId, () => getDocument(docId));
  // A reload after a save keeps showing the old answer until the new one lands.
  const [fresh, setFresh] = useState<DocDetail | null>(null);
  const detail = fresh?.id === docId ? fresh : loaded.value;
  const runId = detail?.run_id ?? null;
  const runDocs = useLoaded(runId, () => listRunDocs(runId ?? ""));
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const unsaved = editing && dirty;
  const label = detail ? detailLabel(detail) : "Document";

  // DOCS-31: leaving an unsaved edit asks first.
  const [asking, setAsking] = useState<(() => void) | null>(null);
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const guard = useCallback<LeaveGuard>((proceed) => {
    if (unsavedRef.current) setAsking(() => proceed);
    else proceed();
  }, []);
  useEffect(() => {
    if (!guardRef) return;
    guardRef.current = guard;
    return () => {
      if (guardRef.current === guard) guardRef.current = null;
    };
  }, [guardRef, guard]);
  // Reload / close the tab (web) and quit (Tvashtr Desktop) ask too while the edit is unsaved.
  // ponytail: this only reports its own edit; an agent drawer that is dirty underneath re-reports
  // on its next change, not when this edit ends.
  useEffect(() => {
    if (!unsaved) return;
    const bridge = window.tvashtrDesktop;
    const app = bridge && typeof bridge === "object" ? bridge.app : undefined;
    app?.setUnsavedChanges?.({ dirty: true, agentName: label });
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      app?.setUnsavedChanges?.({ dirty: false });
    };
  }, [unsaved, label]);

  const dialogRef = useModalDialog<HTMLElement>(true, () => guard(onClose));

  const leaveEdit = () => {
    setEditing(false);
    setDirty(false);
  };
  const go = (next: DocPlace, id = docId) =>
    guard(() => {
      leaveEdit();
      onPlace(id, next);
    });
  const reload = () => {
    getDocument(docId).then(setFresh, () => undefined);
    runDocs.retry();
  };

  let body;
  if (!detail) {
    body = (
      <div className="dv-center">
        {loaded.state === "error" ? (
          <p className="dv-note" role="alert">
            Couldn’t load the document.{" "}
            <Button variant="secondary" size="sm" onClick={loaded.retry}>
              Retry
            </Button>
          </p>
        ) : (
          <p className="dv-note" role="status">
            Loading the document…
          </p>
        )}
      </div>
    );
  } else {
    const docs = runDocs.value?.documents ?? [];
    const doc: RunDoc | null = docs.find((d) => d.id === docId) ?? null;
    const listed = runs?.find((r) => r.run_id === runId);
    const run = runDocs.value?.run;
    const rail = (
      <DocRail
        docs={docs}
        currentId={docId}
        onPick={(d) => d.id !== docId && go({}, d.id)}
        run={
          (listed || run) && (
            <div className="dv-rail__run">
              <RunLine
                idea={listed?.idea ?? run?.idea ?? ""}
                when={whenShort(
                  listed ? (listed.updated_at ?? listed.created_at) : (run?.created_at ?? ""),
                )}
              />
            </div>
          )
        }
      />
    );
    const aside = (
      <DocAside detail={detail} doc={doc} place={editing ? {} : place} onPlace={(p) => go(p)} />
    );
    body = editing ? (
      <DocEditor
        detail={detail}
        rail={rail}
        aside={aside}
        onDirty={setDirty}
        onSaved={(v: DocVersion) => {
          leaveEdit();
          reload();
          onPlace(docId, {});
          toast({ message: `Saved v${v.version_no} — the agents read it on their next round.` });
        }}
        onRefresh={reload}
        onCompare={(from) => go({ compare: from })}
        onDiscard={leaveEdit}
      />
    ) : (
      <DocColumns rail={rail} aside={aside}>
        <DocBody detail={detail} place={place} />
      </DocColumns>
    );
  }

  const { latest, selected, from } = pickVersions(detail?.versions ?? [], editing ? {} : place);
  // DOCS-26 / OQ-7: only the shared spec of a live run, on its latest version, not while comparing.
  const canEdit =
    !editing &&
    detail?.editable === true &&
    detail.is_shared_spec &&
    selected !== null &&
    selected.version_no === latest?.version_no &&
    from === null;
  const copy = () => {
    if (!selected) return;
    const done = () => toast({ message: "Copied as Markdown" });
    const failed = () => toast({ message: "Couldn’t copy to the clipboard.", tone: "error" });
    if (navigator.clipboard)
      void navigator.clipboard.writeText(selected.content).then(done, failed);
    else failed();
  };

  return (
    <div className="fx-layer dv-layer">
      <div className="fx-scrim" aria-hidden />
      <section
        ref={dialogRef}
        className="fx-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <header className="dv-head">
          <span className="dv-head__glyph" aria-hidden>
            <FileText size={17} strokeWidth={1.6} />
          </span>
          <div>
            <h2 className="dv-head__title">{label}</h2>
            <div className="dv-head__sub">
              {detail
                ? docSubtitle(detail, runDocs.value?.documents.find((d) => d.id === docId) ?? null)
                : ""}
            </div>
          </div>
          <div className="dv-head__actions">
            {selected && latest && (
              <Menu
                label="Choose a version"
                items={[...(detail?.versions ?? [])].reverse().map((v) => ({
                  key: String(v.version_no),
                  label: `v${v.version_no}${v.version_no === latest.version_no ? " · latest" : ""}`,
                  description: `${v.author?.label ?? "Agent"} · ${whenShort(v.created_at)}`,
                  icon:
                    v.version_no === selected.version_no ? (
                      <Check size={15} strokeWidth={1.6} aria-hidden />
                    ) : (
                      <span />
                    ),
                  onSelect: () =>
                    go({
                      version: v.version_no === latest.version_no ? undefined : v.version_no,
                    }),
                }))}
                trigger={(t) => (
                  <button type="button" className="dv-vmenu" {...t}>
                    <span className="dv-vmenu__no">v{selected.version_no}</span>
                    {selected.version_no === latest.version_no && " · latest"}
                    <ChevronDown size={12} strokeWidth={1.6} aria-hidden />
                  </button>
                )}
              />
            )}
            {canEdit && (
              <Button
                variant="secondary"
                size="sm"
                className="nd-btn-flush"
                onClick={() => setEditing(true)}
              >
                <Pencil size={13} strokeWidth={1.6} aria-hidden />
                <span>Edit</span>
              </Button>
            )}
            <IconButton
              size="sm"
              aria-label="Copy as Markdown"
              title="Copy as Markdown"
              onClick={copy}
            >
              <Copy size={15} strokeWidth={1.6} />
            </IconButton>
            <IconButton size="sm" aria-label="Close" title="Close" onClick={() => guard(onClose)}>
              <X size={16} strokeWidth={1.6} />
            </IconButton>
          </div>
        </header>
        {body}
      </section>
      <ConfirmDialog
        open={asking !== null}
        title={`Discard your edit to the ${label}?`}
        confirmLabel="Discard edit"
        cancelLabel="Keep editing"
        tone="danger"
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const proceed = asking;
          setAsking(null);
          leaveEdit();
          proceed?.();
        }}
      >
        It isn’t saved, so the agents won’t see it.
      </ConfirmDialog>
    </div>
  );
}
