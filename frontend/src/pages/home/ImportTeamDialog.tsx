import { CircleAlert, CircleCheck, FileCode, TriangleAlert, Upload, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CodeText } from "../../components/CodeText";
import { Button, IconButton, Input } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  checkTeamImport,
  type ImportCheck,
  importTeam,
  TeamFileRefused,
} from "../../lib/api/teams";
import { navigate } from "../../lib/nav";
import { rememberImport, TEAM_FILE_ACCEPT } from "../../lib/teamImport";
import { useModalDialog } from "../../lib/useModalDialog";
import { refreshBadges } from "../../lib/workspaceStatus";
import { useHome } from "./homeContext";
import "./teams.css";

const BLANK_NAME = "Give this team a name so you can tell it apart.";
const CHECK_FAILED = "Couldn’t check the file — is the backend running?";
const IMPORT_FAILED = "Couldn’t import the team — is the backend running?";

const fixesLine = (n: number) =>
  n === 0
    ? "Nothing to fix after importing"
    : `${n} ${n === 1 ? "thing" : "things"} to fix after importing`;

function ImportBody({ file, onClose }: { file: File; onClose: () => void }) {
  const { reloadTeams } = useHome();
  const [picked, setPicked] = useState<{ name: string; content: string } | null>(null);
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const ref = useModalDialog<HTMLDivElement>(true, () => {
    if (!busy) onClose();
  });

  // Read the file and check it (a dry run: nothing changes). A newer pick wins.
  const load = useCallback(async (f: File) => {
    const mine = ++seq.current;
    setCheck(null);
    setCheckFailed(false);
    setImportError(null);
    setNameError(null);
    try {
      const content = await f.text();
      if (mine !== seq.current) return;
      setPicked({ name: f.name, content });
      const result = await checkTeamImport(content, f.name);
      if (mine !== seq.current) return;
      setCheck(result);
      setName(result.name);
    } catch {
      if (mine === seq.current) setCheckFailed(true);
    }
  }, []);

  useEffect(() => {
    void load(file);
  }, [file, load]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !check?.ok || !picked) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(BLANK_NAME);
      return;
    }
    setBusy(true);
    setImportError(null);
    try {
      const team = await importTeam(picked.content, trimmed);
      rememberImport(team);
      void reloadTeams();
      void refreshBadges();
      onClose();
      navigate({ page: "team", teamId: team.team_graph_id });
    } catch (err) {
      setBusy(false);
      // The file can't be imported after all: the dialog shows why, as the check does.
      if (err instanceof TeamFileRefused) setCheck({ ...check, ok: false, error: err.error });
      else
        setImportError(err instanceof ApiError && err.status === 422 ? err.message : IMPORT_FAILED);
    }
  };

  const lines = check?.lines ?? picked?.content.split("\n").length ?? 0;
  const error = check && !check.ok ? check.error : null;
  return (
    <>
      <div className="ds-scrim" onClick={() => !busy && onClose()} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Import a team file"
        className="hm-import"
        tabIndex={-1}
      >
        <form onSubmit={(e) => void submit(e)} noValidate>
          <header className="hm-import__head">
            <span className="hm-import__icon">
              <Upload size={17} strokeWidth={1.6} aria-hidden />
            </span>
            <div className="hm-import__titles">
              <h2 className="hm-import__title">Import a team file</h2>
              <div className="hm-import__sub">
                Tvashtr checks the file first. Nothing changes until you choose Import.
              </div>
            </div>
            <IconButton
              size="sm"
              aria-label="Close"
              title="Close"
              onClick={onClose}
              disabled={busy}
            >
              <X size={16} strokeWidth={1.6} aria-hidden />
            </IconButton>
          </header>
          <div className="hm-import__body">
            <div className="hm-import__file">
              <span className="hm-import__file-icon">
                <FileCode size={18} strokeWidth={1.6} aria-hidden />
              </span>
              <div className="hm-import__file-text">
                <div className="hm-import__file-name">{picked?.name ?? file.name}</div>
                <div className={`hm-import__file-sub${error ? " hm-import__file-sub--bad" : ""}`}>
                  {!check && !checkFailed
                    ? "Checking…"
                    : error
                      ? `Can’t be read · ${lines} lines`
                      : `${lines} lines`}
                </div>
              </div>
              <button
                type="button"
                className="hm-import__another"
                disabled={busy}
                onClick={() => picker.current?.click()}
              >
                Choose another
              </button>
              <input
                ref={picker}
                type="file"
                accept={TEAM_FILE_ACCEPT}
                hidden
                data-testid="import-another-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void load(f);
                }}
              />
            </div>
            {check?.ok && (
              <>
                <Input
                  label="Team name"
                  value={name}
                  error={nameError ?? undefined}
                  disabled={busy}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                />
                <div className="hm-import__checks">
                  <span className="hm-import__eyebrow" id="hm-import-checked">
                    What we checked
                  </span>
                  <ul className="hm-import__list" aria-labelledby="hm-import-checked">
                    {check.checks.map((c) => (
                      <li key={c.key} className="hm-import__check">
                        <span className={`hm-import__mark hm-import__mark--${c.tone}`}>
                          {c.tone === "ok" ? (
                            <CircleCheck size={16} strokeWidth={1.6} aria-label="OK" />
                          ) : (
                            <TriangleAlert size={16} strokeWidth={1.6} aria-label="To fix" />
                          )}
                        </span>
                        <div className="hm-import__check-text">
                          <span className="hm-import__check-title">
                            <CodeText text={c.title} code={c.code} />
                          </span>
                          <span className="hm-import__check-detail">
                            <CodeText text={c.detail} code={c.code} />
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
            {error && (
              <div className="hm-import__error" role="alert">
                <span className="hm-import__error-icon">
                  <TriangleAlert size={16} strokeWidth={1.8} aria-hidden />
                </span>
                <div className="hm-import__error-text">
                  <span className="hm-import__error-title">This file can’t be imported</span>
                  <span className="hm-import__error-line">
                    {error.line != null && `Line ${error.line}: `}
                    <CodeText text={error.message} />
                  </span>
                  <span className="hm-import__error-next">
                    Nothing was changed. Fix the file, or choose another.
                  </span>
                </div>
              </div>
            )}
            {(checkFailed || importError) && (
              <div className="hm-newteam__alert hm-import__alert" role="alert">
                <CircleAlert size={14} strokeWidth={1.6} aria-hidden />
                {importError ?? CHECK_FAILED}
              </div>
            )}
          </div>
          <footer className="hm-import__foot">
            <div className="hm-import__foot-note">
              {check?.ok ? fixesLine(check.fixes) : check ? "Nothing changed" : ""}
            </div>
            <div className="hm-import__actions">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="hm-btn-inline"
                disabled={!check?.ok}
                loading={busy}
              >
                <Upload size={14} strokeWidth={2} aria-hidden />
                <span>Import as a new team</span>
              </Button>
            </div>
          </footer>
        </form>
      </div>
    </>
  );
}

/**
 * M4 — Import a team file (File-Check / File-CheckError): the picked file is checked first (counts,
 * models, connectors, tools and skills, secrets named), nothing changes until Import, which creates a
 * NEW team and opens it with what is left to fix. A file that can't be read says which line.
 */
export function ImportTeamDialog({ file, onClose }: { file: File | null; onClose: () => void }) {
  if (!file) return null;
  return createPortal(<ImportBody file={file} onClose={onClose} />, document.body);
}
