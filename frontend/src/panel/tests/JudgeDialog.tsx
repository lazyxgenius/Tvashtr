import { Check, CircleCheck, Info, ThumbsUp, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { VersionDialog } from "../../canvas/VersionDialogs";
import { Button } from "../../design-system/components";
import {
  type AgentTest,
  judgeCheck,
  type JudgeResult,
  listAnswers,
} from "../../lib/api/agentTests";
import { serverWords } from "../../lib/myAgentsFormat";
import { LoadState } from "../runs/RunsTab";
import { useLoaded } from "../runs/useLoaded";
import "./tests.css";

/** The answers shown at first, and after each "Label more" (Test-Judge draws seven). */
const PAGE = 7;
/** Labels are sent this long after the last change (the latest answer wins). */
const JUDGE_DEBOUNCE_MS = 400;

const clip = (s: string) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);

/**
 * M7 Test-Judge: "Check the AI check". Label saved answers Yes / No yourself; each change runs the
 * AI check on the labelled answers (on Tvashtr's key, R7) and says how often it agrees with you —
 * trusted at 8 of 10 or better. The answer that failed is listed first.
 */
export function JudgeDialog({
  teamId,
  nodeId,
  test,
  check,
  first,
  onClose,
  onUsed,
}: {
  teamId: string;
  nodeId: string;
  test: AgentTest;
  /** The index of the AI check in the test's checks. */
  check: number;
  /** The answer it failed on. */
  first: string | null;
  onClose: () => void;
  onUsed: () => void;
}) {
  const answers = useLoaded(`judge:${test.id}`, () => listAnswers(teamId, nodeId, test.id));
  const [shown, setShown] = useState(PAGE);
  const [labels, setLabels] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // The server keys answers by their trimmed text.
  const top = first?.trim() || null;
  const texts = [
    ...(top ? [top] : []),
    ...(answers.value ?? []).map((a) => a.text.trim()).filter((t) => t && t !== top),
  ];
  const visible = texts.slice(0, shown);
  const judged = new Map((result?.rows ?? []).map((r) => [r.answer, r]));

  useEffect(() => {
    if (labels.size === 0) return;
    const mine = ++seq.current;
    const t = window.setTimeout(() => {
      judgeCheck(teamId, nodeId, test.id, {
        check,
        labels: [...labels].map(([answer, you]) => ({ answer, you })),
      }).then(
        (res) => {
          if (mine !== seq.current) return;
          setResult(res);
          setError(null);
        },
        (err: unknown) => {
          if (mine === seq.current) setError(serverWords(err, "Couldn’t run the AI check."));
        },
      );
    }, JUDGE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [labels, teamId, nodeId, test.id, check]);

  const label = (answer: string, you: boolean) => {
    const next = new Map(labels);
    if (next.get(answer) === you) next.delete(answer);
    else next.set(answer, you);
    setLabels(next);
  };
  const misses = (result?.rows ?? []).filter((r) => r.ai !== null && r.ai !== r.you);

  return (
    <VersionDialog
      title="Check the AI check"
      icon={<ThumbsUp size={17} strokeWidth={1.6} aria-hidden />}
      sub="Label a few saved answers yourself. If the AI check agrees with you on at least 8 of 10, you can rely on it in tests."
      size="tt-dlg--judge"
      onClose={onClose}
      footNote="Your labels are saved with the test"
      actions={
        <>
          {texts.length > shown && (
            <Button variant="ghost" onClick={() => setShown(shown + PAGE)}>
              Label more
            </Button>
          )}
          <Button variant="primary" className="tt-flush" onClick={onUsed}>
            <Check size={14} strokeWidth={2} aria-hidden />
            <span>Use this check</span>
          </Button>
        </>
      }
    >
      <div className="lv-confirm__card">
        <span className="tt-eyebrow">The check</span>
        <div className="tt-judge__check">{test.checks[check]?.value}</div>
      </div>
      {answers.state === "loading" || answers.state === "error" ? (
        <LoadState
          state={answers.state}
          loading="Loading saved answers"
          error="Couldn’t load the saved answers."
          onRetry={answers.retry}
        />
      ) : (
        <div className="tt-section tt-section--checks">
          <div className="tt-judge__head" aria-hidden>
            <span />
            <span className="tt-eyebrow">Saved answer</span>
            <span className="tt-eyebrow">You</span>
            <span className="tt-eyebrow">AI check</span>
          </div>
          <ul className="tt-judge" aria-label="Saved answers">
            {visible.map((text, i) => {
              const you = labels.get(text);
              const row = judged.get(text);
              const ai = row && you !== undefined ? row.ai : undefined;
              const miss = ai !== undefined && ai !== null && ai !== you;
              return (
                <li key={text} className={miss ? "tt-judge__miss" : undefined}>
                  <span className="tt-judge__n">{i + 1}</span>
                  <span className="tt-judge__answer" title={text}>
                    {text}
                  </span>
                  <span className="tt-judge__you" role="group" aria-label={`You: answer ${i + 1}`}>
                    <button
                      type="button"
                      className="tt-yn tt-yn--yes"
                      aria-pressed={you === true}
                      onClick={() => label(text, true)}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className="tt-yn"
                      aria-pressed={you === false}
                      onClick={() => label(text, false)}
                    >
                      No
                    </button>
                  </span>
                  <span className="tt-judge__ai" aria-label={`AI check: answer ${i + 1}`}>
                    {ai === true && <span className="tt-pill tt-pill--good">Yes</span>}
                    {ai === false && <span className="tt-pill">No</span>}
                    {ai === null && (
                      <span className="tt-pill" title={row?.reason ?? undefined}>
                        Not run
                      </span>
                    )}
                    {miss && (
                      <span className="tt-judge__warn" title="Not what you said">
                        <TriangleAlert size={13} strokeWidth={1.6} aria-label="Not what you said" />
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {result && result.total > 0 && !error && (
        <div
          className={`lv-confirm__skips tt-callout${result.trusted ? "" : " tt-callout--plain"}`}
          role="status"
        >
          <span className="lv-confirm__mark" aria-hidden>
            {result.trusted ? (
              <CircleCheck size={18} strokeWidth={1.6} />
            ) : (
              <Info size={18} strokeWidth={1.6} />
            )}
          </span>
          <div className="lv-confirm__skips-text">
            <div className="lv-confirm__skips-title">
              Agrees with you on {result.agree} of {result.total}
            </div>
            {misses.length === 1 && (
              <div className="lv-confirm__skips-sub">
                The one miss: it said {misses[0].ai ? "Yes" : "No"} to “{clip(misses[0].answer)}”.
              </div>
            )}
          </div>
        </div>
      )}
      {error && (
        <div className="lv-confirm__error" role="alert">
          {error}
        </div>
      )}
    </VersionDialog>
  );
}
