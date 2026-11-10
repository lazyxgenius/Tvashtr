/** A training example in a right drawer (M2): Add example, or Edit one. Saving makes a new training
 *  set version. An input that is one of the model's tests is refused in place. */
import { useState } from "react";
import { GraduationCap, X } from "lucide-react";

import { Button, ConfirmDialog, Select, TextArea } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type ModelDetail,
  type TrainingExample,
  addExample,
  deleteExample,
  editExample,
} from "../../lib/api/models";
import { SourceCell } from "./TestsTab";

const BACKEND_DOWN = "Couldn’t reach Tvashtr — is the backend running?";

export function ExampleDrawer({
  model,
  example,
  onClose,
  onSaved,
}: {
  model: ModelDetail;
  example: TrainingExample | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isChoice = model.answer_kind === "choice";
  const [input, setInput] = useState(example?.input ?? "");
  const [answer, setAnswer] = useState(example?.answer ?? (isChoice ? model.choices[0] : ""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const id = model.model_id;
  const current = model.training_version ?? 0;

  const words = (err: unknown) => (err instanceof ApiError ? err.message : BACKEND_DOWN);
  const field =
    error?.startsWith("Write the input") || error?.includes("test")
      ? "input"
      : error?.includes("answer")
        ? "answer"
        : null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (example) await editExample(id, example.example_key, { input, answer });
      else await addExample(id, { input, answer });
      onSaved();
    } catch (err) {
      setError(words(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!example) return;
    setBusy(true);
    try {
      await deleteExample(id, example.example_key);
      onSaved();
    } catch (err) {
      setError(words(err));
      setBusy(false);
      setDeleting(false);
    }
  };

  return (
    <aside
      className="md-drawer"
      aria-labelledby="md-example-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="md-drawer__head">
        <span className="md-drawer__tile">
          <GraduationCap size={16} strokeWidth={1.7} aria-hidden />
        </span>
        <div className="md-drawer__titles">
          <h2 id="md-example-title" className="md-drawer__title">
            {example ? `Example ${example.position}` : "New training example"}
          </h2>
          <p className="md-drawer__sub">
            {model.name}
            {current > 0 && ` · training set v${current}`}
          </p>
        </div>
        <button type="button" className="md-ctl" aria-label="Close" onClick={onClose}>
          <X size={15} strokeWidth={1.7} aria-hidden />
        </button>
      </div>
      <div className="md-drawer__body">
        <TextArea
          label="Input"
          rows={4}
          value={input}
          error={field === "input" ? (error ?? undefined) : undefined}
          onChange={(e) => setInput(e.target.value)}
        />
        {isChoice ? (
          <Select
            label="Answer"
            value={answer}
            options={model.choices}
            error={field === "answer" ? (error ?? undefined) : undefined}
            onChange={(e) => setAnswer(e.target.value)}
          />
        ) : (
          <TextArea
            label="Answer"
            rows={3}
            value={answer}
            error={field === "answer" ? (error ?? undefined) : undefined}
            onChange={(e) => setAnswer(e.target.value)}
          />
        )}
        {example?.source?.file && (
          <div className="md-src">
            <SourceCell source={example.source} fallback="" />
          </div>
        )}
      </div>
      <div className="md-drawer__foot">
        <span className="md-hint">Saving makes training set v{current + 1}.</span>
        {error && !field && (
          <span className="md-error" role="alert">
            {error}
          </span>
        )}
        <div className="md-drawer__actions">
          {example && (
            <Button variant="ghost" onClick={() => setDeleting(true)}>
              Delete example
            </Button>
          )}
          <span className="md-grow" />
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save example
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        title={`Delete example ${example?.position}?`}
        confirmLabel="Delete example"
        tone="danger"
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={() => void remove()}
      >
        This makes training set v{current + 1} without it.
      </ConfirmDialog>
    </aside>
  );
}
