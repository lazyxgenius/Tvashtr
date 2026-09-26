import { Fragment } from "react";
import { AlertTriangle, CircleCheck, Route } from "lucide-react";

import { Button } from "../../design-system/components";
import type { Routing } from "./routing";

/** "…and C" / "B and C" / "A, B and C". */
function joinAnd(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The routing line attached to the instructions card: where the agent's work goes, and (for an agent
 * that routes on a verdict) whether its instructions still match its arrows. `onUpdate` offers the
 * "Update instructions" fix when they don't.
 */
export function RoutingStatus({ routing, onUpdate }: { routing: Routing; onUpdate?: () => void }) {
  return (
    <div className="nd-routing">
      <div className="nd-routing__line">
        <span className="nd-routing__icon" aria-hidden>
          <Route size={14} strokeWidth={1.7} />
        </span>
        {routing.kind === "none" && (
          <span>Connect an arrow out of this agent on the canvas to set where its work goes.</span>
        )}
        {routing.kind === "then" && (
          <span>
            Then → <b>{joinAnd(routing.targets)}</b>.
          </span>
        )}
        {routing.kind === "verdict" && (
          <span>
            {routing.branches.map((b, i) => (
              <Fragment key={`${b.label}:${b.target}`}>
                {i > 0 && " "}
                Says <b>“{b.label}”</b> → <b>{b.target}</b>.
              </Fragment>
            ))}
            {routing.otherwise && (
              <>
                {" "}
                Anything else → {routing.otherwise.back ? "back to " : ""}
                <b>{routing.otherwise.target}</b>.
              </>
            )}
          </span>
        )}
      </div>
      {routing.kind === "verdict" &&
        (routing.inSync ? (
          <span className="nd-routing__sync">
            <CircleCheck size={13} strokeWidth={1.8} aria-hidden />
            Instructions match your arrows
          </span>
        ) : (
          <span className="nd-routing__sync nd-routing__sync--warn">
            <AlertTriangle size={13} strokeWidth={1.8} aria-hidden />
            Instructions no longer match your arrows
            {onUpdate && (
              <Button variant="tint" size="sm" onClick={onUpdate}>
                Update instructions
              </Button>
            )}
          </span>
        ))}
    </div>
  );
}
