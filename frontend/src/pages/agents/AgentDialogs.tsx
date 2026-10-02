/** Toolkit › My agents' dialogs (Agents-Rename, Agents-Delete, Agents-UseInTeam), in M5's shell. */
import { Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { VersionDialog } from "../../canvas/VersionDialogs";
import { Button, Input, Select, TextArea } from "../../design-system/components";
import type { TeamSummary } from "../../lib/api";
import {
  addAgentToTeam,
  deleteMyAgent,
  renameMyAgent,
  type SavedAgent,
} from "../../lib/api/myAgents";
import { deleteAgentText, serverWords } from "../../lib/myAgentsFormat";
import { listTeams } from "../../lib/api/teams";
import { navigate } from "../../lib/nav";

/** Agents-Rename: the name and what it's for; a taken name shows under Name. */
export function RenameAgentDialog({
  agent,
  onClose,
  onDone,
}: {
  agent: SavedAgent;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [purpose, setPurpose] = useState(agent.purpose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    setBusy(true);
    setError(null);
    renameMyAgent(agent.id, { name: name.trim(), purpose }).then(onDone, (err: unknown) => {
      setError(serverWords(err, "Couldn’t save. Try again."));
      setBusy(false);
    });
  };
  return (
    <VersionDialog
      title={`Rename ${agent.name}`}
      icon={<Pencil size={17} strokeWidth={1.6} aria-hidden />}
      sub="Teams that use it keep the name they were made with."
      size="cv-vdlg--top"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <Input
        label="Name"
        value={name}
        maxLength={60}
        error={error ?? undefined}
        onChange={(e) => setName(e.target.value)}
      />
      <TextArea
        label="What it’s for"
        value={purpose}
        maxLength={300}
        onChange={(e) => setPurpose(e.target.value)}
      />
    </VersionDialog>
  );
}

/** Agents-Delete: deleting never changes a team. */
export function DeleteAgentDialog({
  agent,
  onClose,
  onDone,
}: {
  agent: SavedAgent;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = () => {
    setBusy(true);
    deleteMyAgent(agent.id).then(onDone, (err: unknown) => {
      setError(serverWords(err, "Couldn’t delete. Try again."));
      setBusy(false);
    });
  };
  return (
    <VersionDialog
      title={`Delete ${agent.name}?`}
      icon={<Trash2 size={17} strokeWidth={1.6} aria-hidden />}
      sub={deleteAgentText(agent)}
      onClose={onClose}
      footNote={error && <span className="lv-confirm__error">{error}</span>}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={remove}>
            Delete
          </Button>
        </>
      }
    />
  );
}

/** Agents-UseInTeam: add it to a team as a new agent, then open that team's canvas on it. */
export function UseInTeamDialog({ agent, onClose }: { agent: SavedAgent; onClose: () => void }) {
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    listTeams().then(
      (list) => {
        if (!live) return;
        setTeams(list);
        setTeamId((id) => id || (list[0]?.team_graph_id ?? ""));
      },
      () => live && setTeams([]),
    );
    return () => {
      live = false;
    };
  }, []);
  const add = () => {
    setBusy(true);
    setError(null);
    addAgentToTeam(agent.id, teamId).then(
      (res) => navigate({ page: "team", teamId: res.team_id, node: res.node_id }),
      (err: unknown) => {
        setError(serverWords(err, "Couldn’t add it. Try again."));
        setBusy(false);
      },
    );
  };
  return (
    <VersionDialog
      title={`Use ${agent.name} in a team`}
      icon={<UserRound size={17} strokeWidth={1.6} aria-hidden />}
      sub="It’s added to the team as a new agent. Connect it with arrows on the canvas."
      size="cv-vdlg--top"
      onClose={onClose}
      footNote={[`v${agent.latest}`, agent.built_on, agent.model].filter(Boolean).join(" · ")}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="cv-btn-flush"
            loading={busy}
            disabled={!teamId}
            onClick={add}
          >
            <Plus size={14} strokeWidth={2} aria-hidden />
            <span>Add to team</span>
          </Button>
        </>
      }
    >
      <Select
        label="Team"
        value={teamId}
        disabled={!teams?.length}
        error={error ?? undefined}
        options={(teams ?? []).map((t) => ({ value: t.team_graph_id, label: t.name }))}
        onChange={(e) => setTeamId(e.target.value)}
      />
    </VersionDialog>
  );
}
