import { type ComponentProps, useCallback, useEffect, useState } from "react";

import { Input } from "../../design-system/components";
import type { MemoryPolarity } from "../../lib/api";
import { listMemories, type Memory } from "../../lib/api/memory";
import { POLARITY_META, POLARITY_ORDER } from "../../lib/memory";
import { routeToHash, type Route } from "../../lib/nav";
import { MemoryTab } from "../memory/MemoryTab";
import type { NodeMemories } from "../memory/useNodeMemories";

type Scope = "agent" | "repo" | "account";

/**
 * The Memory tab in focus mode (Focus-Memory, FOCUS-55..61): a filter rail — search, scope with
 * counts, force — beside the drawer's Memory parts. "This agent" is the agent's own notes; "This
 * repo" the repo memories of the repo its latest run worked on; "Account" the account-wide ones
 * (one `GET /api/memories`, filtered here). Every change still saves right away.
 */
export function FocusMemoryTab({
  tab,
  repoKey,
}: {
  tab: ComponentProps<typeof MemoryTab>;
  /** The memory repo of this agent's latest run (null: it never ran on a repo). */
  repoKey: string | null;
}) {
  const [text, setText] = useState("");
  const [scopes, setScopes] = useState<ReadonlySet<Scope>>(() => new Set(["agent"]));
  const [forces, setForces] = useState<ReadonlySet<MemoryPolarity>>(() => new Set(POLARITY_ORDER));
  const [all, setAll] = useState<Memory[] | null>(null);

  const loadAll = useCallback(
    () =>
      listMemories("active").then(
        (list) => setAll(list),
        () => undefined,
      ),
    [],
  );
  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const own = tab.memories;
  // A Keep, pin, edit or delete also changes the repo / account lists.
  const memories: NodeMemories = {
    ...own,
    change: async (call) => {
      const done = await own.change(call);
      void loadAll();
      return done;
    },
  };
  const repoNotes = (all ?? []).filter((m) => m.tier === "repo" && m.repo_key === repoKey);
  const accountNotes = (all ?? []).filter((m) => m.tier === "account");
  const counts: Record<Scope, number | null> = {
    agent: own.state === "ready" ? own.active.length : null,
    repo: all && repoKey ? repoNotes.length : null,
    account: all ? accountNotes.length : null,
  };

  const needle = text.trim().toLowerCase();
  const keep = (m: Memory) =>
    forces.has(m.polarity) && (!needle || m.content.toLowerCase().includes(needle));
  const active = [
    ...(scopes.has("agent") ? own.active : []),
    ...(scopes.has("repo") ? repoNotes : []),
    ...(scopes.has("account") ? accountNotes : []),
  ].filter(keep);
  const pending = scopes.has("agent") ? own.pending.filter(keep) : [];
  const filtered = needle !== "" || forces.size < POLARITY_ORDER.length || !scopes.has("agent");

  const flip = <T,>(set: ReadonlySet<T>, value: T, on: boolean): Set<T> => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };
  const shelf: Route = { page: "memory", tab: own.pending.length > 0 ? "inbox" : "active" };
  const scopeRows: { scope: Scope; label: string }[] = [
    { scope: "agent", label: "This agent" },
    { scope: "repo", label: "This repo" },
    { scope: "account", label: "Account" },
  ];

  return (
    <div className="fx-panes fx-panes--memory">
      <aside className="fx-pane fx-rail fx-mem__rail" aria-label="Filter notes">
        <Input
          size="sm"
          placeholder="Search notes"
          aria-label="Search notes"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <span className="fx-label">Scope</span>
        <div className="fx-checks" role="group" aria-label="Scope">
          {scopeRows.map(({ scope, label }) => (
            <label key={scope} className="fx-check">
              <input
                type="checkbox"
                checked={scopes.has(scope)}
                disabled={scope === "repo" && !repoKey}
                onChange={(e) => setScopes(flip(scopes, scope, e.target.checked))}
              />
              {counts[scope] === null ? label : `${label} (${counts[scope]})`}
            </label>
          ))}
        </div>
        <span className="fx-label">Force</span>
        <div className="fx-checks" role="group" aria-label="Force">
          {POLARITY_ORDER.map((p) => (
            <label key={p} className="fx-check">
              <input
                type="checkbox"
                checked={forces.has(p)}
                onChange={(e) => setForces(flip(forces, p, e.target.checked))}
              />
              {POLARITY_META[p].label}
            </label>
          ))}
        </div>
        <a
          className="fx-mem__shelf"
          href={routeToHash(shelf)}
          onClick={(e) => {
            if (!tab.onOpenShelf) return;
            e.preventDefault();
            tab.onOpenShelf(shelf);
          }}
        >
          Open Memory in Toolkit →
        </a>
      </aside>
      <div className="fx-pane fx-pane--detail">
        <MemoryTab {...tab} memories={memories} focus={{ active, pending, filtered }} />
      </div>
    </div>
  );
}
