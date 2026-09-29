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
import { NAVIGATION_KEPT, navigate, parseRoute } from "../../lib/nav";
import { reportUnsaved } from "../../lib/unsavedChanges";
import { useModalDialog } from "../../lib/useModalDialog";
import { whenShort } from "../runs/rounds";
import { useLoaded } from "../runs/useLoaded";
import { useSaveShortcut } from "../saveShortcut";
import type { LeaveGuard } from "../useUnsavedGuard";
import { DocEditor } from "./DocEditor";
import { DocAside, DocBody, DocColumns, DocRail, RunLine } from "./DocPanes";
import { type DocPlace, detailLabel, docSubtitle, pickVersions } from "./docView";
import "../focus/focus.css";
import "./viewer.css";

/** How often an open viewer looks for a newer version while its run is live. */
const LIVE_LOOK_MS = 10_000;
/** A late answer never replaces a newer one (versions only grow). */
const newest = (prev: DocDetail | null, next: DocDetail) =>
  prev?.id === next.id && prev.versions.length > next.versions.length ? prev : next;

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
  // A reload (after a save, or a refused one) replaces the answer in place — never through a loading
  // state, which would unmount an open edit. Versions only grow, so the longer list is the newer.
  const [fresh, setFresh] = useState<DocDetail | null>(null);
  const detail =
    fresh?.id === docId && fresh.versions.length >= (loaded.value?.versions.length ?? 0)
      ? fresh
      : loaded.value;
  const runId = detail?.run_id ?? null;
  // Each reload looks at the run's documents again too, keeping the last answer meanwhile.
  const [looks, setLooks] = useState(0);
  const runDocs = useLoaded(runId && `${runId}:${looks}`, () => listRunDocs(runId ?? ""), {
    keep: true,
  });
  const reload = useCallback(() => {
    getDocument(docId).then(
      (next) => setFresh((prev) => newest(prev, next)),
      () => undefined,
    );
    setLooks((n) => n + 1);
  }, [docId]);
  // While the run is live an agent can save a newer version at any time: look again every few
  // seconds and when the window comes back (an open edit stays as it is).
  const live = detail?.editable === true;
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(reload, LIVE_LOOK_MS);
    window.addEventListener("focus", reload);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", reload);
    };
  }, [live, reload]);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const unsaved = editing && dirty;
  const label = detail ? detailLabel(detail) : "Document";

  // DOCS-31: leaving an unsaved edit asks first. `fromAddress`: the address already moved (Back).
  const [asking, setAsking] = useState<{ proceed: () => void; fromAddress?: boolean } | null>(null);
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const guard = useCallback<LeaveGuard>((proceed) => {
    if (unsavedRef.current) setAsking({ proceed });
    else proceed();
  }, []);
  useEffect(() => {
    if (!guardRef) return;
    guardRef.current = guard;
    return () => {
      if (guardRef.current === guard) guardRef.current = null;
    };
  }, [guardRef, guard]);
  // While the edit is unsaved: reload / close the tab (web) and quit (Tvashtr Desktop) ask first,
  // and so does browser Back or any address change that isn't the viewer's own — the address is put
  // back (before the app's own listener sees it) until the edit is discarded.
  const [source] = useState(() => Symbol("document edit"));
  useEffect(() => {
    if (!unsaved) return;
    reportUnsaved(source, { dirty: true, agentName: label });
    const here = window.location.hash;
    const onHash = (e: HashChangeEvent) => {
      const next = window.location.hash;
      if (!unsavedRef.current || next === here) return;
      e.stopImmediatePropagation();
      const url = new URL(window.location.href);
      url.hash = here;
      window.history.replaceState(window.history.state, "", url);
      setAsking({
        proceed: () => navigate(parseRoute(next), { replace: true }),
        fromAddress: true,
      });
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("hashchange", onHash, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("hashchange", onHash, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      reportUnsaved(source, { dirty: false });
    };
  }, [unsaved, label, source]);
  // ⌘S belongs to the viewer while it's open (its edit saves; the agent drawer underneath doesn't).
  useSaveShortcut(() => undefined, true);

  const dialogRef = useModalDialog<HTMLElement>(true, () => guard(onClose));
  // Focus starts on the dialog itself (its name is read out), not on its first button.
  useEffect(() => dialogRef.current?.focus(), [dialogRef]);

  const leaveEdit = () => {
    // At once: a move that follows in this same tick must not be asked about again.
    unsavedRef.current = false;
    setEditing(false);
    setDirty(false);
  };
  const go = (next: DocPlace, id = docId) =>
    guard(() => {
      leaveEdit();
      onPlace(id, next);
    });
  // Edit starts on the real latest version (an agent may have saved one since the last look), and
  // not at all once the run has ended.
  const startEdit = () =>
    getDocument(docId).then(
      (next) => {
        setFresh((prev) => newest(prev, next));
        setEditing(next.editable);
      },
      () => setEditing(true),
    );

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
        className="fx-dialog dv-dialog"
        tabIndex={-1}
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
                onClick={() => void startEdit()}
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
        onCancel={() => {
          if (asking?.fromAddress) window.dispatchEvent(new Event(NAVIGATION_KEPT));
          setAsking(null);
        }}
        onConfirm={() => {
          const proceed = asking?.proceed;
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
