/** The Tests tab: the version line, the choices, the table with its Last run chips, the first 25
 *  tests, and the banner over an older version, which is read-only. */
import { useEffect, useState } from "react";
import { Check, Clock, X } from "lucide-react";

import { Button, ConfirmDialog, Menu, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type ModelDetail,
  type ModelTest,
  type ModelTests,
  type Verdict,
  deleteTest,
  listTests,
} from "../../lib/api/models";
import { SCORING_LABEL, ago, shortModel } from "./modelsFormat";

const FIRST_ROWS = 25;

export function VerdictChip({ verdict, title }: { verdict: Verdict; title?: string }) {
  const pass = verdict === "pass";
  return (
    <span className={pass ? "md-mk md-mk--ok" : "md-mk md-mk--no"} title={title}>
      {pass ? (
        <Check size={12} strokeWidth={1.7} aria-hidden />
      ) : (
        <X size={12} strokeWidth={1.7} aria-hidden />
      )}
      {pass ? "Pass" : "Fail"}
    </span>
  );
}

export function TestsTab({
  model,
  tick,
  viewing,
  selected,
  docked,
  onOpen,
  onImport,
  onHistory,
  onBack,
  onRestore,
  onChanged,
}: {
  model: ModelDetail;
  tick: number;
  /** An older version shown read-only, else `null` (the current one). */
  viewing: number | null;
  /** The drawer's test (`"new"`: a new one), else `null`. */
  selected: string | null;
  docked: boolean;
  onOpen: (test: ModelTest | null) => void;
  onImport: () => void;
  onHistory: () => void;
  onBack: () => void;
  onRestore: (version: number) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<ModelTests | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const [deleting, setDeleting] = useState<ModelTest | null>(null);
  const [busy, setBusy] = useState(false);
  const id = model.model_id;

  useEffect(() => {
    let live = true;
    listTests(id, viewing ?? undefined)
      .then((d) => {
        if (!live) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, viewing, tick]);

  if (!data) {
    return failed ? (
      <div className="md-alert" role="alert">
        <span>Couldn’t reach Tvashtr — is the backend running?</span>
      </div>
    ) : null;
  }

  const current = model.current_version;
  const readOnly = viewing !== null;
  const isChoice = model.answer_kind === "choice";
  const tests = data.tests;
  const shown = all ? tests : tests.slice(0, FIRST_ROWS);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteTest(id, deleting.case_key);
      setDeleting(null);
      onChanged();
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : "Couldn’t delete the test.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const banner = readOnly && (
    <div className="md-banner" role="status">
      <span>You’re looking at test set v{viewing}. It can’t be changed.</span>
      <span className="md-banner__actions">
        <Button variant="secondary" size="sm" onClick={onBack}>
          Back to v{current}
        </Button>
        <Button variant="primary" size="sm" onClick={() => onRestore(viewing)}>
          Restore as v{current + 1}
        </Button>
      </span>
    </div>
  );

  if (tests.length === 0 && !readOnly) {
    return (
      <>
        {current > 0 && (
          <div className="md-line">
            <VersionBits data={data} onHistory={onHistory} />
          </div>
        )}
        <section className="md-card md-empty">
          <h2 className="md-empty__title">No tests yet</h2>
          <p className="md-empty__text">
            Add a test by hand, or import a CSV with the columns input and expected.
          </p>
          <div className="md-empty__actions">
            <Button variant="primary" size="sm" onClick={() => onOpen(null)}>
              Add test
            </Button>
            <Button variant="secondary" size="sm" onClick={onImport}>
              Import CSV
            </Button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {banner}
      {!docked && (
        <div className="md-line">
          <VersionBits data={data} onHistory={onHistory} />
          {isChoice && (
            <div className="md-line__choices">
              <span>Answers are one of:</span>
              {model.choices.map((c) => (
                <span key={c} className="md-ans">
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <section
        className={docked ? "md-tbl md-tbl--narrow md-tests" : "md-tbl md-tests"}
        aria-label="Tests"
      >
        <table>
          <thead>
            <tr>
              <th scope="col" className="md-tests__n">
                #
              </th>
              <th scope="col">Input</th>
              <th scope="col" className={docked ? "md-tests__expected-wide" : "md-tests__expected"}>
                Expected answer
              </th>
              <th scope="col" className="md-tests__by">
                Scored by
              </th>
              {!docked && (
                <th scope="col" className="md-tests__last">
                  Last run
                  {data.last_runs.length > 0 && (
                    <span className="md-tests__last-names">
                      {" · "}
                      {data.last_runs.map((r, i) => (
                        <span key={r.run_id}>
                          {i > 0 && " / "}
                          <span className="md-mono md-mono--xs">{shortModel(r.model_slug)}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </th>
              )}
              {!docked && !readOnly && (
                <th scope="col" className="md-tests__menu">
                  <span className="md-sr">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr
                key={t.case_id}
                className={selected === t.case_key ? "md-row md-row--on" : "md-row"}
                onClick={
                  readOnly
                    ? undefined
                    : (e) => {
                        if (!(e.target as HTMLElement).closest(".md-row__menu")) onOpen(t);
                      }
                }
              >
                <td className="md-num">{t.position}</td>
                <td>
                  <span className="md-clamp">{t.input}</span>
                </td>
                <td>
                  {isChoice ? (
                    <span className="md-ans">{t.expected}</span>
                  ) : (
                    <span className="md-clamp md-tests__text">{t.expected}</span>
                  )}
                </td>
                <td className="md-tests__by-cell">{SCORING_LABEL[t.scoring]}</td>
                {!docked && (
                  <td>
                    <div className="md-tests__chips">
                      {t.last_run.some(Boolean) ? (
                        t.last_run.map((v, i) =>
                          v ? (
                            <VerdictChip key={i} verdict={v.verdict} />
                          ) : (
                            <span key={i} className="md-none">
                              —
                            </span>
                          ),
                        )
                      ) : (
                        <span className="md-none">—</span>
                      )}
                    </div>
                  </td>
                )}
                {!docked && !readOnly && (
                  <td>
                    <div className="md-row__menu">
                      <Menu
                        label={`More actions for test ${t.position}`}
                        items={[
                          { key: "edit", label: "Edit", onSelect: () => onOpen(t) },
                          {
                            key: "delete",
                            label: "Delete",
                            danger: true,
                            onSelect: () => setDeleting(t),
                          },
                        ]}
                      />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {!all && tests.length > FIRST_ROWS && (
        <div className="md-more">
          <span>
            Showing {FIRST_ROWS} of {tests.length} tests
          </span>
          <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
            Show all {tests.length}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete test ${deleting?.position}?`}
        confirmLabel="Delete test"
        tone="danger"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      >
        This makes test set v{current + 1} without it. Earlier results stay tied to v{current}.
      </ConfirmDialog>
    </>
  );
}

function VersionBits({ data, onHistory }: { data: ModelTests; onHistory: () => void }) {
  return (
    <div className="md-line__version">
      <span className="md-chip">Test set v{data.version}</span>
      {data.created_at && (
        <span className="md-line__edited">Edited {ago(data.created_at)} by you</span>
      )}
      <button type="button" className="md-link md-link--icon" onClick={onHistory}>
        <Clock size={14} strokeWidth={1.7} aria-hidden />
        History
      </button>
    </div>
  );
}
