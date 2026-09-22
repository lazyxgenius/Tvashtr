import { useCallback, useEffect, useState } from "react";

import { domainsEvalGoldenSetsHint } from "../lib/domains";
import {
  createDomainEvalCase,
  deleteDomainEvalCase,
  getLatestDomainEvalRun,
  listDomainEvalCases,
  runDomainEval,
  type DomainEvalCase,
  type DomainEvalRun,
} from "../lib/api";

function fmtScore(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

export function DomainEvalPanel({ domainId }: { domainId: string }) {
  const [cases, setCases] = useState<DomainEvalCase[]>([]);
  const [latest, setLatest] = useState<DomainEvalRun | null>(null);
  const [question, setQuestion] = useState("");
  const [keywords, setKeywords] = useState("");
  const [docIds, setDocIds] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const rows = await listDomainEvalCases(domainId);
    setCases(rows);
    try {
      setLatest(await getLatestDomainEvalRun(domainId));
    } catch {
      setLatest(null);
    }
  }, [domainId]);

  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  return (
    <section className="tv-domains__panel" aria-label="Eval">
      <p className="tv-muted">{domainsEvalGoldenSetsHint()}</p>
      {error && <p role="alert">{error}</p>}
      <div className="tv-domains__eval-scores" aria-label="Latest scores">
        <div>hit@k: {fmtScore(latest?.scores?.hit_at_k)}</div>
        <div>keyword_hit: {fmtScore(latest?.scores?.keyword_hit)}</div>
        <div>status: {latest?.status ?? "—"}</div>
      </div>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await createDomainEvalCase(domainId, {
              question,
              expected_keywords: keywords
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              expected_citation_doc_ids: docIds
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            });
            setQuestion("");
            setKeywords("");
            setDocIds("");
            await refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Question
          <input
            aria-label="Question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
          />
        </label>
        <label>
          Keywords
          <input
            aria-label="Keywords"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="comma-separated"
          />
        </label>
        <label>
          Expected document IDs
          <input
            aria-label="Expected document IDs"
            value={docIds}
            onChange={(e) => setDocIds(e.target.value)}
            placeholder="comma-separated UUIDs"
          />
        </label>
        <button type="submit" disabled={busy}>
          Add case
        </button>
      </form>
      <ul aria-label="Eval cases">
        {cases.map((c) => (
          <li key={c.case_id}>
            <span>{c.question}</span>
            <button
              type="button"
              aria-label={`Delete case ${c.question}`}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await deleteDomainEvalCase(domainId, c.case_id);
                  await refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy || cases.length === 0}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const run = await runDomainEval(domainId);
            setLatest(run);
            await refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Run eval
      </button>
      {latest?.scores?.per_case && latest.scores.per_case.length > 0 && (
        <table aria-label="Per-case scores">
          <thead>
            <tr>
              <th>Question</th>
              <th>hit</th>
              <th>keyword</th>
              <th>error</th>
            </tr>
          </thead>
          <tbody>
            {latest.scores.per_case.map((row) => (
              <tr key={row.case_id}>
                <td>{row.question}</td>
                <td>{row.hit == null ? "—" : row.hit ? "yes" : "no"}</td>
                <td>{row.keyword_hit == null ? "—" : row.keyword_hit ? "yes" : "no"}</td>
                <td>{row.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
