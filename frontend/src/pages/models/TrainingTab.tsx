/** The Training examples tab (M2, prompts/m2-design/Training.dc.html): the version chip and History,
 *  the note (tests are kept apart), the table (# · Input · Answer · Source · Added by), the first 25
 *  examples, and the banner over an older version. Empty: "No training examples yet". */
import { useEffect, useState } from "react";
import { Clock, Info, MoreHorizontal } from "lucide-react";

import { Button, ConfirmDialog, Menu, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type ModelDetail,
  type TrainingExample,
  type TrainingSet,
  deleteExample,
  listTraining,
} from "../../lib/api/models";
import { plural, versionLine } from "./modelsFormat";
import { SourceCell } from "./TestsTab";

const FIRST_ROWS = 25;

export function TrainingTab({
  model,
  tick,
  viewing,
  selected,
  docked,
  onOpen,
  onDraft,
  onHistory,
  onBack,
  onRestore,
  onChanged,
}: {
  model: ModelDetail;
  tick: number;
  viewing: number | null;
  selected: string | null;
  docked: boolean;
  onOpen: (example: TrainingExample | null) => void;
  onDraft: () => void;
  onHistory: () => void;
  onBack: () => void;
  onRestore: (version: number) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<TrainingSet | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const [deleting, setDeleting] = useState<TrainingExample | null>(null);
  const [busy, setBusy] = useState(false);
  const id = model.model_id;

  useEffect(() => {
    let live = true;
    listTraining(id, viewing ?? undefined)
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

  const current = model.training_version ?? 0;
  const readOnly = viewing !== null;
  const isChoice = model.answer_kind === "choice";
  const examples = data.examples;
  const shown = all ? examples : examples.slice(0, FIRST_ROWS);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteExample(id, deleting.example_key);
      setDeleting(null);
      onChanged();
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : "Couldn’t delete the example.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const note = (
    <div className="md-note">
      <Info size={16} strokeWidth={1.7} aria-hidden style={{ flex: "none", marginTop: 2 }} />
      <span>
        <b>What a model will learn from.</b> Your {plural(data.tests, "test")} are kept apart and
        never trained on, so their scores stay honest. Training arrives in a later release; you can
        download this set now as JSONL or CSV.
      </span>
    </div>
  );

  if (examples.length === 0 && !readOnly) {
    return (
      <>
        {current > 0 && (
          <div className="md-line">
            <VersionBits data={data} onHistory={onHistory} />
          </div>
        )}
        <section className="md-card md-empty">
          <h2 className="md-empty__title">No training examples yet</h2>
          <p className="md-empty__text">
            Add an example by hand, import a CSV with the columns input and answer, or let a team
            draft them from your files.
          </p>
          <div className="md-empty__actions">
            <Button variant="primary" size="sm" onClick={() => onOpen(null)}>
              Add example
            </Button>
            <Button variant="secondary" size="sm" onClick={onDraft}>
              Draft with a team
            </Button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {readOnly && (
        <div className="md-banner" role="status">
          <span>You’re looking at training set v{viewing}. It can’t be changed.</span>
          <span className="md-banner__actions">
            <Button variant="secondary" size="sm" onClick={onBack}>
              Back to v{current}
            </Button>
            <Button variant="primary" size="sm" onClick={() => onRestore(viewing)}>
              Restore as v{current + 1}
            </Button>
          </span>
        </div>
      )}
      {!docked && (
        <div className="md-line md-line--results">
          <VersionBits data={data} onHistory={onHistory} />
        </div>
      )}
      {!docked && note}
      <section
        className={docked ? "md-tbl md-tbl--narrow md-tests" : "md-tbl md-tests"}
        aria-label="Training examples"
      >
        <table>
          <thead>
            <tr>
              <th scope="col" className="md-tests__n">
                #
              </th>
              <th scope="col">Input</th>
              <th scope="col" className="md-tests__expected">
                Answer
              </th>
              {!docked && (
                <th scope="col" className="md-train__src">
                  Source
                </th>
              )}
              {!docked && (
                <th scope="col" className="md-train__by">
                  Added by
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
            {shown.map((e) => (
              <tr
                key={e.example_id}
                className={selected === e.example_key ? "md-row md-row--on" : "md-row"}
                onClick={
                  readOnly
                    ? undefined
                    : (ev) => {
                        if (!(ev.target as HTMLElement).closest(".md-row__menu")) onOpen(e);
                      }
                }
              >
                <td className="md-num">{e.position}</td>
                <td>
                  <span className="md-clamp">{e.input}</span>
                </td>
                <td>
                  {isChoice ? (
                    <span className="md-ans">{e.answer}</span>
                  ) : (
                    <span className="md-clamp md-tests__text">{e.answer}</span>
                  )}
                </td>
                {!docked && (
                  <td>
                    <SourceCell
                      source={e.source}
                      fallback={e.origin === "csv" ? e.added_by : "Added by you"}
                    />
                  </td>
                )}
                {!docked && (
                  <td>
                    <span className="md-byhand">{e.added_by}</span>
                  </td>
                )}
                {!docked && !readOnly && (
                  <td>
                    <div className="md-row__menu">
                      <Menu
                        label={`More actions for example ${e.position}`}
                        trigger={(props) => (
                          <button
                            type="button"
                            className="md-more-btn"
                            aria-label={`More actions for example ${e.position}`}
                            {...props}
                          >
                            <MoreHorizontal size={16} strokeWidth={1.7} aria-hidden />
                          </button>
                        )}
                        items={[
                          { key: "edit", label: "Edit", onSelect: () => onOpen(e) },
                          {
                            key: "delete",
                            label: "Delete",
                            danger: true,
                            onSelect: () => setDeleting(e),
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
      <div className="md-more">
        <span>
          Showing {shown.length} of {plural(examples.length, "training example")}
        </span>
        {!all && examples.length > FIRST_ROWS && (
          <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
            Show all {examples.length}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete example ${deleting?.position}?`}
        confirmLabel="Delete example"
        tone="danger"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      >
        This makes training set v{current + 1} without it.
      </ConfirmDialog>
    </>
  );
}

function VersionBits({ data, onHistory }: { data: TrainingSet; onHistory: () => void }) {
  return (
    <div className="md-line__version">
      <span className="md-chip">Training set v{data.version}</span>
      {data.created_at && (
        <span className="md-line__edited">{versionLine(data.change_note, data.created_at)}</span>
      )}
      <button type="button" className="md-link md-link--icon" onClick={onHistory}>
        <Clock size={14} strokeWidth={1.7} aria-hidden />
        History
      </button>
    </div>
  );
}
