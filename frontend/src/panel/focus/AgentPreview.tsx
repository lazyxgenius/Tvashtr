import { useEffect, useState } from "react";

import { Badge, Button } from "../../design-system/components";
import {
  type ContextPreview,
  type ContextPreviewDraft,
  previewNodeContext,
} from "../../lib/api/nodes";

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: ContextPreview };

const tokens = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "token" : "tokens"}`;

/**
 * "Preview as the agent sees it" (PANEL-101): the first-round context the executor would compile
 * for this agent with the unsaved draft applied (POST …/context-preview), part by part, in order,
 * with where each comes from and its size. A read-only list for now; the focus area restyles it.
 */
export function AgentPreview({
  teamId,
  nodeId,
  draft,
}: {
  teamId: string;
  nodeId: string;
  draft: ContextPreviewDraft;
}) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Rebuild only when what the preview compiles actually changes.
  const draftKey = JSON.stringify(draft);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    previewNodeContext(teamId, nodeId, JSON.parse(draftKey) as ContextPreviewDraft)
      .then((preview) => {
        if (live) setState({ status: "ready", preview });
      })
      .catch((e: unknown) => {
        if (live) {
          setState({
            status: "error",
            message: e instanceof Error && e.message ? e.message : "Couldn’t build the preview.",
          });
        }
      });
    return () => {
      live = false;
    };
  }, [teamId, nodeId, draftKey, attempt]);

  if (state.status === "loading") {
    return (
      <div className="fx-preview" role="status">
        <p className="fx-preview__lede">Building what the agent sees…</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="fx-preview">
        <p className="fx-preview__error" role="alert">
          {state.message}
        </p>
        <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  const { preview } = state;
  return (
    <div className="fx-preview" role="region" aria-label="What the agent sees">
      <p className="fx-preview__lede">
        {preview.source_run
          ? `Its first round in the run “${preview.source_run.idea}”, with your unsaved changes.`
          : "Its first round, with your unsaved changes. No run yet, so the idea and the spec are placeholders."}{" "}
        About {tokens(preview.total_tokens)} of its {tokens(preview.budget)} budget
        {preview.over_budget ? ": over budget." : "."}
      </p>
      {preview.notes.length > 0 && (
        <ul className="fx-preview__notes">
          {preview.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {preview.parts.map((part, i) => (
        <section key={`${part.key}-${i}`} className="fx-part" aria-label={part.label}>
          <div className="fx-part__head">
            <span className="fx-part__label">{part.label}</span>
            {part.source.label && <span className="fx-part__source">{part.source.label}</span>}
            {part.placeholder && <Badge variant="neutral">Placeholder</Badge>}
            <span className="fx-part__tokens">about {tokens(part.tokens)}</span>
          </div>
          <pre className="fx-part__text">{part.text.replace(/^\n+/, "")}</pre>
        </section>
      ))}
      {preview.skills.length > 0 && (
        <section className="fx-part" aria-label="Skills">
          <div className="fx-part__head">
            <span className="fx-part__label">Skills</span>
            <span className="fx-part__tokens">about {tokens(preview.skills_tokens)}</span>
          </div>
          <ul className="fx-preview__skills">
            {preview.skills.map((s) => (
              <li key={s.name}>
                <span className="fx-part__label">{s.name}</span>
                {s.fetched_at_run_time
                  ? " · fetched when the team runs"
                  : ` · about ${tokens(s.tokens)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
