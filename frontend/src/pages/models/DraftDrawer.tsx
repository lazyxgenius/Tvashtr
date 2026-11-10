/** Edit a draft (M2): the input, the answer (a Select for a choice model) and, for a text model, its
 *  key phrases. The source is shown, not editable. Saving re-runs the answer, copy and lock checks
 *  and marks the card "Edited by you". */
import { useState } from "react";
import { FileText, Pencil, X } from "lucide-react";

import { Button, Select, TextArea } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import { type Draft, type ModelDetail, editDraft } from "../../lib/api/models";
import { ChipsField } from "./ChipsField";
import { sourceFileLine } from "./modelsFormat";

export function DraftDrawer({
  model,
  draft,
  onClose,
  onSaved,
}: {
  model: ModelDetail;
  draft: Draft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isChoice = model.answer_kind === "choice";
  const [input, setInput] = useState(draft.input);
  const [answer, setAnswer] = useState(draft.answer);
  const [phrases, setPhrases] = useState<string[]>(draft.must_contain);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await editDraft(model.model_id, draft.draft_id, {
        input,
        answer,
        ...(isChoice ? {} : { must_contain: phrases }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn’t save the draft. Try again.");
      setBusy(false);
    }
  };

  return (
    <aside
      className="md-drawer"
      aria-labelledby="md-draft-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="md-drawer__head">
        <span className="md-drawer__tile">
          <Pencil size={16} strokeWidth={1.7} aria-hidden />
        </span>
        <div className="md-drawer__titles">
          <h2 id="md-draft-title" className="md-drawer__title">
            Draft {draft.number}
          </h2>
          <p className="md-drawer__sub">
            {model.name} · {draft.kind === "test" ? "a test" : "a training example"}
          </p>
        </div>
        <button type="button" className="md-ctl" aria-label="Close" onClick={onClose}>
          <X size={15} strokeWidth={1.7} aria-hidden />
        </button>
      </div>
      <div className="md-drawer__body">
        <TextArea label="Input" rows={4} value={input} onChange={(e) => setInput(e.target.value)} />
        {isChoice ? (
          <Select
            label={draft.kind === "test" ? "Expected answer" : "Answer"}
            value={answer}
            options={model.choices}
            onChange={(e) => setAnswer(e.target.value)}
          />
        ) : (
          <>
            <TextArea
              label={draft.kind === "test" ? "Expected answer" : "Answer"}
              rows={3}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
            <ChipsField
              label="Key phrases"
              values={phrases}
              onChange={setPhrases}
              placeholder="Add a phrase and press Enter"
              inputLabel="Add a key phrase"
              hint="1 to 5 phrases the answer contains. A test from this draft is scored by them."
            />
          </>
        )}
        <div className="md-src">
          <span className="md-src__file">
            <FileText size={13} strokeWidth={1.7} aria-hidden />
            {sourceFileLine(draft.source)}
          </span>
          <q className="md-src__q">{draft.source.quote}</q>
          <span className="md-hint">The source stays as the team quoted it.</span>
        </div>
      </div>
      <div className="md-drawer__foot">
        {error && (
          <span className="md-error" role="alert">
            {error}
          </span>
        )}
        <div className="md-drawer__actions">
          <span className="md-grow" />
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save draft
          </Button>
        </div>
      </div>
    </aside>
  );
}
