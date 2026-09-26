import { Fragment, type ReactNode } from "react";

import type { DesktopTemplateNode } from "../../../lib/api/desktop";
import {
  ArrowRightIcon,
  ClipboardCheckIcon,
  PackageCheckIcon,
  ShieldCheckIcon,
  TerminalIcon,
  ZapIcon,
} from "../icons";
import { chipName, runsOnLabel } from "./teamCards";

const ROLE_ICONS: Record<string, () => ReactNode> = {
  pm: () => <ZapIcon />,
  architect: () => <ZapIcon />,
  thinker: () => <ZapIcon />,
  gate: () => <ShieldCheckIcon />,
  engineer: () => <TerminalIcon />,
  worker: () => <TerminalIcon />,
  reviewer: () => <ClipboardCheckIcon />,
  ship: () => <PackageCheckIcon />,
};

/**
 * A template's pipeline as setup's First team cards draw it (DT-35): role chips joined by arrows,
 * each model node labelled with where it will run for this account ("Claude plan", "Grok plan",
 * "API key", "Needs setup") — what Create team will actually stamp (`GET /api/templates?for=desktop`).
 */
export function TemplateStrip({ nodes }: { nodes: DesktopTemplateNode[] }) {
  return (
    <div className="st-tpl-strip" aria-label="Agents in this team">
      {nodes.map((node, i) => {
        const where = runsOnLabel(node);
        const icon = ROLE_ICONS[node.role] ?? ROLE_ICONS.thinker;
        return (
          <Fragment key={`${node.role}-${i}`}>
            {i > 0 && (
              <span className="st-tpl-strip__arrow">
                <ArrowRightIcon />
              </span>
            )}
            <div className="st-tpl-chip">
              <div className="st-tpl-chip__head">
                <span className="st-tpl-chip__icon">{icon()}</span>
                <span className="st-tpl-chip__name">{chipName(node)}</span>
              </div>
              {where && <span className="st-tpl-chip__where">{where}</span>}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
