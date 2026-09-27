import type { ReactNode } from "react";
import { Check } from "lucide-react";

import { Menu } from "../../design-system/components";

export interface RunChoice {
  run_id: string;
  idea: string;
  /** "31m ago · 3 rounds", "Sep 22 · completed". */
  detail: string;
}

type TriggerProps = Parameters<NonNullable<Parameters<typeof Menu>[0]["trigger"]>>[0];

/**
 * "Choose a run" (DOCS-2 / DOCS-13): the team's (or this agent's) runs, newest first, the current
 * one ticked. The Docs tab's "Change" and the Documents drawer's "Run: …" button open it.
 */
export function RunPicker({
  runs,
  current,
  onPick,
  trigger,
}: {
  runs: readonly RunChoice[];
  current: string;
  onPick: (runId: string) => void;
  trigger: (props: TriggerProps) => ReactNode;
}) {
  return (
    <Menu
      label="Choose a run"
      items={runs.map((r) => ({
        key: r.run_id,
        label: r.idea || "Untitled run",
        description: r.detail,
        icon: r.run_id === current ? <Check size={15} strokeWidth={1.6} aria-hidden /> : <span />,
        onSelect: () => onPick(r.run_id),
      }))}
      trigger={trigger}
    />
  );
}
