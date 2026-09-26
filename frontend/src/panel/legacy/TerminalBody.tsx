import { useState } from "react";

import { type TeamGraphNode, type TerminalConfig, updateTerminalNode } from "../../lib/api";

/**
 * An endpoint's settings (M-endpoint-editable), moved verbatim from the old TeamNodePanel into the
 * new drawer shell: the live Ship / Stop control and its own dirty-aware Save. No tabs.
 */
export function TerminalBody({
  teamId,
  node,
  onSaved,
}: {
  teamId: string;
  node: TeamGraphNode;
  onSaved: () => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);
  const termCfg = (node.config ?? {}) as TerminalConfig;
  const initialTerminalKind: "ship" | "stop" = termCfg.terminal_kind === "ship" ? "ship" : "stop";
  const [terminalKind, setTerminalKind] = useState<"ship" | "stop">(initialTerminalKind);

  const isShip = terminalKind === "ship";
  const terminalDirty = terminalKind !== initialTerminalKind;
  const handleTerminalSave = async () => {
    if (!terminalDirty) return;
    setSaving(true);
    setSaveError(false);
    try {
      await updateTerminalNode(teamId, node.id, terminalKind);
      setSaved(true);
      await onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="tv-scroll tv-node-edit">
      <div className="tv-field">
        <span className="tv-field__label">Endpoint</span>
        <div className="tv-seg" role="group" aria-label="Endpoint">
          <button
            type="button"
            aria-pressed={isShip}
            className={`tv-seg__btn${isShip ? " tv-seg__btn--active" : ""}`}
            onClick={() => {
              setTerminalKind("ship");
              setSaved(false);
            }}
          >
            Ship it
          </button>
          <button
            type="button"
            aria-pressed={!isShip}
            className={`tv-seg__btn${!isShip ? " tv-seg__btn--active" : ""}`}
            onClick={() => {
              setTerminalKind("stop");
              setSaved(false);
            }}
          >
            Stop
          </button>
        </div>
        <span className="tv-field__hint">
          {isShip
            ? "Ship — open a reviewed change on a branch and tag it."
            : "Stop — end the run here with no change shipped."}
        </span>
      </div>

      <div className="tv-prd__editbar">
        <button
          className="tv-btn"
          type="button"
          onClick={() => void handleTerminalSave()}
          disabled={!terminalDirty || saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {terminalDirty ? (
          <span className="tv-prd__dirty">Unsaved changes</span>
        ) : saved ? (
          <span className="tv-prd__saved">Saved — this drives the next run you launch.</span>
        ) : null}
        {saveError && <span className="tv-prd__saveerr">Couldn’t save — try again.</span>}
      </div>
    </div>
  );
}
