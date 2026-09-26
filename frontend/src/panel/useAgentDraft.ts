/**
 * One agent's unsaved draft, shared by the drawer and the focus view (it lives in `NodeEditor`, above
 * both, so docking keeps it). Save sends one PATCH of ONLY the changed parts, then asks the page to
 * refetch the team graph. A refetch re-seeds every part the user hasn't touched (so a Toolkit-side
 * attach of a tool is picked up, never reverted) and keeps the parts they have.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TeamGraphNode } from "../lib/api";
import { NodeSaveError, patchAgentNode } from "../lib/api/nodes";
import {
  type AgentDraft,
  type ChangeGroup,
  changedGroups,
  draftProblem,
  patchFor,
  rebaseDraft,
  seedDraft,
} from "./agentDraft";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** How long "Saved. This drives the next run you launch." shows before the footer reads clean. */
export const SAVED_NOTICE_MS = 4000;

interface DraftState {
  nodeId: string;
  seedKey: string;
  baseline: AgentDraft;
  draft: AgentDraft;
}

export interface AgentDraftApi {
  draft: AgentDraft;
  /** The last saved values the draft is compared against. */
  baseline: AgentDraft;
  set: <K extends keyof AgentDraft>(field: K, value: AgentDraft[K]) => void;
  update: (patch: Partial<AgentDraft>) => void;
  changed: ChangeGroup[];
  dirtyCount: number;
  isDirty: boolean;
  /** Why Save is blocked (e.g. empty instructions), or null. */
  problem: string | null;
  discard: () => void;
  /** Save the changed parts; resolves true when saved. */
  save: () => Promise<boolean>;
  saveState: SaveState;
  saveError: string | null;
}

export function useAgentDraft(
  node: TeamGraphNode,
  opts: { teamId: string; onSaved?: (saved: TeamGraphNode) => void | Promise<void> },
): AgentDraftApi {
  const nodeSeed = useMemo(() => seedDraft(node), [node]);
  const seedKey = JSON.stringify(nodeSeed);
  const [state, setState] = useState<DraftState>(() => ({
    nodeId: node.id,
    seedKey,
    baseline: nodeSeed,
    draft: nodeSeed,
  }));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Adjust during render (React's derived-state pattern): another node → start over; the same node
  // re-fetched → new baseline, and a clean draft follows it.
  let current = state;
  if (state.nodeId !== node.id) {
    current = { nodeId: node.id, seedKey, baseline: nodeSeed, draft: nodeSeed };
    setState(current);
    if (saveState !== "idle") setSaveState("idle");
    if (saveError !== null) setSaveError(null);
  } else if (state.seedKey !== seedKey) {
    current = {
      nodeId: node.id,
      seedKey,
      baseline: nodeSeed,
      draft: rebaseDraft(state.baseline, state.draft, nodeSeed),
    };
    setState(current);
  }

  const { baseline, draft } = current;
  const changed = useMemo(() => changedGroups(baseline, draft), [baseline, draft]);
  const problem = draftProblem(draft);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // "Saved…" decays to the clean footer.
  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), SAVED_NOTICE_MS);
    return () => clearTimeout(t);
  }, [saveState]);

  const update = useCallback((patch: Partial<AgentDraft>) => {
    setState((s) => ({ ...s, draft: { ...s.draft, ...patch } }));
    setSaveState((st) => (st === "saved" ? "idle" : st));
  }, []);

  const set = useCallback(
    <K extends keyof AgentDraft>(field: K, value: AgentDraft[K]) => {
      update({ [field]: value });
    },
    [update],
  );

  const discard = useCallback(() => {
    setState((s) => ({ ...s, draft: s.baseline }));
    setSaveState("idle");
    setSaveError(null);
  }, []);

  const { teamId, onSaved } = opts;
  const save = useCallback(async (): Promise<boolean> => {
    if (changed.length === 0 || problem !== null || saveState === "saving") return false;
    const sent = draft;
    setSaveState("saving");
    setSaveError(null);
    try {
      const saved = await patchAgentNode(teamId, node.id, patchFor(baseline, sent));
      if (!mounted.current) return true;
      // Clean at once (the graph refetch may lag): what we sent is now the saved baseline.
      setState((s) => (s.nodeId === node.id ? { ...s, baseline: sent } : s));
      setSaveState("saved");
      await onSaved?.(saved);
      return true;
    } catch (err) {
      if (!mounted.current) return false;
      setSaveState("error");
      setSaveError(
        err instanceof NodeSaveError && err.kind !== "other"
          ? err.message
          : "Couldn’t save. Try again.",
      );
      return false;
    }
  }, [baseline, changed.length, draft, node.id, onSaved, problem, saveState, teamId]);

  return {
    draft,
    baseline,
    set,
    update,
    changed,
    dirtyCount: changed.length,
    isDirty: changed.length > 0,
    problem,
    discard,
    save,
    saveState,
    saveError,
  };
}
