import { Badge, Kbd } from "../../design-system/components";
import { runLook, versionAge } from "../../lib/versionFormat";
import type { RecentTasksApi } from "./useRecentTasks";

/** The task with the typed text in bold ("**Add a**n RSI indicator"). */
function Match({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <b>{text.slice(i, i + q.length)}</b>
      {text.slice(i + q.length)}
    </>
  );
}

/** The listbox under the idea box (Agents-Recent). */
export function RecentTasksList({ recent, query }: { recent: RecentTasksApi; query: string }) {
  const n = recent.tasks.length;
  return (
    <>
      {/* Says when the list opens (the list itself is announced through the box's ARIA). */}
      <span className="hm-sr-only" role="status" aria-live="polite">
        {recent.open ? `${n} recent task${n === 1 ? "" : "s"} — use the arrow keys to choose` : ""}
      </span>
      {recent.open && <List recent={recent} query={query} />}
    </>
  );
}

function List({ recent, query }: { recent: RecentTasksApi; query: string }) {
  return (
    <div
      id={recent.listId}
      role="listbox"
      aria-label="Recent tasks"
      className="hm-rtask"
      onMouseLeave={() => recent.setActive(-1)}
    >
      <div className="hm-rtask__head" role="presentation">
        <span className="hm-rtask__eyebrow">Recent tasks</span>
        <span>Picking one fills in the task and its team</span>
      </div>
      <ul className="hm-rtask__list" role="presentation">
        {recent.tasks.map((t, i) => {
          const look = runLook(t.status);
          return (
            <li
              key={`${t.run_id}-${i}`}
              id={recent.optionId(i)}
              role="option"
              aria-selected={i === recent.active}
              className="hm-rtask__row"
              // Keep the caret in the idea box.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => recent.setActive(i)}
              onClick={() => recent.pick(t)}
            >
              <span className="hm-rtask__task">
                <Match text={t.task} q={query.trim()} />
              </span>
              <span className="hm-rtask__team">{t.team.name}</span>
              <span className="hm-rtask__status">
                <Badge variant={look.variant} dot>
                  {look.label}
                </Badge>
                {t.number != null && <span className="hm-rtask__num">#{t.number}</span>}
              </span>
              <span className="hm-rtask__age">{versionAge(t.created_at)}</span>
            </li>
          );
        })}
      </ul>
      <div className="hm-rtask__foot" role="presentation">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> to choose
        </span>
        <span>
          <Kbd>Enter</Kbd> to use
        </span>
        <span>
          <Kbd>Esc</Kbd> to keep typing
        </span>
      </div>
    </div>
  );
}
