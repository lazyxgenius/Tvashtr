import { Circle, CircleCheck } from "lucide-react";

import type { ReadyItem } from "./getReady";

/**
 * "Get this agent ready  1 of 3" (PANEL-62, Web-NewAgent): Write instructions / Pick a model /
 * Choose documents, each ticked as it's done, and "Hide this".
 */
export function GetReadyChecklist({ items, onHide }: { items: ReadyItem[]; onHide: () => void }) {
  const done = items.filter((i) => i.done).length;
  return (
    <section className="nd-ready" aria-label="Get this agent ready">
      <div className="nd-ready__head">
        <span className="nd-ready__title">Get this agent ready</span>
        <span className="nd-ready__count">
          {done} of {items.length}
        </span>
      </div>
      <ol className="nd-ready__list">
        {items.map((item) => (
          <li
            key={item.key}
            className={`nd-ready__item${item.done ? " nd-ready__item--done" : ""}`}
          >
            <span className="nd-ready__icon" role="img" aria-label={item.done ? "Done" : "To do"}>
              {item.done ? (
                <CircleCheck size={16} strokeWidth={1.6} aria-hidden />
              ) : (
                <Circle size={16} strokeWidth={1.6} aria-hidden />
              )}
            </span>
            <span className="nd-ready__label">{item.label}</span>
            {item.note && <span className="nd-ready__note">{item.note}</span>}
          </li>
        ))}
      </ol>
      <button type="button" className="nd-ready__hide" onClick={onHide}>
        Hide this
      </button>
    </section>
  );
}
