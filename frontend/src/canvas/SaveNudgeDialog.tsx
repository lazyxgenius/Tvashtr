import { Save } from "lucide-react";
import { useState } from "react";

import { Button, Checkbox, Input } from "../design-system/components";
import type { VersionTests } from "../lib/api/versions";
import { VersionDialog } from "./VersionDialogs";

/**
 * M7 Test-SaveNudge (R6): Save as vN when a changed agent has tests — a note, and "Save and run the
 * Reviewer’s 6 tests" (picked) or "Just save". The tests run after the save, never blocking it; their
 * results show next to the version in History.
 */
export function SaveNudgeDialog({
  current,
  next,
  tests,
  onClose,
  onSave,
}: {
  current: number;
  next: number;
  tests: VersionTests;
  onClose: () => void;
  onSave: (body: { note?: string; run_tests: boolean }) => void;
}) {
  const [note, setNote] = useState("");
  const [run, setRun] = useState(true);
  const e = tests.estimate;
  const results = `Results show next to v${next} in History.`;
  return (
    <VersionDialog
      title={`Save as v${next}`}
      icon={<Save size={17} strokeWidth={1.6} aria-hidden />}
      sub={tests.sub}
      size="cv-vdlg cv-vdlg--save"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            iconLeft={<Save size={14} strokeWidth={2} aria-hidden />}
            onClick={() =>
              onSave({ ...(note.trim() ? { note: note.trim() } : {}), run_tests: run })
            }
          >
            {run ? "Save and run tests" : `Save as v${next}`}
          </Button>
        </>
      }
    >
      <Input
        label="What changed (optional)"
        value={note}
        maxLength={200}
        onChange={(ev) => setNote(ev.target.value)}
      />
      <div className="cv-save__parts" role="radiogroup" aria-label="After saving">
        <Checkbox
          type="radio"
          name="save-nudge"
          label={tests.option}
          description={
            e
              ? `About ${e.minutes} min · about $${e.cost_usd.toFixed(2)} on your keys. ${results}`
              : results
          }
          checked={run}
          onChange={() => setRun(true)}
        />
        <Checkbox
          type="radio"
          name="save-nudge"
          label="Just save"
          checked={!run}
          onChange={() => setRun(false)}
        />
      </div>
      <div className="lv-confirm__note">
        If v{next} does worse, restore v{current} from History in one click.
      </div>
    </VersionDialog>
  );
}
