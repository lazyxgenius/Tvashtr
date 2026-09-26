/**
 * One subscription card (Eng-Subs, Eng-CardStates, Eng-Flow-Grok-*, Eng-Flow-Codex-*): the letter
 * tile, name and account line, the status badge(s), what it covers and who uses it, the state's
 * message and its actions. Everything it shows comes from `subscriptionCard()`; the page runs the
 * actions.
 */
import { Terminal } from "lucide-react";

import { Badge, Button } from "../../design-system/components";
import type { CardAction, CardView } from "./subscriptionModel";

export function SubscriptionCard({
  view,
  highlight = false,
  onAction,
}: {
  view: CardView;
  /** A `tvashtr://…?connect=` link pointed at this card. */
  highlight?: boolean;
  onAction: (action: CardAction) => void;
}) {
  const titleId = `eng-sub-${view.sub}`;
  const { message } = view;
  return (
    <article
      className={`eng-sub${view.ok ? " eng-sub--ok" : ""}${highlight ? " eng-sub--highlight" : ""}`}
      data-highlight={highlight || undefined}
      aria-labelledby={titleId}
      data-sub={view.sub}
    >
      <div className="eng-sub__head">
        <span className="eng-sub__tile" aria-hidden>
          {view.letter}
        </span>
        <div>
          <div className="eng-sub__name" id={titleId}>
            {view.name}
          </div>
          {view.account && <div className="eng-sub__account">{view.account}</div>}
        </div>
        <span className="eng-sub__badges">
          {view.badges.map((b) => (
            <Badge key={b.text} variant={b.variant} dot={b.dot}>
              {b.text}
            </Badge>
          ))}
        </span>
      </div>
      <dl className="eng-sub__meta">
        <dt>Covers</dt>
        <dd>
          <span className="eng-code">{view.coversCode}</span>
          {view.coversRest}
        </dd>
        <dt>Used by</dt>
        <dd>{view.usedBy}</dd>
      </dl>
      <div className="eng-sub__msg">
        {message.kind === "terminal" ? (
          <div className="eng-sub__callout eng-sub__callout--terminal" role="status">
            <Terminal size={14} strokeWidth={1.6} aria-hidden />
            <span>{message.text}</span>
          </div>
        ) : message.kind === "warn" ? (
          <div className="eng-sub__callout eng-sub__callout--warn" role="note">
            {message.text}
          </div>
        ) : (
          <>
            {message.text}
            {message.link && (
              <>
                {" "}
                <a
                  className="eng-sub__link"
                  href={message.link.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {message.link.label}
                </a>
              </>
            )}
          </>
        )}
      </div>
      <div className="eng-sub__actions">
        {view.actions.map((a) => (
          <Button
            key={a.kind}
            variant={a.variant}
            size="sm"
            loading={a.loading}
            disabled={a.disabled}
            onClick={() => onAction(a)}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </article>
  );
}
