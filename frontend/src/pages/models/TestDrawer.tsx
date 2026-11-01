/** A test, in a right drawer beside the table, or as a centred pop-up (the pattern of
 *  `panel/NodeHeader.tsx`'s Focus mode / Dock to the side). Saving makes a new test set version. */
import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Maximize2, Minimize2, X } from "lucide-react";

import { Button, ConfirmDialog, Input, Select, TextArea } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type ModelDetail,
  type ModelTest,
  type Scoring,
  type TestFields,
  type TestResult,
  addTest,
  deleteTest,
  editTest,
  testResults,
} from "../../lib/api/models";
import { useModalDialog } from "../../lib/useModalDialog";
import { ChipsField } from "./ChipsField";
import { useModelChoices } from "./modelChoices";
import { SCORING_LABEL, ago, modelRows, scoringHint } from "./modelsFormat";
import { VerdictChip } from "./TestsTab";

const BACKEND_DOWN = "Couldn’t reach Tvashtr — is the backend running?";
const CUSTOM = "__custom__";
const FIELD_OF: Record<string, string> = {
  "Write the input first.": "input",
  "Write the expected answer.": "expected",
  "The expected answer must be one of the choices.": "expected",
  "Add at least one word or phrase it must contain.": "phrases",
  "Say what a right answer must do.": "rubric",
  "Pick a judge model.": "judge",
  "Type it as provider/model, like groq/llama-3.3-70b-versatile.": "judge",
};

function LastRunBox({ results }: { results: TestResult[] }) {
  if (results.length === 0) return null;
  return (
    <div className="md-lastrun">
      <span className="md-eyebrow">Last run · {ago(results[0].completed_at)}</span>
      {results.map((r) => (
        <div key={r.run_id} className="md-lastrun__row">
          <div className="md-lastrun__top">
            <span className="md-mono">{r.model_name}</span>
            <VerdictChip verdict={r.verdict} />
          </div>
          {r.reason && (
            <span className="md-hint">{r.judge_model ? `Judge: "${r.reason}"` : r.reason}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function TestDrawer({
  model,
  test,
  popup,
  onTogglePopup,
  onClose,
  onSaved,
}: {
  model: ModelDetail;
  test: ModelTest | null;
  popup: boolean;
  onTogglePopup: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isChoice = model.answer_kind === "choice";
  const { catalogue, held } = useModelChoices();
  const [input, setInput] = useState(test?.input ?? "");
  const [expected, setExpected] = useState(test?.expected ?? (isChoice ? model.choices[0] : ""));
  const [scoring, setScoring] = useState<Scoring>(
    test?.scoring ?? (isChoice ? "exact" : "contains"),
  );
  const [phrases, setPhrases] = useState<string[]>(test?.must_contain ?? []);
  const [rubric, setRubric] = useState(test?.rubric ?? "");
  const [judge, setJudge] = useState(test?.judge_model ?? model.judge_default ?? "");
  const [customJudge, setCustomJudge] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ref = useModalDialog<HTMLElement>(popup, onClose);
  const id = model.model_id;
  const key = test?.case_key;

  useEffect(() => {
    if (!key) return;
    let live = true;
    testResults(id, key)
      .then((r) => live && setResults(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id, key]);

  const judges = useMemo(() => {
    const rows = modelRows(catalogue, held ?? [], judge ? [judge] : []).filter(
      (r) => r.held || r.slug === judge,
    );
    return [
      ...rows.map((r) => ({
        value: r.slug,
        label: `${r.providerLabel} ${r.name} · your ${r.providerLabel} key`,
      })),
      { value: CUSTOM, label: "Custom…" },
    ];
  }, [catalogue, held, judge]);

  const current = model.current_version;
  const fields: TestFields = {
    input,
    expected,
    scoring,
    must_contain: scoring === "contains" ? phrases : [],
    rubric: scoring === "judge" ? rubric : null,
    judge_model: scoring === "judge" ? judge : null,
  };
  const unchanged =
    test !== null &&
    input === test.input &&
    expected === test.expected &&
    scoring === test.scoring &&
    JSON.stringify(fields.must_contain) === JSON.stringify(test.must_contain) &&
    (fields.rubric ?? null) === (test.rubric ?? null) &&
    (fields.judge_model ?? null) === (test.judge_model ?? null);

  const save = async () => {
    // Saving what's already there isn't an edit: no new version, so no chips cleared.
    if (unchanged) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await (test ? editTest(id, test.case_key, fields) : addTest(id, fields));
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : BACKEND_DOWN);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!test) return;
    setBusy(true);
    try {
      await deleteTest(id, test.case_key);
      onSaved();
    } catch (err) {
      setDeleting(false);
      setError(err instanceof ApiError ? err.message : BACKEND_DOWN);
      setBusy(false);
    }
  };

  const field = error ? FIELD_OF[error] : undefined;
  const fieldError = (name: string) => (field === name ? (error ?? undefined) : undefined);
  const titleId = "md-drawer-title";
  const ways: Scoring[] = isChoice ? ["exact"] : ["exact", "contains", "judge"];

  const panel = (
    <aside
      ref={ref}
      className={popup ? "md-drawer md-drawer--popup" : "md-drawer"}
      role={popup ? "dialog" : undefined}
      aria-modal={popup ? true : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (!popup && e.key === "Escape") onClose();
      }}
    >
      <div className="md-drawer__head">
        <span className="md-drawer__tile">
          <ClipboardCheck size={16} strokeWidth={1.7} aria-hidden />
        </span>
        <div className="md-drawer__titles">
          <h2 id={titleId} className="md-drawer__title">
            {test ? `Test ${test.position}` : "New test"}
          </h2>
          <p className="md-drawer__sub">
            {model.name}
            {current > 0 && ` · test set v${current}`}
          </p>
        </div>
        <button
          type="button"
          className="md-ctl"
          aria-label={popup ? "Dock to the side" : "Open as a pop-up"}
          title={popup ? "Dock to the side" : "Open as a pop-up"}
          onClick={onTogglePopup}
        >
          {popup ? (
            <Minimize2 size={15} strokeWidth={1.7} aria-hidden />
          ) : (
            <Maximize2 size={15} strokeWidth={1.7} aria-hidden />
          )}
        </button>
        <button type="button" className="md-ctl" aria-label="Close" onClick={onClose}>
          <X size={15} strokeWidth={1.7} aria-hidden />
        </button>
      </div>

      <div className="md-drawer__body">
        <TextArea
          label="Input"
          rows={4}
          value={input}
          error={fieldError("input")}
          onChange={(e) => setInput(e.target.value)}
        />
        {isChoice ? (
          <Select
            label="Expected answer"
            value={expected}
            error={fieldError("expected")}
            options={model.choices}
            onChange={(e) => setExpected(e.target.value)}
          />
        ) : (
          <TextArea
            label="Expected answer"
            rows={2}
            value={expected}
            error={fieldError("expected")}
            onChange={(e) => setExpected(e.target.value)}
          />
        )}
        <div className="md-score">
          <span className="md-lbl" id="md-score-lbl">
            How to score
          </span>
          <div className="tv-seg md-seg" role="group" aria-labelledby="md-score-lbl">
            {ways.map((way) => (
              <button
                key={way}
                type="button"
                className={way === scoring ? "tv-seg__btn tv-seg__btn--active" : "tv-seg__btn"}
                aria-pressed={way === scoring}
                onClick={() => setScoring(way)}
              >
                {SCORING_LABEL[way]}
              </button>
            ))}
          </div>
          <span className="md-hint">{scoringHint(scoring, isChoice)}</span>
        </div>
        {scoring === "contains" && (
          <ChipsField
            label="Words it must contain"
            values={phrases}
            onChange={setPhrases}
            placeholder="Add a word or phrase and press Enter"
            inputLabel="Add a word or phrase"
            hint="Each word or phrase must appear in the answer. Case doesn't matter."
            error={fieldError("phrases")}
          />
        )}
        {scoring === "judge" && (
          <>
            <TextArea
              label="What a right answer must do"
              rows={3}
              value={rubric}
              error={fieldError("rubric")}
              onChange={(e) => setRubric(e.target.value)}
            />
            {customJudge ? (
              <Input
                label="Judge model"
                autoFocus
                placeholder="provider/model"
                value={judge}
                error={fieldError("judge")}
                helper="The judge runs on your key too. Its cost is added to each run's total."
                onChange={(e) => setJudge(e.target.value)}
              />
            ) : (
              <Select
                label="Judge model"
                value={judge}
                error={fieldError("judge")}
                helper="The judge runs on your key too. Its cost is added to each run's total."
                options={judge ? judges : [{ value: "", label: "Pick a judge model" }, ...judges]}
                onChange={(e) => {
                  if (e.target.value === CUSTOM) {
                    setCustomJudge(true);
                    setJudge("");
                  } else {
                    setJudge(e.target.value);
                  }
                }}
              />
            )}
          </>
        )}
        <LastRunBox results={results} />
      </div>

      <div className="md-drawer__foot">
        <span className="md-hint">
          Saving makes test set v{current + 1}.
          {current > 0 && ` Earlier results stay tied to v${current}.`}
        </span>
        {error && !field && (
          <span className="md-error" role="alert">
            {error}
          </span>
        )}
        <div className="md-drawer__actions">
          {test && (
            <Button variant="ghost" onClick={() => setDeleting(true)}>
              Delete test
            </Button>
          )}
          <span className="md-grow" />
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save test
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        title={`Delete test ${test?.position}?`}
        confirmLabel="Delete test"
        tone="danger"
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={() => void remove()}
      >
        This makes test set v{current + 1} without it. Earlier results stay tied to v{current}.
      </ConfirmDialog>
    </aside>
  );

  return popup ? (
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden />
      {panel}
    </>
  ) : (
    panel
  );
}
