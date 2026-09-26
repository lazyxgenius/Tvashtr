/**
 * A domain's Quality tab (DM-70…DM-79; Dm-Quality, DmF-Qual-1…5): the score cards of the latest
 * finished test run (with deltas against the run picked in "Compare with"), **Add test question**
 * and **Run all tests**, the running banner (progress + estimate; polled), and the table of test
 * questions with Found / Missed results — a miss opens to show the top 3 passages search found.
 * With no test questions, a card offers to add one or pick one from the Ask history.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Target,
  Trash2,
  X,
} from "lucide-react";

import { Badge, Button, Menu, Select, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type DomainDetailView,
  type DomainFile,
  type DomainTestCase,
  type DomainTestResult,
  type DomainTestRun,
  deleteTestCase,
  getTestRun,
  listDomainFiles,
  listTestCases,
  listTestRuns,
  startTestRun,
} from "../../lib/api/domains";
import {
  changeMark,
  compareOptions,
  expectedLabel,
  isMiss,
  missHint,
  percent,
  runLine,
  runningText,
  scoreDelta,
} from "./qualityFormat";
import { type SheetMode, TestQuestionSheet } from "./TestQuestionSheet";
import { UNDO_MS } from "./useFileDeletes";
import "./quality.css";

const POLL_MS = 1500;
const BACKEND_DOWN = "Couldn’t reach Tvashtr — is the backend running?";

function configTopK(config: Record<string, unknown>): number {
  const r = config.retrieval;
  const k = r && typeof r === "object" ? (r as Record<string, unknown>).top_k : undefined;
  return typeof k === "number" && k >= 1 ? k : 8;
}

function Result({ value, mark }: { value: boolean | null | undefined; mark: string | null }) {
  if (value !== true && value !== false) return <span className="dm-qres-none">—</span>;
  return (
    <>
      <span className={value ? "dm-qres dm-qres--ok" : "dm-qres dm-qres--miss"}>
        {value ? (
          <Check size={12} strokeWidth={2.2} aria-hidden />
        ) : (
          <X size={12} strokeWidth={2.2} aria-hidden />
        )}
        {value ? "Found" : "Missed"}
      </span>
      {mark && (
        <>
          {" "}
          <span className={mark === "fixed" ? "dm-qmark" : "dm-qmark dm-qmark--new"}>{mark}</span>
        </>
      )}
    </>
  );
}

/** "What search found (top 3 of 8)" under a missed row (DM-77). */
function MissDetail({
  testCase,
  result,
  run,
}: {
  testCase: DomainTestCase;
  result: DomainTestResult;
  run: DomainTestRun;
}) {
  const hint = missHint(testCase, result, run);
  return (
    <tr className="dm-qrow dm-qrow--open">
      <td>
        <div className="dm-qmiss">
          <div className="dm-qmiss__title">
            What search found (top {result.top.length} of {run.top_k ?? 8})
          </div>
          <ul className="dm-qmiss__list">
            {result.top.map((p) => (
              <li key={p.number} className="dm-qmiss__item">
                <span className="dm-qmiss__n">{p.number}</span>
                <span className="dm-qmiss__file">{p.filename}</span>
                <span className="dm-qmiss__text">{p.excerpt}</span>
              </li>
            ))}
          </ul>
          {hint && <div className="dm-qmiss__hint">{hint}</div>}
        </div>
      </td>
      <td />
      <td />
      <td />
      <td />
      <td />
    </tr>
  );
}

export function QualityTab({ detail, now }: { detail: DomainDetailView; now: Date }) {
  const id = detail.domain_id;
  const toast = useToast();
  const [cases, setCases] = useState<DomainTestCase[] | null>(null);
  const [runs, setRuns] = useState<DomainTestRun[]>([]);
  const [latest, setLatest] = useState<DomainTestRun | null>(null);
  const [compareId, setCompareId] = useState("");
  const [compared, setCompared] = useState<DomainTestRun | null>(null);
  const [files, setFiles] = useState<DomainFile[]>([]);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cs, rs] = await Promise.all([listTestCases(id), listTestRuns(id)]);
      const done = rs.find((r) => r.status === "completed");
      const full = done ? await getTestRun(id, done.run_id) : null;
      setCases(cs);
      setRuns(rs);
      setLatest(full);
      setError(null);
    } catch {
      setError(BACKEND_DOWN);
    }
  }, [id]);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    void load();
    listDomainFiles(id)
      .then((l) => setFiles(l.documents))
      .catch(() => undefined);
  }, [id, load]);

  // While a run is going, poll it; when it ends, read the results.
  const running = runs[0]?.status === "running" ? runs[0] : null;
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => {
      listTestRuns(id)
        .then((rs) => (rs[0]?.status === "running" ? setRuns(rs) : void loadRef.current()))
        .catch(() => setRuns((rs) => [...rs]));
    }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [id, running]);

  const older = latest
    ? runs.filter((r) => r.status === "completed" && r.run_id !== latest.run_id)
    : [];
  const options = latest ? compareOptions(older, latest, now) : [];
  const picked = options.find((o) => o.value === compareId) ?? options[0];
  const pickedId = picked?.value ?? "";
  useEffect(() => {
    if (!pickedId) {
      setCompared(null);
      return;
    }
    let live = true;
    getTestRun(id, pickedId)
      .then((r) => live && setCompared(r))
      .catch(() => live && setCompared(null));
    return () => {
      live = false;
    };
  }, [id, pickedId]);

  // Deleting a test question: hidden at once, sent when the Undo toast closes (or on leaving).
  const pending = useRef(new Map<string, number>());
  const commit = useCallback(
    (caseId: string, keepalive = false) => {
      window.clearTimeout(pending.current.get(caseId));
      pending.current.delete(caseId);
      deleteTestCase(id, caseId, { keepalive })
        .then(() => {
          if (!keepalive) void loadRef.current();
        })
        .catch(() => {
          setHidden((h) => h.filter((x) => x !== caseId));
          toast({ message: "Couldn’t delete the test question.", tone: "error" });
        });
    },
    [id, toast],
  );
  useEffect(() => {
    const map = pending.current;
    const flush = () => [...map.keys()].forEach((cid) => commit(cid, true));
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [commit]);

  const remove = (c: DomainTestCase) => {
    setHidden((h) => [...h, c.case_id]);
    pending.current.set(
      c.case_id,
      window.setTimeout(() => commit(c.case_id), UNDO_MS),
    );
    toast({
      message: "Test question deleted.",
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          window.clearTimeout(pending.current.get(c.case_id));
          pending.current.delete(c.case_id);
          setHidden((h) => h.filter((x) => x !== c.case_id));
        },
      },
    });
  };

  const runAll = async () => {
    setStarting(true);
    try {
      const run = await startTestRun(id);
      setRuns((rs) => [run, ...rs.filter((r) => r.run_id !== run.run_id)]);
      setOpen(null);
    } catch (err) {
      toast({ message: err instanceof ApiError ? err.message : BACKEND_DOWN, tone: "error" });
    } finally {
      setStarting(false);
    }
  };

  if (cases === null) {
    return error ? (
      <div className="dm-error" role="alert">
        <span>{error}</span>
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    ) : null;
  }

  const visible = cases.filter((c) => !hidden.includes(c.case_id));
  const results = new Map((running ? [] : (latest?.results ?? [])).map((r) => [r.case_id, r]));
  const before = new Map((compared?.results ?? []).map((r) => [r.case_id, r]));
  const failed = runs[0]?.status === "failed" ? runs[0] : null;
  const k = latest?.top_k ?? configTopK(detail.config);
  const vs = compared && picked ? picked.vs : null;
  const delta = (a: number | null | undefined, b: number | null | undefined) =>
    vs && latest ? scoreDelta(a ?? null, b ?? null, vs) : null;

  const sheetEl = sheet && (
    <TestQuestionSheet
      domainId={id}
      mode={sheet}
      files={files}
      count={visible.length}
      onClose={() => setSheet(null)}
      onSaved={() => {
        setSheet(null);
        void load();
      }}
    />
  );

  if (visible.length === 0) {
    return (
      <div className="dm-qual">
        <div className="dm-qempty">
          <span className="dm-qempty__tile">
            <Target size={22} strokeWidth={1.6} aria-hidden />
          </span>
          <h2 className="dm-qempty__title">Check that search finds the right files</h2>
          <p className="dm-qempty__text">
            Add questions you already know the answer to. Tvashtr checks whether search finds the
            file you expect and the words you list. Run them again after you change a setting to see
            if it helped.
          </p>
          <div className="dm-qempty__actions">
            <Button
              variant="primary"
              size="sm"
              className="dm-btn-inline"
              onClick={() => setSheet({ kind: "add" })}
            >
              <Plus size={15} strokeWidth={1.6} aria-hidden />
              <span>Add test question</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="dm-btn-inline"
              onClick={() => setSheet({ kind: "history" })}
            >
              <MessageSquare size={15} strokeWidth={1.6} aria-hidden />
              <span>Pick from Ask history</span>
            </Button>
          </div>
        </div>
        {sheetEl}
      </div>
    );
  }

  const cards = [
    {
      label: "Found the right file",
      value: percent(latest?.hit_at_k ?? null),
      delta: delta(latest?.hit_at_k, compared?.hit_at_k),
      text: `At least one expected file was in the top ${k} passages.`,
    },
    {
      label: "Found the key words",
      value: percent(latest?.keyword_hit ?? null),
      delta: delta(latest?.keyword_hit, compared?.keyword_hit),
      text:
        latest && latest.keyword_hit === null
          ? "No key words to check yet."
          : "Every key word you listed showed up in the passages found.",
    },
    {
      label: "Test questions",
      value: String(visible.length),
      delta: null,
      text: runLine(latest, now),
    },
  ];

  return (
    <div className="dm-qual">
      <div className="dm-qcards">
        {cards.map((c) => (
          <div key={c.label} className="dm-qcard">
            <span className="dm-qcard__label">{c.label}</span>
            <div className="dm-qcard__row">
              <span className="dm-qcard__value">{c.value}</span>
              {c.delta && (
                <span
                  className={c.delta.startsWith("+") ? "dm-qdelta" : "dm-qdelta dm-qdelta--down"}
                >
                  {c.delta}
                </span>
              )}
            </div>
            <span className="dm-qcard__text">{c.text}</span>
          </div>
        ))}
      </div>

      <div className="dm-qbar">
        <span className="dm-qbar__label">Compare with</span>
        <span className="dm-qbar__select">
          <Select
            aria-label="Compare with"
            value={pickedId}
            disabled={options.length === 0}
            onChange={(e) => setCompareId(e.target.value)}
          >
            {options.length ? (
              options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))
            ) : (
              <option value="">No earlier run</option>
            )}
          </Select>
        </span>
        <span className="dm-qbar__gap" />
        <Button
          variant="secondary"
          size="sm"
          className="dm-btn-inline"
          onClick={() => setSheet({ kind: "add" })}
        >
          <Plus size={15} strokeWidth={1.6} aria-hidden />
          <span>Add test question</span>
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="dm-btn-inline"
          loading={Boolean(running) || starting}
          onClick={() => void runAll()}
        >
          <Play size={15} strokeWidth={1.6} aria-hidden />
          <span>Run all tests</span>
        </Button>
      </div>

      {running && (
        <div className="dm-qrun" role="status">
          <LoaderCircle size={15} strokeWidth={1.6} aria-hidden />
          <span>{runningText(running, new Date())}</span>
          <span className="dm-qrun__bar">
            <span
              className="dm-qrun__fill"
              style={{
                width: `${Math.round((100 * running.progress.done) / Math.max(1, running.progress.total))}%`,
              }}
            />
          </span>
        </div>
      )}
      {failed && (
        <div className="dm-qrun dm-qrun--failed" role="alert">
          <span>Tests didn’t run: {failed.error_message ?? "something went wrong."}</span>
        </div>
      )}

      <section className="dm-qtable" aria-label="Test questions">
        <table>
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col" className="dm-qtable__file">
                Expected file
              </th>
              <th scope="col" className="dm-qtable__kw">
                Key words
              </th>
              <th scope="col" className="dm-qtable__res">
                Right file
              </th>
              <th scope="col" className="dm-qtable__res">
                Key words
              </th>
              <th scope="col" className="dm-qtable__menu" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visible.map((c, i) => {
              const r = results.get(c.case_id);
              const was = before.get(c.case_id);
              const miss = isMiss(r);
              const isOpen = miss && open === c.case_id;
              const deleted = c.expected_files.some((f) => !f.exists);
              return (
                <Fragment key={c.case_id}>
                  <tr
                    className={isOpen ? "dm-qrow dm-qrow--open" : "dm-qrow"}
                    onClick={(e) => {
                      if (!miss || (e.target as HTMLElement).closest(".dm-qrow__menu")) return;
                      setOpen(isOpen ? null : c.case_id);
                    }}
                  >
                    <td>
                      {miss ? (
                        <button
                          type="button"
                          className="dm-qrow__q dm-qrow__toggle"
                          aria-expanded={isOpen}
                        >
                          {c.question}
                        </button>
                      ) : (
                        <span className="dm-qrow__q">{c.question}</span>
                      )}
                    </td>
                    <td>
                      <span className="dm-qrow__file">{expectedLabel(c)}</span>
                      {deleted && (
                        <Badge variant="warning" className="dm-qrow__gone">
                          File deleted
                        </Badge>
                      )}
                    </td>
                    <td>
                      <span className="dm-qrow__kw">{c.expected_keywords.join(", ") || "—"}</span>
                    </td>
                    <td>
                      <Result value={r?.hit} mark={changeMark(r?.hit ?? null, was?.hit)} />
                    </td>
                    <td>
                      <Result
                        value={r?.keyword_hit}
                        mark={changeMark(r?.keyword_hit ?? null, was?.keyword_hit)}
                      />
                    </td>
                    <td>
                      <div className="dm-qrow__menu">
                        <Menu
                          label={`More actions for ${c.question}`}
                          items={[
                            {
                              key: "edit",
                              label: "Edit",
                              icon: <Pencil size={15} strokeWidth={1.6} aria-hidden />,
                              onSelect: () => setSheet({ kind: "edit", testCase: c, index: i }),
                            },
                            "separator",
                            {
                              key: "delete",
                              label: "Delete",
                              danger: true,
                              icon: <Trash2 size={15} strokeWidth={1.6} aria-hidden />,
                              onSelect: () => remove(c),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                  {isOpen && r && latest && <MissDetail testCase={c} result={r} run={latest} />}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
      {sheetEl}
    </div>
  );
}
