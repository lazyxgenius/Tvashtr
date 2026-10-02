import "./live.css";

import { CornerDownRight, Info, Layers, Play, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  Button,
  Checkbox,
  IconButton,
  Select,
  TextArea,
  useDismiss,
} from "../../../design-system/components";
import type { RunRow } from "../../../lib/api";
import {
  type CarryChoice,
  type CarryDecision,
  getCarry,
  type NextInfo,
  type StartFrom,
} from "../../../lib/api/startFrom";
import { ApiDetailError } from "../../../lib/api/runs";
import { routeToHash } from "../../../lib/nav";
import { useModalDialog } from "../../../lib/useModalDialog";
import { LoadState } from "../../runs/RunsTab";
import { useLoaded } from "../../runs/useLoaded";

/** "Spec approved" / "The reviewer’s rule: every indicator is registered on INDICATORS". */
const decisionText = (d: CarryDecision) => (d.text ? `${d.title}: ${d.text}` : d.title);

const memoriesCount = (n: number) => (n === 1 ? "1 memory" : `${n} memories`);

/**
 * M10 — "Start a new run from run #12" (Runs › Next-Carry; Next-CarryMerged): the next task, what
 * comes along (R9), where it starts from, what stays behind, then Start run. A refusal shows its
 * reason above the footer and the dialog stays open.
 */
/** "Product manager" → "product manager" in a sentence; a name like "PM" stays as it is. */
const agentWord = (name: string) =>
  /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;

/** The server's refusal, in the words Next-CarryMerged draws for full run slots. */
function refusal(e: unknown): string {
  const detail = e instanceof ApiDetailError ? (e.detail as { code?: string } | null) : null;
  const limit = /limit (\d+)/.exec(e instanceof Error ? e.message : "")?.[1];
  if (detail?.code === "owner_concurrency_limit" && limit)
    return `You have ${limit} runs going, the most at once. Start this one when one of them finishes.`;
  return e instanceof Error ? e.message : String(e);
}

export function StartNextDialog({
  info,
  onStart,
  onCancel,
}: {
  info: NextInfo;
  /** Start the new run (and open it); rejects with the server's reason. */
  onStart: (body: { task: string; carry: CarryChoice; start_from: StartFrom }) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // While Start run is on its way nothing cancels it: its answer is still coming.
  const cancel = () => {
    if (!busy) onCancel();
  };
  const ref = useModalDialog<HTMLDivElement>(true, cancel);
  const has: CarryChoice = {
    spec: info.spec !== null,
    decisions: info.decisions.length > 0,
    memories: info.memories.length > 0,
    summaries: info.summaries.length > 0,
  };
  const [carry, setCarry] = useState<CarryChoice>(has);
  const [task, setTask] = useState("");
  const [from, setFrom] = useState<StartFrom>(info.default_start);
  const [error, setError] = useState<string | null>(null);
  const run = `run #${info.run.number}`;
  const tick = (key: keyof CarryChoice) => ({
    checked: carry[key],
    disabled: !has[key] || busy,
    onChange: () => setCarry({ ...carry, [key]: !carry[key] }),
  });
  const mainLabel = info.start_from.find((o) => o.value === "main")?.label ?? "main";
  const fromNote = info.pr
    ? info.pr.merged
      ? `Pull request #${info.pr.number} is merged, so the new run starts from ${mainLabel}.`
      : `Pull request #${info.pr.number} isn’t merged yet.`
    : null;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onStart({ task: task.trim(), carry, start_from: from });
    } catch (e) {
      setError(refusal(e));
      setBusy(false);
    }
  };
  const title = `Start a new run from ${run}`;
  return createPortal(
    <>
      <div className="ds-scrim" onClick={cancel} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="lv-confirm lv-next"
        tabIndex={-1}
      >
        <header className="lv-confirm__head">
          <span className="lv-confirm__icon">
            <CornerDownRight size={17} strokeWidth={1.6} aria-hidden />
          </span>
          <div className="lv-confirm__titles">
            <h2 className="lv-confirm__title">{title}</h2>
            <div className="lv-confirm__sub">
              The team starts with what {run} finished with, so it doesn’t redo or forget it.
            </div>
          </div>
          <IconButton size="sm" aria-label="Close" title="Close" onClick={cancel} disabled={busy}>
            <X size={16} strokeWidth={1.6} aria-hidden />
          </IconButton>
        </header>
        <div className="lv-confirm__body">
          <TextArea
            label="What should the team do next?"
            rows={3}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            disabled={busy}
          />
          <div className="lv-next__along">
            <span className="lv-confirm__eyebrow">Brings along</span>
            <Checkbox
              label={
                has.spec
                  ? `The final spec${info.spec?.version != null ? ` (v${info.spec.version})` : ""}`
                  : "The final spec (none)"
              }
              description={`Becomes the starting spec. The ${agentWord(info.entry_agent ?? "Product manager")} updates it for the new task.`}
              {...tick("spec")}
            />
            <Checkbox
              label={`Your decisions (${has.decisions ? info.decisions.length : "none"})`}
              description={
                has.decisions
                  ? info.decisions.map(decisionText).join(" · ")
                  : `You didn’t approve or change anything in ${run}.`
              }
              {...tick("decisions")}
            />
            <Checkbox
              label={`What the agents learned (${has.memories ? memoriesCount(info.memories.length) : "none"})`}
              description={`Confirmed memories from ${run}.${info.pending_memories > 0 ? " New ones still wait for your review." : ""}`}
              {...tick("memories")}
            />
            <Checkbox
              label="A short summary from each agent"
              description="What each one did and why, in a few lines"
              {...tick("summaries")}
            />
          </div>
          <Select
            label="Start from"
            options={info.start_from}
            value={from}
            onChange={(e) => setFrom(e.target.value as StartFrom)}
            disabled={busy}
          />
          {fromNote && <div className="lv-next__from-note">{fromNote}</div>}
          <div className="lv-confirm__skips lv-next__left">
            <span className="lv-confirm__mark">
              <Info size={18} strokeWidth={1.6} aria-hidden />
            </span>
            <div className="lv-confirm__skips-text">
              <div className="lv-confirm__skips-title">
                Left behind: the agents’ full conversations
              </div>
              <div className="lv-confirm__skips-sub">
                They stay with {run}. Open it and use Ask if you need something from them.
              </div>
            </div>
          </div>
        </div>
        {error && (
          <div className="lv-confirm__error lv-next__error" role="alert">
            {error}
          </div>
        )}
        <footer className="lv-confirm__foot">
          <div className="lv-confirm__foot-note">
            <Layers size={14} strokeWidth={1.6} aria-hidden />
            Uses the team as it is now
            {info.team.version != null ? ` (v${info.team.version})` : ""}
          </div>
          <div className="lv-confirm__actions">
            <Button variant="ghost" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="cv-btn-flush"
              loading={busy}
              disabled={!task.trim()}
              onClick={() => void go()}
            >
              <Play size={14} fill="currentColor" strokeWidth={0} aria-hidden />
              <span>Start run</span>
            </Button>
          </div>
        </footer>
      </div>
    </>,
    document.body,
  );
}

/** The run bar's "From run #12" (Next-Started): a link to the run this one started from. */
export function StartedFrom({
  from,
  teamId,
}: {
  from: NonNullable<RunRow["started_from"]>;
  teamId: string;
}) {
  return (
    <a className="lv-resumed" href={routeToHash({ page: "team", teamId, runId: from.run_id })}>
      <CornerDownRight size={12} strokeWidth={2} aria-hidden />
      {from.number != null ? `From run #${from.number}` : "From an earlier run"}
    </a>
  );
}

/**
 * The Activity's "See what came along" (Next-CameAlong): what the run started from brought, read
 * from its carry snapshot. As drawn, it opens on the right over the run's canvas, 8px below its top
 * (the Activity list scrolls, so it is not inside), and scrolls itself when the window is short.
 */
export function CameAlong({ runId }: { runId: string }) {
  const [at, setAt] = useState<number | null>(null);
  return (
    <>
      <CameAlongButton open={at !== null} onOpen={setAt} />
      {at !== null && <CameAlongPopover runId={runId} at={at} onClose={() => setAt(null)} />}
    </>
  );
}

/** The Activity line's "See what came along"; `onOpen` gets the popover's top (8px below the
 *  run's canvas). */
export function CameAlongButton({
  open,
  onOpen,
}: {
  open: boolean;
  onOpen: (top: number) => void;
}) {
  return (
    <button
      type="button"
      className="lv-linkbtn lv-linkbtn--accent"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(e) => {
        const canvas = document.querySelector(".cv-canvas") ?? e.currentTarget;
        onOpen(Math.max(8, canvas.getBoundingClientRect().top + 8));
      }}
    >
      See what came along
    </button>
  );
}

/** The popover itself, owned by whoever keeps it open (the Activity panel keeps it open while
 *  its line scrolls out of the last few). */
export function CameAlongPopover({
  runId,
  at,
  onClose,
}: {
  runId: string;
  at: number;
  onClose: () => void;
}) {
  const pop = useRef<HTMLDivElement>(null);
  const close = onClose;
  useDismiss(true, close, pop);
  const carry = useLoaded(runId, () => getCarry(runId));
  const c = carry.value;
  const n = c?.from.number;
  const run = n != null ? `run #${n}` : "an earlier run";
  if (carry.state === "loading") return null;
  return createPortal(
    <div
      ref={pop}
      role="dialog"
      aria-label={`What came along from ${run}`}
      className="lv-came"
      style={{ top: at, maxHeight: `calc(100vh - ${at + 16}px)` }}
    >
      <div className="lv-came__head">
        <span className="lv-came__title">What came along from {run}</span>
        <IconButton size="sm" aria-label="Close" title="Close" onClick={close}>
          <X size={16} strokeWidth={1.6} aria-hidden />
        </IconButton>
      </div>
      {!c ? (
        <LoadState
          state="error"
          loading=""
          error="Couldn’t load what came along."
          onRetry={carry.retry}
        />
      ) : (
        <>
          {c.spec && (
            <Part title="The final spec">
              <div className="lv-came__item">
                Spec{c.spec.version != null ? ` v${c.spec.version}` : ""} · became this run’s
                starting spec
              </div>
            </Part>
          )}
          {c.decisions.length > 0 && (
            <Part title={`Your decisions (${c.decisions.length})`}>
              {c.decisions.map((d, i) => (
                <div key={i} className="lv-came__item">
                  {decisionText(d)}
                </div>
              ))}
            </Part>
          )}
          {c.memories.length > 0 && (
            <Part title={`What the agents learned (${memoriesCount(c.memories.length)})`}>
              {c.memories.map((m) => (
                <div key={m.id} className="lv-came__item">
                  {m.content}
                </div>
              ))}
            </Part>
          )}
          {c.summaries.length > 0 && (
            <Part title="A short summary from each agent">
              {c.summaries.map((s, i) => (
                <div key={i} className="lv-came__item">
                  <span className="lv-came__agent">{s.agent}</span> · {s.text}
                </div>
              ))}
            </Part>
          )}
          <div className="lv-came__foot">
            Left behind: the agents’ full conversations. They stay with {run}.
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="lv-came__part">
      <span className="lv-confirm__eyebrow">{title}</span>
      {children}
    </div>
  );
}
