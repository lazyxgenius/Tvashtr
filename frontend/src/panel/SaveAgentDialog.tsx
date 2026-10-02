import { Lock, Save } from "lucide-react";
import { useState } from "react";

import { VersionDialog } from "../canvas/VersionDialogs";
import { Button, Checkbox, Input, TextArea } from "../design-system/components";
import { type AgentPart, type SavedAgent, saveMyAgent } from "../lib/api/myAgents";
import { nextVersionFor, providerName, serverWords } from "../lib/myAgentsFormat";

export interface SaveAgentDialogProps {
  teamId: string;
  nodeId: string;
  /** The agent as the drawer names it ("Reviewer"): the title's "Save Reviewer as my agent". */
  agentName: string;
  defaultName: string;
  defaultPurpose: string;
  /** The team's latest version ("The current text (v7)"). */
  teamVersion?: number;
  model: string;
  editsAllowed: boolean;
  skills: number;
  tools: number;
  /** Its own memories (0: no Memories row). */
  memories: number;
  /** The account's saved agents (the footer's "Saved as version N"). */
  agents: SavedAgent[];
  onClose: () => void;
  onSaved: (result: Awaited<ReturnType<typeof saveMyAgent>>) => void;
}

/**
 * M6 Agents-Save: "Save <agent> as my agent" in M5's dialog shell (580px, 56px from the top). The
 * agent's SAVED state is what goes (the drawer saves its draft first); memories stay off unless
 * ticked, and sign-ins, keys and secrets never go.
 */
export function SaveAgentDialog({
  teamId,
  nodeId,
  agentName,
  defaultName,
  defaultPurpose,
  teamVersion,
  model,
  editsAllowed,
  skills,
  tools,
  memories,
  agents,
  onClose,
  onSaved,
}: SaveAgentDialogProps) {
  const [name, setName] = useState(defaultName);
  const [purpose, setPurpose] = useState(defaultPurpose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The rows this agent has (none with nothing to carry), each ticked but Memories.
  const rows: { part: AgentPart; label: string; description?: string }[] = [
    {
      part: "instructions",
      label: "Instructions",
      description: teamVersion ? `The current text (v${teamVersion})` : "The current text",
    },
  ];
  if (model.trim())
    rows.push({
      part: "model",
      label: `Model: ${model}`,
      description: `Teams without ${providerName(model)} can pick another model`,
    });
  if (skills + tools > 0)
    rows.push({ part: "skills_tools", label: `Skills (${skills}) and tools (${tools})` });
  rows.push({
    part: "file_access",
    label: `File access: ${editsAllowed ? "can edit files" : "read-only"}`,
  });
  if (memories > 0)
    rows.push({
      part: "memories",
      label: `Memories (${memories})`,
      description: "Usually about this team’s repo. Leave off to start fresh.",
    });
  const [checked, setChecked] = useState<ReadonlySet<AgentPart>>(
    () => new Set(rows.map((r) => r.part).filter((p) => p !== "memories")),
  );
  const include = rows.map((r) => r.part).filter((p) => checked.has(p));
  const canSave = name.trim() !== "" && include.some((p) => p !== "memories") && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await saveMyAgent({
          team_id: teamId,
          node_id: nodeId,
          name: name.trim(),
          purpose,
          include,
        }),
      );
    } catch (err) {
      setError(serverWords(err, "Couldn’t save. Try again."));
      setBusy(false);
    }
  };

  return (
    <VersionDialog
      title={`Save ${agentName} as my agent`}
      icon={<Save size={17} strokeWidth={1.6} aria-hidden />}
      sub="Use it in any team. Teams keep the version they use until you update them."
      size="cv-vdlg--top cv-vdlg--save"
      onClose={onClose}
      footNote={`Saved as version ${nextVersionFor(name, agents)}`}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="cv-btn-flush"
            disabled={!canSave}
            loading={busy}
            onClick={() => void save()}
          >
            <Save size={14} strokeWidth={2} aria-hidden />
            <span>Save to My agents</span>
          </Button>
        </>
      }
    >
      <Input label="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <TextArea
        label="What it’s for"
        value={purpose}
        maxLength={300}
        onChange={(e) => setPurpose(e.target.value)}
      />
      <div className="cv-save__parts" role="group" aria-label="Included">
        <div className="lv-confirm__eyebrow">Included</div>
        {rows.map((r) => (
          <Checkbox
            key={r.part}
            label={r.label}
            description={r.description}
            checked={checked.has(r.part)}
            onChange={(e) => {
              const next = new Set(checked);
              if (e.target.checked) next.add(r.part);
              else next.delete(r.part);
              setChecked(next);
            }}
          />
        ))}
      </div>
      <div className="cv-save__never">
        <Lock size={14} strokeWidth={1.6} aria-hidden />
        Never included: sign-ins, keys and secrets.
      </div>
      {error && (
        <div className="lv-confirm__error" role="alert">
          {error}
        </div>
      )}
    </VersionDialog>
  );
}
