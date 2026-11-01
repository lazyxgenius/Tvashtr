/** The Settings tab: the name; the job and the choices (which make a new test set version); the
 *  kind of answer, read-only; and Delete this model. */
import { useState } from "react";

import { Button, ConfirmDialog, Input, TextArea, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import { type ModelDetail, deleteModel, updateModel } from "../../lib/api/models";
import { ChipsField } from "./ChipsField";
import { plural } from "./modelsFormat";

const BACKEND_DOWN = "Couldn’t reach Tvashtr — is the backend running?";

export function SettingsTab({
  model,
  onSaved,
  onDeleted,
}: {
  model: ModelDetail;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(model.name);
  const [job, setJob] = useState(model.job);
  const [choices, setChoices] = useState(model.choices);
  const [nameError, setNameError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"name" | "job" | "delete" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isChoice = model.answer_kind === "choice";

  const saveName = async () => {
    setBusy("name");
    setNameError(null);
    try {
      await updateModel(model.model_id, { name });
      toast({ message: "Name saved." });
      onSaved();
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : BACKEND_DOWN);
    }
    setBusy(null);
  };

  const saveChanges = async () => {
    setBusy("job");
    setJobError(null);
    try {
      await updateModel(model.model_id, isChoice ? { job, choices } : { job });
      toast({ message: "Changes saved." });
      onSaved();
    } catch (err) {
      setJobError(err instanceof ApiError ? err.message : BACKEND_DOWN);
    }
    setBusy(null);
  };

  const remove = async () => {
    setBusy("delete");
    setDeleteError(null);
    try {
      await deleteModel(model.model_id);
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : BACKEND_DOWN);
      setBusy(null);
    }
  };

  return (
    <div className="md-settings">
      <section className="md-card md-settings__card">
        <div className="md-settings__name">
          <Input
            label="Name"
            value={name}
            error={nameError ?? undefined}
            onChange={(e) => setName(e.target.value)}
          />
          <Button variant="secondary" loading={busy === "name"} onClick={() => void saveName()}>
            Save name
          </Button>
        </div>
      </section>
      <section className="md-card md-settings__card">
        <TextArea
          label="The job, in one sentence"
          rows={2}
          value={job}
          onChange={(e) => setJob(e.target.value)}
        />
        {isChoice && (
          <ChipsField
            label="The choices"
            values={choices}
            onChange={setChoices}
            placeholder="Add a choice and press Enter"
            inputLabel="Add a choice"
            duplicate="That choice is already in the list."
          />
        )}
        <span className="md-hint">
          Changing the job or the choices makes a new test set version, since models see them with
          every test.
        </span>
        {jobError && (
          <span className="md-error" role="alert">
            {jobError}
          </span>
        )}
        <div>
          <Button variant="primary" loading={busy === "job"} onClick={() => void saveChanges()}>
            Save changes
          </Button>
        </div>
      </section>
      <section className="md-card md-settings__card">
        <p className="md-body">
          Kind of answer: {isChoice ? "Pick from a list" : "Write text"} — set when the model was
          made.
        </p>
        <div>
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Delete this model
          </Button>
        </div>
      </section>
      <ConfirmDialog
        open={deleting}
        title={`Delete ${model.name}?`}
        confirmLabel="Delete model"
        tone="danger"
        busy={busy === "delete"}
        error={deleteError}
        onCancel={() => setDeleting(false)}
        onConfirm={() => void remove()}
      >
        Its {plural(model.tests, "test")}, every test set version and every result are deleted. This
        can’t be undone.
      </ConfirmDialog>
    </div>
  );
}
