import { Copy, Download, FileCode, Lock, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button, IconButton, useToast } from "../design-system/components";
import { getTeamFile, type TeamFileFormat } from "../lib/api/teams";
import { isTopOverlay, pushOverlay, removeOverlay } from "../lib/overlayStack";
import { LoadState } from "../panel/runs/RunsTab";
import { useLoaded } from "../panel/runs/useLoaded";

const FORMATS: [TeamFileFormat, string][] = [
  ["yaml", "YAML"],
  ["json", "JSON"],
];

/** "GITHUB_TOKEN", "A and B", "A, B and C". */
const listWords = (names: string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** The no-secrets note: the secrets the file names (never their values). */
function secretsLine(names: string[]): string {
  const held =
    names.length === 0
      ? "The file never holds a secret value."
      : `The file names ${listWords(names)} but never holds ${names.length === 1 ? "its value" : "their values"}.`;
  return `${held} Whoever imports it signs in with their own account.`;
}

/** One line, its keys and comments tinted as the board draws them (display only, no parsing). */
function tint(line: string, format: TeamFileFormat): ReactNode {
  if (format === "yaml" && /^\s*#/.test(line))
    return <span className="cv-file__comment">{line}</span>;
  const m =
    format === "yaml"
      ? /^(\s*(?:- )?)([\w-]+)(:.*)$/.exec(line)
      : /^(\s*)("[^"]*")(:.*)$/.exec(line);
  if (!m) return line;
  // ponytail: a trailing comment is two spaces then `#` (how the server writes them).
  const c = format === "yaml" ? /^(.*?\s{2,})(#.*)$/.exec(m[3]) : null;
  const [rest, comment] = c ? [c[1], c[2]] : [m[3], ""];
  return (
    <>
      {m[1]}
      <span className="cv-file__key">{m[2]}</span>
      {rest}
      {comment && <span className="cv-file__comment">{comment}</span>}
    </>
  );
}

/** Save a file in the same window: never `window.open`, which Desktop hands to the browser. */
function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * M4 — the canvas header's Team file panel (File-Panel): the whole team as one read-only file,
 * YAML or JSON as the server renders it, with Copy and Download. Never secret values or sign-ins.
 */
export function TeamFilePanel({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const [format, setFormat] = useState<TeamFileFormat>("yaml");
  const file = useLoaded(`${teamId}:${format}`, () => getTeamFile(teamId, format), { keep: true });
  const toast = useToast();
  const close = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Opening it takes focus (on Close), closing gives it back; Escape closes it unless something on
  // top of it owns the keyboard.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const token = pushOverlay();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopOverlay(token)) {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      removeOverlay(token);
      if (before?.isConnected) before.focus();
    };
  }, []);

  const f = file.value;
  const copy = () => {
    if (!f) return;
    const failed = () => toast({ message: "Couldn’t copy to the clipboard.", tone: "error" });
    if (!navigator.clipboard) return failed();
    navigator.clipboard
      .writeText(f.content)
      .then(() => toast({ message: `Copied ${f.filename}` }), failed);
  };

  return (
    <aside className="cv-file" aria-label="Team file">
      <header className="cv-file__head">
        <span className="cv-file__icon">
          <FileCode size={16} strokeWidth={1.6} aria-hidden />
        </span>
        <div className="cv-file__titles">
          <div className="cv-file__title">Team file</div>
          <div className="cv-file__sub">
            The whole team in one file: agents, models, gates and routes. Keep it in your repo,
            share it, or import it as a new team.
          </div>
        </div>
        <IconButton ref={close} size="sm" aria-label="Close" title="Close" onClick={onClose}>
          <X size={16} strokeWidth={1.6} aria-hidden />
        </IconButton>
      </header>
      <div className="cv-file__body">
        <div className="cv-file__row">
          <span className="cv-file__name">
            <FileCode size={14} strokeWidth={1.6} aria-hidden />
            {f?.filename ?? ""}
          </span>
          <div className="tv-seg cv-file__seg" role="group" aria-label="Format">
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
        {f ? (
          <>
            <div className="cv-file__code">
              <div className="cv-file__scroll" tabIndex={0} aria-label={`${f.filename}, read-only`}>
                {f.content.split("\n").map((line, i) => (
                  <div key={i} className="cv-file__line">
                    <span className="cv-file__n">{i + 1}</span>
                    <span className="cv-file__text">{tint(line, f.format)}</span>
                  </div>
                ))}
              </div>
              <div className="cv-file__fade" aria-hidden />
              <span className="cv-file__lines">{f.lines} lines</span>
            </div>
            <div className="cv-file__note">
              <span className="cv-file__lock">
                <Lock size={18} strokeWidth={1.6} aria-hidden />
              </span>
              <div className="cv-file__note-text">
                <div className="cv-file__note-title">No secrets or sign-ins inside</div>
                <div className="cv-file__note-body">{secretsLine(f.needs?.secrets ?? [])}</div>
              </div>
            </div>
          </>
        ) : (
          <LoadState
            state={file.state === "error" ? "error" : "loading"}
            loading="Loading the team file"
            error="Couldn’t load the team file."
            onRetry={file.retry}
          />
        )}
      </div>
      <footer className="cv-file__foot">
        <span className="cv-file__foot-note">Read-only · matches the canvas</span>
        <div className="cv-file__actions">
          <Button
            variant="secondary"
            size="sm"
            className="cv-btn-flush"
            disabled={!f}
            onClick={copy}
          >
            <Copy size={14} strokeWidth={1.6} aria-hidden />
            <span>Copy</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="cv-btn-flush"
            disabled={!f}
            onClick={() => f && downloadText(f.content, f.filename)}
          >
            <Download size={14} strokeWidth={2} aria-hidden />
            <span>Download</span>
          </Button>
        </div>
      </footer>
    </aside>
  );
}
