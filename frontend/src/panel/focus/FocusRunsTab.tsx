import { type ReactNode, useState } from "react";
import { Brain, FileText, Sparkle } from "lucide-react";

import { Badge, Button } from "../../design-system/components";
import { getNodeRuns, type NodeRound, type NodeRuns } from "../../lib/api/nodes";
import { statusBadge } from "../nodeBadges";
import {
  billingLine,
  compactTokens,
  forcesLine,
  roundDuration,
  verdictFileText,
  whenShort,
} from "../runs/rounds";
import { DetailText, EmptyCard, LoadState } from "../runs/RunsTab";
import { type Loaded, useLoaded } from "../runs/useLoaded";
import "../runs/runs.css";

const roundWhen = (r: NodeRound) => whenShort(r.ended_at ?? r.started_at ?? "");
const docLabel = (d: { name: string; is_shared_spec?: boolean }) =>
  d.is_shared_spec ? "Shared spec" : d.name;
const small = { size: 13, strokeWidth: 1.6, "aria-hidden": true } as const;

/**
 * The Runs tab in focus mode (Focus-Runs, FOCUS-62..70): a rail with the rounds of one run (newest
 * first) and the agent's earlier runs, and the picked round in full — its verdict, what it was
 * given, what it produced and what it cost. An earlier run opens its own rounds in the rail (OQ-15).
 */
export function FocusRunsTab({
  teamId,
  nodeId,
  history,
  verdict,
  onOpenRun,
}: {
  teamId: string;
  nodeId: string;
  /** This agent's runs, with the newest run's rounds (the drawer's Runs tab reads the same). */
  history: Loaded<NodeRuns>;
  /** It routes on a verdict (a Reviewer): its detail is a "Verdict", else a "Summary". */
  verdict: boolean;
  /** "Open this run on the canvas": the run view of that run. */
  onOpenRun?: (runId: string) => void;
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const newest = history.value?.run ?? null;
  const elsewhere = runId !== null && runId !== newest?.run_id ? runId : null;
  const other = useLoaded(elsewhere, () => getNodeRuns(teamId, nodeId, { runId: elsewhere ?? "" }));

  if (history.state === "loading" || history.state === "error") {
    return (
      <div className="fx-empty">
        <LoadState
          state={history.state}
          loading="Loading runs"
          error="Couldn’t load this agent’s runs."
          onRetry={history.retry}
        />
      </div>
    );
  }
  if (!newest || newest.rounds.length === 0) {
    return (
      <div className="fx-empty">
        <EmptyCard title="This agent hasn’t run yet">
          Press <b>Run this team</b> and what it did will show up here.
        </EmptyCard>
      </div>
    );
  }

  const runs = history.value?.runs ?? [];
  const shownId = elsewhere ?? newest.run_id;
  const run = elsewhere ? (other.value?.run ?? null) : newest;
  const idea = runs.find((r) => r.run_id === shownId)?.idea ?? run?.idea ?? "";
  const rounds = run?.rounds ?? [];
  const round = rounds.find((r) => r.invocation_id === picked) ?? rounds[0];
  const earlier = runs.filter((r) => r.run_id !== shownId);
  const pickRun = (id: string) => {
    setRunId(id);
    setPicked(null);
  };

  return (
    <div className="fx-panes fx-panes--runs">
      <aside className="fx-pane fx-rail fx-runs__rail" aria-label="Rounds">
        <span className="fx-label">Run “{idea}”</span>
        {elsewhere && other.state !== "ready" ? (
          <LoadState
            state={other.state === "error" ? "error" : "loading"}
            loading="Loading rounds"
            error="Couldn’t load that run."
            onRetry={other.retry}
          />
        ) : (
          <ul className="fx-rounds">
            {rounds.map((r) => {
              const badge = statusBadge(r, false);
              const on = r === round;
              return (
                <li key={r.invocation_id}>
                  <button
                    type="button"
                    className={`fx-round${on ? " fx-round--on" : ""}`}
                    aria-pressed={on}
                    onClick={() => setPicked(r.invocation_id)}
                  >
                    <span className="fx-round__n">Round {r.iteration}</span>
                    <Badge variant={badge.variant} dot={badge.dot}>
                      {badge.label}
                    </Badge>
                    <span className="fx-round__when">{roundWhen(r)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {earlier.length > 0 && (
          <>
            <span className="fx-label">
              {shownId === newest.run_id ? "Earlier runs" : "Other runs"}
            </span>
            <ul className="fx-rounds">
              {earlier.map((r) => {
                const badge = statusBadge(
                  { outcome: r.last_outcome, status: r.last_status },
                  false,
                );
                return (
                  <li key={r.run_id}>
                    <button
                      type="button"
                      className="fx-round"
                      title={`Run “${r.idea}”`}
                      onClick={() => pickRun(r.run_id)}
                    >
                      <span className="fx-round__n">Round —</span>
                      <Badge variant={badge.variant} dot={badge.dot}>
                        {badge.label}
                      </Badge>
                      <span className="fx-round__when">
                        {whenShort(r.last_round_at ?? r.created_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </aside>
      <div className="fx-pane fx-pane--detail fx-runs__detail">
        {round && run && (
          <RoundDetail
            round={round}
            verdict={verdict}
            onOpenRun={onOpenRun && (() => onOpenRun(run.run_id))}
          />
        )}
      </div>
    </div>
  );
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="fx-card" aria-label={label}>
      <span className="fx-label">{label}</span>
      {children}
    </section>
  );
}

function RoundDetail({
  round,
  verdict,
  onOpenRun,
}: {
  round: NodeRound;
  verdict: boolean;
  onOpenRun?: () => void;
}) {
  const badge = statusBadge(round, false);
  const when = roundWhen(round);
  const detail = round.outcome_detail?.trim() ?? "";

  const given = round.given;
  const always = (given?.skills ?? []).filter((s) => s.mode === "always");
  const givenItems = [
    ...(given?.documents ?? []).map((d) => (
      <li key={`d:${d.document_id}`}>
        <FileText {...small} />
        {docLabel(d)} <span className="fx-list__dim">v{d.version_no}</span>
      </li>
    )),
    ...(given && given.memory.length > 0
      ? [
          <li key="memory">
            <Brain {...small} />
            {given.memory.length} memory {given.memory.length === 1 ? "note" : "notes"}{" "}
            <span className="fx-list__dim">{forcesLine(given.memory)}</span>
          </li>,
        ]
      : []),
    ...always.map((s, i) => (
      <li key={`s:${i}`}>
        <Sparkle {...small} />
        {typeof s.name === "string" ? s.name : "A skill"}{" "}
        <span className="fx-list__dim">always on</span>
      </li>
    )),
  ];

  const produced = round.produced;
  const files = (produced?.files ?? []).filter((f) => f !== produced?.verdict?.file);
  const producedItems = [
    ...(produced?.documents ?? []).map((d) => (
      <li key={`d:${d.document_id}`}>
        <FileText {...small} />
        {docLabel(d)} <span className="fx-list__dim">v{d.version_no}</span>
      </li>
    )),
    ...files.map((f) => (
      <li key={`f:${f}`} className="fx-list__file">
        <FileText {...small} />
        {f}
      </li>
    )),
  ];

  const cost = [
    ...(round.cost
      ? [
          `${compactTokens(round.cost.prompt_tokens)} tokens in`,
          `${compactTokens(round.cost.completion_tokens)} out`,
        ]
      : []),
    billingLine(round),
    roundDuration(round),
  ].filter(Boolean);

  return (
    <>
      <div className="fx-runs__head">
        <Badge variant={badge.variant} dot={badge.dot}>
          {badge.label}
        </Badge>
        <span className="fx-runs__when">
          Round {round.iteration}
          {when && ` · ${when}`}
        </span>
        {onOpenRun && (
          <span className="fx-runs__open">
            <Button variant="secondary" size="sm" onClick={onOpenRun}>
              Open this run on the canvas
            </Button>
          </span>
        )}
      </div>
      {detail && (
        <Card label={verdict ? "Verdict" : "Summary"}>
          <div className="fx-card__text">
            <DetailText text={detail} />
          </div>
        </Card>
      )}
      <div className="fx-runs__pair">
        <Card label="What it was given">
          {givenItems.length > 0 ? (
            <ul className="fx-list">{givenItems}</ul>
          ) : (
            <p className="fx-card__none">Nothing recorded for this round.</p>
          )}
        </Card>
        <Card label="What it produced">
          {produced?.verdict && <pre className="fx-code">{verdictFileText(produced.verdict)}</pre>}
          {producedItems.length > 0 && <ul className="fx-list">{producedItems}</ul>}
          {!produced?.verdict && producedItems.length === 0 && (
            <p className="fx-card__none">
              {round.status === "running" ? "Still running." : "Nothing recorded for this round."}
            </p>
          )}
        </Card>
      </div>
      {cost.length > 0 && (
        <Card label="Cost">
          <div className="fx-cost">
            {cost.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
