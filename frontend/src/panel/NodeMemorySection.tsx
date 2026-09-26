import { useEffect, useRef, useState } from "react";

import { MemoryFact } from "../components/MemoryFact";
import {
  deleteMemory,
  listMemories,
  type MemoryPolarity,
  type NodeMemoryRow,
  pinMemory,
  promoteMemory,
  rejectMemory,
  unpinMemory,
  updateMemory,
} from "../lib/api";
import { reposOf } from "../lib/memory";

/**
 * M-memory S5b — the authoring-drawer **Memory** section: this node's own private notes (its
 * node-tier facts, keyed on `node_id` across every repo it has learned on). Unlike the drawer's
 * Skills/Tools (controlled pieces of the single Save), this is an INDEPENDENT-fetch + direct-mutate
 * mini-shelf — it hits the memory endpoints itself, never the node Save. Manage variant (pin / edit /
 * delete) for active facts + inline Confirm / Discard for pending ones, a repo sub-grouping when the
 * node has learned on more than one repo, an empty state that teaches node memory, and a "Manage all
 * memory" link to the Dashboard shelf (where account/repo-wide facts live).
 */
export function NodeMemorySection({
  nodeId,
  onManageAll,
}: {
  nodeId: string;
  onManageAll?: () => void;
}) {
  const [active, setActive] = useState<NodeMemoryRow[]>([]);
  const [pending, setPending] = useState<NodeMemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const mounted = useRef(true);

  const reloadActive = async () => {
    const rows = await listMemories({ node_id: nodeId });
    if (mounted.current) setActive(rows ?? []);
  };
  const reloadPending = async () => {
    const rows = await listMemories({ node_id: nodeId, status: "pending_review" });
    if (mounted.current) setPending(rows ?? []);
  };

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    Promise.all([reloadActive(), reloadPending()])
      .catch(() => {})
      .finally(() => mounted.current && setLoading(false));
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  const guard = (p: Promise<unknown>, msg: string): Promise<void> =>
    p
      .then(() => undefined)
      .catch(() => {
        if (mounted.current) setError(msg);
      });

  const handleTogglePin = (m: NodeMemoryRow) =>
    void guard(
      (m.pinned ? unpinMemory : pinMemory)(m.id).then(reloadActive),
      "Couldn't update the pin.",
    );
  const handleSaveEdit = (m: NodeMemoryRow, patch: { content: string; polarity: MemoryPolarity }) =>
    void guard(updateMemory(m.id, patch).then(reloadActive), "Couldn't save the edit.");
  const handleDelete = (m: NodeMemoryRow) =>
    void guard(deleteMemory(m.id).then(reloadActive), "Couldn't delete the memory.");
  const handleConfirm = (m: NodeMemoryRow) =>
    void guard(
      promoteMemory(m.id).then(() => Promise.all([reloadActive(), reloadPending()])),
      "Couldn't confirm the memory.",
    );
  const handleDiscard = (m: NodeMemoryRow) =>
    void guard(rejectMemory(m.id).then(reloadPending), "Couldn't discard the memory.");

  // Group the active node facts by the repo they were learned on. A single repo (or all repo-agnostic)
  // → a flat list; more than one distinct repo → a per-repo sub-group (reuse `reposOf`'s ordering).
  const hasNullRepo = active.some((m) => m.repo_key === null);
  const groups: { key: string; label: string; rows: NodeMemoryRow[] }[] = [
    ...reposOf(active).map((r) => ({
      key: r.repo_key,
      label: r.repo_key,
      rows: active.filter((m) => m.repo_key === r.repo_key),
    })),
    ...(hasNullRepo
      ? [
          {
            key: "__none__",
            label: "Not repo-specific",
            rows: active.filter((m) => m.repo_key === null),
          },
        ]
      : []),
  ];
  const grouped = groups.length > 1;
  const count = active.length + pending.length;
  const isEmpty = !loading && count === 0;

  const renderManage = (m: NodeMemoryRow) => (
    <MemoryFact
      key={m.id}
      memory={m}
      variant="manage"
      onTogglePin={handleTogglePin}
      onSaveEdit={handleSaveEdit}
      onDelete={handleDelete}
    />
  );

  return (
    <details
      className="tv-field tv-mem-drawer"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="tv-field__label">Memory{count > 0 ? ` · ${count}` : ""}</summary>
      <span className="tv-field__hint">
        This node’s own private notes — lessons it has learned that apply only to it.
      </span>

      {loading ? (
        <p className="tv-panel-note">Loading memory…</p>
      ) : isEmpty ? (
        <p className="tv-panel-note">
          This node has no private notes yet — as it runs, lessons specific to it appear here;
          shared repo-wide lessons live in Toolkit › Memory.
        </p>
      ) : (
        <div className="tv-mem-facts">
          {pending.length > 0 && (
            <div className="tv-mem-section">
              <h4 className="tv-mem-section__sub">Pending review ({pending.length})</h4>
              <ul className="tv-mem-list">
                {pending.map((m) => (
                  <MemoryFact
                    key={m.id}
                    memory={m}
                    variant="pending"
                    onConfirm={handleConfirm}
                    onDiscard={handleDiscard}
                  />
                ))}
              </ul>
            </div>
          )}

          {grouped ? (
            groups.map((g) => (
              <div className="tv-mem-section" key={g.key}>
                <h4 className="tv-mem-section__sub">{g.label}</h4>
                <ul className="tv-mem-list">{g.rows.map(renderManage)}</ul>
              </div>
            ))
          ) : (
            <ul className="tv-mem-list">{active.map(renderManage)}</ul>
          )}
        </div>
      )}

      <div className="tv-mem-drawer__foot">
        <button
          type="button"
          className="tv-btn tv-btn--link tv-btn--sm"
          onClick={() => onManageAll?.()}
        >
          Manage all memory →
        </button>
      </div>

      {error && (
        <p className="tv-panel-note tv-chat__error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
