import { useEffect, useRef, useState } from "react";

import { Badge, Button } from "../design-system/components";
import {
  getRunMemories,
  listMemories,
  type MemoryPolarity,
  type NodeInvocation,
  type NodeMemoryRow,
  promoteMemory,
  rejectMemory,
} from "../lib/api";
import { TIER_LABEL, usedFacts } from "../lib/memory";
import { FORCE_VARIANT, forceLabel } from "../pages/memory/memoryModel";
import { LoadState } from "./runs/RunsTab";
import "./memory/memory.css";

type Phase = "idle" | "loading" | "ready" | "error";

/**
 * The run drawer's Memory tab, in the agent drawer's Memory layout. Two groups:
 *  - **Used this run** — the notes put into THIS agent's context, gathered from every round's
 *    `context_manifest.memory` ({id, polarity} stubs) and resolved against the store
 *    (`include_superseded`, so a since-replaced note still resolves; a deleted one reads
 *    "(no longer stored)"), strongest first (`usedFacts`).
 *  - **Learned this run** — what this RUN taught (`GET /api/runs/{id}/memories`), the same on every
 *    agent: the rows carry no per-agent link for the common repo/account note. Notes waiting for
 *    review get Keep / Discard.
 *
 * It loads when the tab opens, and only reads and reviews through the existing memory endpoints.
 */
export function RunMemory({
  invocations,
  runId,
}: {
  invocations: NodeInvocation[];
  runId: string | null;
}) {
  const [store, setStore] = useState<Map<string, NodeMemoryRow>>(new Map());
  const [learned, setLearned] = useState<NodeMemoryRow[]>([]);
  const [state, setState] = useState<Phase>("idle");
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const reloadStore = async () => {
    const rows = await listMemories({ include_superseded: true });
    if (mounted.current) setStore(new Map((rows ?? []).map((r) => [r.id, r])));
  };
  const reloadLearned = async () => {
    if (!runId) return;
    const rows = await getRunMemories(runId);
    if (mounted.current) setLearned(rows ?? []);
  };

  useEffect(() => {
    mounted.current = true;
    setState("loading");
    Promise.all([reloadStore(), reloadLearned()])
      .then(() => mounted.current && setState("ready"))
      .catch(() => mounted.current && setState("error"));
    return () => {
      mounted.current = false;
    };
    // Re-fetch when the run changes (or on Retry); the injected refs come from `invocations` and are
    // read at render, so they need no effect dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, attempt]);

  // Swallow a rejected mutation into the error banner without an unhandled rejection.
  const guard = (p: Promise<unknown>, msg: string): Promise<void> =>
    p
      .then(() => undefined)
      .catch(() => {
        if (mounted.current) setError(msg);
      });

  // Keep/Discard re-reads the learned list (the pending row leaves) AND the store (a kept note
  // becomes resolvable in "Used this run").
  const handleConfirm = (m: NodeMemoryRow) =>
    void guard(
      promoteMemory(m.id).then(() => Promise.all([reloadLearned(), reloadStore()])),
      "Couldn’t keep that note. Try again.",
    );
  const handleDiscard = (m: NodeMemoryRow) =>
    void guard(rejectMemory(m.id).then(reloadLearned), "Couldn’t discard that note. Try again.");

  const refs = invocations.flatMap((inv) => inv.context_manifest?.memory ?? []);
  const used = usedFacts(refs, store);
  const pendingLearned = learned.filter((m) => m.status === "pending_review");
  const settledLearned = learned.filter((m) => m.status !== "pending_review");

  if (state !== "ready") {
    return (
      <LoadState
        state={state === "error" ? "error" : "loading"}
        loading="Loading memory"
        error="Couldn’t load this run’s memory."
        onRetry={() => setAttempt((a) => a + 1)}
      />
    );
  }

  return (
    <div className="nd-mem">
      <section className="nd-mem__group" aria-label="Used this run">
        <h4 className="nd-mem__head">Used this run{used.length > 0 && ` · ${used.length}`}</h4>
        {used.length === 0 ? (
          <p className="nd-mem__intro">
            No memory was injected into this agent’s context this run.
          </p>
        ) : (
          <ul className="nd-mem__list">
            {used.map((u) => (
              // A used id no longer in the store keeps the force it was given; its text is gone.
              <Note
                key={u.id}
                content={u.row?.content ?? "(no longer stored)"}
                polarity={u.row?.polarity ?? u.polarity}
                scope={u.row ? TIER_LABEL[u.row.tier] : "Deleted since"}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="nd-mem__group" aria-label="Learned this run">
        <h4 className="nd-mem__head">
          Learned this run{learned.length > 0 && ` · ${learned.length}`}
        </h4>
        {learned.length === 0 ? (
          <p className="nd-mem__intro">This run hasn’t taught any durable memory.</p>
        ) : (
          <>
            <p className="nd-mem__intro">
              What this run taught the whole team, so every agent in it shows the same list.
            </p>
            <ul className="nd-mem__list">
              {pendingLearned.map((m) => (
                <Note
                  key={m.id}
                  content={m.content}
                  polarity={m.polarity}
                  scope={TIER_LABEL[m.tier]}
                  review={{
                    onKeep: () => handleConfirm(m),
                    onDiscard: () => handleDiscard(m),
                  }}
                />
              ))}
              {settledLearned.map((m) => (
                <Note
                  key={m.id}
                  content={m.content}
                  polarity={m.polarity}
                  scope={TIER_LABEL[m.tier]}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      {error && (
        <div className="nd-mem__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** One note: its text, where it applies and its force; a note waiting for review adds Keep / Discard. */
function Note({
  content,
  polarity,
  scope,
  review,
}: {
  content: string;
  polarity: MemoryPolarity;
  scope: string;
  review?: { onKeep: () => void; onDiscard: () => void };
}) {
  return (
    <li className={`nd-mem__note${review ? " nd-mem__note--pending" : ""}`}>
      <div className="nd-mem__text">{content}</div>
      <div className="nd-mem__meta">
        <span className="nd-mem__origin">{scope}</span>
        <Badge variant={FORCE_VARIANT[polarity]}>{forceLabel(polarity)}</Badge>
      </div>
      {review && (
        <div className="nd-mem__review">
          <Button
            variant="primary"
            size="sm"
            aria-label={`Keep ${content}`}
            onClick={review.onKeep}
          >
            Keep
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Discard ${content}`}
            onClick={review.onDiscard}
          >
            Discard
          </Button>
        </div>
      )}
    </li>
  );
}
