import { useEffect, useRef, useState } from "react";
import { Brain } from "lucide-react";

import {
  createMemory,
  deleteMemory,
  getReviewMode,
  listMemories,
  type MemoryPolarity,
  type NodeMemoryRow,
  pinMemory,
  promoteMemory,
  rejectMemory,
  setReviewMode,
  unpinMemory,
  updateMemory,
} from "../lib/api";
import {
  ALL_REPOS,
  bucketMemories,
  defaultRepo,
  POLARITY_META,
  POLARITY_ORDER,
  reposOf,
} from "../lib/memory";
import { MemoryFact } from "./MemoryFact";

/**
 * M-memory S5a — the account **Memory shelf**: the owner's central place to see, prune, pin, and
 * author the facts the agents have learned across runs, plus the review-mode control. Mounts as the
 * 4th Dashboard shelf (after Providers / Secrets / Tools / Skills). Everything it drives already
 * exists on the backend (M-memory S1–S4) EXCEPT the review-mode toggle endpoint this slice adds; it
 * mirrors the self-fetching ToolsShelf pattern and reuses the shared `MemoryFact` chip.
 */
export function MemoryShelf() {
  const [active, setActive] = useState<NodeMemoryRow[]>([]);
  const [pending, setPending] = useState<NodeMemoryRow[]>([]);
  const [archived, setArchived] = useState<NodeMemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewMode, setReviewModeState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-a-memory form.
  const [contentInput, setContentInput] = useState("");
  const [tier, setTier] = useState<"account" | "repo">("account");
  const [repoInput, setRepoInput] = useState("");
  const [polarity, setPolarity] = useState<MemoryPolarity>("context");
  const [busy, setBusy] = useState(false);

  // The repo whose This-repo + Per-node sections show (null until the first load picks a default).
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const mounted = useRef(true);

  const loadActive = async () => {
    const rows = await listMemories({});
    if (!mounted.current) return;
    setActive(rows);
    setSelectedRepo((cur) => cur ?? defaultRepo(rows) ?? ALL_REPOS);
  };
  const loadPending = async () => {
    const rows = await listMemories({ status: "pending_review" });
    if (mounted.current) setPending(rows);
  };
  const loadArchived = async () => {
    const [superseded, rejected] = await Promise.all([
      listMemories({ status: "superseded" }),
      listMemories({ status: "rejected" }),
    ]);
    if (mounted.current) setArchived([...superseded, ...rejected]);
  };

  useEffect(() => {
    mounted.current = true;
    Promise.all([
      loadActive(),
      loadPending(),
      getReviewMode().then((v) => mounted.current && setReviewModeState(v)),
    ])
      .catch(() => {})
      .finally(() => mounted.current && setLoading(false));
    return () => {
      mounted.current = false;
    };
  }, []);

  // Swallow a rejected mutation into the error banner without leaving an unhandled rejection.
  const guard = (p: Promise<unknown>, msg: string): Promise<void> =>
    p
      .then(() => undefined)
      .catch(() => {
        if (mounted.current) setError(msg);
      });

  const toggleReviewMode = async () => {
    const next = !reviewMode;
    setReviewModeState(next); // optimistic
    try {
      const confirmed = await setReviewMode(next);
      if (mounted.current) setReviewModeState(confirmed);
    } catch {
      if (!mounted.current) return;
      setReviewModeState(!next);
      setError("Couldn't change review mode.");
    }
  };

  const handleAdd = async () => {
    const content = contentInput.trim();
    if (content === "") {
      setError("Write the memory first.");
      return;
    }
    const repo_key = tier === "repo" ? repoInput.trim() : null;
    if (tier === "repo" && repo_key === "") {
      setError("A repo path is required for a This-repo memory.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createMemory({ content, polarity, repo_key });
      setContentInput("");
      await Promise.all([loadActive(), loadPending()]);
    } catch {
      if (mounted.current) setError("Couldn't save the memory.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const handleTogglePin = (m: NodeMemoryRow) =>
    void guard(
      (m.pinned ? unpinMemory : pinMemory)(m.id).then(loadActive),
      "Couldn't update the pin.",
    );
  const handleSaveEdit = (m: NodeMemoryRow, patch: { content: string; polarity: MemoryPolarity }) =>
    void guard(updateMemory(m.id, patch).then(loadActive), "Couldn't save the edit.");
  const handleDelete = (m: NodeMemoryRow) =>
    void guard(deleteMemory(m.id).then(loadActive), "Couldn't delete the memory.");
  const handleConfirm = (m: NodeMemoryRow) =>
    void guard(
      promoteMemory(m.id).then(() => Promise.all([loadActive(), loadPending()])),
      "Couldn't confirm the memory.",
    );
  const handleDiscard = (m: NodeMemoryRow) =>
    void guard(
      rejectMemory(m.id).then(() => Promise.all([loadActive(), loadPending()])),
      "Couldn't discard the memory.",
    );

  const toggleArchived = () => {
    const next = !archivedOpen;
    setArchivedOpen(next);
    if (next) void guard(loadArchived(), "Couldn't load the archived memories.");
  };

  const repos = reposOf(active);
  const buckets = bucketMemories(active, selectedRepo ?? ALL_REPOS);
  const isEmpty = !loading && active.length === 0 && pending.length === 0;

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
    <section className="tv-dash__panel tv-dash__prov tv-mem" aria-label="Your agent memory">
      <div className="tv-dash__prov-head">
        <div className="tv-dash__prov-lede">
          <div className="tv-dash__prov-title">
            <Brain size={16} strokeWidth={1.7} />
            <h2>Memory</h2>
          </div>
          <p className="tv-dash__prov-sub">
            What your agents have learned across runs — prune it, pin what matters, and control how
            new memories are reviewed before they apply.
          </p>
        </div>
        <div className="tv-dash__prov-add" style={{ display: "grid", gap: "0.4rem" }}>
          <textarea
            className="tv-node-prompt"
            aria-label="New memory content"
            rows={2}
            placeholder="e.g. Always run the linter before shipping"
            value={contentInput}
            onChange={(e) => setContentInput(e.target.value)}
            style={{ width: "100%" }}
          />
          <div className="tv-mem-addrow">
            <div className="tv-field">
              <span className="tv-field__label">Applies to</span>
              <select
                aria-label="Tier"
                value={tier}
                onChange={(e) => setTier(e.target.value as "account" | "repo")}
              >
                <option value="account">Account (all repos)</option>
                <option value="repo">This repo</option>
              </select>
            </div>
            {tier === "repo" && (
              <div className="tv-field">
                <span className="tv-field__label">Repo path</span>
                <input
                  className="tv-launch__input"
                  aria-label="Repo path"
                  placeholder="/path/to/repo"
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                />
              </div>
            )}
            <div className="tv-field">
              <span className="tv-field__label">Force</span>
              <select
                aria-label="Polarity"
                value={polarity}
                onChange={(e) => setPolarity(e.target.value as MemoryPolarity)}
              >
                {POLARITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {POLARITY_META[p].label} — {p}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="tv-btn tv-btn--primary"
              onClick={() => void handleAdd()}
              disabled={busy}
            >
              Add memory
            </button>
          </div>
        </div>
      </div>

      <div className="tv-mem-review">
        <button
          type="button"
          role="switch"
          aria-checked={reviewMode}
          aria-label="Review new memories before they apply"
          className={`tv-switch${reviewMode ? " tv-switch--on" : ""}`}
          onClick={() => void toggleReviewMode()}
        >
          <span className="tv-switch__thumb" />
        </button>
        <div className="tv-mem-review__text">
          <strong>Review new memories before they apply</strong>
          <span className="tv-field__hint">
            {reviewMode
              ? "On — every new memory waits in the inbox below until you confirm it."
              : "Off — memories apply automatically (only a failed run's cautions wait)."}
          </span>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="tv-mem-pending">
          <h3 className="tv-mem-section__head">Pending review ({pending.length})</h3>
          <ul className="tv-mem-list">
            {pending.map((m) => (
              <MemoryFact
                key={m.id}
                memory={m}
                variant="pending"
                showTier
                onConfirm={handleConfirm}
                onDiscard={handleDiscard}
              />
            ))}
          </ul>
        </div>
      )}

      {isEmpty ? (
        <p className="tv-dash__prov-empty">
          Your agents haven&rsquo;t learned anything yet. As they run, useful facts about your repos
          will appear here — and you can add your own above.
        </p>
      ) : (
        <div className="tv-mem-facts">
          {buckets.account.length > 0 && (
            <div className="tv-mem-section">
              <h3 className="tv-mem-section__head">Account</h3>
              <ul className="tv-mem-list">{buckets.account.map(renderManage)}</ul>
            </div>
          )}

          {repos.length > 0 && (
            <div className="tv-mem-reposel">
              <span className="tv-field__label">Repo</span>
              <select
                aria-label="Repo"
                value={selectedRepo ?? ALL_REPOS}
                onChange={(e) => setSelectedRepo(e.target.value)}
              >
                {repos.map((r) => (
                  <option key={r.repo_key} value={r.repo_key}>
                    {r.repo_key} ({r.count})
                  </option>
                ))}
                <option value={ALL_REPOS}>All repos</option>
              </select>
            </div>
          )}

          {buckets.repoGroups.map((group) => (
            <div className="tv-mem-section" key={group.repo_key}>
              <h3 className="tv-mem-section__head">
                {selectedRepo === ALL_REPOS ? group.repo_key : "This repo"}
              </h3>
              {group.repoFacts.length > 0 && (
                <ul className="tv-mem-list">{group.repoFacts.map(renderManage)}</ul>
              )}
              {group.nodeGroups.map((ng) => (
                <div className="tv-mem-nodegroup" key={ng.node_id}>
                  <h4 className="tv-mem-section__sub">Node {ng.node_id.slice(0, 8)}</h4>
                  <ul className="tv-mem-list">{ng.rows.map(renderManage)}</ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="tv-mem-archived">
        <button
          type="button"
          className="tv-btn tv-btn--link tv-btn--sm"
          aria-expanded={archivedOpen}
          onClick={toggleArchived}
        >
          {archivedOpen ? "Hide archived" : "Show archived"}
        </button>
        {archivedOpen && (
          <ul className="tv-mem-list">
            {archived.length === 0 ? (
              <li className="tv-field__hint">No superseded or rejected memories.</li>
            ) : (
              archived.map((m) => <MemoryFact key={m.id} memory={m} variant="archived" showTier />)
            )}
          </ul>
        )}
      </div>

      {error && (
        <div className="tv-dash__error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
