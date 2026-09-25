import { type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { Check, History, Layers, Maximize2, Pencil, Play, Trash, X } from "lucide-react";

import { Badge, Button, IconButton, Input, Menu } from "../../design-system/components";
import type { TeamSummary } from "../../lib/api";
import { PipelineStrip } from "./PipelineStrip";
import { cardCounts, lastRunLine, rowCounts, teamBadge } from "./teamFormat";

/** What a card or list row can ask the Teams section to do. */
export interface TeamItemActions {
  open: (team: TeamSummary) => void;
  run: (team: TeamSummary) => void;
  history: (team: TeamSummary) => void;
  startRename: (team: TeamSummary) => void;
  duplicate: (team: TeamSummary) => void;
  remove: (team: TeamSummary) => void;
  /** Save a new name; resolves to an error message to show, or null when saved. */
  saveName: (team: TeamSummary, name: string) => Promise<string | null>;
  cancelRename: () => void;
}

const BLANK_NAME = "Give this team a name so you can tell it apart.";

/** Clicks on the card's own controls must not also open the canvas. */
function fromControl(e: MouseEvent): boolean {
  return (e.target as HTMLElement).closest("button, a, input, [role='menu']") !== null;
}

function TeamMenu({ team, actions }: { team: TeamSummary; actions: TeamItemActions }) {
  const icon = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;
  return (
    <Menu
      label={`More actions for ${team.name}`}
      // 220px of content inside 5px padding and a 1px border, as drawn
      width={232}
      items={[
        {
          key: "open",
          label: "Open canvas",
          icon: <Maximize2 {...icon} />,
          onSelect: () => actions.open(team),
        },
        {
          key: "run",
          label: "Start a run",
          icon: <Play {...icon} />,
          onSelect: () => actions.run(team),
        },
        {
          key: "history",
          label: "Run history",
          icon: <History {...icon} />,
          onSelect: () => actions.history(team),
        },
        "separator",
        {
          key: "rename",
          label: "Rename",
          icon: <Pencil {...icon} />,
          onSelect: () => actions.startRename(team),
        },
        {
          key: "duplicate",
          label: "Duplicate",
          icon: <Layers {...icon} />,
          onSelect: () => actions.duplicate(team),
        },
        "separator",
        {
          key: "delete",
          label: "Delete team",
          icon: <Trash {...icon} />,
          danger: true,
          onSelect: () => actions.remove(team),
        },
      ]}
    />
  );
}

/** Inline rename (TEAMS-26–28): an input with Save name ✓ and Cancel ✕. */
function RenameEditor({ team, actions }: { team: TeamSummary; actions: TeamItemActions }) {
  const [value, setValue] = useState(team.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const save = async () => {
    if (busy) return;
    const name = value.trim();
    if (!name) {
      setError(BLANK_NAME);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    const problem = await actions.saveName(team, name);
    setBusy(false);
    if (problem) setError(problem);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      actions.cancelRename();
    }
  };

  return (
    <div className="hm-rename">
      {/* The error line is ours (not Input's `error`), so the input isn't remounted — and
          doesn't lose focus — when the error appears. */}
      <div className="ds-field hm-rename__field">
        <Input
          ref={inputRef}
          size="sm"
          aria-label="Team name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={error ? "ds-input--error" : undefined}
          value={value}
          readOnly={busy}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
        />
        {error && (
          <span id={errorId} className="ds-field__help ds-field__help--error" role="alert">
            {error}
          </span>
        )}
      </div>
      <IconButton size="sm" aria-label="Save name" onClick={() => void save()} disabled={busy}>
        <Check size={14} strokeWidth={1.6} aria-hidden />
      </IconButton>
      <IconButton size="sm" aria-label="Cancel" onClick={actions.cancelRename} disabled={busy}>
        <X size={14} strokeWidth={1.6} aria-hidden />
      </IconButton>
    </div>
  );
}

export function TeamCard({
  team,
  renaming,
  highlight,
  actions,
}: {
  team: TeamSummary;
  renaming: boolean;
  highlight: boolean;
  actions: TeamItemActions;
}) {
  const badge = teamBadge(team);
  return (
    <article
      className={`hm-team${highlight ? " hm-team--flash" : ""}`}
      data-team-id={team.team_graph_id}
      onClick={(e) => {
        if (!renaming && !fromControl(e)) actions.open(team);
      }}
    >
      <div className="hm-team__head">
        {renaming ? (
          <RenameEditor team={team} actions={actions} />
        ) : (
          <>
            <span className="hm-team__name">{team.name}</span>
            <span className="hm-team__badge">
              <Badge variant={badge.variant} dot>
                {badge.label}
              </Badge>
            </span>
          </>
        )}
      </div>
      <PipelineStrip shape={team.shape} size={22} />
      <div className="hm-team__last">{lastRunLine(team)}</div>
      <div className="hm-team__foot">
        <span>{cardCounts(team)}</span>
        <span className="hm-team__actions">
          {/* The icon sits inside the label (no gap), as the design draws "▷Run". */}
          <Button variant="ghost" size="sm" onClick={() => actions.run(team)}>
            <Play className="hm-inline-icon" size={12} strokeWidth={1.6} aria-hidden />
            Run
          </Button>
          <TeamMenu team={team} actions={actions} />
        </span>
      </div>
    </article>
  );
}

export function TeamRow({
  team,
  renaming,
  highlight,
  actions,
}: {
  team: TeamSummary;
  renaming: boolean;
  highlight: boolean;
  actions: TeamItemActions;
}) {
  const badge = teamBadge(team);
  return (
    <tr
      className={`hm-trow${highlight ? " hm-team--flash" : ""}`}
      data-team-id={team.team_graph_id}
      onClick={(e) => {
        if (!renaming && !fromControl(e)) actions.open(team);
      }}
    >
      <td>
        <div className="hm-trow__team">
          {renaming ? (
            <RenameEditor team={team} actions={actions} />
          ) : (
            <span className="hm-trow__name">{team.name}</span>
          )}
          <PipelineStrip shape={team.shape} size={14} />
        </div>
      </td>
      <td>
        <Badge variant={badge.variant} dot>
          {badge.label}
        </Badge>
      </td>
      <td>
        <span className="hm-trow__last">{lastRunLine(team)}</span>
      </td>
      <td>
        <span className="hm-trow__counts">{rowCounts(team)}</span>
      </td>
      <td>
        <TeamMenu team={team} actions={actions} />
      </td>
    </tr>
  );
}
