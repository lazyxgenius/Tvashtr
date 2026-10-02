import { CircleCheck, CircleX, FileText, Plus, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { VersionDialog } from "../../canvas/VersionDialogs";
import { Button, Select } from "../../design-system/components";
import { addTestsLabel, COLUMN_USES, readyText, unreadable } from "../../lib/agentTestsFormat";
import {
  checkTestFile,
  type ColumnUse,
  type FileCheck,
  importTestFile,
} from "../../lib/api/agentTests";
import { serverWords } from "../../lib/myAgentsFormat";
import { PickTestFile } from "./TestsTab";
import "./tests.css";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * M7 Test-Upload: "Add tests from a file". The server reads the file (a dry run): its columns, the
 * first row of each and a guess at what each column is; every change to "Use it as" checks again
 * (the latest answer wins), and "Add 12 tests" adds them. A file that can't be read says why.
 */
export function UploadTestsDialog({
  teamId,
  nodeId,
  agent,
  file: picked,
  onClose,
  onAdded,
}: {
  teamId: string;
  nodeId: string;
  agent: string;
  file: { filename: string; content: string };
  onClose: () => void;
  onAdded: (added: number) => void;
}) {
  const [file, setFile] = useState(picked);
  const [mapping, setMapping] = useState<Record<string, ColumnUse> | null>(null);
  const [check, setCheck] = useState<FileCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Add's own refusal: said, but Add stays available to try again (#2).
  const [addError, setAddError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setChecking(true);
    checkTestFile(teamId, nodeId, { ...file, ...(mapping ? { mapping } : {}) }).then(
      (res) => {
        if (mine !== seq.current) return;
        setCheck(res);
        setError(null);
        setChecking(false);
      },
      (err: unknown) => {
        if (mine !== seq.current) return;
        setError(serverWords(err, "This file can’t be read. Try another."));
        setChecking(false);
      },
    );
  }, [teamId, nodeId, file, mapping]);

  // Test-UploadError: a file the server couldn't read shows why, and nothing else of it.
  const why = error ? unreadable(error) : null;
  const shown = why ? null : check;
  const columns = shown?.columns ?? [];
  const uses = mapping ?? Object.fromEntries(columns.map((c) => [c.name, c.use]));
  const ready = shown?.ready ?? null;
  const n = ready?.tests ?? 0;
  const [title, line] = ready ? readyText(ready, agent) : ["", ""];
  // The server only refuses this on Add: say it as soon as no column is the task.
  const noTask = columns.length > 0 && !Object.values(uses).includes("gets");

  const add = async () => {
    setBusy(true);
    setAddError(null);
    try {
      const res = await importTestFile(teamId, nodeId, { ...file, mapping: uses });
      onAdded(res.added);
    } catch (err) {
      setAddError(serverWords(err, "Couldn’t add the tests. Try again."));
      setBusy(false);
    }
  };

  return (
    <VersionDialog
      title="Add tests from a file"
      icon={<Upload size={17} strokeWidth={1.6} aria-hidden />}
      sub={`Each row becomes one test for the ${agent}. Tell Tvashtr what each column is.`}
      size="tt-dlg--upload"
      onClose={onClose}
      footNote="Rows with an empty task are skipped"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={n === 0 || checking || error !== null || noTask}
            loading={busy}
            className="tt-flush"
            onClick={() => void add()}
          >
            <Plus size={14} strokeWidth={2} aria-hidden />
            <span>{n > 0 ? addTestsLabel(n) : "Add tests"}</span>
          </Button>
        </>
      }
    >
      <div className="tt-file">
        <span className="tt-file__icon" aria-hidden>
          <FileText size={18} strokeWidth={1.6} />
        </span>
        <div className="tt-file__text">
          <div className="tt-file__name">{file.filename}</div>
          {why ? (
            <div className="tt-file__meta tt-bad">Couldn’t read it</div>
          ) : (
            shown && (
              <div className="tt-file__meta">
                {plural(shown.rows, "row")} · {plural(columns.length, "column")}
              </div>
            )
          )}
        </div>
        <PickTestFile
          onPick={(f) =>
            void f.text().then((content) => {
              setMapping(null);
              setCheck(null);
              setFile({ filename: f.name, content });
            })
          }
        >
          {(open) => (
            <button type="button" className="tt-link" onClick={open}>
              Choose another
            </button>
          )}
        </PickTestFile>
      </div>
      {columns.length > 0 && (
        <div className="tt-section">
          <div className="tt-map__head" aria-hidden>
            <span className="tt-eyebrow">Column</span>
            <span className="tt-eyebrow">First row</span>
            <span className="tt-eyebrow">Use it as</span>
          </div>
          <ul className="tt-map" aria-label="Columns">
            {columns.map((c) => (
              <li key={c.name}>
                <span className="tt-map__col">{c.name}</span>
                <span className="tt-map__first" title={c.first}>
                  {c.first}
                </span>
                <Select
                  aria-label={`Use ${c.name} as`}
                  options={COLUMN_USES}
                  value={uses[c.name] ?? c.use}
                  onChange={(e) => setMapping({ ...uses, [c.name]: e.target.value as ColumnUse })}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {why && (
        <div className="lv-confirm__skips tt-callout tt-callout--bad" role="alert">
          <span className="lv-confirm__mark" aria-hidden>
            <CircleX size={18} strokeWidth={1.6} />
          </span>
          <div className="lv-confirm__skips-text">
            <div className="lv-confirm__skips-title">This file can’t be read</div>
            <div className="lv-confirm__skips-sub">{why}</div>
          </div>
        </div>
      )}
      {noTask && !error && (
        <div className="lv-confirm__error" role="alert">
          Pick a column for What the agent gets.
        </div>
      )}
      {ready && n > 0 && !error && !noTask && (
        <div className="lv-confirm__skips tt-callout" role="status">
          <span className="lv-confirm__mark" aria-hidden>
            <CircleCheck size={18} strokeWidth={1.6} />
          </span>
          <div className="lv-confirm__skips-text">
            <div className="lv-confirm__skips-title">{title}</div>
            {line && <div className="lv-confirm__skips-sub">{line}</div>}
          </div>
        </div>
      )}
      {(error && !why) || addError ? (
        <div className="lv-confirm__error" role="alert">
          {addError ?? error}
        </div>
      ) : null}
    </VersionDialog>
  );
}
