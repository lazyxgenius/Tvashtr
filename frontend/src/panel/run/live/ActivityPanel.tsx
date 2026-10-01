import "./live.css";

import { useEffect, useRef, useState } from "react";

import { Button, IconButton } from "../../../design-system/components";
import type { ActivityLine, PinnedCallout, RunActivity } from "../../../lib/api/activity";
import { clock, duration } from "./liveFormat";
import { StateGlyph } from "./StateGlyph";

/** What the panel's buttons do — the run view wires each to an existing action. */
export interface ActivityActions {
  onViewChange: (nodeId: string) => void;
  onOpenDocument: (documentId: string) => void;
  onApprove: (taskId: number) => void;
  onReject: (taskId: number) => void;
  onReviewSpec: () => void;
  onSwitchBackup: (nodeId: string) => void;
  onStop: () => void;
  onRetryFromStart: () => void;
}

/** The steps shown before "Show N earlier steps" (the boards show the last six). */
const SHOWN = 6;

const KIND_ICON: Record<string, "ok" | "warn" | "danger" | "live" | "idle"> = {
  gate_approved: "ok",
  gate_waiting: "live",
  gate_rejected: "danger",
  retry: "warn",
  backup: "warn",
  stalled: "danger",
  error: "danger",
  done: "ok",
  pr: "ok",
};

function iconTone(l: ActivityLine): string {
  if (l.tone === "danger") return "danger";
  if (l.tone === "warn") return "warn";
  if (l.tone === "ok") return "ok";
  return KIND_ICON[l.kind] ?? (l.refs.running ? "live" : "idle");
}

function Line({
  line,
  now,
  actions,
}: {
  line: ActivityLine;
  now: number;
  actions: ActivityActions;
}) {
  const [open, setOpen] = useState(false);
  const r = line.refs;
  const output = r.output_tail && r.output_tail.length > 0;
  let what: React.ReactNode = line.text;
  let extra: React.ReactNode = null;
  if (line.kind === "edited" && r.file) {
    what = (
      <>
        Edited <code className="lv-code">{r.file}</code>{" "}
        {r.added != null && <span className="lv-plus">+{r.added}</span>}{" "}
        {r.removed != null && <span className="lv-minus">−{r.removed}</span>}
      </>
    );
    if (line.node_id) {
      extra = (
        <button
          type="button"
          className="lv-linkbtn lv-linkbtn--accent"
          onClick={() => actions.onViewChange(line.node_id as string)}
        >
          View change
        </button>
      );
    }
  } else if ((line.kind === "tests" || line.kind === "command") && r.running) {
    extra = (
      <span>
        live ·{" "}
        {duration((now - Date.parse(r.started_at ?? line.at)) / 1000).replace(/^(\d+)s$/, "$1 s")}
      </span>
    );
  } else if ((line.kind === "tests" || line.kind === "command") && output) {
    extra = (
      <button
        type="button"
        className="lv-linkbtn lv-linkbtn--accent"
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide output" : "Show output"}
      </button>
    );
  } else if (line.kind === "read" && r.files && r.files.length > 1) {
    extra = (
      <button type="button" className="lv-linkbtn" onClick={() => setOpen(!open)}>
        {open ? "Hide files" : "Show files"}
      </button>
    );
  } else if (line.kind === "verdict" && r.reasons) {
    extra = (
      <button
        type="button"
        className="lv-linkbtn lv-linkbtn--accent"
        onClick={() => setOpen(!open)}
      >
        Read notes
      </button>
    );
  } else if (line.kind === "wrote_doc" && r.document_id) {
    extra = (
      <button
        type="button"
        className="lv-linkbtn lv-linkbtn--accent"
        onClick={() => actions.onOpenDocument(r.document_id as string)}
      >
        Open spec
      </button>
    );
  } else if (line.kind === "pr" && r.pr_url) {
    extra = (
      <a className="lv-linkbtn lv-linkbtn--accent" href={r.pr_url} target="_blank" rel="noreferrer">
        Open on GitHub
      </a>
    );
  }
  const body =
    line.kind === "read"
      ? (r.files ?? []).join("\n")
      : line.kind === "verdict"
        ? (r.reasons ?? "")
        : [r.command ? `$ ${r.command}` : null, ...(r.output_tail ?? [])]
            .filter(Boolean)
            .join("\n");
  return (
    <li className="lv-line">
      <span className="lv-line__time">{clock(line.at)}</span>
      <span className={`lv-line__icon lv-line__icon--${iconTone(line)}`}>
        <StateGlyph
          state={line.tone === "ok" ? "done" : r.running ? "running_command" : "waiting"}
        />
      </span>
      <span className="lv-line__who">{line.label}</span>
      <span className="lv-line__what">{what}</span>
      <span className="lv-line__extra">{extra}</span>
      {open && body && <div className="lv-out">{body}</div>}
    </li>
  );
}

function Pinned({ pin, actions }: { pin: PinnedCallout; actions: ActivityActions }) {
  const tone =
    pin.kind === "gate"
      ? ""
      : pin.kind === "retrying"
        ? " lv-pin__box--warn"
        : " lv-pin__box--danger";
  return (
    <div className="lv-pin">
      <div className={`lv-pin__box${tone}`} role="status">
        <span className="lv-pin__icon">
          <StateGlyph
            state={
              pin.kind === "gate" ? "needs_you" : pin.kind === "retrying" ? "retrying" : "stalled"
            }
          />
        </span>
        <div className="lv-pin__body">
          <div className="lv-pin__title">{pin.title}</div>
          <div className="lv-pin__text">{pin.body}</div>
          <div className="lv-pin__actions">
            {pin.kind === "gate" && pin.task_id != null && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => actions.onApprove(pin.task_id as number)}
                >
                  Approve
                </Button>
                <Button variant="secondary" size="sm" onClick={actions.onReviewSpec}>
                  Review the spec
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => actions.onReject(pin.task_id as number)}
                >
                  Reject
                </Button>
              </>
            )}
            {pin.kind === "retrying" && pin.node_id && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => actions.onSwitchBackup(pin.node_id as string)}
                >
                  Switch to the backup model now
                </Button>
                <Button variant="ghost" size="sm" onClick={actions.onStop}>
                  Stop run
                </Button>
              </>
            )}
            {pin.kind === "stalled" && (
              <Button variant="secondary" size="sm" onClick={actions.onStop}>
                Stop run
              </Button>
            )}
            {pin.kind === "failed" && (
              <Button variant="secondary" size="sm" onClick={actions.onRetryFromStart}>
                Retry from the start
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * M2 — the Activity panel (Runs › Live-*): every agent's steps in plain words, run-wide; filter by
 * agent; "Jump to live"; "Show N earlier steps"; the one thing needing action pinned on top.
 */
export function ActivityPanel({
  activity,
  now = Date.now(),
  actions,
}: {
  activity: RunActivity;
  now?: number;
  actions: ActivityActions;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [earlier, setEarlier] = useState(false);
  const [folded, setFolded] = useState(false);
  const [follow, setFollow] = useState(true);
  const list = useRef<HTMLOListElement>(null);

  const agents = activity.agents.filter(
    (a) =>
      !["terminal", "ship", "stop"].includes(a.kind) &&
      activity.lines.some((l) => l.node_id === a.node_id),
  );
  const lines = filter ? activity.lines.filter((l) => l.node_id === filter) : activity.lines;
  const hiddenCount = earlier ? 0 : Math.max(0, lines.length - SHOWN);
  const shown = lines.slice(hiddenCount);

  useEffect(() => {
    if (follow && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [follow, shown.length]);

  return (
    <section className={`lv-act${folded ? " lv-act--folded" : ""}`} aria-label="Activity">
      <div className="lv-act__head">
        <span className="lv-act__title">Activity</span>
        <span className="lv-act__count">
          {activity.total} {activity.total === 1 ? "step" : "steps"}
          {folded ? " · hidden" : ""}
        </span>
        {!folded && (
          <div className="tv-seg">
            <button
              type="button"
              className={`tv-seg__btn${filter === null ? " tv-seg__btn--active" : ""}`}
              onClick={() => setFilter(null)}
            >
              All
            </button>
            {agents.map((a) => (
              <button
                key={a.node_id}
                type="button"
                className={`tv-seg__btn${filter === a.node_id ? " tv-seg__btn--active" : ""}`}
                onClick={() => setFilter(a.node_id)}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        <div className="lv-act__tools">
          {!folded && (
            <Button variant="ghost" size="sm" onClick={() => setFollow(true)}>
              Jump to live
            </Button>
          )}
          <IconButton
            size="sm"
            aria-label={folded ? "Show activity" : "Hide activity"}
            title={folded ? "Show activity" : "Hide activity"}
            onClick={() => setFolded(!folded)}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={folded ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
            </svg>
          </IconButton>
        </div>
      </div>
      {!folded && (
        <>
          {activity.pinned && <Pinned pin={activity.pinned} actions={actions} />}
          {hiddenCount > 0 && (
            <div className="lv-act__earlier">
              <button type="button" className="lv-linkbtn" onClick={() => setEarlier(true)}>
                Show {hiddenCount} earlier {hiddenCount === 1 ? "step" : "steps"}
              </button>
            </div>
          )}
          <ol
            className="lv-act__list"
            ref={list}
            onScroll={(e) => {
              const el = e.currentTarget;
              setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
            }}
          >
            {shown.map((l) => (
              <Line key={l.id} line={l} now={now} actions={actions} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
