import { useState } from "react";
import { X } from "lucide-react";

import type { EdgeRole, GraphEdge, TeamGraphNode } from "../lib/api";
import { branchLabelsOf, edgeRoleOptions, escalationTargets } from "../lib/topology";

// The pending connection the user just drew (S → T), with what the canvas derived about it.
export interface PendingConnect {
  source: string;
  target: string;
  sourceKind: string;
  sourceLabel: string;
  targetLabel: string;
  closesLoop: boolean;
}

// What confirming an edge produces. A bounded rework loop ALSO carries its escalation exit (the
// node is re-entered = the connection TARGET, escalating to a chosen gate/Stop) — you cannot author
// a bounded loop without its exhaustion exit (§6), which is what makes termination provable.
export interface EdgeConfirm {
  role: EdgeRole;
  label?: string;
  loopLimit?: number;
  escalationTargetId?: string;
}

/** The inline edge-role editor: when the user draws S → T, set the edge's role in PLAIN LANGUAGE,
 *  offering only what S supports (a thinker → "Then →"; a gate → approved/rejected; a worker →
 *  "Then →" / "When it outputs … →"; a loop-closing edge → a bounded "Rework loop" with its
 *  escalation exit). Never exposes raw {when}/loop_limit/escalation. */
export function EdgeRoleEditor({
  pending,
  nodes,
  edges,
  onConfirm,
  onCancel,
}: {
  pending: PendingConnect;
  nodes: TeamGraphNode[];
  edges: GraphEdge[];
  onConfirm: (c: EdgeConfirm) => void;
  onCancel: () => void;
}) {
  const options = edgeRoleOptions(pending.sourceKind, pending.closesLoop);
  const seededLabels = branchLabelsOf(edges, pending.source);
  const escTargets = escalationTargets(nodes);

  const [branchLabel, setBranchLabel] = useState(seededLabels[0] ?? "");
  const [loopLimit, setLoopLimit] = useState(3);
  const [escId, setEscId] = useState(escTargets[0]?.id ?? "");

  return (
    <div className="tv-edge-editor" role="dialog" aria-label="Choose the connection's role">
      <header className="tv-edge-editor__head">
        <span className="tv-edge-editor__title">How do they connect?</span>
        <button type="button" onClick={onCancel} aria-label="Cancel" title="Cancel">
          <X size={15} strokeWidth={1.8} />
        </button>
      </header>
      <p className="tv-edge-editor__pair">
        <strong>{pending.sourceLabel}</strong> → <strong>{pending.targetLabel}</strong>
      </p>

      {options.length === 0 ? (
        <p className="tv-edge-editor__note">An ending node has no outgoing step.</p>
      ) : (
        <div className="tv-edge-editor__opts">
          {options.map((o) => {
            if (o.needsLabel) {
              return (
                <div key={o.key} className="tv-edge-editor__row">
                  <input
                    className="tv-edge-editor__input"
                    type="text"
                    list="tv-branch-labels"
                    value={branchLabel}
                    placeholder="e.g. PASS"
                    aria-label="Routing label"
                    onChange={(e) => setBranchLabel(e.target.value)}
                  />
                  <datalist id="tv-branch-labels">
                    {seededLabels.map((l) => (
                      <option key={l} value={l} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    className="tv-btn tv-btn--sm"
                    disabled={!branchLabel.trim()}
                    onClick={() => onConfirm({ role: "branch", label: branchLabel.trim() })}
                  >
                    When it outputs “{branchLabel.trim() || "…"}” →
                  </button>
                </div>
              );
            }
            if (o.isLoop) {
              return (
                <div key={o.key} className="tv-edge-editor__loop">
                  <div className="tv-edge-editor__note">
                    A rework loop needs an exit. Set the retry limit and where {pending.targetLabel}{" "}
                    goes when it’s hit.
                  </div>
                  <label className="tv-edge-editor__field">
                    Retry limit
                    <input
                      type="number"
                      min={1}
                      value={loopLimit}
                      onChange={(e) => setLoopLimit(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </label>
                  <label className="tv-edge-editor__field">
                    When the limit is hit, go to
                    <select value={escId} onChange={(e) => setEscId(e.target.value)}>
                      {escTargets.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.role_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="tv-btn tv-btn--sm"
                    disabled={!escId}
                    onClick={() =>
                      onConfirm({ role: "loop_back", loopLimit, escalationTargetId: escId })
                    }
                  >
                    Add rework loop →
                  </button>
                  {escTargets.length === 0 && (
                    <div className="tv-edge-editor__warn">
                      Add a gate or a Stop ending first — a loop must have somewhere to escalate.
                    </div>
                  )}
                </div>
              );
            }
            return (
              <button
                key={o.key}
                type="button"
                className="tv-btn tv-btn--sm tv-edge-editor__opt"
                onClick={() => onConfirm({ role: o.role, label: o.presetLabel })}
              >
                {o.display}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
