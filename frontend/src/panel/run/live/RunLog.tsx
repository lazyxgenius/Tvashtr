import "./live.css";

import { Download, MoreHorizontal, Scroll, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { Button, IconButton, Menu } from "../../../design-system/components";
import { getRunLog, type LogFormat } from "../../../lib/api/startFrom";
import { downloadText } from "../../../lib/download";
import { useModalDialog } from "../../../lib/useModalDialog";
import { LoadState } from "../../runs/RunsTab";
import { useLoaded } from "../../runs/useLoaded";

const FORMATS: [LogFormat, string][] = [
  ["text", "Readable text"],
  ["jsonl", "JSON lines"],
];

/** The log's first lines, "…", then its last (Next-Log). */
function preview(text: string): string {
  const lines = text.replace(/\n$/, "").split("\n");
  return (lines.length > 9 ? [...lines.slice(0, 8), "…", lines[lines.length - 1]] : lines).join(
    "\n",
  );
}

/** "About 180 KB" — the size of the file the person saves. */
function about(text: string): string {
  const bytes = new Blob([text]).size;
  return bytes < 1024 * 1024
    ? `About ${Math.max(1, Math.round(bytes / 1024))} KB`
    : `About ${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * M10 — the run bar's ⋯ "More for this run" (Next-More) and its one item, Download the run log
 * (Next-Log): readable text or JSON lines, every step in order, secrets shown as ••••.
 */
export function RunMore({
  runId,
  number,
  steps,
}: {
  runId: string;
  /** "run #12": names the saved file (run-12.txt). */
  number: number | null;
  /** The Activity's step count ("31 steps"); null while it loads. */
  steps: number | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Menu
        label="More for this run"
        width={232}
        trigger={(props) => (
          <IconButton size="sm" aria-label="More for this run" title="More for this run" {...props}>
            <MoreHorizontal size={16} strokeWidth={1.6} aria-hidden />
          </IconButton>
        )}
        items={[
          {
            key: "log",
            label: "Download the run log",
            icon: <Download size={15} strokeWidth={1.6} aria-hidden />,
            onSelect: () => setOpen(true),
          },
        ]}
      />
      {open && (
        <RunLogDialog
          runId={runId}
          filename={`run-${number ?? runId}`}
          steps={steps}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RunLogDialog({
  runId,
  filename,
  steps,
  onClose,
}: {
  runId: string;
  filename: string;
  steps: number | null;
  onClose: () => void;
}) {
  const ref = useModalDialog<HTMLDivElement>(true, onClose);
  const [format, setFormat] = useState<LogFormat>("text");
  const log = useLoaded(`${runId}:${format}`, () => getRunLog(runId, format));
  const text = log.state === "ready" ? log.value : null;
  const facts = [
    text !== null ? about(text) : null,
    steps !== null ? `${steps} ${steps === 1 ? "step" : "steps"}` : null,
  ].filter(Boolean);
  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Download the run log"
        className="lv-confirm"
        tabIndex={-1}
      >
        <header className="lv-confirm__head">
          <span className="lv-confirm__icon">
            <Scroll size={17} strokeWidth={1.6} aria-hidden />
          </span>
          <div className="lv-confirm__titles">
            <h2 className="lv-confirm__title">Download the run log</h2>
            <div className="lv-confirm__sub">
              Every step, its output and its errors, in order. Secrets are replaced with ••••.
            </div>
          </div>
          <IconButton size="sm" aria-label="Close" title="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.6} aria-hidden />
          </IconButton>
        </header>
        <div className="lv-confirm__body">
          <div className="lv-log__format">
            <span className="lv-confirm__eyebrow">Format</span>
            <div className="tv-seg lv-seg" role="group" aria-label="Format">
              {FORMATS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`tv-seg__btn${format === value ? " tv-seg__btn--active" : ""}`}
                  aria-pressed={format === value}
                  onClick={() => setFormat(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {text !== null ? (
            <pre className="lv-log__preview" aria-label="Preview">
              {preview(text)}
            </pre>
          ) : (
            <LoadState
              state={log.state === "error" ? "error" : "loading"}
              loading="Loading the run log"
              error="Couldn’t load the run log."
              onRetry={log.retry}
            />
          )}
          <div className="lv-log__note">
            The log is a record for sharing or keeping. It can’t be loaded back into Tvashtr; to
            build on this run, use Start the next run from this.
          </div>
        </div>
        <footer className="lv-confirm__foot">
          <div className="lv-confirm__foot-note">{facts.join(" · ")}</div>
          <div className="lv-confirm__actions">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="cv-btn-flush"
              disabled={text === null}
              onClick={() =>
                text !== null &&
                downloadText(text, `${filename}.${format === "text" ? "txt" : "jsonl"}`)
              }
            >
              <Download size={14} strokeWidth={2} aria-hidden />
              <span>Download</span>
            </Button>
          </div>
        </footer>
      </div>
    </>,
    document.body,
  );
}
