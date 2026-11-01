/** Test set history: one row per version, newest first; View opens it read-only. */
import { useEffect, useState } from "react";

import { Button, Sheet } from "../../design-system/components";
import { type ModelDetail, type TestSetVersion, listVersions } from "../../lib/api/models";
import { ago, plural } from "./modelsFormat";

export function HistorySheet({
  model,
  onClose,
  onView,
}: {
  model: ModelDetail;
  onClose: () => void;
  onView: (version: number) => void;
}) {
  const [versions, setVersions] = useState<TestSetVersion[] | null>(null);
  useEffect(() => {
    let live = true;
    listVersions(model.model_id)
      .then((v) => live && setVersions(v))
      .catch(() => live && setVersions([]));
    return () => {
      live = false;
    };
  }, [model.model_id]);
  return (
    <Sheet open title="Test set history" subtitle={model.name} onClose={onClose}>
      <ul className="md-history">
        {(versions ?? []).map((v) => (
          <li key={v.version} className="md-history__row">
            <span className="md-chip">v{v.version}</span>
            <div className="md-history__text">
              <span className="md-history__note">{v.change_note}</span>
              <span className="md-hint">
                you · {ago(v.created_at)} · {plural(v.runs, "run")}
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
