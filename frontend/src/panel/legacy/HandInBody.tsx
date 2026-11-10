import { Lock } from "lucide-react";

/** M2: the Hand in ending's drawer (prompts/m2-design/ExampleBuilder.dc.html): where the drafts go,
 *  what is always on, and what the customer can change. Nothing to set. */
export function HandInBody() {
  return (
    <div className="tv-scroll tv-node-edit hi-body">
      <p className="hi-lede">
        The drafts go to the model you start this team from, on its Drafts tab. Nothing joins its
        tests or training examples until you accept it.
      </p>
      <div className="hi-group">
        <span className="hi-eyebrow">Always on</span>
        <div className="hi-row">
          <div className="hi-row__text">
            <b>Source check</b>
            <span>
              Each quote must be in the named file. Each answer must be one of the model's choices.
            </span>
          </div>
          <span className="hi-locked">
            <Lock size={13} strokeWidth={1.7} aria-hidden />
            Built in
          </span>
        </div>
        <div className="hi-row">
          <div className="hi-row__text">
            <b>Tests stay apart</b>
            <span>A draft that matches one of your tests can't be accepted as training.</span>
          </div>
          <span className="hi-locked">
            <Lock size={13} strokeWidth={1.7} aria-hidden />
            Built in
          </span>
        </div>
      </div>
      <div className="hi-group">
        <span className="hi-eyebrow">You can change</span>
        <span className="hi-text">
          Everything on the canvas: add a second Reviewer, change a prompt, pick other models, or
          add a gate for you to approve the plan first.
        </span>
      </div>
    </div>
  );
}

/** M2: the agent panel's one read-only line for an examples grant, else nothing. */
export function ExamplesGrantLine({ toolConfig }: { toolConfig?: Record<string, unknown> | null }) {
  const meta = (toolConfig?.tvashtr ?? null) as Record<string, unknown> | null;
  const grant = meta?.examples;
  const line =
    grant === "write"
      ? "Can hand in examples"
      : grant === "review"
        ? "Can review examples"
        : grant === "read"
          ? "Can read the examples brief"
          : null;
  if (!line) return null;
  return (
    <div className="hi-grant" role="note">
      <Lock size={13} strokeWidth={1.7} aria-hidden />
      {line}
    </div>
  );
}
