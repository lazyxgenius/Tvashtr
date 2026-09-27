/**
 * A domain's Sources tab (Dm-Sources, DmF-First-4/5, DmF-Filter-1…3, DmF-Preview-1/2): search in
 * file names and text, the Show filter with its counts, Add files, the drop hint, the files table
 * and its footer, and the file preview sheet (`?file=`). Files dragged over the tab show the drop
 * overlay (DmF-Drag-1); dropped or picked files go to `useUploads` (DmF-Drag-2…4).
 * Delete file… asks first (DeleteFileDialog), then hands the file to the page's deferred delete.
 */
import { type DragEvent, useEffect, useRef, useState } from "react";
import { RefreshCw, Upload } from "lucide-react";

import { Button, Input, useToast } from "../../design-system/components";
import {
  type DomainDetailView,
  type DomainFile,
  type DomainFileFilter,
  type DomainFilesList,
  domainFileUrl,
  listDomainFiles,
  rereadDomainFiles,
} from "../../lib/api/domains";
import { navigate } from "../../lib/nav";
import {
  UPLOAD_ACCEPT,
  filesFooter,
  formatNumber,
  listWithout,
  pieceSizeOf,
  rereadingBanner,
  showOptions,
  shownRereading,
} from "./domainFormat";
import { DeleteFileDialog } from "./DeleteFileDialog";
import { DropOverlay } from "./DropOverlay";
import { FilePreviewSheet } from "./FilePreviewSheet";
import { FilesTable } from "./FilesTable";
import { SortSelect } from "./SortSelect";
import { type FileDeletes, readStamp } from "./useFileDeletes";
import { takeFilePickerRequest, useUploads, withUploads } from "./useUploads";

const SEARCH_DELAY_MS = 250;

/** Save a file in the same window (D2): never `window.open`, which Desktop hands to the browser. */
function downloadInPlace(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function SourcesTab({
  detail,
  tick,
  file,
  piece,
  now,
  deletes,
  onChanged,
}: {
  detail: DomainDetailView;
  /** Bumps whenever the domain summary reloads: the table reloads on the same beat. */
  tick: number;
  /** The file whose preview is open (`?file=`). */
  file?: string;
  piece?: number;
  now: Date;
  /** The page's deferred file deletes (OQ-12): their rows hide at once. */
  deletes: FileDeletes;
  /** Something changed the files (upload, re-read): reload the summary. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const domainId = detail.domain_id;
  const [find, setFind] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DomainFileFilter>("all");
  const [loaded, setLoaded] = useState<{ list: DomainFilesList; stamp: number } | null>(null);
  const [deleting, setDeleting] = useState<DomainFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Files dragged over the tab: how many (the overlay's "Drop to add <n> files").
  const [dragging, setDragging] = useState<number | null>(null);
  const uploads = useUploads({ domainId, domainName: detail.name, onUploaded: onChanged });
  const picker = useRef<HTMLInputElement>(null);
  // Files re-read from this page: a toast says when each one is ready again (DM-50).
  const rereading = useRef(new Map<string, string>());

  useEffect(() => {
    if (takeFilePickerRequest()) picker.current?.click();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(find.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [find]);

  useEffect(() => {
    let live = true;
    const stamp = readStamp();
    listDomainFiles(domainId, { q: query, status: filter })
      .then((next) => {
        if (!live) return;
        setLoaded({ list: next, stamp });
        setError(null);
        for (const f of next.documents) {
          if (!rereading.current.has(f.document_id)) continue;
          if (f.phase === "ready") {
            rereading.current.delete(f.document_id);
            toast({
              message: `${f.filename} is ready · ${formatNumber(f.pieces ?? 0)} ${
                f.pieces === 1 ? "piece" : "pieces"
              }`,
            });
          } else if (f.phase === "needs_attention") {
            rereading.current.delete(f.document_id);
          }
        }
      })
      .catch((e: unknown) => {
        if (live)
          setError(e instanceof Error && e.message ? e.message : "Couldn’t load the files.");
      });
    return () => {
      live = false;
    };
  }, [domainId, query, filter, tick, toast]);

  const openPreview = (f: DomainFile) =>
    navigate({ page: "domains", domainId, file: f.document_id }, { replace: true });
  const closePreview = () => navigate({ page: "domains", domainId }, { replace: true });

  const reread = (documentId: string, filename: string) => {
    rereadDomainFiles(domainId, { document_ids: [documentId] })
      .then(() => {
        rereading.current.set(documentId, filename);
        onChanged();
      })
      .catch((e: unknown) =>
        toast({
          message: e instanceof Error && e.message ? e.message : "Couldn’t start reading.",
          tone: "error",
        }),
      );
  };

  const copyId = (f: DomainFile) => {
    const failed = () => toast({ message: "Couldn’t copy the file ID.", tone: "error" });
    if (!navigator.clipboard) return failed();
    navigator.clipboard
      .writeText(f.document_id)
      .then(() => toast({ message: "File ID copied." }))
      .catch(failed);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    const n = Array.from(e.dataTransfer.items ?? []).filter((i) => i.kind === "file").length;
    if (n !== dragging) setDragging(n);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(null);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setDragging(null);
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    void uploads.add(Array.from(e.dataTransfer.files));
  };

  const list = loaded && listWithout(loaded.list, deletes.gone(loaded.stamp));
  const previewed = file ? list?.documents.find((d) => d.document_id === file) : undefined;
  const rows =
    loaded && list
      ? withUploads(list.documents, uploads.uploads, {
          listStamp: loaded.stamp,
          showLocal: !query && filter === "all",
        })
      : null;
  const footer =
    list && rows
      ? filesFooter({
          files: detail.files,
          list,
          shown: list.documents.length,
          query,
          filter,
          firstRead: !detail.setup.files_read,
          local: { uploading: rows.uploading, rejected: rows.rejected },
          rereading: shownRereading(detail),
          pieceSize: pieceSizeOf(detail.config),
        })
      : null;
  const banner = rereadingBanner(detail);

  return (
    <div
      className="dm-src"
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="dm-src__tools">
        <Input
          size="sm"
          style={{ width: 260 }}
          placeholder="Search files"
          aria-label="Search files"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
        <SortSelect
          name="Show"
          className="dm-show"
          value={filter}
          options={showOptions(
            list?.counts ?? { all: 0, ready: 0, reading: 0, needs_attention: 0 },
          )}
          onChange={setFilter}
        />
        <span className="dm-src__spacer" />
        <Button
          variant="primary"
          size="sm"
          className="dm-btn-inline"
          onClick={() => picker.current?.click()}
        >
          <Upload size={15} strokeWidth={1.6} aria-hidden />
          <span>Add files</span>
        </Button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          hidden
          data-testid="add-files-input"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = "";
            void uploads.add(picked);
          }}
        />
      </div>
      {banner && (
        <div className="dm-callout dm-callout--info" role="status">
          <span className="dm-callout__icon">
            <RefreshCw size={14} strokeWidth={1.6} aria-hidden />
          </span>
          <span className="dm-callout__text">{banner}</span>
        </div>
      )}
      <div className="dm-drophint">
        <Upload className="dm-drophint__icon" size={15} strokeWidth={1.6} aria-hidden />
        <span>
          Drop files here, or use <b>Add files</b>. PDF, Markdown, text or HTML, up to 10 MB each.
          New files are read automatically.
        </span>
      </div>
      {error && !list && (
        <div className="dm-error" role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={onChanged}>
            Try again
          </Button>
        </div>
      )}
      {rows && footer && (
        <FilesTable
          files={rows.rows}
          now={now}
          provider={detail.reading_model.provider}
          tinted={deleting?.document_id ?? file}
          fullReread={shownRereading(detail) !== null}
          footer={footer}
          empty={
            query
              ? `No files match “${query}”.`
              : filter === "all"
                ? "No files yet."
                : "No files here."
          }
          onShowAll={() => {
            setFilter("all");
            setFind("");
          }}
          actions={{
            onRemove: (f) => uploads.remove(f.document_id),
            onPreview: openPreview,
            onReread: (f) => reread(f.document_id, f.filename),
            onDownload: (f) => downloadInPlace(domainFileUrl(domainId, f.document_id), f.filename),
            onCopyId: copyId,
            onDelete: setDeleting,
          }}
        />
      )}
      {deleting && (
        <DeleteFileDialog
          domainId={domainId}
          domainName={detail.name}
          file={deleting}
          totalFiles={detail.files.total}
          onClose={() => setDeleting(null)}
          onConfirm={(f) => {
            setDeleting(null);
            deletes.schedule(f);
          }}
        />
      )}
      {dragging !== null && <DropOverlay count={dragging} domainName={detail.name} />}
      {file && (
        <FilePreviewSheet
          key={file}
          domainId={domainId}
          documentId={file}
          piece={piece}
          fallbackName={previewed?.filename ?? ""}
          now={now}
          onClose={closePreview}
          onReread={(id, name) => {
            closePreview();
            reread(id, name);
          }}
        />
      )}
    </div>
  );
}
