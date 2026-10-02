import { CHECK_LABEL, elapsedText } from "../../lib/agentTestsFormat";
import { type CheckResult, getReplay, type ReplayDetail } from "../../lib/api/agentTests";
import { formatRelativeTime } from "../../lib/time";
import { LoadState } from "../runs/RunsTab";
import { useLoaded } from "../runs/useLoaded";
import { SubView } from "../SubView";
import { GetsList } from "./GetsList";
import "./tests.css";

const STATUS: Record<ReplayDetail["status"], [string, string]> = {
  passed: ["Passed", "tt-pill--good"],
  failed: ["Failed", "tt-pill--bad"],
  stopped: ["Stopped", ""],
  running: ["Running", "tt-pill--live"],
  waiting: ["Waiting", ""],
};

/** A check as the replay met it: Met, Not met, or Skipped (an AI check that couldn't run). */
function CheckRow({ check }: { check: CheckResult }) {
  const [label, look] =
    check.met === true
      ? ["Met", "tt-pill--good"]
      : check.met === false
        ? ["Not met", "tt-pill--bad"]
        : ["Skipped", ""];
  return (
    <li>
      <span className="tt-replay__kind">{CHECK_LABEL[check.kind]}</span>
      <span className="tt-replay__value">
        {check.kind === "must_name_file" ? (
          <code className="tt-code">{check.value}</code>
        ) : (
          check.value
        )}
      </span>
      <span className={`tt-pill ${look}`}>{label}</span>
      {check.reason && <div className="tt-replay__reason">{check.reason}</div>}
    </li>
  );
}

/**
 * M7 Test-Replay — "Open this replay" in the drawer (the app's SubView, Back to the list): when and
 * on which version it ran with its result, what the agent got, what it answered, the files it
 * changed and how each check went.
 */
export function ReplayView({
  teamId,
  nodeId,
  agent,
  resultId,
  onBack,
}: {
  teamId: string;
  nodeId: string;
  /** "What the Reviewer got". */
  agent: string;
  resultId: string;
  onBack: () => void;
}) {
  const replay = useLoaded(`replay:${teamId}:${nodeId}:${resultId}`, () =>
    getReplay(teamId, nodeId, resultId),
  );
  const r = replay.value;
  const meta = r
    ? [
        r.version != null ? `On v${r.version}` : null,
        r.at ? formatRelativeTime(r.at) : null,
        r.duration_s != null ? elapsedText(r.duration_s) : null,
        `$${r.cost_usd.toFixed(2)}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const [status, look] = r ? STATUS[r.status] : ["", ""];
  return (
    <SubView title={r ? `Replay · ${r.name}` : "Replay"} onBack={onBack} gap={8}>
      {!r ? (
        <LoadState
          state={replay.state === "error" ? "error" : "loading"}
          loading="Loading the replay"
          error="Couldn’t load this replay."
          onRetry={replay.retry}
        />
      ) : (
        <>
          <div className="tt-replay__meta">
            <span>{meta}</span>
            <span className={`tt-pill ${look}`}>{status}</span>
          </div>
          {r.gets && (
            <section className="tt-replay__section" aria-label={`What the ${agent} got`}>
              <span className="tt-eyebrow">What the {agent} got</span>
              <GetsList gets={r.gets} compact />
            </section>
          )}
          <section className="tt-replay__section" aria-label="What it answered">
            <span className="tt-eyebrow">What it answered</span>
            {r.answer ? (
              <div className="tt-answer">{r.answer}</div>
            ) : (
              <div className="tt-detail__reason">No answer.</div>
            )}
          </section>
          <div className="tt-replay__files">
            <span className="tt-eyebrow">Files it changed</span>
            <span className="tt-replay__files-list">
              {r.files.length === 0
                ? "None"
                : r.files.map((f, i) => (
                    <span key={f}>
                      {i > 0 && " "}
                      <code className="tt-code">{f}</code>
                    </span>
                  ))}
            </span>
          </div>
          {r.checks.length > 0 && (
            <section className="tt-replay__section" aria-label="Checks">
              <span className="tt-eyebrow">Checks</span>
              <ul className="tt-replay__checks">
                {r.checks.map((c, i) => (
                  <CheckRow key={i} check={c} />
                ))}
              </ul>
            </section>
          )}
          {r.error && <div className="tt-detail__error">{r.error}</div>}
        </>
      )}
    </SubView>
  );
}
