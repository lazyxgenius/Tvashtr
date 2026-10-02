import { Info, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button, Menu } from "../../design-system/components";
import { listMyAgents, type SavedAgent } from "../../lib/api/myAgents";
import { publishBadges } from "../../lib/workspaceStatus";
import { DeleteAgentDialog, RenameAgentDialog, UseInTeamDialog } from "./AgentDialogs";
import { SavedAgentCard } from "./SavedAgentCard";
import "./agents.css";

const icon = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;

type Open = { kind: "rename" | "delete" | "use"; agent: SavedAgent } | null;

/**
 * M6 Toolkit › My agents (Agents-Page): the agents saved from their panels, each card with Use in a
 * team and ⋯ Rename / Delete, and the dashed hint (alone when there are none).
 */
export function MyAgentsPage() {
  const [agents, setAgents] = useState<SavedAgent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Open>(null);

  const load = useCallback(() => {
    listMyAgents().then(
      (list) => {
        setAgents(list);
        setFailed(false);
        publishBadges({ myAgents: list.length });
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(load, [load]);

  const close = () => setOpen(null);
  const done = () => {
    setOpen(null);
    load();
  };

  return (
    <>
      <div className="pg-head">
        <div>
          <h1 className="pg-head__title ag-title">My agents</h1>
          <p className="pg-head__lede ag-lede">
            Agents you saved from their panels, to use in any team.
          </p>
        </div>
      </div>
      <div className="ag-list">
        {failed && !agents && (
          <div className="ag-hint" role="alert">
            Couldn’t load your agents.
            <Button variant="ghost" size="sm" onClick={load}>
              Try again
            </Button>
          </div>
        )}
        {agents?.map((a) => (
          <SavedAgentCard
            key={a.id}
            agent={a}
            onUse={() => setOpen({ kind: "use", agent: a })}
            onChanged={load}
            more={
              <Menu
                label={`More for ${a.name}`}
                width={200}
                items={[
                  {
                    key: "rename",
                    label: "Rename",
                    icon: <Pencil {...icon} />,
                    onSelect: () => setOpen({ kind: "rename", agent: a }),
                  },
                  {
                    key: "delete",
                    label: "Delete",
                    icon: <Trash2 {...icon} />,
                    danger: true,
                    onSelect: () => setOpen({ kind: "delete", agent: a }),
                  },
                ]}
              />
            }
          />
        ))}
        {agents && (
          <div className="ag-hint">
            <Info size={15} strokeWidth={1.6} aria-hidden />
            Save any agent from its panel: More › Save as my agent. Changing a saved agent makes a
            new version; teams keep theirs until you update them.
          </div>
        )}
      </div>
      {open?.kind === "rename" && (
        <RenameAgentDialog agent={open.agent} onClose={close} onDone={done} />
      )}
      {open?.kind === "delete" && (
        <DeleteAgentDialog agent={open.agent} onClose={close} onDone={done} />
      )}
      {open?.kind === "use" && <UseInTeamDialog agent={open.agent} onClose={close} />}
    </>
  );
}
