/** Test set history (or, M2, training set history): one row per version, newest first; View opens
 *  it read-only. */
import { useEffect, useState } from "react";

import { Button, Sheet } from "../../design-system/components";
import { type ModelDetail, listTrainingVersions, listVersions } from "../../lib/api/models";
import { ago, plural } from "./modelsFormat";

export function HistorySheet({
  model,
  onClose,
  onView,
  kind = "tests",
}: {
  model: ModelDetail;
  onClose: () => void;
  onView: (version: number) => void;
  kind?: "tests" | "training";
}) {
  const training = kind === "training";
  const [versions, setVersions] = useState<
    { version: number; change_note: string; created_at: string | null; meta: string }[] | null
  >(null);
  useEffect(() => {
    let live = true;
    (training
      ? listTrainingVersions(model.model_id).then((vs) =>
          vs.map((v) => ({ ...v, meta: plural(v.examples, "example") })),
        )
      : listVersions(model.model_id).then((vs) =>
          vs.map((v) => ({ ...v, meta: plural(v.runs, "run") })),
        )
    )
      .then((v) => live && setVersions(v))
      .catch(() => live && setVersions([]));
    return () => {
      live = false;
    };
  }, [model.model_id, training]);
  return (
    <Sheet
      open
      title={training ? "Training set history" : "Test set history"}
      subtitle={model.name}
      onClose={onClose}
    >
      <ul className="md-history">
        {(versions ?? []).map((v) => (
          <li key={v.version} className="md-history__row">
            <span className="md-chip">v{v.version}</span>
            <div className="md-history__text">
              <span className="md-history__note">{v.change_note}</span>
              <span className="md-hint">
                you · {ago(v.created_at)} · {v.meta}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onView(v.version)}>
              View
            </Button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
