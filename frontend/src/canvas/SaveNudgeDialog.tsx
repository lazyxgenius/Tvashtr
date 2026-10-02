import { Save } from "lucide-react";
import { useState } from "react";

import { Button, Checkbox, Input } from "../design-system/components";
import type { CheckSet, VersionTests } from "../lib/api/versions";
import { VersionDialog } from "./VersionDialogs";

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * M7 Test-SaveNudge (R6): Save as vN when a changed agent has tests — a note, and "Save and run the
 * Reviewer’s 6 tests" (picked) or "Just save". The tests run after the save, never blocking it; their
 * results show next to the version in History.
 * M9 Set-SaveCheck: when the team has task sets it also offers "Compare v8 with v7 on <set>" (ticked),
 * posted as `check_set` by "Save and check"; "Just save" clears both checks.
 */
export function SaveNudgeDialog({
  current,
  next,
  tests,
  checkSets = [],
  onClose,
  onSave,
}: {
  current: number;
  next: number;
  /** M7's changed agents with tests (null: only M9's compare is offered). */
  tests: VersionTests | null;
  checkSets?: CheckSet[];
  onClose: () => void;
  onSave: (body: { note?: string; run_tests?: boolean; check_set?: string }) => void;
}) {
  const [note, setNote] = useState("");
  const [run, setRun] = useState(tests !== null);
  // ponytail: the first set is offered; a set picker if teams keep several.
  const set = checkSets[0] ?? null;
  const [compare, setCompare] = useState(set !== null);
  const e = tests?.estimate;
  const se = set?.estimate;
  const results = `Results show next to v${next} in History.`;
  return (
    <VersionDialog
      title={`Save as v${next}`}
      icon={<Save size={17} strokeWidth={1.6} aria-hidden />}
      sub={tests?.sub ?? null}
      size="cv-vdlg cv-vdlg--save"
      onClose={onClose}
      footNote={
        run && compare && e && se ? `About ${usd(e.cost_usd + se.cost_usd)} for both checks` : null
      }
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="cv-btn-flush"
            onClick={() =>
              onSave({
                ...(note.trim() ? { note: note.trim() } : {}),
                ...(tests ? { run_tests: run } : {}),
                ...(compare && set ? { check_set: set.id } : {}),
              })
            }
          >
            <Save size={14} strokeWidth={2} aria-hidden />
            <span>
              {compare ? "Save and check" : run ? "Save and run tests" : `Save as v${next}`}
            </span>
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
      {set && <span className="lv-confirm__eyebrow">Check it right after saving</span>}
      {tests && (
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
            checked={!run && !compare}
            onChange={() => {
              setRun(false);
              setCompare(false);
            }}
          />
        </div>
      )}
      {set && (
        <Checkbox
          label={`Compare v${next} with v${current} on ${set.name}`}
          description={[
            `${set.count} ${set.count === 1 ? "task" : "tasks"}`,
            se && `about ${se.minutes} min`,
            se && `about ${usd(se.cost_usd)}`,
            "nothing ships",
          ]
            .filter(Boolean)
            .join(" · ")}
          checked={compare}
          onChange={(ev) => setCompare(ev.target.checked)}
        />
      )}
      <div className="lv-confirm__note">
        If v{next} does worse, restore v{current} from History in one click.
      </div>
    </VersionDialog>
  );
}
