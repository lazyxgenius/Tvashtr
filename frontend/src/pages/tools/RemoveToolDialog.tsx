/**
 * "Remove <name> from Toolkit?" (TkF-ToolMenu-2, TOOL-49): the see-the-impact confirmation. The
 * sentence names the agents that lose the tool, by team, from the tool's page data
 * (`GET /api/tool-library/{id}` → `used_by_agents`), so it opens once that has loaded — or failed
 * or taken too long, when it falls back to the row's counts. "Remove tool" is a secondary button,
 * as drawn; there is no undo (TOOL-50).
 *
 * The tool page (TkF-Detail-5, TOOL-58) passes the agents it already shows (`agents`) and asks
 * "Remove <name>?" — "Engineer, Reviewer and Writer lose it on their next run. You can add it again
 * later."
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "../../design-system/components";
import { type ToolItem, type UsageRow, deleteTool, getTool } from "../../lib/api/tools";
import { useModalDialog } from "../../lib/useModalDialog";
import { pageRemoveImpact, removeImpact } from "./toolFormat";
import "../secrets/secrets.css";

const REMOVE_FAILED = "Couldn’t remove the tool. Try again.";
// Past this, open with the counts alone rather than leave the click unanswered.
const AGENTS_WAIT_MS = 3000;

type Agents = { rows: UsageRow[] | null } | null;

/** The tool's agents: `{rows}` once known (`rows: null` = couldn't load), `null` while loading. */
function useToolAgents(tool: ToolItem, known: UsageRow[] | undefined): Agents {
  const unused = tool.used_by.agent_count === 0;
  const [agents, setAgents] = useState<Agents>(
    known ? { rows: known } : unused ? { rows: [] } : null,
  );
  const skip = unused || known !== undefined;
  useEffect(() => {
    if (skip) return;
    let live = true;
    const timer = setTimeout(() => live && setAgents((a) => a ?? { rows: null }), AGENTS_WAIT_MS);
    getTool(tool.id).then(
      (detail) => live && setAgents((a) => a ?? { rows: detail.used_by_agents }),
      () => live && setAgents((a) => a ?? { rows: null }),
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tool.id, skip]);
  return agents;
}

export function RemoveToolDialog({
  tool,
  agents: known,
  onClose,
  onRemoved,
}: {
  tool: ToolItem;
  /** The tool page's agents: asks the page's way ("Remove <name>?") without loading them again. */
  agents?: UsageRow[];
  onClose: () => void;
  /** Called once the server has removed it. */
  onRemoved: () => void;
}) {
  const agents = useToolAgents(tool, known);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = () => {
    if (!busy) onClose();
  };
  const ref = useModalDialog<HTMLDivElement>(agents !== null, cancel);
  if (agents === null) return null;

  const title = known ? `Remove ${tool.name}?` : `Remove ${tool.name} from Toolkit?`;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteTool(tool.id);
      onRemoved();
    } catch {
      setBusy(false);
      setError(REMOVE_FAILED);
    }
  };

  return createPortal(
    <>
      <div className="ds-scrim" onClick={cancel} aria-hidden />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="ds-dialog sc-dialog sc-dialog--confirm"
        tabIndex={-1}
      >
        <h2 className="ds-dialog__title">{title}</h2>
        <div className="ds-dialog__body">
          {known ? pageRemoveImpact(known) : removeImpact(tool.used_by, agents.rows)}
        </div>
        {error && (
          <div className="sc-dialog__error" role="alert">
            {error}
          </div>
        )}
        <div className="ds-dialog__actions">
          <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void confirm()} loading={busy}>
            Remove tool
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
