import { Circle, GitCompare, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button, ConfirmDialog, Menu } from "../../design-system/components";
import { deleteTaskSet, type TaskSet } from "../../lib/api/compare";
import { versionAge } from "../../lib/versionFormat";
import { TaskSetDialog } from "./TaskSetDialog";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * M9 — the Task sets tab (Quality › Set-List, Set-Empty, Set-RowMenu, Set-DeleteConfirm): a card per
 * set with its tasks and last use, "Compare on this set", Edit and the ⋯ menu; "New task set".
 */
export function TaskSets({
  teamId,
  sets,
  onChanged,
  onCompare,
}: {
  teamId: string;
  sets: TaskSet[];
  /** After a save or a delete: the page reads the sets again. */
  onChanged: () => void;
  /** "Compare on this set": the Compare tab with this set chosen. */
  onCompare: (setId: string) => void;
}) {
  // The edit dialog: a set, or "new".
  const [editing, setEditing] = useState<TaskSet | "new" | null>(null);
  const [deleting, setDeleting] = useState<TaskSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The most recently used set's Compare is the primary button.
  const newest = sets
    .filter((x) => x.last_used)
    .sort((x, y) => Date.parse(y.last_used!.at) - Date.parse(x.last_used!.at))[0]?.id;

  const remove = () => {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    deleteTaskSet(deleting.id).then(
      () => {
        setBusy(false);
        setDeleting(null);
        onChanged();
      },
      (e: unknown) => {
        setBusy(false);
        setError(message(e));
      },
    );
  };
  const newSet = (variant: "primary" | "secondary") => (
    <Button variant={variant} className="cv-btn-flush" onClick={() => setEditing("new")}>
      <Plus size={14} strokeWidth={1.8} aria-hidden />
      <span>New task set</span>
    </Button>
  );

  return (
    <div className="cmp-sets">
      <div className="cmp-sets__head">
        <div>
          <h2 className="cmp-h2">Task sets</h2>
          <p className="cmp-lede cmp-sets__lede">
            A few tasks you care about. Comparing on a set shows whether a change helps in general,
            not just once.
          </p>
        </div>
        {newSet("secondary")}
      </div>
      {sets.length === 0 ? (
        <div className="cmp-sets__empty">
          <span className="cmp-sets__empty-icon">
            <ListChecks size={20} strokeWidth={1.6} aria-hidden />
          </span>
          <h3 className="cmp-sets__empty-title">No task sets yet</h3>
          <p className="cmp-sets__empty-text">
            Make one from tasks you care about — each with a hidden check that says whether it
            really works.
          </p>
          {newSet("primary")}
        </div>
      ) : (
        <div className="cmp-sets__grid">
          {sets.map((x) => (
            <article key={x.id} className="cmp-set" aria-labelledby={`set-${x.id}`}>
              <div className="cmp-set__top">
                <span className="cmp-set__icon">
                  <ListChecks size={16} strokeWidth={1.6} aria-hidden />
                </span>
                <div>
                  <h3 id={`set-${x.id}`} className="cmp-set__name">
                    {x.name}
                  </h3>
                  <div className="cmp-set__count">
                    {x.items.length} {x.items.length === 1 ? "task" : "tasks"} · each has a hidden
                    check
                  </div>
                </div>
                <span className="cmp-set__more">
                  <Menu
                    label={`More for ${x.name}`}
                    width={180}
                    items={[
                      {
                        key: "edit",
                        label: "Edit",
                        icon: <Pencil size={14} strokeWidth={1.6} aria-hidden />,
                        onSelect: () => setEditing(x),
                      },
                      {
                        key: "delete",
                        label: "Delete",
                        danger: true,
                        icon: <Trash2 size={14} strokeWidth={1.6} aria-hidden />,
                        onSelect: () => {
                          setError(null);
                          setDeleting(x);
                        },
                      },
                    ]}
                  />
                </span>
              </div>
              <ul className="cmp-set__tasks">
                {x.items.map((it, i) => (
                  <li key={i}>
                    <span className="cmp-set__dot">
                      <Circle size={6} strokeWidth={2} aria-hidden />
                    </span>
                    {it.task}
                  </li>
                ))}
              </ul>
              <div className="cmp-set__used">
                {x.last_used
                  ? `Last used: v${x.last_used.a} vs v${x.last_used.b} · ${versionAge(x.last_used.at)} · ${x.last_used.summary}`
                  : "Not used yet"}
              </div>
              <div className="cmp-set__acts">
                <Button
                  variant={x.id === newest ? "primary" : "secondary"}
                  size="sm"
                  className="cv-btn-flush"
                  onClick={() => onCompare(x.id)}
                >
                  <GitCompare size={14} strokeWidth={1.6} aria-hidden />
                  <span>Compare on this set</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="cv-btn-flush"
                  onClick={() => setEditing(x)}
                >
                  <Pencil size={14} strokeWidth={1.6} aria-hidden />
                  <span>Edit</span>
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <TaskSetDialog
          teamId={teamId}
          set={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ""}?`}
        confirmLabel="Delete set"
        cancelLabel="Keep it"
        busy={busy}
        error={error}
        onConfirm={remove}
        onCancel={() => !busy && setDeleting(null)}
      >
        Its tasks and hidden checks are removed. Past results stay next to the versions they
        checked.
      </ConfirmDialog>
    </div>
  );
}
