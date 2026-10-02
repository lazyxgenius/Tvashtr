import "./live.css";

import {
  ArrowRight,
  Check,
  CircleX,
  ClipboardCheck,
  FileCode,
  FileText,
  Info,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { Button, IconButton } from "../../../design-system/components";
import type { ResumedFrom as ResumedFromRun } from "../../../lib/api/activity";
import type { ResumeInfo, ResumePoint } from "../../../lib/api/resume";
import { routeToHash } from "../../../lib/nav";
import { useModalDialog } from "../../../lib/useModalDialog";
import { money } from "../../../pages/home/homeFormat";
import { aboutMinutes, clock } from "./liveFormat";

/** "run #12", or "this run" when the run has no number (launched without a library team). */
const runName = (n: number | null) => (n != null ? `run #${n}` : "this run");
const runNameStart = (n: number | null) => (n != null ? `Run #${n}` : "This run");

/** A kept item's words with its file paths set as code ("changes to core/indicators.py and …"). */
function WithPaths({ text }: { text: string }) {
  // ponytail: a path is a word with a slash in it; good enough for the server's kept lines.
  return (
    <>
      {text.split(/(\S+\/\S+)/).map((part, i) =>
        i % 2 ? (
          <code key={i} className="lv-code">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

const ROLE_ICON: Record<string, typeof FileText> = {
  pm: FileText,
  engineer: FileCode,
  reviewer: ClipboardCheck,
};

/**
 * M3 — "Resume run #12" (Runs › Prob-Pick): the run's steps in the order they ran, each Kept or
 * Suggested (the step that failed or stalled), with "Resume from here" on every agent step that can
 * resume (gates have none).
 */
export function ResumePick({
  info,
  roleOf,
  onPick,
  onClose,
}: {
  info: ResumeInfo;
  /** A step's role (pm / engineer / reviewer) for its icon. */
  roleOf?: (nodeId: string) => string | undefined;
  onPick: (point: ResumePoint) => void;
  onClose: () => void;
}) {
  const title = info.number != null ? `Resume run #${info.number}` : "Resume this run";
  return (
    <aside className="lv-pick" aria-label={title}>
      <header className="lv-pick__head">
        <span className="lv-pick__icon">
          <RotateCcw size={17} strokeWidth={1.6} aria-hidden />
        </span>
        <div className="lv-pick__titles">
          <div className="lv-pick__title">{title}</div>
          <div className="lv-pick__sub">
            Pick where to start again. Everything before that step is kept.
          </div>
        </div>
        <IconButton size="sm" aria-label="Close" title="Close" onClick={onClose}>
          <X size={16} strokeWidth={1.6} aria-hidden />
        </IconButton>
      </header>
      <div className="lv-pick__body">
        <ol className="lv-pick__list">
          {info.points.map((p) => {
            const suggested = p.state === "suggested";
            const gate = p.kind === "gate";
            const Icon = suggested
              ? CircleX
              : gate
                ? ShieldCheck
                : (ROLE_ICON[roleOf?.(p.node_id) ?? ""] ?? FileText);
            const tone = suggested ? "danger" : gate ? "ok" : "idle";
            return (
              <li
                key={p.invocation_id}
                className={`lv-pick__step${suggested ? " lv-pick__step--suggested" : ""}`}
              >
                <div className="lv-pick__row">
                  <span className={`lv-pick__sq lv-pick__sq--${tone}`}>
                    <Icon size={13} strokeWidth={1.6} aria-hidden />
                  </span>
                  <div className="lv-pick__what">
                    <div className="lv-pick__name">{p.title}</div>
                    <div className="lv-pick__text">
                      {suggested ? <span className="lv-tone--danger">{p.text}</span> : p.text}
                    </div>
                  </div>
                  <span
                    className={`lv-pick__chip lv-pick__chip--${suggested ? "suggested" : "kept"}`}
                  >
                    {suggested ? "Suggested" : "Kept"}
                  </span>
                </div>
                <div className="lv-pick__foot">
                  <span className="lv-pick__meta">
                    {clock(p.at).slice(0, 5)}
                    {p.cost_usd != null && ` · ${money(p.cost_usd)}`}
                  </span>
                  {p.resumable && p.confirm && (
                    <Button
                      variant={suggested ? "primary" : "ghost"}
                      size="sm"
                      className="cv-btn-flush"
                      onClick={() => onPick(p)}
                    >
                      {suggested && <RotateCcw size={14} strokeWidth={2} aria-hidden />}
                      <span>Resume from here</span>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="lv-pick__note">
          Resuming from a step keeps everything above it and runs that step again, then carries on
          through the team as usual.
        </p>
      </div>
      <footer className="lv-pick__bar">
        <span className="lv-pick__bar-note">
          Uses the same team setup as {runName(info.number)}
        </span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </footer>
    </aside>
  );
}

/**
 * M3 — the confirm dialog (Runs › Prob-Confirm; Prob-ConfirmStalled when Resume stops the run
 * first): what is kept, what runs again, what it skips, then Resume run. A refusal shows its reason
 * here.
 */
export function ResumeConfirm({
  info,
  point,
  onResume,
  onCancel,
}: {
  info: ResumeInfo;
  point: ResumePoint;
  /** Start the resumed run; rejects with the server's reason. */
  onResume: () => Promise<unknown>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // While "Resume run" is on its way nothing cancels it: its answer (the new run, or a refusal to
  // show here) is still coming.
  const cancel = () => {
    if (!busy) onCancel();
  };
  const ref = useModalDialog<HTMLDivElement>(true, cancel);
  const [error, setError] = useState<string | null>(null);
  const c = point.confirm;
  if (!c) return null;
  const { number: n, next_number: next } = info;
  const sub = info.stops_run
    ? n != null && next != null
      ? `This stops run #${n} and starts run #${next}. It picks up where run #${n} got to.`
      : "This stops this run and starts a new one. It picks up where this one got to."
    : n != null && next != null
      ? `This starts run #${next}. It picks up where run #${n} stopped.`
      : "This starts a new run. It picks up where this one stopped.";
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onResume();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return createPortal(
    <>
      <div className="ds-scrim" onClick={cancel} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={c.title}
        className="lv-confirm"
        tabIndex={-1}
      >
        <header className="lv-confirm__head">
          <span className="lv-confirm__icon">
            <RotateCcw size={17} strokeWidth={1.6} aria-hidden />
          </span>
          <div className="lv-confirm__titles">
            <h2 className="lv-confirm__title">{c.title}</h2>
            <div className="lv-confirm__sub">{sub}</div>
          </div>
          <IconButton size="sm" aria-label="Close" title="Close" onClick={cancel} disabled={busy}>
            <X size={16} strokeWidth={1.6} aria-hidden />
          </IconButton>
        </header>
        <div className="lv-confirm__body">
          <div className="lv-confirm__cols">
            <div className="lv-confirm__card">
              <span className="lv-confirm__eyebrow">Kept</span>
              <ul className="lv-confirm__list">
                {c.kept.map((k, i) => (
                  <li key={i}>
                    <span className="lv-confirm__mark lv-tone--ok">
                      <Check size={14} strokeWidth={2} aria-hidden />
                    </span>
                    <span>
                      <WithPaths text={k.text} />
                      {k.at && `, ${clock(k.at).slice(0, 5)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="lv-confirm__card">
              <span className="lv-confirm__eyebrow">Runs again</span>
              <ul className="lv-confirm__list">
                {c.runs_again.map((text, i) => (
                  <li key={i}>
                    <span className={`lv-confirm__mark lv-tone--${i === 0 ? "live" : "idle"}`}>
                      {i === 0 ? (
                        <RotateCcw size={14} strokeWidth={2} aria-hidden />
                      ) : (
                        <ArrowRight size={14} strokeWidth={2} aria-hidden />
                      )}
                    </span>
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {(c.skips_cost_usd > 0 || c.skips_s > 0) && (
            <div className="lv-confirm__skips">
              <span className="lv-confirm__mark lv-tone--ok">
                <Check size={18} strokeWidth={1.6} aria-hidden />
              </span>
              <div className="lv-confirm__skips-text">
                <div className="lv-confirm__skips-title">
                  Skips work that already cost {money(c.skips_cost_usd)} and took{" "}
                  {aboutMinutes(c.skips_s)}
                </div>
                <div className="lv-confirm__skips-sub">
                  You only pay for the steps that run again.
                </div>
              </div>
            </div>
          )}
          <div className="lv-confirm__note">
            Uses the same team setup as {runName(n)}. Changes you made to the team since then are
            not used.
          </div>
          {error && (
            <div className="lv-confirm__error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer className="lv-confirm__foot">
          <div className="lv-confirm__foot-note">
            <Info size={14} strokeWidth={1.6} aria-hidden />
            {info.stops_run
              ? `${runNameStart(n)} is stopped first. What it did stays as it is`
              : `${runNameStart(n)} stays as it is`}
          </div>
          <div className="lv-confirm__actions">
            <Button variant="ghost" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="cv-btn-flush"
              loading={busy}
              onClick={() => void go()}
            >
              <RotateCcw size={14} strokeWidth={2} aria-hidden />
              <span>Resume run</span>
            </Button>
          </div>
        </footer>
      </div>
    </>,
    document.body,
  );
}

/** The run bar's "Resumed from #12" (Prob-Resumed): a link to the run this one resumed. */
export function ResumedFrom({ from, teamId }: { from: ResumedFromRun; teamId: string }) {
  return (
    <a className="lv-resumed" href={routeToHash({ page: "team", teamId, runId: from.run_id })}>
      <RotateCcw size={12} strokeWidth={2} aria-hidden />
      {from.number != null ? `Resumed from #${from.number}` : "Resumed from an earlier run"}
    </a>
  );
}
