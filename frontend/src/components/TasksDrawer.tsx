import type { HumanTask, TaskDecision } from "../lib/api";

/**
 * The Tasks-for-Human drawer (J4): a docked LEFT inbox replacing P1.1b's full-width strip.
 * High/blockers (approve/reject via /resolve) above, Low/nudges (dismiss via /acknowledge)
 * below. An actionable inbox — pending tasks only, so when it empties it returns null and the
 * canvas reclaims the width. Gate blockers link to their paused gate node on the canvas.
 */
export function TasksDrawer({
  blockers,
  nudges,
  onResolve,
  onAcknowledge,
  onFocusNode,
  busy = false,
}: {
  blockers: HumanTask[]; // pending && blocking
  nudges: HumanTask[]; // pending && !blocking
  onResolve: (taskId: number, decision: TaskDecision) => void;
  onAcknowledge: (taskId: number) => void;
  onFocusNode: (nodeId: string | null) => void;
  busy?: boolean;
}) {
  // Actionable inbox: empty ⇒ gone.
  if (blockers.length === 0 && nudges.length === 0) return null;

  return (
    <aside className="tv-drawer" aria-live="polite">
      <div className="tv-drawer__head">
        <h2 className="tv-drawer__title">Tasks for Human</h2>
      </div>
      <div className="tv-drawer__scroll">
        {blockers.length > 0 && (
          <section className="tv-drawer__section">
            <div className="tv-drawer__section-label">Needs your approval</div>
            {blockers.map((task) => (
              <BlockerCard
                key={task.id}
                task={task}
                onResolve={onResolve}
                onFocusNode={onFocusNode}
                busy={busy}
              />
            ))}
          </section>
        )}
        {nudges.length > 0 && (
          <section className="tv-drawer__section">
            <div className="tv-drawer__section-label">Heads up</div>
            {nudges.map((task) => (
              <NudgeCard key={task.id} task={task} onAcknowledge={onAcknowledge} busy={busy} />
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}

/** A blocker card (coral, serif title). If it's a gate blocker (topic `gate:{run}:{node}`),
 *  the body is a button that frames the matching gate node on the canvas. Budget blockers
 *  (topic `budget:…`) are not canvas-linked (budget is policy, not a node). */
function BlockerCard({
  task,
  onResolve,
  onFocusNode,
  busy,
}: {
  task: HumanTask;
  onResolve: (taskId: number, decision: TaskDecision) => void;
  onFocusNode: (nodeId: string | null) => void;
  busy: boolean;
}) {
  // The one gate↔node link convention: gate task topic = `gate:{run_id}:{node_id}`.
  const gateNodeId = task.topic?.startsWith("gate:") ? task.topic.split(":")[2] : null;

  const body = (
    <>
      <div className="tv-task__eyebrow">
        <span className="tv-pill tv-pill--paused">
          <span className="tv-pill__dot" />
          Awaiting your approval
        </span>
      </div>
      <div className="tv-task__title">{task.title}</div>
      <p className="tv-task__desc">{task.description}</p>
      {gateNodeId && <span className="tv-task__link-hint">Show on canvas →</span>}
    </>
  );

  return (
    <article className="tv-task">
      {gateNodeId ? (
        <button
          type="button"
          className="tv-task__body tv-task__body--link"
          onClick={() => onFocusNode(gateNodeId)}
        >
          {body}
        </button>
      ) : (
        <div className="tv-task__body">{body}</div>
      )}
      <div className="tv-task__actions">
        <button className="tv-btn" onClick={() => onResolve(task.id, "approve")} disabled={busy}>
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
  );
}

/** A nudge card — calmer than a blocker (a neutral left-bar, no coral alarm). Single Dismiss
 *  action via /acknowledge. Nudges are topic-less → never canvas-linked. */
function NudgeCard({
  task,
  onAcknowledge,
  busy,
}: {
  task: HumanTask;
  onAcknowledge: (taskId: number) => void;
  busy: boolean;
}) {
  return (
    <article className="tv-task tv-task--nudge">
      <div className="tv-task__body">
        <div className="tv-task__title">{task.title}</div>
        <p className="tv-task__desc">{task.description}</p>
      </div>
      <div className="tv-task__actions">
        <button
          className="tv-btn tv-btn--ghost"
          onClick={() => onAcknowledge(task.id)}
          disabled={busy}
        >
          Dismiss
        </button>
      </div>
    </article>
  );
}
