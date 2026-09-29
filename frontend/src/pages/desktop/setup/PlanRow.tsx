import { Badge, Button, Switch } from "../../../design-system/components";
import { ExternalLinkIcon } from "../icons";
import type { PlanAction, PlanRowView } from "./planRows";

const TILE: Record<PlanRowView["provider"], string> = { claude: "C", grok: "G" };

/**
 * One Claude Code / Grok row on the Engines step (DT-20, DT-21): tile, name, status badge, the
 * status line and either the "Use my plan" Switch or one small button. `planRows.ts` decides
 * what each bridge state shows.
 */
export function PlanRow({
  view,
  busy,
  onAction,
  onPlanSwitch,
}: {
  view: PlanRowView;
  busy?: boolean;
  onAction: (does: Extract<PlanAction, { kind: "button" }>["does"]) => void;
  onPlanSwitch: (on: boolean) => void;
}) {
  const tone = view.tone === "line" ? "" : ` st-row--${view.tone}`;
  const { action } = view;
  return (
    <div className={`st-row${tone}`} data-provider={view.provider}>
      <span className="st-row__tile" aria-hidden="true">
        {TILE[view.provider]}
      </span>
      <div className="st-row__info">
        <div className="st-row__head">
          <span className="st-row__name">{view.title}</span>
          <Badge variant={view.badge.variant} dot={view.badge.dot}>
            {view.badge.label}
          </Badge>
        </div>
        <span className="st-row__line">{view.line}</span>
      </div>
      {action?.kind === "switch" && (
        <Switch
          label="Use my plan"
          aria-label={`Use my ${view.provider === "claude" ? "Claude" : "Grok"} plan`}
          checked={action.checked}
          disabled={busy}
          onCheckedChange={onPlanSwitch}
        />
      )}
      {action?.kind === "button" && (
        <Button
          variant={action.variant}
          size="sm"
          disabled={busy && action.does !== "cancel"}
          onClick={() => onAction(action.does)}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** DT-22: Codex is status only — "How to install" opens OpenAI's page in the default browser. */
export function CodexRow({ line, installUrl }: { line: string; installUrl: string | null }) {
  return (
    <div className="st-row" data-provider="codex">
      <span className="st-row__tile" aria-hidden="true">
        O
      </span>
      <div className="st-row__info">
        <div className="st-row__head">
          <span className="st-row__name">Codex</span>
          <Badge variant="info">Status only</Badge>
        </div>
        <span className="st-row__line">{line}</span>
      </div>
      {installUrl && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.open(installUrl, "_blank", "noopener,noreferrer")}
        >
          <ExternalLinkIcon />
          <span>How to install</span>
        </Button>
      )}
    </div>
  );
}
