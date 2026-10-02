import { FileCode, FileText, FlaskConical, MessageSquare } from "lucide-react";
import { Fragment } from "react";

import { changeCount, pagesText } from "../../lib/agentTestsFormat";
import type { TestGets } from "../../lib/api/agentTests";

/**
 * "What the Reviewer gets" (Test-New): the task, the documents it read, the change and the test
 * output it saw, and its reviewer's feedback (round 2+), one row each.
 */
export function GetsList({
  gets,
  compact = false,
}: {
  gets: TestGets;
  /** Test-Replay's narrower rows (the drawer). */
  compact?: boolean;
}) {
  return (
    <ul className={`tt-gets${compact ? " tt-gets--compact" : ""}`}>
      <li>
        <span className="tt-gets__icon" aria-hidden>
          <FileText size={14} strokeWidth={1.6} />
        </span>
        <span className="tt-gets__label">The task</span>
        <span className="tt-gets__value" title={gets.task}>
          {gets.task}
        </span>
      </li>
      {gets.documents.map((d) => (
        <li key={`${d.name}:${d.version_no}`}>
          <span className="tt-gets__icon" aria-hidden>
            <FileText size={14} strokeWidth={1.6} />
          </span>
          <span className="tt-gets__label">
            {d.name} v{d.version_no}
          </span>
          <span className="tt-gets__value">{pagesText(d.pages)}</span>
        </li>
      ))}
      {gets.change.length > 0 && (
        <li>
          <span className="tt-gets__icon" aria-hidden>
            <FileCode size={14} strokeWidth={1.6} />
          </span>
          <span className="tt-gets__label">
            {gets.change_by ? `The ${gets.change_by}’s change` : "The change"}
          </span>
          <span className="tt-gets__value">
            {gets.change.map((c, i) => (
              <Fragment key={c.path}>
                {i > 0 && " · "}
                <code className="tt-code">{c.path}</code> {changeCount(c)}
              </Fragment>
            ))}
          </span>
        </li>
      )}
      {gets.test_output && (
        <li>
          <span className="tt-gets__icon" aria-hidden>
            <FlaskConical size={14} strokeWidth={1.6} />
          </span>
          <span className="tt-gets__label">Test output</span>
          <span className="tt-gets__value">{gets.test_output}</span>
        </li>
      )}
      {gets.feedback && (
        <li>
          <span className="tt-gets__icon" aria-hidden>
            <MessageSquare size={14} strokeWidth={1.6} />
          </span>
          <span className="tt-gets__label">Feedback</span>
          <span className="tt-gets__value">From the round before</span>
        </li>
      )}
    </ul>
  );
}
