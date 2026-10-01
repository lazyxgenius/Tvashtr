import "./live.css";

import { ArrowDown, Check, ChevronUp, FileText, RefreshCw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, IconButton } from "../../../design-system/components";
import type { ActivityLine, PinnedCallout, RunActivity } from "../../../lib/api/activity";
import { clock, currentLineIds, duration } from "./liveFormat";
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

/** "4 s" / "2m 10s" — how long since `iso`. */
const since = (iso: string, now: number) =>
  duration((now - Date.parse(iso)) / 1000).replace(/^(\d+)s$/, "$1 s");

/** A line's small square icon, in its tone. */
export function LineIcon({ line }: { line: ActivityLine }) {
  return (
    <span className={`lv-line__icon lv-line__icon--${iconTone(line)}`}>
      <StateGlyph
        state={line.tone === "ok" ? "done" : line.refs.running ? "running_command" : "waiting"}
      />
    </span>
  );
}

/** A line's words: an edit with its file and counts; the model, search or command a line ends
 *  with, set as code (Runs › Live-*). */
export function LineWhat({ line }: { line: ActivityLine }) {
  const r = line.refs;
  if (line.kind === "edited" && r.file) {
    return (
      <>
        Edited <code className="lv-code">{r.file}</code>{" "}
        {r.added != null && <span className="lv-plus">+{r.added}</span>}{" "}
        {r.removed != null && <span className="lv-minus">−{r.removed}</span>}
      </>
    );
  }
  const code = [r.to_model, r.query, r.command].find(
    (c): c is string => typeof c === "string" && c !== "" && line.text.endsWith(c),
  );
  if (!code) return <>{line.text}</>;
  return (
    <>
      {line.text.slice(0, -code.length)}
      <code className="lv-code">{code}</code>
    </>
  );
}

function Line({
  line,
  current,
  now,
  actions,
}: {
  line: ActivityLine;
  current: boolean;
  now: number;
  actions: ActivityActions;
}) {
  const [open, setOpen] = useState(false);
  const r = line.refs;
  const output = r.output_tail && r.output_tail.length > 0;
  let extra: React.ReactNode = null;
  if (line.kind === "edited" && r.file) {
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
    extra = <span className="lv-line__note">live · {since(r.started_at ?? line.at, now)}</span>;
  } else if (line.kind === "gate_waiting" && current) {
    extra = <span className="lv-line__note">{since(line.at, now)}</span>;
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
      <button type="button" className="lv-linkbtn lv-linkbtn--quiet" onClick={() => setOpen(!open)}>
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
        : // A running command's latest output stays in view (Live-Command); its command is in
          // the line already.
          [r.command && !r.running ? `$ ${r.command}` : null, ...(r.output_tail ?? [])]
            .filter(Boolean)
            .join("\n");
  return (
    <li className="lv-line">
      <span className="lv-line__time">{clock(line.at)}</span>
      <LineIcon line={line} />
      <span className="lv-line__who">{line.label}</span>
      <span className={`lv-line__what${current ? " lv-now-line" : ""}`}>
        <LineWhat line={line} />
      </span>
      <span className="lv-line__extra">{extra}</span>
      {(open || (r.running && output)) && body && <div className="lv-out">{body}</div>}
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
                  iconLeft={<Check size={14} strokeWidth={1.8} aria-hidden />}
                  onClick={() => actions.onApprove(pin.task_id as number)}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<FileText size={14} strokeWidth={1.6} aria-hidden />}
                  onClick={actions.onReviewSpec}
                >
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
                  iconLeft={<RefreshCw size={14} strokeWidth={1.6} aria-hidden />}
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
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Square size={14} strokeWidth={1.6} aria-hidden />}
                onClick={actions.onStop}
              >
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

  // Every agent a person sees, reached or not (the boards list the Reviewer before it starts); a
  // gate only once the run reaches it, so an unused escalation gate stays out.
  const agents = activity.agents.filter(
    (a) =>
      a.kind !== "terminal" &&
      (a.kind !== "gate" ||
        a.live_state !== "waiting" ||
        activity.lines.some((l) => l.node_id === a.node_id)),
  );
  const current = currentLineIds(activity.lines);
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
          <div className="tv-seg lv-seg">
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
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<ArrowDown size={14} strokeWidth={1.6} aria-hidden />}
              onClick={() => setFollow(true)}
            >
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
                <ChevronUp size={12} strokeWidth={1.8} aria-hidden />
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
              <Line key={l.id} line={l} current={current.has(l.id)} now={now} actions={actions} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
