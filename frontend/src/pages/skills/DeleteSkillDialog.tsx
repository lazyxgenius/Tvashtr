import { useEffect, useState } from "react";

import { ConfirmDialog } from "../../design-system/components";
import { type Skill, type SkillUsageRow, deleteSkill, getSkill } from "../../lib/api/skills";
import { deleteImpact } from "./skillsModel";

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

/**
 * "Delete skill" (TkF-SkillMenu-2): the impact first — which agents lose it, read from
 * `GET /api/skill-library/{id}` `used_by` (the row's counts stand in if that read fails) — then
 * Cancel or Delete skill. Deleting also takes it off every agent (the backend strips the refs).
 * Mount it per skill (`key={skill.id}`): its state belongs to that one confirmation.
 */
export function DeleteSkillDialog({
  skill,
  onCancel,
  onDeleted,
}: {
  skill: Skill;
  onCancel: () => void;
  onDeleted: (skill: Skill) => void;
}) {
  // `undefined` while the read is in flight, `null` when it failed (the counts speak instead).
  const [usedBy, setUsedBy] = useState<SkillUsageRow[] | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = skill.id;

  useEffect(() => {
    let live = true;
    getSkill(id).then(
      (detail) => live && setUsedBy(detail.used_by),
      () => live && setUsedBy(null),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteSkill(skill.id);
      onDeleted(skill);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open
      title={`Delete ${skill.name}?`}
      confirmLabel="Delete skill"
      onConfirm={() => void confirm()}
      onCancel={onCancel}
      busy={busy}
      error={error}
    >
      {usedBy === undefined ? (
        <span aria-busy="true">Checking which agents use it…</span>
      ) : (
        deleteImpact(usedBy, skill.usage)
      )}
    </ConfirmDialog>
  );
}
