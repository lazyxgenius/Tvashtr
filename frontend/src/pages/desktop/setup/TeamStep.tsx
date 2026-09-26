import { useCallback, useEffect, useRef, useState } from "react";

import { Input, useToast } from "../../../design-system/components";
import { ApiError } from "../../../lib/api";
import {
  createFirstTeam,
  type DesktopTemplate,
  getDesktopTemplates,
} from "../../../lib/api/desktop";
import { saveDesktopSetup } from "../../../lib/desktopSetup";
import { navigate } from "../../../lib/nav";
import { leaveSetup } from "./leaveSetup";
import { RadioCard, RadioCardGroup } from "./RadioCard";
import { SetupFrame, SetupHead } from "./SetupFrame";
import { CREATE_FAILED, FIRST_TEAM_NAME, SETUP_TEAM_CARDS } from "./teamCards";
import { TemplateStrip } from "./TemplateStrip";

const CARD_KEYS = SETUP_TEAM_CARDS.map((c) => c.template);

/**
 * Setup step 4, First team (desktop-app.md DT-33..DT-36): Plan, build, review (preselected), Spec
 * only or Blank canvas, each strip showing where its agents will run for this account; a team
 * name ("My first team", OQ-13); Create team makes the team on the plans in use
 * (`use_plans`), marks setup finished on this Mac and goes Home.
 */
export function TeamStep({ login, onSwitch }: { login: string; onSwitch: () => void }) {
  const toast = useToast();
  const [template, setTemplate] = useState<string>(CARD_KEYS[0]);
  const [name, setName] = useState(FIRST_TEAM_NAME);
  const [templates, setTemplates] = useState<DesktopTemplate[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A team made on an earlier press whose "finished" save then failed: never make a second one.
  const created = useRef(false);

  useEffect(() => {
    let live = true;
    getDesktopTemplates()
      .then((body) => {
        if (live) setTemplates(body.templates);
      })
      .catch(() => undefined); // the cards still work; only the strips are missing
    return () => {
      live = false;
    };
  }, []);

  const create = useCallback(async () => {
    if (busy) return;
    setNameError(null);
    setFormError(null);
    setBusy(true);
    if (!created.current) {
      try {
        await createFirstTeam(template, name);
        created.current = true;
      } catch (e) {
        setBusy(false);
        if (e instanceof ApiError && e.status === 422) setNameError(e.message);
        else if (!(e instanceof ApiError && e.status === 401)) setFormError(CREATE_FAILED);
        return;
      }
    }
    try {
      await saveDesktopSetup({ step: "team", finishedAt: new Date().toISOString() });
    } catch {
      setBusy(false);
      toast({ message: "Couldn’t save this Mac’s setup. Try again.", tone: "error" });
      return;
    }
    leaveSetup();
  }, [busy, name, template, toast]);

  const back = useCallback(() => {
    void saveDesktopSetup({ step: "project" }).catch(() => undefined);
    navigate({ page: "setup", step: "project" });
  }, []);

  const strips = new Map(templates.map((t) => [t.template, t.nodes]));

  return (
    <SetupFrame
      step="team"
      login={login}
      onSwitch={onSwitch}
      footer={{
        onBack: back,
        primary: { label: "Create team", busy, onClick: () => void create() },
      }}
    >
      <SetupHead
        title="Start with a team"
        lede="Pick a starting point. You can change every role, prompt and model on the canvas."
      />
      <RadioCardGroup
        label="Starting point"
        value={template}
        values={CARD_KEYS}
        onChange={setTemplate}
        className="st-cards"
      >
        {SETUP_TEAM_CARDS.map((card) => {
          const nodes = card.strip ? strips.get(card.template) : undefined;
          return (
            <RadioCard
              key={card.template}
              value={card.template}
              className="st-card--team"
              title={
                <>
                  <span className="st-card__name">{card.title}</span>
                  {card.recommended && <span className="st-pill">Recommended</span>}
                </>
              }
              description={card.description}
            >
              {nodes && nodes.length > 0 && <TemplateStrip nodes={nodes} />}
            </RadioCard>
          );
        })}
      </RadioCardGroup>
      <div className="st-team-name">
        <Input
          label="Team name"
          value={name}
          error={nameError ?? undefined}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        {formError && (
          <p className="st-form-error" role="alert">
            {formError}
          </p>
        )}
      </div>
    </SetupFrame>
  );
}
