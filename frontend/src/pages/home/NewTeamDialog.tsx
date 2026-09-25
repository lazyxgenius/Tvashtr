import { type FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, X } from "lucide-react";

import { Button, IconButton, Input, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  BLANK_TEMPLATE,
  createLibraryTeam,
  getTeamTemplates,
  type TeamTemplate,
} from "../../lib/api/teams";
import { navigate } from "../../lib/nav";
import { useModalDialog } from "../../lib/useModalDialog";
import { refreshBadges } from "../../lib/workspaceStatus";
import { useHome } from "./homeContext";
import { PipelineStrip } from "./PipelineStrip";
import "./teams.css";

const BLANK_NAME = "Give this team a name so you can tell it apart.";
const HELPER = "So this isn’t another “New team”.";
const LOAD_FAILED =
  "Couldn’t load the starter templates — is the backend running? You can still start from Blank.";
const CREATE_FAILED = "Couldn’t create the team — is the backend running?";

function NewTeamBody({
  initialTemplate,
  onClose,
}: {
  initialTemplate?: string;
  onClose: () => void;
}) {
  const { reloadTeams } = useHome();
  const toast = useToast();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [options, setOptions] = useState<TeamTemplate[]>([BLANK_TEMPLATE]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [picked, setPicked] = useState(initialTemplate ?? "blank");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ref = useModalDialog<HTMLDivElement>(true, () => {
    if (!busy) onClose();
  });

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    getTeamTemplates()
      .then(({ templates, blank }) => {
        if (live) setOptions([blank, ...templates]);
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // A preselected template that didn't load (or doesn't exist) falls back to Blank.
  const chosen = options.some((o) => o.template === picked) ? picked : "blank";

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(BLANK_NAME);
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setCreateError(null);
    try {
      const team = await createLibraryTeam(chosen, trimmed);
      void reloadTeams();
      void refreshBadges();
      toast({ message: `${team.name} created. Click an agent to set it up, then Run.` });
      onClose();
      navigate({ page: "team", teamId: team.team_graph_id });
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 422) {
        setNameError(BLANK_NAME);
        nameRef.current?.focus();
      } else {
        setCreateError(CREATE_FAILED);
      }
    }
  };

  return (
    <>
      <div className="ds-scrim" onClick={() => !busy && onClose()} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="New team"
        className="ds-dialog hm-newteam"
        tabIndex={-1}
      >
        <form className="hm-newteam__form" onSubmit={(e) => void submit(e)} noValidate>
          <div className="hm-newteam__head">
            <h2 className="hm-newteam__title">New team</h2>
            <span className="hm-newteam__close">
              <IconButton size="sm" aria-label="Close" onClick={onClose} disabled={busy}>
                <X size={16} strokeWidth={1.6} aria-hidden />
              </IconButton>
            </span>
          </div>
          <Input
            ref={nameRef}
            label="Name"
            placeholder="e.g. Launch squad"
            helper={HELPER}
            error={nameError ?? undefined}
            value={name}
            disabled={busy}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
          />
          <span className="hm-newteam__label" id="hm-newteam-start">
            Starting point
          </span>
          {loadFailed && (
            <div className="hm-newteam__alert" role="alert">
              <CircleAlert size={14} strokeWidth={1.6} aria-hidden />
              {LOAD_FAILED}
            </div>
          )}
          <div className="hm-newteam__grid" role="group" aria-labelledby="hm-newteam-start">
            {options.map((o) => (
              <button
                key={o.template}
                type="button"
                className="hm-tplcard"
                aria-pressed={o.template === chosen}
                disabled={busy}
                onClick={() => setPicked(o.template)}
              >
                <span className="hm-tplcard__name">{o.name}</span>
                <PipelineStrip shape={o.shape} size={18} />
                <span className="hm-tplcard__desc">{o.description}</span>
              </button>
            ))}
          </div>
          {createError && (
            <div className="hm-newteam__alert" role="alert">
              <CircleAlert size={14} strokeWidth={1.6} aria-hidden />
              {createError}
            </div>
          )}
          <div className="hm-newteam__foot">
            <span className="hm-newteam__note">
              You can change every agent after you create it.
            </span>
            <span className="hm-newteam__actions">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                {busy ? "Creating…" : "Create team"}
              </Button>
            </span>
          </div>
        </form>
      </div>
    </>
  );
}

/**
 * New team (HmF-NewTeam-1…6, TEAMS-40–48): a name (required) and a starting point — Blank or one of
 * the starter templates, each with its pipeline strip. Creating opens the new team on the canvas
 * with a "{name} created" toast.
 */
export function NewTeamDialog({
  open,
  initialTemplate,
  onClose,
}: {
  open: boolean;
  initialTemplate?: string;
  onClose: () => void;
}) {
  if (!open) return null;
  return createPortal(
    <NewTeamBody initialTemplate={initialTemplate} onClose={onClose} />,
    document.body,
  );
}
