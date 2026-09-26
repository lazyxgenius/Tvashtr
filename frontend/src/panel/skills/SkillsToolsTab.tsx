import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";

import {
  type SkillLibraryItem,
  type ToolLibraryItem,
  listSecrets,
  listSkillLibrary,
  listToolLibrary,
} from "../../lib/api";
import type { Route } from "../../lib/nav";
import { type AddToolKind, ToolsPanel } from "../tools/ToolsPanel";
import type { ToolConfig } from "../tools/nodeTools";
import type { ToastAction } from "../useDrawerToast";
import { type AddSkillKind, SkillsPanel } from "./SkillsPanel";
import "./skillsTools.css";

/** The account's library skills and tools and its secret names; null while unknown. */
function useShelves() {
  const [skillLibrary, setSkillLibrary] = useState<SkillLibraryItem[] | null>(null);
  const [toolLibrary, setToolLibrary] = useState<ToolLibraryItem[] | null>(null);
  const [secrets, setSecrets] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    // A shelf that fails to load leaves its rows generic ("Library skill"), nothing more.
    listSkillLibrary()
      .then((v) => live && setSkillLibrary(v))
      .catch(() => {});
    listToolLibrary()
      .then((v) => live && setToolLibrary(v))
      .catch(() => {});
    listSecrets()
      .then((v) => live && setSecrets(v.map((s) => s.name)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return { skillLibrary, toolLibrary, secrets };
}

/**
 * The Skills & tools tab (PANEL-81..99, 103): Skills over Tools, bound to the draft. `note` is the
 * Desktop-subscription note (what that agent doesn't use).
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
}) {
  const { skillLibrary, toolLibrary, secrets } = useShelves();
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
      />
      <ToolsPanel
        config={toolConfig}
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
