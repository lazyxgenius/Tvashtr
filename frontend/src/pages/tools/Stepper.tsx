/** The Add tool wizard's steps (TOOL-31): the current number highlighted, finished steps checked. */
import { Check } from "lucide-react";

import { cx } from "../../design-system/components";

export function Stepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="tk-steps" aria-label="Steps">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li
            key={label}
            className={cx("tk-step", `tk-step--${state}`)}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="tk-step__num" aria-hidden="true">
              {state === "done" ? <Check size={12} strokeWidth={2.4} /> : i + 1}
            </span>
            <span className="tk-step__label">{label}</span>
            {state === "done" && <span className="tk-sr">, done</span>}
          </li>
        );
      })}
    </ol>
  );
}
