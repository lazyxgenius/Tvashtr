import type { HumanTask, TaskDecision } from "../lib/api";

const PRIORITY_LABEL: Record<string, string> = {
  high_blocker: "Blocker",
  low_nudge: "Nudge",
};

/**
 * The gate's Tasks-for-Human strip: one calm coral card per pending blocking
 * task, with Approve / Reject. Rendered full-width under the toolbar so a blocker
 * is always visible without a node click. (The dedicated drawer is a later P1.5
 * upgrade — this strip is the P1.1b surface.)
 */
export function TasksForHuman({
  tasks,
  onResolve,
  busy = false,
}: {
  tasks: HumanTask[];
  onResolve: (taskId: number, decision: TaskDecision) => void;
  busy?: boolean;
}) {
  if (tasks.length === 0) return null;

  return (
    <section className="tv-tasks" aria-live="polite">
      {tasks.map((task) => (
        <article key={task.id} className="tv-task">
          <div className="tv-task__body">
            <div className="tv-task__eyebrow">
              <span className="tv-pill tv-pill--paused">
                <span className="tv-pill__dot" />
                Awaiting your approval
              </span>
              {PRIORITY_LABEL[task.priority] && (
                <span className="tv-task__prio">{PRIORITY_LABEL[task.priority]}</span>
              )}
            </div>
            <h2 className="tv-task__title">{task.title}</h2>
            <p className="tv-task__desc">{task.description}</p>
          </div>
          <div className="tv-task__actions">
            <button
              className="tv-btn"
              onClick={() => onResolve(task.id, "approve")}
              disabled={busy}
            >
              Approve
            </button>
            <button
              className="tv-btn tv-btn--ghost"
              onClick={() => onResolve(task.id, "reject")}
              disabled={busy}
            >
              Reject
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
