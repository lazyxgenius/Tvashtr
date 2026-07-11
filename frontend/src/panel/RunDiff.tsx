import { type ReactNode, useEffect, useState } from "react";

import { getRunDiff, type RunDiffFile } from "../lib/api";

type LoadState = "idle" | "loading" | "ready" | "error";

// A file's unified-diff hunk, line-by-line: added lines sage-green, removed lines brick-red, hunk
// headers muted — the trust surface a reviewer reads before accepting a change. Kept dumb (a string
// -> colored <pre>) so it renders identically for a brownfield patch and a greenfield add-all diff.
function DiffPatch({ patch }: { patch: string }) {
  const lines = patch.replace(/\n+$/, "").split("\n");
  return (
    <pre className="tv-diff__patch" aria-label="File patch">
      {lines.map((line, i) => {
        let cls = "";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = " tv-diff__ln--add";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = " tv-diff__ln--del";
        else if (line.startsWith("@@")) cls = " tv-diff__ln--hunk";
        return (
          <span className={`tv-diff__ln${cls}`} key={i}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

/**
 * The run-view "Changes" tab (M-changes): the files a run changed on its ship branch, each an
 * expandable per-file diff. Read-only and owner-scoped server-side (like every run read); a one-shot
 * fetch by `runId` (a diff is a terminal artifact — no polling). Mirrors EventFeed's fetch shell +
 * ContextManifest's row rendering; the existing panels are untouched.
 */
export function RunDiff({ runId }: { runId: string | null }) {
  const [files, setFiles] = useState<RunDiffFile[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!runId) {
      setFiles([]);
      setState("idle");
      return;
    }
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await getRunDiff(runId);
        if (cancelled) return;
        setFiles(res.files);
        setState("ready");
      } catch {
        if (!cancelled) setState((s) => (s === "ready" ? s : "error"));
      }
    };
    setState((s) => (s === "ready" ? s : "loading"));
    void fetchOnce();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  let body: ReactNode;
  if (state === "error") {
    body = <p className="tv-panel-note">Couldn't load the changes.</p>;
  } else if (state === "idle" || state === "loading") {
    body = <p className="tv-panel-note">Loading changes…</p>;
  } else if (files.length === 0) {
    body = <p className="tv-panel-note">No file changes — this run didn't modify any files.</p>;
  } else {
    body = (
      <div className="tv-diff">
        {files.map((f) => {
          const isOpen = open.has(f.path);
          return (
            <div className="tv-diff__file" key={f.path}>
              <button
                type="button"
                className="tv-diff__row"
                aria-expanded={isOpen}
                onClick={() => toggle(f.path)}
              >
                <span className={`tv-diff__status tv-diff__status--${f.status}`}>{f.status}</span>
                <span className="tv-diff__path">{f.path}</span>
                <span className="tv-diff__counts">
                  {f.additions > 0 && <span className="tv-diff__add">+{f.additions}</span>}
                  {f.deletions > 0 && <span className="tv-diff__del">-{f.deletions}</span>}
                </span>
              </button>
              {isOpen &&
                (f.patch ? (
                  <DiffPatch patch={f.patch} />
                ) : (
                  <p className="tv-panel-note">No patch preview for this file.</p>
                ))}
            </div>
          );
        })}
      </div>
    );
  }

  return <div className="tv-scroll">{body}</div>;
}
