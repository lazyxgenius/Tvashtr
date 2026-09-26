/**
 * The Sources table (DM-41, DM-42, DM-44, DM-45, DM-49): kind tile + name (opens the preview),
 * size, pieces, the status cell with its progress bar or humanised problem, the date added and
 * the row's ⋯ menu; the footer line under it.
 */
import { CircleCheck, Clock, TriangleAlert } from "lucide-react";

import { Menu, type MenuEntry } from "../../design-system/components";
import type { DomainFile } from "../../lib/api/domains";
import { navigate } from "../../lib/nav";
import { formatAdded, formatNumber, formatSize } from "./domainFormat";

const STATUS_ICON = { size: 14, strokeWidth: 1.6, "aria-hidden": true } as const;

function EnginesKeyLink({ children }: { children: string }) {
  return (
    <a
      className="dm-status__fix"
      href="#/engines/keys"
      onClick={(e) => {
        e.preventDefault();
        navigate({ page: "engines", tab: "keys" });
      }}
    >
      {children}
    </a>
  );
}

export function StatusCell({ file, provider }: { file: DomainFile; provider: string }) {
  switch (file.phase) {
    case "ready":
      return (
        <span className="dm-status dm-status--ready">
          <CircleCheck {...STATUS_ICON} />
          Ready
        </span>
      );
    case "reading":
    case "rereading": {
      const pct = Math.round((file.progress ?? 0) * 100);
      return (
        <span className="dm-status dm-status--progress">
          <span
            className="dm-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={`Reading ${file.filename}`}
          >
            <span className="dm-bar__fill" style={{ width: `${pct}%` }} />
          </span>
          {file.phase === "rereading" ? "Re-reading" : "Reading"} {pct}%
        </span>
      );
    }
    case "waiting":
      return (
        <span className="dm-status dm-status--waiting">
          <Clock {...STATUS_ICON} />
          Waiting to read
        </span>
      );
    case "waiting_for_key":
      return (
        <span className="dm-status dm-status--waiting">
          <Clock {...STATUS_ICON} />
          Waiting for {/^[aeiou]/i.test(provider) ? "an" : "a"} {provider} key{" "}
          <EnginesKeyLink>Add key</EnginesKeyLink>
        </span>
      );
    default:
      return (
        <span className="dm-status__attention">
          <span className="dm-status dm-status--attention">
            <TriangleAlert {...STATUS_ICON} />
            Needs attention
          </span>
          {file.problem && (
            <span className="dm-status__reason">
              {file.problem.message}
              {file.problem.fix === "engines_key" && (
                <>
                  {" "}
                  <EnginesKeyLink>Fix key in Engines</EnginesKeyLink>
                </>
              )}
            </span>
          )}
        </span>
      );
  }
}

export interface FileActions {
  onPreview: (file: DomainFile) => void;
  onReread: (file: DomainFile) => void;
  onDownload: (file: DomainFile) => void;
  onCopyId: (file: DomainFile) => void;
}

export function FilesTable({
  files,
  now,
  provider,
  tinted,
  footer,
  empty,
  onShowAll,
  actions,
}: {
  files: DomainFile[];
  now: Date;
  provider: string;
  /** The file whose preview is open (its row is tinted behind the sheet). */
  tinted?: string;
  footer: { text: string; showAll: boolean };
  /** The one row shown when no file is listed. */
  empty: string;
  onShowAll: () => void;
  actions: FileActions;
}) {
  return (
    <section className="dm-files" aria-label="Files">
      <table className="dm-files__table">
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col" className="dm-files__size">
              Size
            </th>
            <th scope="col" className="dm-files__pieces">
              Pieces
            </th>
            <th scope="col" className="dm-files__status">
              Status
            </th>
            <th scope="col" className="dm-files__added">
              Added
            </th>
            <th scope="col" className="dm-files__more">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {files.length === 0 && (
            <tr>
              <td colSpan={6} className="dm-files__empty">
                {empty}
              </td>
            </tr>
          )}
          {files.map((f) => {
            const items: MenuEntry[] = [
              { key: "preview", label: "Preview pieces", onSelect: () => actions.onPreview(f) },
              { key: "reread", label: "Re-read this file", onSelect: () => actions.onReread(f) },
              {
                key: "download",
                label: "Download original",
                onSelect: () => actions.onDownload(f),
              },
              { key: "copy", label: "Copy file ID", onSelect: () => actions.onCopyId(f) },
            ];
            const tint =
              f.document_id === tinted || f.phase === "rereading" || f.phase === "needs_attention";
            return (
              <tr key={f.document_id} className={tint ? "dm-files__row--tint" : undefined}>
                <td>
                  <div className="dm-files__name">
                    <span className="dm-kind">{f.kind}</span>
                    <button
                      type="button"
                      className="dm-files__open"
                      onClick={() => actions.onPreview(f)}
                    >
                      {f.filename}
                    </button>
                  </div>
                </td>
                <td>{formatSize(f.byte_size)}</td>
                <td>{f.pieces === null ? "—" : formatNumber(f.pieces)}</td>
                <td>
                  <StatusCell file={f} provider={provider} />
                </td>
                <td>{formatAdded(f.created_at, now)}</td>
                <td>
                  <div className="dm-files__menu">
                    <Menu label={`More actions for ${f.filename}`} items={items} width={220} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="dm-files__foot">
        {footer.text}
        {footer.showAll && (
          <button type="button" className="dm-files__showall" onClick={onShowAll}>
            Show all files
          </button>
        )}
      </div>
    </section>
  );
}
