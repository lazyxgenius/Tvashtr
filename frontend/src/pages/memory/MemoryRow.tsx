import { ClipboardCheck, Globe } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "../../design-system/components";
import type { Memory, MemoryPolarity } from "../../lib/api/memory";
import { GithubIcon } from "../home/homeIcons";
import { FORCE_VARIANT, forceLabel, provenance, scopeChip } from "./memoryModel";

/** MEM-8: the force as a badge (MUST = danger, SHOULD = warning, …). */
export function ForceBadge({ polarity }: { polarity: MemoryPolarity }) {
  return <Badge variant={FORCE_VARIANT[polarity]}>{forceLabel(polarity)}</Badge>;
}

const chipIcon = { size: 11, strokeWidth: 1.6, "aria-hidden": true } as const;

/** MEM-9: who the memory applies to — an agent (clipboard), a repo (GitHub), or the account. */
export function ScopeChip({ memory }: { memory: Memory }) {
  const { kind, label } = scopeChip(memory);
  return (
    <span className="mem-chip">
      {kind === "agent" ? (
        <ClipboardCheck {...chipIcon} />
      ) : kind === "repo" ? (
        <GithubIcon size={11} />
      ) : (
        <Globe {...chipIcon} />
      )}
      {label}
    </span>
  );
}

/**
 * One memory: force badge, the text, its scope chip and a provenance line (`meta`, by default where
 * it came from), then the row's actions.
 */
export function MemoryRow({
  memory,
  meta,
  actions,
}: {
  memory: Memory;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li className="mem-row">
      <ForceBadge polarity={memory.polarity} />
      <div>
        <div className="mem-row__text">{memory.content}</div>
        <div className="mem-row__meta">
          <ScopeChip memory={memory} />
          <span>{meta ?? provenance(memory)}</span>
        </div>
      </div>
      <div className="mem-row__actions">{actions}</div>
    </li>
  );
}
