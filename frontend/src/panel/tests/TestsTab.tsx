import {
  CircleCheck,
  CircleX,
  Clock,
  FlaskConical,
  History,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { Button, Menu } from "../../design-system/components";
import {
  CHECK_LABEL,
  elapsedText,
  estimateText,
  firstUnmet,
  queuedSub,
  resultsSub,
  runningSub,
  runningTitle,
  sinceText,
  stoppedTitle,
  TEST_FILE_ACCEPT,
  testsCount,
} from "../../lib/agentTestsFormat";
import type { AgentTest, TestResult, TestRun } from "../../lib/api/agentTests";
import { formatRelativeTime } from "../../lib/time";
import { useModalDialog } from "../../lib/useModalDialog";
import { useTicker } from "../../lib/useTicker";
import { LoadState } from "../runs/RunsTab";
import type { AgentTestsApi } from "./useAgentTests";
import "./tests.css";

/** A hidden file input behind any button (CSV or JSON lines); a pick hands over the file. */
export function PickTestFile({
  onPick,
  children,
}: {
  onPick: (file: File) => void;
  children: (open: () => void) => ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      {children(() => input.current?.click())}
      <input
        ref={input}
        type="file"
        hidden
        accept={TEST_FILE_ACCEPT}
        data-testid="test-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick(file);
        }}
      />
    </>
  );
}

/** New test and "Add tests from a file": the drawer's footer, focus mode's row under the tests. */
function TestsActions({
  onNewTest,
  onPickFile,
}: {
  onNewTest: () => void;
  onPickFile: (file: File) => void;
}) {
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        iconLeft={<Plus size={14} strokeWidth={1.6} aria-hidden />}
        onClick={onNewTest}
      >
        New test
      </Button>
      <PickTestFile onPick={onPickFile}>
        {(open) => (
          <button type="button" className="tt-link" onClick={open}>
            <Upload size={13} strokeWidth={1.6} aria-hidden />
            Add tests from a file
          </button>
        )}
      </PickTestFile>
    </>
  );
}

/** The Tests footer (Test-List / -Results). */
export function TestsFooter(props: { onNewTest: () => void; onPickFile: (file: File) => void }) {
  return (
    <footer className="nd-foot">
      <TestsActions {...props} />
    </footer>
  );
}

/**
 * Test-RowMenu: "Delete “Flags a missing test file”? Its past results stay." in the footer's place,
 * with Cancel and Delete (Escape = Cancel; the keyboard stays inside).
 */
export function DeleteTestBar({
  name,
  busy,
  onCancel,
  onDelete,
}: {
  name: string;
  busy: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const ref = useModalDialog<HTMLElement>(true, onCancel);
  return (
    <footer
      ref={ref}
      className="nd-foot tt-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-label="Delete test"
      tabIndex={-1}
    >
      <div className="tt-confirm__text">Delete “{name}”? Its past results stay.</div>
      <div className="tt-confirm__actions">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" loading={busy} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </footer>
  );
}

export interface TestsTabProps {
  /** The agent's name ("Replays only the Reviewer"). */
  agent: string;
  tests: AgentTestsApi;
  /** Run all N / Run again (the drawer asks about a draft first). */
  onRunAll: () => void;
  onStop: () => void;
  /** Run all / Stop on its way. */
  busy: boolean;
  /** "Pick a round from a run" / New test: the Runs tab. */
  onPickRound: () => void;
  onPickFile: (file: File) => void;
  onOpenReplay: (result: TestResult) => void;
  /** "Compare with v6" (this agent's instruction history). */
  onCompare?: (version: number) => void;
  /** "The AI check is wrong": Check the AI check on that answer. */
  onJudge: (test: AgentTest, check: number, answer: string | null) => void;
  onDelete: (test: AgentTest) => void;
  /** Test-Focus: a centred column, the tests two by two, New test under them. */
  focus?: boolean;
}

/**
 * M7 — the Tests tab (Test-Empty / -List / -Running / -Queued / -Results / -Worse / -Stopped): its
 * header (the count and the last run; the run going or waiting for a slot; or how the run this tab
 * watched went), the estimate box, a progress bar while running and a row per test with its result.
 * After a watched run the failed rows are open; every row opens to what it was checked on.
 */
export function TestsTab(props: TestsTabProps) {
  const { tests } = props;
  const list = tests.value?.tests ?? [];
  const body =
    tests.state === "loading" || tests.state === "error" ? (
      <LoadState
        state={tests.state}
        loading="Loading tests"
        error="Couldn’t load this agent’s tests."
        onRetry={tests.retry}
      />
    ) : list.length === 0 ? (
      <TestsEmpty onPickRound={props.onPickRound} onPickFile={props.onPickFile} />
    ) : (
      <TestsList {...props} list={list} />
    );
  return props.focus ? (
    <div className="tt-focus">
      <div className="tt-focus__col">{body}</div>
    </div>
  ) : (
    body
  );
}

function TestsEmpty({
  onPickRound,
  onPickFile,
}: {
  onPickRound: () => void;
  onPickFile: (file: File) => void;
}) {
  return (
    <>
      <div className="tt-empty">
        <span className="tt-empty__disc" aria-hidden>
          <FlaskConical size={22} strokeWidth={1.6} />
        </span>
        <div className="tt-empty__title">No tests yet</div>
        <p className="tt-empty__body">
          A test replays only this agent on a saved input and checks what it says. You see pass or
          fail in about a minute, before you change the team.
        </p>
        <Button
          variant="primary"
          iconLeft={<History size={14} strokeWidth={2} aria-hidden />}
          onClick={onPickRound}
        >
          Pick a round from a run
        </Button>
        <PickTestFile onPick={onPickFile}>
          {(open) => (
            <Button
              variant="secondary"
              iconLeft={<Upload size={14} strokeWidth={1.6} aria-hidden />}
              onClick={open}
            >
              Add tests from a file
            </Button>
          )}
        </PickTestFile>
        <span className="tt-empty__hint">CSV or JSON lines</span>
      </div>
      <section className="tt-how" aria-label="How it works">
        <span className="tt-eyebrow">How it works</span>
        {[
          "Pick a real round that went right or wrong.",
          "Say what the agent must say, or which file it must name.",
          "Run the tests whenever you change the agent.",
        ].map((text, i) => (
          <div key={text} className="tt-how__step">
            <span className="tt-how__n" aria-hidden>
              {i + 1}
            </span>
            <span>{text}</span>
          </div>
        ))}
      </section>
    </>
  );
}

/** The running header's timer, counting on from the last read. */
function RunTimer({ run, readAt }: { run: TestRun; readAt: number }) {
  const now = useTicker(1000);
  return (
    <span className="tt-head__timer">
      {elapsedText(run.elapsed_s + Math.max(0, now - readAt) / 1000)}
    </span>
  );
}

function TestsList({
  agent,
  tests,
  list,
  onRunAll,
  onStop,
  busy,
  onPickRound,
  onPickFile,
  onOpenReplay,
  onCompare,
  onJudge,
  onDelete,
  focus = false,
}: TestsTabProps & { list: AgentTest[] }) {
  const value = tests.value;
  const run = value?.run ?? null;
  const running = tests.running;
  const queued = running && run?.waiting_for_slot === true;
  const watched = run && tests.watched === run.id ? run : null;
  const byTest = new Map((run?.results ?? []).map((r) => [r.test_id, r]));
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const stop = (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      iconLeft={<Square size={14} strokeWidth={1.6} aria-hidden />}
      onClick={onStop}
    >
      Stop
    </Button>
  );
  const again = (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      iconLeft={<RefreshCw size={14} strokeWidth={1.6} aria-hidden />}
      onClick={onRunAll}
    >
      Run again
    </Button>
  );
  let title: ReactNode;
  let sub: string | null;
  let action: ReactNode;
  if (queued && run) {
    title = "Waiting to start";
    sub = queuedSub(run);
    action = stop;
  } else if (running && run) {
    title = (
      <>
        {runningTitle(run)}
        <RunTimer run={run} readAt={tests.readAt} />
      </>
    );
    sub = runningSub(run);
    action = stop;
  } else if (watched?.status === "stopped") {
    title = stoppedTitle(watched);
    sub = resultsSub(watched, "");
    action = again;
  } else if (watched) {
    const since = sinceText(watched.since);
    title = (
      <>
        {watched.passed} of {watched.total} passed
        {since && (
          <span
            className={`tt-pill tt-pill--since ${since.worse ? "tt-pill--bad" : "tt-pill--good"}`}
          >
            {since.text}
          </span>
        )}
      </>
    );
    sub = resultsSub(watched, formatRelativeTime(watched.ended_at ?? watched.started_at));
    action = again;
  } else {
    title = testsCount(list.length);
    sub = value?.last ?? null;
    action = (
      <Button
        variant="primary"
        size="sm"
        loading={busy}
        iconLeft={<Play size={14} fill="currentColor" strokeWidth={0} aria-hidden />}
        onClick={onRunAll}
      >
        Run all {list.length}
      </Button>
    );
  }

  const pct = run && run.total > 0 ? Math.round((run.done / run.total) * 100) : 0;
  return (
    <>
      <div className="tt-head">
        <div className="tt-head__row">
          <div className="tt-head__titles">
            <div className="tt-head__title">{title}</div>
            {sub && <div className="tt-head__sub">{sub}</div>}
          </div>
          {action}
        </div>
        <div className="tt-estimate">
          {estimateText(agent, value?.estimate ?? null, value?.ai ?? null)}
        </div>
        {queued && (
          <div className="tt-queued" role="status">
            <span className="tt-queued__icon" aria-hidden>
              <Clock size={15} strokeWidth={1.6} />
            </span>
            <span>Your runs are using all 3 slots. The tests start when one finishes.</span>
          </div>
        )}
        {run?.error && !running && (
          <div className="tt-error" role="alert">
            {run.error}
          </div>
        )}
      </div>
      {running && run && (
        <div
          className="tt-progress"
          role="progressbar"
          aria-label="Tests done"
          aria-valuemin={0}
          aria-valuemax={run.total}
          aria-valuenow={run.done}
        >
          <div className="tt-progress__fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      <ol className="tt-list" aria-label="Tests">
        {list.map((t) => {
          const result = byTest.get(t.id) ?? null;
          const open = toggled[t.id] ?? (watched !== null && result?.status === "failed");
          return (
            <TestRow
              key={t.id}
              test={t}
              result={result}
              open={open}
              onToggle={() => setToggled({ ...toggled, [t.id]: !open })}
              sinceVersion={run?.since?.version ?? null}
              onOpenReplay={onOpenReplay}
              onCompare={onCompare}
              onJudge={onJudge}
              onDelete={onDelete}
            />
          );
        })}
      </ol>
      {focus && !running && (
        <div className="tt-focus__actions">
          <TestsActions onNewTest={onPickRound} onPickFile={onPickFile} />
        </div>
      )}
    </>
  );
}

const STATUS: Record<
  TestResult["status"],
  { label: string; pill: string; icon: typeof CircleCheck }
> = {
  passed: { label: "Passed", pill: "tt-pill--good", icon: CircleCheck },
  failed: { label: "Failed", pill: "tt-pill--bad", icon: CircleX },
  running: { label: "Running", pill: "tt-pill--live", icon: LoaderCircle },
  waiting: { label: "Waiting", pill: "", icon: Clock },
  stopped: { label: "Stopped", pill: "", icon: Square },
};

function TestRow({
  test,
  result,
  open,
  onToggle,
  sinceVersion,
  onOpenReplay,
  onCompare,
  onJudge,
  onDelete,
}: {
  test: AgentTest;
  result: TestResult | null;
  open: boolean;
  onToggle: () => void;
  sinceVersion: number | null;
  onOpenReplay: (result: TestResult) => void;
  onCompare?: (version: number) => void;
  onJudge: (test: AgentTest, check: number, answer: string | null) => void;
  onDelete: (test: AgentTest) => void;
}) {
  const look = result ? STATUS[result.status] : null;
  const Icon = look?.icon ?? FlaskConical;
  const failed = result?.status === "failed";
  const finished = failed || result?.status === "passed";
  const unmet = failed && result ? firstUnmet(result.checks) : null;
  // The AI check that failed, as the test's own check (its index is what Check the AI check labels).
  const aiCheck =
    unmet?.kind === "ai"
      ? Math.max(
          test.checks.findIndex((c) => c.kind === "ai" && c.value === unmet.value),
          test.checks.findIndex((c) => c.kind === "ai"),
        )
      : -1;
  return (
    <li className={`tt-row${result ? ` tt-row--${result.status}` : ""}`}>
      <div className="tt-row__l1">
        <button type="button" className="tt-row__toggle" aria-expanded={open} onClick={onToggle}>
          <span className="tt-row__icon" aria-hidden>
            <Icon size={15} strokeWidth={1.6} />
          </span>
          <span className="tt-row__name">{test.name}</span>
          {look && <span className={`tt-pill tt-row__pill ${look.pill}`}>{look.label}</span>}
        </button>
        <span className="tt-row__more">
          <Menu
            label={`More for ${test.name}`}
            width={196}
            items={[
              {
                key: "delete",
                label: "Delete test",
                icon: <Trash2 size={15} strokeWidth={1.6} aria-hidden />,
                danger: true,
                onSelect: () => onDelete(test),
              },
            ]}
          />
        </span>
      </div>
      <div className="tt-row__meta">{test.meta}</div>
      {open && (
        <div className="tt-detail">
          {unmet && (
            <div className="tt-detail__line">
              <b>{CHECK_LABEL[unmet.kind]}:</b> {unmet.value} ·{" "}
              <span className="tt-bad">not met</span>
            </div>
          )}
          {!finished &&
            test.checks.map((c, i) => (
              <div key={i} className="tt-detail__line">
                <b>{CHECK_LABEL[c.kind]}:</b> {c.value}
              </div>
            ))}
          {result?.error && <div className="tt-detail__error">{result.error}</div>}
          {result?.answer && <div className="tt-answer">{result.answer}</div>}
          {unmet?.reason && <div className="tt-detail__reason">{unmet.reason}</div>}
          {result && finished && (
            <div className="tt-detail__acts">
              <Button variant="secondary" size="sm" onClick={() => onOpenReplay(result)}>
                Open this replay
              </Button>
              {failed && sinceVersion != null && onCompare && (
                <button type="button" className="tt-link" onClick={() => onCompare(sinceVersion)}>
                  Compare with v{sinceVersion}
                </button>
              )}
              {aiCheck >= 0 && (
                <button
                  type="button"
                  className="tt-link tt-link--quiet"
                  onClick={() => onJudge(test, aiCheck, result.answer)}
                >
                  The AI check is wrong
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
