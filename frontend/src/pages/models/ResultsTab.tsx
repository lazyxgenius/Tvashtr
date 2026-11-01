/** The Results tab: one score card per run of a version, and Compare two models. Polls every 3 s
 *  while a run on the shown version is going. */
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

import { Badge, Button, Select, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type Comparison,
  type CompareSide,
  type ModelDetail,
  type ModelRun,
  type RunsOfVersion,
  compareRuns,
  listRuns,
  startRuns,
  stopRun,
} from "../../lib/api/models";
import {
  ago,
  compareOption,
  defaultPair,
  money,
  percent,
  plural,
  runCost,
  runSpeed,
} from "./modelsFormat";

const POLL_MS = 3000;
const BACKEND_DOWN = "Couldn’t reach Tvashtr — is the backend running?";

function RunCard({
  run,
  best,
  lowest,
  onStop,
  onAgain,
}: {
  run: ModelRun;
  best: boolean;
  lowest: boolean;
  onStop: () => void;
  onAgain: () => void;
}) {
  const running = run.status === "running";
  const failed = run.status === "failed";
  const stopped = run.status === "stopped";
  const shown = running ? run.done : run.cases_total;
  const width = running ? percent(run.done, run.cases_total) : percent(run.passed, run.cases_total);
  return (
    <article className="md-card md-rcard">
      <div className="md-rcard__top">
        <div className="md-rcard__names">
          <span className="md-rcard__provider">{run.provider_label}</span>
          <span className="md-mono md-mono--13">{run.model_name}</span>
        </div>
        <div className="md-rcard__badges">
          {best && <Badge variant="success">Best score</Badge>}
          {lowest && <Badge variant="info">Lowest cost</Badge>}
          {stopped && <Badge variant="neutral">Stopped</Badge>}
        </div>
      </div>
      {failed ? (
        <div className="md-rcard__failed">
          <span>This run failed: {run.error_message ?? "something went wrong."}</span>
          <div>
            <Button variant="secondary" size="sm" onClick={onAgain}>
              Run again
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="md-rcard__score">
            <span className="md-rcard__value">
              {run.passed} / {shown}
            </span>
            {running ? (
              <span className="md-rcard__pct">
                {run.done} of {run.cases_total} done
              </span>
            ) : stopped ? (
              <span className="md-rcard__pct">
                Stopped after {run.done} of {run.cases_total}
              </span>
            ) : (
              <span className="md-rcard__pct">{percent(run.passed, run.cases_total)}% passed</span>
            )}
          </div>
          <div className="md-rcard__bar">
            <div
              className={
                running
                  ? "md-rcard__fill md-rcard__fill--running"
                  : best
                    ? "md-rcard__fill md-rcard__fill--best"
                    : "md-rcard__fill"
              }
              style={{ width: `${width}%` }}
            />
          </div>
          <div className="md-rcard__meta">
            <span>{runCost(run)}</span>
            {runSpeed(run) && <span>{runSpeed(run)}</span>}
            {!running && <span>{ago(run.completed_at ?? run.created_at)}</span>}
          </div>
          {run.price_known && run.judge_cost_usd > 0 && (
            <span className="md-hint">Includes {money(run.judge_cost_usd)} for the AI judge.</span>
          )}
          {run.errors > 0 && (
            <span className="md-rcard__errors" title={run.first_error ?? undefined}>
              {run.errors} couldn’t be scored
            </span>
          )}
          {running && (
            <div>
              <Button variant="ghost" size="sm" disabled={run.stop_requested} onClick={onStop}>
                Stop
              </Button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

function AnswerChip({ side }: { side: CompareSide }) {
  return (
    <span
      className={side.right ? "md-amk md-amk--ok" : "md-amk md-amk--no"}
      title={side.reason ?? undefined}
    >
      {side.right ? (
        <Check size={12} strokeWidth={1.7} aria-hidden />
      ) : (
        <X size={12} strokeWidth={1.7} aria-hidden />
      )}
      <span>{side.answer || "—"}</span>
    </span>
  );
}

function Compare({
  modelId,
  runs,
  best,
  lowest,
}: {
  modelId: string;
  runs: ModelRun[];
  best: string | null;
  lowest: string | null;
}) {
  const pair = defaultPair(runs, best, lowest);
  const [picked, setPicked] = useState<[string, string] | null>(null);
  const [data, setData] = useState<Comparison | null>(null);
  const [onlyDiffer, setOnlyDiffer] = useState(true);
  const stillThere = picked && picked.every((id) => runs.some((r) => r.run_id === id));
  const [a, b] = (stillThere ? picked : pair) ?? ["", ""];

  useEffect(() => {
    if (!a || !b || a === b) return;
    let live = true;
    compareRuns(modelId, a, b)
      .then((d) => live && setData(d))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [modelId, a, b]);

  if (!pair) {
    return (
      <section className="md-compare" aria-labelledby="md-cmp-title">
        <h2 id="md-cmp-title" className="md-compare__title">
          Compare two models
        </h2>
        <p className="md-compare__sentence">Compare needs two finished runs on this version.</p>
      </section>
    );
  }

  const optionsWithout = (other: string) =>
    runs
      .filter((r) => r.run_id !== other)
      .map((r) => ({ value: r.run_id, label: compareOption(r) }));
  const fresh = data && data.a.run_id === a && data.b.run_id === b ? data : null;
  const rows = fresh ? fresh.rows.filter((r) => !onlyDiffer || r.differ) : [];
  const differ = fresh ? fresh.counts.only_a + fresh.counts.only_b : 0;
  const nameA = fresh?.a.model_name;
  const nameB = fresh?.b.model_name;

  return (
    <section className="md-compare" aria-labelledby="md-cmp-title">
      <h2 id="md-cmp-title" className="md-compare__title">
        Compare two models
      </h2>
      <div className="md-compare__bar">
        <div className="md-compare__pick">
          <Select
            label="First"
            value={a}
            options={optionsWithout(b)}
            onChange={(e) => setPicked([e.target.value, b])}
          />
        </div>
        <div className="md-compare__pick">
          <Select
            label="Second"
            value={b}
            options={optionsWithout(a)}
            onChange={(e) => setPicked([a, e.target.value])}
          />
        </div>
        {fresh && (
          <div className="tv-seg" role="group" aria-label="Which tests to show">
            <button
              type="button"
              className={onlyDiffer ? "tv-seg__btn tv-seg__btn--active" : "tv-seg__btn"}
              aria-pressed={onlyDiffer}
              onClick={() => setOnlyDiffer(true)}
            >
              Only where they differ ({differ})
            </button>
            <button
              type="button"
              className={onlyDiffer ? "tv-seg__btn" : "tv-seg__btn tv-seg__btn--active"}
              aria-pressed={!onlyDiffer}
              onClick={() => setOnlyDiffer(false)}
            >
              All {fresh.counts.total}
            </button>
          </div>
        )}
      </div>
      {fresh && (
        <>
          <p className="md-compare__sentence">
            They agree on {fresh.counts.agree} of {plural(fresh.counts.total, "test")} (
            {fresh.counts.both_right} both right, {fresh.counts.both_wrong} both wrong).{" "}
            <span className="md-mono">{nameA}</span> is right on {fresh.counts.only_a} where{" "}
            <span className="md-mono">{nameB}</span> is wrong;{" "}
            <span className="md-mono">{nameB}</span> is right on {fresh.counts.only_b} where{" "}
            <span className="md-mono">{nameA}</span> is wrong.
          </p>
          <div className="md-tbl md-cmptable">
            <table>
              <thead>
                <tr>
                  <th scope="col" className="md-tests__n">
                    #
                  </th>
                  <th scope="col">Input</th>
                  <th scope="col" className="md-cmptable__expected">
                    Expected
                  </th>
                  <th scope="col" className="md-cmptable__side">
                    <span className="md-mono md-mono--12">{nameA}</span>
                  </th>
                  <th scope="col" className="md-cmptable__side">
                    <span className="md-mono md-mono--12">{nameB}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.case_key}>
                    <td className="md-num">{r.position}</td>
                    <td>
                      <span className="md-clamp">{r.input}</span>
                    </td>
                    <td>
                      <span className={r.expected.length > 24 ? "md-ans md-ans--wrap" : "md-ans"}>
                        {r.expected}
                      </span>
                    </td>
                    <td>
                      <AnswerChip side={r.a} />
                    </td>
                    <td>
                      <AnswerChip side={r.b} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="md-hint md-compare__foot">
            Only runs on the same test set version are compared. Each answer is shown exactly as the
            model gave it.
          </p>
        </>
      )}
    </section>
  );
}

export function ResultsTab({
  model,
  tick,
  onRun,
  onChanged,
}: {
  model: ModelDetail;
  tick: number;
  onRun: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const id = model.model_id;
  const current = model.current_version;
  const [version, setVersion] = useState<number | null>(null);
  const [data, setData] = useState<RunsOfVersion | null>(null);
  const [failed, setFailed] = useState(false);
  const [picking, setPicking] = useState(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const shownVersion = version ?? current;

  useEffect(() => {
    let live = true;
    listRuns(id, shownVersion)
      .then((d) => {
        if (!live) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, shownVersion, tick]);

  const going = data?.runs.some((r) => r.status === "running") ?? false;
  useEffect(() => {
    if (!going) return;
    const t = window.setTimeout(() => {
      listRuns(id, shownVersion)
        .then((d) => {
          setData(d);
          if (!d.runs.some((r) => r.status === "running")) onChangedRef.current();
        })
        .catch(() => setData((x) => (x ? { ...x } : x)));
    }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [id, shownVersion, going, data]);

  if (!data) {
    return failed ? (
      <div className="md-alert" role="alert">
        <span>{BACKEND_DOWN}</span>
      </div>
    ) : null;
  }

  const stop = (run: ModelRun) => {
    stopRun(id, run.run_id)
      .then(() => listRuns(id, shownVersion))
      .then(setData)
      .catch(() => toast({ message: "Couldn’t stop the run. Try again.", tone: "error" }));
  };
  const again = (run: ModelRun) => {
    startRuns(id, [run.model_slug])
      .then(() => {
        setVersion(null);
        onChanged();
      })
      .catch((err) =>
        toast({
          message: err instanceof ApiError ? err.message : "Couldn’t start the run. Try again.",
          tone: "error",
        }),
      );
  };

  const earlier = data.versions_with_runs.filter((v) => v.version !== current);
  const earlierRuns = earlier.reduce((sum, v) => sum + v.runs, 0);
  const pickOptions = [
    ...(data.versions_with_runs.some((v) => v.version === current)
      ? []
      : [{ version: current, runs: 0 }]),
    ...data.versions_with_runs,
  ].map((v) => ({ value: String(v.version), label: `Test set v${v.version}` }));
  const finished = data.runs.filter((r) => r.status === "completed");

  return (
    <>
      <div className="md-line md-line--results">
        {picking ? (
          <span className="md-line__pick">
            <Select
              size="sm"
              aria-label="Test set version"
              autoFocus
              value={String(shownVersion)}
              options={pickOptions}
              onChange={(e) => {
                const next = Number(e.target.value);
                setVersion(next === current ? null : next);
                setPicking(false);
              }}
              onBlur={() => setPicking(false)}
            />
          </span>
        ) : (
          <button
            type="button"
            className="md-chip md-chip--button"
            disabled={data.versions_with_runs.length === 0}
            onClick={() => setPicking(true)}
          >
            Test set v{shownVersion}
          </button>
        )}
        {data.runs.length > 0 && (
          <span className="md-line__edited">{plural(data.runs.length, "run")} on this version</span>
        )}
        <span className="md-grow" />
        {shownVersion === current && earlierRuns > 0 && (
          <button type="button" className="md-link" onClick={() => setVersion(earlier[0].version)}>
            Runs on earlier versions ({earlierRuns})
          </button>
        )}
        {shownVersion !== current && (
          <button type="button" className="md-link" onClick={() => setVersion(null)}>
            Back to test set v{current}
          </button>
        )}
      </div>
      {data.runs.length === 0 ? (
        <section className="md-card md-empty">
          <h2 className="md-empty__title">No runs on test set v{shownVersion} yet.</h2>
          <p className="md-empty__text">
            Run its tests to see how each model does, and for how much.
          </p>
          <div className="md-empty__actions">
            <Button variant="primary" size="sm" disabled={model.tests === 0} onClick={onRun}>
              Run tests
            </Button>
          </div>
        </section>
      ) : (
        <>
          <div className="md-rgrid">
            {data.runs.map((r) => (
              <RunCard
                key={r.run_id}
                run={r}
                best={r.run_id === data.best_run_id}
                lowest={r.run_id === data.lowest_cost_run_id}
                onStop={() => stop(r)}
                onAgain={() => again(r)}
              />
            ))}
          </div>
          <Compare
            modelId={id}
            runs={finished}
            best={data.best_run_id}
            lowest={data.lowest_cost_run_id}
          />
        </>
      )}
    </>
  );
}
