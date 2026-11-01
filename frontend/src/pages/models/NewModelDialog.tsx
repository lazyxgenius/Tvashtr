/** New model: one job, described plainly. Create model opens its page on the Tests tab. */
import { useState } from "react";

import { Button, Checkbox, Input, TextArea } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import { type AnswerKind, type ModelDetail, createModel } from "../../lib/api/models";
import { ChipsField } from "./ChipsField";
import { ModelDialog } from "./ModelDialog";

const BACKEND_DOWN = "Couldn’t reach Tvashtr — is the backend running?";
const NAME_WORDS = ["Give it a name.", "That name is taken. Pick another."];
const JOB_WORD = "Describe the job in one sentence.";

export function NewModelDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (model: ModelDetail) => void;
}) {
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [kind, setKind] = useState<AnswerKind>("choice");
  const [choices, setChoices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await createModel({ name, job, answer_kind: kind, choices }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : BACKEND_DOWN);
      setBusy(false);
    }
  };

  const nameError = error && NAME_WORDS.includes(error) ? error : undefined;
  const jobError = error === JOB_WORD ? error : undefined;
  const otherError = error && !nameError && !jobError ? error : null;

  return (
    <ModelDialog
      title="New model"
      subtitle="One job, described plainly. You can change any of this later."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Create model
          </Button>
        </>
      }
    >
      <Input
        label="Name"
        autoFocus
        value={name}
        error={nameError}
        onChange={(e) => setName(e.target.value)}
      />
      <TextArea
        label="The job, in one sentence"
        rows={2}
        value={job}
        error={jobError}
        helper="Write it the way you would brief a new colleague."
        onChange={(e) => setJob(e.target.value)}
      />
      <fieldset className="md-kinds">
        <legend className="md-lbl">What kind of answer?</legend>
        <div className={kind === "choice" ? "md-kind md-kind--on" : "md-kind"}>
          <Checkbox
            type="radio"
            name="model-kind"
            checked={kind === "choice"}
            onChange={() => setKind("choice")}
            label="Pick from a list"
            description="One of a few fixed choices, like a team or a label. Tests are scored by exact match."
          />
        </div>
        <div className={kind === "text" ? "md-kind md-kind--on" : "md-kind"}>
          <Checkbox
            type="radio"
            name="model-kind"
            checked={kind === "text"}
            onChange={() => setKind("text")}
            label="Write text"
            description="A sentence or more, like a summary or a reply. Tests are scored by key words or an AI judge."
          />
        </div>
      </fieldset>
      {kind === "choice" && (
        <ChipsField
          label="The choices"
          values={choices}
          onChange={setChoices}
          placeholder="Add a choice and press Enter"
          inputLabel="Add a choice"
          hint="Every test's expected answer must be one of these."
          duplicate="That choice is already in the list."
          error={otherError}
        />
      )}
      {kind === "text" && otherError && (
        <span className="md-error" role="alert">
          {otherError}
        </span>
      )}
    </ModelDialog>
  );
}
