/**
 * A domain's Use in teams tab (DM-92…97; Dm-Teams, DmF-Step-1…3, DmF-Agent-1…3): three cards — Ask
 * it yourself, A fixed step in a team (its Query domain steps + Add as a step in a team) and Let an
 * agent search it (the agents with access + Give an agent access) — and the Domain ID strip (OQ-19:
 * the raw id + Copy; no MCP-client claim). Open canvas goes to `#/teams/<team>?node=<node>`.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Code,
  Copy,
  ExternalLink,
  MessageSquare,
  Plus,
  Zap,
} from "lucide-react";

import { Button, useToast } from "../../design-system/components";
import { cx } from "../../design-system/components/utils";
import {
  type DomainAgent,
  type DomainDetailView,
  type DomainUsageDetail,
  getDomainUsage,
} from "../../lib/api/domains";
import { navigate } from "../../lib/nav";
import { AddStepDialog } from "./AddStepDialog";
import { GiveAccessDialog } from "./GiveAccessDialog";
import {
  accessToast,
  addedStepToast,
  agentLine,
  copyDomainId,
  lastQuestionLine,
  stepLine,
} from "./useInTeamsFormat";
import "./teams.css";

const ICON = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;
const TILE = { size: 18, strokeWidth: 1.6, "aria-hidden": true } as const;
const ROW = { size: 13, strokeWidth: 1.6, "aria-hidden": true } as const;
/** How long the agent card stays tinted after access is given (DM-97). */
const FLASH_MS = 2400;

const openCanvas = (teamId: string, nodeId: string) =>
  navigate({ page: "team", teamId, node: nodeId });

/** "Open canvas" for one row; the row's name describes it (`aria-describedby`). */
function OpenCanvas({ teamId, nodeId }: { teamId: string; nodeId: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="dm-btn-inline"
      aria-describedby={`dm-use-${nodeId}`}
      onClick={() => openCanvas(teamId, nodeId)}
    >
      <ExternalLink {...ICON} />
      <span>Open canvas</span>
    </Button>
  );
}

export function UseInTeamsTab({
  detail,
  now,
  onChanged,
}: {
  detail: DomainDetailView;
  now: Date;
  /** The tab count and header re-read after a step or an agent is added. */
  onChanged: () => void;
}) {
  const id = detail.domain_id;
  const toast = useToast();
  const [usage, setUsage] = useState<DomainUsageDetail | null>(null);
  const [error, setError] = useState(false);
  const [dialog, setDialog] = useState<"step" | "agent" | null>(null);
  const [flash, setFlash] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsage(await getDomainUsage(id));
      setError(false);
    } catch {
      setError(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(false), FLASH_MS);
    return () => window.clearTimeout(t);
  }, [flash]);

  const given = (agent: DomainAgent) => {
    setDialog(null);
    setFlash(true);
    void load();
    onChanged();
    toast({
      message: accessToast(agent, detail.name),
      tone: "success",
      action: { label: "Open canvas", onClick: () => openCanvas(agent.team_id, agent.node_id) },
    });
  };

  if (error && !usage) {
    return (
      <div className="dm-error" role="alert">
        <span>Couldn’t load where this domain is used.</span>
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="dm-use">
      <div className="dm-use__cards">
        <section className="dm-use__card" aria-labelledby="dm-use-ask">
          <span className="dm-use__tile">
            <MessageSquare {...TILE} />
          </span>
          <h2 id="dm-use-ask" className="dm-use__title">
            Ask it yourself
          </h2>
          <p className="dm-use__text">
            Chat with the files and check sources while you curate this domain. Nothing runs in a
            team.
          </p>
          <ul className="dm-use__list">
            <li className="dm-use__empty">{lastQuestionLine(detail.last_question_at, now)}</li>
          </ul>
          <div className="dm-use__foot">
            <Button
              variant="ghost"
              size="sm"
              className="dm-btn-inline"
              onClick={() => navigate({ page: "domains", domainId: id, tab: "ask" })}
            >
              <ArrowRight {...ICON} />
              <span>Open Ask</span>
            </Button>
          </div>
        </section>

        <section className="dm-use__card" aria-labelledby="dm-use-step">
          <span className="dm-use__tile">
            <BookOpen {...TILE} />
          </span>
          <h2 id="dm-use-step" className="dm-use__title">
            A fixed step in a team
          </h2>
          <p className="dm-use__text">
            Adds a <b>Query domain</b> node. It asks one question every run and can pass the answer
            and its sources to the next agents.
          </p>
          <ul className="dm-use__list">
            {usage?.steps.map((s) => (
              <li key={s.node_id} className="dm-use__row">
                <span className="dm-use__rowtile">
                  <BookOpen {...ROW} />
                </span>
                <div className="dm-use__rowtext">
                  <div id={`dm-use-${s.node_id}`} className="dm-use__rowname">
                    {s.title}
                  </div>
                  <div className="dm-use__rowsub">{stepLine(s)}</div>
                </div>
                <OpenCanvas teamId={s.team_id} nodeId={s.node_id} />
              </li>
            ))}
            {usage && usage.steps.length === 0 && (
              <li className="dm-use__empty">Not in any team yet.</li>
            )}
          </ul>
          <div className="dm-use__foot">
            <Button
              variant="secondary"
              size="sm"
              className="dm-btn-inline"
              onClick={() => setDialog("step")}
            >
              <Plus {...ICON} />
              <span>Add as a step in a team</span>
            </Button>
          </div>
        </section>

        <section
          className={cx("dm-use__card", flash && "dm-use__card--flash")}
          aria-labelledby="dm-use-agent"
        >
          <span className="dm-use__tile">
            <Zap {...TILE} />
          </span>
          <h2 id="dm-use-agent" className="dm-use__title">
            Let an agent search it
          </h2>
          <p className="dm-use__text">
            The agent gets two tools: ask this domain, or pull matching passages. It decides when.
            It finds the domain by name.
          </p>
          <ul className="dm-use__list">
            {usage?.agents.map((a) => (
              <li key={a.node_id} className="dm-use__row">
                <span className="dm-use__rowtile">
                  <Zap {...ROW} />
                </span>
                <div className="dm-use__rowtext">
                  <div id={`dm-use-${a.node_id}`} className="dm-use__rowname">
                    {a.title}
                  </div>
                  <div className="dm-use__rowsub">{agentLine(a)}</div>
                </div>
                <OpenCanvas teamId={a.team_id} nodeId={a.node_id} />
              </li>
            ))}
            {usage && usage.agents.length === 0 && (
              <li className="dm-use__empty">No agent can search it yet.</li>
            )}
          </ul>
          <div className="dm-use__foot">
            <Button
              variant="secondary"
              size="sm"
              className="dm-btn-inline"
              onClick={() => setDialog("agent")}
            >
              <Plus {...ICON} />
              <span>Give an agent access</span>
            </Button>
          </div>
        </section>
      </div>

      <div className="dm-use__id">
        <Code {...ICON} />
        <span>Domain ID</span>
        <span className="dm-use__uuid">{id}</span>
        <Button
          variant="ghost"
          size="sm"
          className="dm-btn-inline"
          onClick={() => copyDomainId(id, toast)}
        >
          <Copy {...ICON} />
          <span>Copy</span>
        </Button>
      </div>

      {dialog === "step" && (
        <AddStepDialog
          domainId={id}
          domainName={detail.name}
          onClose={() => setDialog(null)}
          onAdded={(added) => {
            setDialog(null);
            toast({ message: addedStepToast(added), tone: "success" });
            openCanvas(added.team_id, added.node_id);
          }}
        />
      )}
      {dialog === "agent" && (
        <GiveAccessDialog
          domainId={id}
          domainName={detail.name}
          onClose={() => setDialog(null)}
          onGiven={given}
        />
      )}
    </div>
  );
}
