import { useEffect, useRef, useState } from "react";

import { MemoryFact } from "../components/MemoryFact";
import {
  getRunMemories,
  listMemories,
  type NodeInvocation,
  type NodeMemoryRow,
  promoteMemory,
  rejectMemory,
} from "../lib/api";
import { POLARITY_META, usedFacts } from "../lib/memory";

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * M-memory S5b — the run-inspector **Memory** tab for one node's run. Two read zones:
 *  - **Used this run** — the facts injected into THIS node's context, gathered from every round's
 *    `context_manifest.memory` ({id, polarity} stubs) and resolved CLIENT-SIDE against the store
 *    (`include_superseded`, so a since-superseded fact still resolves; a deleted one renders
 *    "(no longer stored)"), ordered by directive force via `usedFacts`.
 *  - **Learned this run** — the durable facts this RUN taught (`GET /api/runs/{id}/memories`). Shown
 *    RUN-LEVEL (identical on every node's tab): the endpoint rows carry `source_invocation_id`, but
 *    the FE invocation objects carry no id to join on, and `node_id` is null for the common
 *    repo/account fact — so per-node attribution would HIDE run-wide lessons. A hint states the
 *    scope. Pending rows (`pending_review`) get inline Confirm / Discard.
 *
 * Fetches lazily (this content mounts only when the Memory segment is active, like `RunDiff`) and is
 * READ/mutate-only against the EXISTING memory endpoints — no run-path or backend change (S5b).
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
  const [state, setState] = useState<LoadState>("idle");
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
    // Re-fetch when the run changes; the injected refs come from `invocations` (static per run) and
    // are read at render, so they need no effect dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Swallow a rejected mutation into the error banner without an unhandled rejection.
  const guard = (p: Promise<unknown>, msg: string): Promise<void> =>
    p
      .then(() => undefined)
      .catch(() => {
        if (mounted.current) setError(msg);
      });

  // Promote/reject re-reads the learned list (the pending row leaves) AND the store (a promoted fact
  // becomes resolvable in "Used this run").
  const handleConfirm = (m: NodeMemoryRow) =>
    void guard(
      promoteMemory(m.id).then(() => Promise.all([reloadLearned(), reloadStore()])),
      "Couldn't confirm the memory.",
    );
  const handleDiscard = (m: NodeMemoryRow) =>
    void guard(rejectMemory(m.id).then(reloadLearned), "Couldn't discard the memory.");

  const refs = invocations.flatMap((inv) => inv.context_manifest?.memory ?? []);
  const used = usedFacts(refs, store);
  const pendingLearned = learned.filter((m) => m.status === "pending_review");
  const settledLearned = learned.filter((m) => m.status !== "pending_review");

  if (state === "idle" || state === "loading") {
    return (
      <div className="tv-scroll">
        <p className="tv-panel-note">Loading memory…</p>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="tv-scroll">
        <p className="tv-panel-note">Couldn’t load this run’s memory.</p>
      </div>
    );
  }

  return (
    <div className="tv-scroll">
      <section className="tv-mem-section" aria-label="Used this run">
        <h3 className="tv-mem-section__head">Used this run</h3>
        {used.length === 0 ? (
          <p className="tv-panel-note">No memory was injected into this node’s context this run.</p>
        ) : (
          <ul className="tv-mem-list">
            {used.map((u) => {
              if (u.row)
                return <MemoryFact key={u.id} memory={u.row} variant="archived" showTier />;
              // A used id no longer in the store (edited-away / deleted): the polarity survives on the
              // ref, the content is gone.
              const meta = POLARITY_META[u.polarity] ?? {
                label: String(u.polarity).toUpperCase(),
                cls: "context",
              };
              return (
                <li className="tv-mem-fact" key={u.id}>
                  <div className="tv-mem-fact__row">
                    <span
                      className={`tv-badge tv-mem-badge tv-mem-badge--${meta.cls}`}
                      title={u.polarity}
                    >
                      {meta.label}
                    </span>
                    <span className="tv-mem-fact__content tv-mem-fact__gone">
                      (no longer stored)
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="tv-mem-section" aria-label="Learned this run">
        <h3 className="tv-mem-section__head">Learned this run</h3>
        {learned.length === 0 ? (
          <p className="tv-panel-note">This run hasn’t taught any durable memory.</p>
        ) : (
          <>
            <p className="tv-field__hint">
              Facts this run taught — shared by the whole team, shown on every node.
            </p>
            <ul className="tv-mem-list">
              {pendingLearned.map((m) => (
                <MemoryFact
                  key={m.id}
                  memory={m}
                  variant="pending"
                  showTier
                  onConfirm={handleConfirm}
                  onDiscard={handleDiscard}
                />
              ))}
              {settledLearned.map((m) => (
                <MemoryFact key={m.id} memory={m} variant="archived" showTier />
              ))}
            </ul>
          </>
        )}
      </section>

      {error && (
        <p className="tv-panel-note tv-chat__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
