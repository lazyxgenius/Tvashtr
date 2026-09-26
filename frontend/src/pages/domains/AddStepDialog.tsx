/**
 * "Add <name> to a team" (DM-94, DmF-Step-2/3; 560 wide). It opens on the Team list — each team
 * with its main path — and Add step stays off until a team is picked (a click, Enter or Space).
 * Then: "Where in the flow" ("After <agent>" for each agent with one way out, the first by default,
 * OQ-20), the question (`{idea}` default) and "Pass the answer to the next agents" (on).
 */
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button, Input, Select, Switch } from "../../design-system/components";
import { cx, useDismiss } from "../../design-system/components/utils";
import { type AddedStep, type StepTeam, addDomainStep, getStepPlaces } from "../../lib/api/domains";
import { DomainDialog } from "./DomainDialog";
import { defaultQuestion, placeLabel } from "./useInTeamsFormat";
import "./teams.css";

const LOAD_FAILED = "Couldn’t load your teams — is the backend running?";

function TeamOptions({
  teams,
  shown,
  onFocusTeam,
  onPick,
}: {
  teams: StepTeam[];
  shown: string | null;
  onFocusTeam: (teamId: string) => void;
  onPick: (team: StepTeam) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const move = (step: 1 | -1) => {
    const opts = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [],
    );
    const at = opts.findIndex((o) => o === document.activeElement);
    opts[Math.max(0, Math.min(opts.length - 1, at + step))]?.focus();
  };
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Team"
      className="dm-rmlist dm-addstep__list"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          move(e.key === "ArrowDown" ? 1 : -1);
        }
      }}
    >
      {teams.map((t) => {
        const selected = t.team_id === shown;
        const usable = t.places.length > 0;
        return (
          <button
            key={t.team_id}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={!usable}
            className="dm-rmopt dm-addstep__opt"
            onFocus={() => onFocusTeam(t.team_id)}
            onClick={() => onPick(t)}
          >
            {selected ? (
              <Check className="dm-rmopt__check" size={15} strokeWidth={2} aria-hidden />
            ) : (
              <span className="dm-rmopt__pad" />
            )}
            <span className="dm-rmopt__text">
              <span className="dm-rmopt__label">{t.name}</span>
              <span className="dm-rmopt__sub">
                {t.path.length === 0
                  ? "No agents yet"
                  : usable
                    ? t.path.join(" → ")
                    : `${t.path.join(" → ")} · no place for a step`}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function placeChoices(team: StepTeam | null): { id: string; value: string; label: string }[] {
  const seen = new Map<string, number>();
  return (team?.places ?? []).map((p) => {
    const base = placeLabel(p);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const label = n > 1 ? `${base} (${n})` : base;
    return { id: p.after_node_id, value: label, label };
  });
}

export function AddStepDialog({
  domainId,
  domainName,
  onClose,
  onAdded,
}: {
  domainId: string;
  domainName: string;
  onClose: () => void;
  onAdded: (added: AddedStep) => void;
}) {
  const [teams, setTeams] = useState<StepTeam[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [team, setTeam] = useState<StepTeam | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [place, setPlace] = useState("");
  const [question, setQuestion] = useState(() => defaultQuestion(domainName));
  const [pass, setPass] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const valueId = useId();

  useEffect(() => {
    let live = true;
    getStepPlaces(domainId)
      .then((rows) => {
        if (!live) return;
        setTeams(rows);
        const first = rows.find((t) => t.places.length > 0);
        // The dialog opens on the Team list (DmF-Step-2).
        if (first) {
          setActive(first.team_id);
          setOpen(true);
        }
      })
      .catch(() => live && setLoadError(LOAD_FAILED));
    return () => {
      live = false;
    };
  }, [domainId]);

  const closeList = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  useDismiss(open, closeList, wrapRef);

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
  }, [open]);

  const pick = (t: StepTeam) => {
    setTeam(t);
    setActive(t.team_id);
    setPlace(t.places[0]?.after_node_id ?? "");
    setError(null);
    closeList();
  };

  // While the list is open the focused team shows as chosen (selection follows focus); it only
  // counts once picked.
  const shownId = open ? active : (team?.team_id ?? null);
  const shown = teams?.find((t) => t.team_id === shownId) ?? null;
  const ready = Boolean(team && place && question.trim()) && !open && !saving;
  // Each option's value is its own words ("After Writer", "After Writer (2)" for a twin).
  const placeOptions = placeChoices(team);

  const submit = async () => {
    if (!team || !ready) return;
    setSaving(true);
    setError(null);
    try {
      onAdded(
        await addDomainStep(domainId, {
          team_id: team.team_id,
          after_node_id: place,
          prompt: question.trim(),
          pass_to_spec: pass,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : LOAD_FAILED);
      setSaving(false);
    }
  };

  return (
    <DomainDialog
      title={`Add ${domainName} to a team`}
      subtitle="It becomes a Query domain node that asks one question every run."
      width={560}
      top={team ? 90 : 110}
      locked={saving}
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={!ready} loading={saving}>
            Add step
          </Button>
        </>
      }
    >
      {loadError ? (
        <p className="dm-dlg__error" role="alert">
          {loadError}
        </p>
      ) : teams && teams.length === 0 ? (
        <p className="dm-dlg__text">
          You don’t have a team yet. Make one on Home, then add this domain to it.
        </p>
      ) : (
        <>
          <div className="dm-addstep__team" ref={wrapRef}>
            <div className={cx("ds-field", open && "dm-addstep__field--open")}>
              <span id={labelId} className={open ? "dm-addstep__label" : "ds-field__label"}>
                Team
              </span>
              <button
                ref={buttonRef}
                type="button"
                className={cx("dm-sort__btn", open ? "dm-sort__btn--open" : "ds-select")}
                aria-labelledby={`${labelId} ${valueId}`}
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={!teams}
                onClick={() => (open ? closeList() : setOpen(true))}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setOpen(true);
                  }
                }}
              >
                <span id={valueId} className="dm-sort__value">
                  {shown?.name ?? (teams ? "Pick a team" : "Loading teams…")}
                </span>
                <ChevronDown
                  className="dm-sort__chevron"
                  size={open ? 15 : 16}
                  strokeWidth={1.6}
                  aria-hidden
                />
              </button>
            </div>
            {open && teams && (
              <TeamOptions teams={teams} shown={shownId} onFocusTeam={setActive} onPick={pick} />
            )}
          </div>
          {team ? (
            <>
              <Select
                label="Where in the flow"
                value={placeOptions.find((o) => o.id === place)?.value ?? ""}
                onChange={(e) =>
                  setPlace(placeOptions.find((o) => o.value === e.target.value)?.id ?? "")
                }
                options={placeOptions}
              />
              <Input
                label="Question to ask"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                helper="{idea} is replaced by the idea you launch the run with."
              />
              <Switch
                label="Pass the answer to the next agents"
                checked={pass}
                onCheckedChange={setPass}
              />
              {error && (
                <p className="dm-dlg__error" role="alert">
                  {error}
                </p>
              )}
            </>
          ) : (
            // Room for the open Team list (the frame keeps the dialog this tall).
            <div className="dm-addstep__room" aria-hidden />
          )}
        </>
      )}
    </DomainDialog>
  );
}
