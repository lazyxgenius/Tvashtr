import type { ReactNode } from "react";
import { ArrowLeft, FileText, Play } from "lucide-react";

import { Button, IconButton } from "../design-system/components";
import { useBackendStatus } from "../lib/backendStatus";

/** The backend status with its label (PANEL-6): "Connected" / "Checking…" / "Can’t reach backend". */
function Connection() {
  const { state } = useBackendStatus();
  return (
    <span className={`cv-conn cv-conn--${state}`} role="status">
      <span className="cv-conn__dot" aria-hidden />
      {state === "offline"
        ? "Can’t reach backend"
        : state === "checking"
          ? "Checking…"
          : "Connected"}
    </span>
  );
}

/**
 * The canvas toolbar (PANEL-3..6): Back to teams, the Run control (or the run view's controls), the
 * team's name, and on the right the run spend and the backend status.
 */
export function CanvasToolbar({
  onBack,
  run,
  teamName,
  spend,
  docs,
  children,
}: {
  onBack?: () => void;
  /** Authoring: "Run this team". Omitted in the run view (its controls come as children). */
  run?: { disabled: boolean; title?: string; onRun: () => void };
  teamName: string;
  spend: string;
  /** DOCS-10: the "Documents {n}" toggle, once the team has a run (count null while loading). */
  docs?: { count: number | null; open: boolean; onToggle: () => void };
  children?: ReactNode;
}) {
  return (
    <div className="cv-bar" role="toolbar" aria-label="Team">
      <div className="cv-bar__group">
        {onBack && (
          <IconButton
            variant="outline"
            aria-label="Back to teams"
            title="Back to teams"
            onClick={onBack}
          >
            <ArrowLeft size={16} strokeWidth={1.8} />
          </IconButton>
        )}
        {run && (
          // The play icon sits inside the label, flush with the text, as the design draws it.
          <Button
            variant="primary"
            className="cv-btn-flush"
            onClick={run.onRun}
            disabled={run.disabled}
            title={run.title}
          >
            <Play size={14} fill="currentColor" strokeWidth={0} aria-hidden />
            <span>Run this team</span>
          </Button>
        )}
        {children}
        {teamName && <span className="cv-team">{teamName}</span>}
        {docs && (
          <button
            type="button"
            className="cv-docs"
            aria-pressed={docs.open}
            onClick={docs.onToggle}
          >
            <FileText size={15} strokeWidth={1.6} aria-hidden />
            Documents
            {docs.count !== null && <span className="cv-docs__count">{docs.count}</span>}
          </button>
        )}
      </div>
      <div className="cv-right">
        <span title="Spend this run">{spend}</span>
        <span className="cv-divider" aria-hidden />
        <Connection />
      </div>
    </div>
  );
}
