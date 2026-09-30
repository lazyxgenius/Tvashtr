import { Monitor } from "lucide-react";

import type { Route } from "../../lib/nav";
import { type AddToolKind, ToolsPanel } from "../tools/ToolsPanel";
import type { ToolConfig } from "../tools/nodeTools";
import type { ToastAction } from "../useDrawerToast";
import { type AddSkillKind, SkillsPanel } from "./SkillsPanel";
import type { Shelves } from "./useShelves";
import "./skillsTools.css";

/**
 * The Skills & tools tab (PANEL-81..99, 103): Skills over Tools, bound to the draft. `note` is the
 * Desktop-subscription note (what that agent doesn't use); `plan` switches that agent's connectors
 * off (Page-Agent-on-a-Claude-plan).
 */
export function SkillsToolsTab({
  skills,
  toolConfig,
  onSkillsChange,
  onToolsChange,
  note,
  notify,
  onAddSkill,
  onEditSkill,
  onAddTool,
  onEditServer,
  onOpenToolkit,
  shelves,
  selected,
  onSelect,
  agentName,
  plan,
  savedToolConfig,
}: {
  skills: unknown[] | null;
  toolConfig: ToolConfig;
  onSkillsChange: (next: unknown[] | null) => void;
  onToolsChange: (next: ToolConfig) => void;
  note: string | null;
  notify: (message: string, action?: ToastAction) => void;
  onAddSkill: (kind: AddSkillKind) => void;
  onEditSkill: (index: number) => void;
  onAddTool: (kind: AddToolKind) => void;
  onEditServer: (name: string) => void;
  onOpenToolkit?: (route: Route) => void;
  shelves: Shelves;
  /** Focus mode: the skill shown in the detail pane. */
  selected?: number | null;
  onSelect?: (index: number) => void;
  /** For the Connectors checklist: the agent's name, the plan it runs on in Tvashtr Desktop
   *  ("Claude"; its connectors are off), and its tool config as last saved. */
  agentName?: string;
  plan?: string | null;
  savedToolConfig?: ToolConfig;
}) {
  const { skillLibrary, toolLibrary, secrets } = shelves;
  return (
    <div className="nd-stack">
      {note && (
        <div className="nd-notice nd-kit__note" role="note">
          <span className="nd-notice__icon">
            <Monitor size={13} strokeWidth={1.7} aria-hidden />
          </span>
          <span className="nd-notice__text">{note}</span>
        </div>
      )}
      <SkillsPanel
        skills={skills}
        library={skillLibrary}
        onChange={onSkillsChange}
        notify={notify}
        onAdd={onAddSkill}
        onEdit={onEditSkill}
        onOpenToolkit={onOpenToolkit}
        selected={selected}
        onSelect={onSelect}
      />
      <ToolsPanel
        config={toolConfig}
        savedConfig={savedToolConfig}
        agentName={agentName}
        plan={plan}
        library={toolLibrary}
        secrets={secrets}
        onChange={onToolsChange}
        notify={notify}
        onAdd={onAddTool}
        onEditServer={onEditServer}
        onOpenToolkit={onOpenToolkit}
      />
    </div>
  );
}
