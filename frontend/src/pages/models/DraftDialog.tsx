/** Draft with a team (M2, prompts/m2-design/DraftDialog.dc.html): which Domain, how many tests and
 *  training examples, which team (its steps and models), the estimate and the pause amount, then
 *  Start drafting — an ordinary team run bound to this model and Domain. */
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";

import { Button, Select } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type DraftingEstimate,
  type DraftingOptions,
  type ModelDetail,
  MissingKeysError,
  draftingOptions,
  estimateDrafting,
  startDrafting,
} from "../../lib/api/models";
import { requestAddKeys } from "../home/homeData";
import { ModelDialog } from "./ModelDialog";
import { aboutMoney, dollars, modelName, plural, unlistedLine } from "./modelsFormat";

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);

function clampCount(raw: string, max: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

export function DraftDialog({
  model,
  onClose,
  onStarted,
}: {
  model: ModelDetail;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [opts, setOpts] = useState<DraftingOptions | null>(null);
  const [domainId, setDomainId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [tests, setTests] = useState(10);
  const [training, setTraining] = useState(20);
  const [estimate, setEstimate] = useState<DraftingEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const id = model.model_id;

  useEffect(() => {
    let live = true;
    draftingOptions(id)
      .then((o) => {
        if (!live) return;
        setOpts(o);
        setDomainId(
          (d) => d || (o.domains.find((x) => x.ready_files > 0) ?? o.domains[0])?.domain_id || "",
        );
        setTeamId((t) => t || o.teams[0]?.team_id || "");
      })
      .catch(() => live && setError("Couldn’t reach Tvashtr — is the backend running?"));
    return () => {
      live = false;
    };
  }, [id, reload]);

  useEffect(() => {
    if (!teamId || tests + training === 0) {
      setEstimate(null);
      return;
    }
    let live = true;
    estimateDrafting(id, { team_id: teamId, tests, training })
      .then((e) => live && setEstimate(e))
      .catch(() => live && setEstimate(null));
    return () => {
      live = false;
    };
  }, [id, teamId, tests, training]);

  const team = opts?.teams.find((t) => t.team_id === teamId) ?? null;
  const domain = opts?.domains.find((d) => d.domain_id === domainId) ?? null;
  const isChoice = model.answer_kind === "choice";
  const noDomains = opts !== null && opts.domains.length === 0;
  const notReady = domain !== null && domain.ready_files === 0;
  const busyModel = opts?.drafting ?? false;
  const cantStart =
    busy || !domain || notReady || !team || tests + training === 0 || busyModel || noDomains;

  const domainOptions = useMemo(
    () =>
      (opts?.domains ?? []).map((d) => ({
        value: d.domain_id,
        label:
          d.ready_files > 0
            ? `${d.name} · ${plural(d.ready_files, "file")}`
            : `${d.name} · no ready files yet`,
      })),
    [opts],
  );

  const start = async () => {
    if (!domain || !team) return;
    setBusy(true);
    setError(null);
    setMissing([]);
    try {
      await startDrafting(id, {
        domain_id: domain.domain_id,
        team_id: team.team_id,
        tests,
        training,
      });
      onStarted();
    } catch (err) {
      if (err instanceof MissingKeysError) setMissing(err.providers);
      setError(err instanceof ApiError ? err.message : "Couldn’t start drafting. Try again.");
      setBusy(false);
    }
  };

  const addKey = (provider: string) =>
    requestAddKeys({
      teamName: team?.name ?? "Example builder",
      providers: [provider],
      subtitle: `So ${team?.name ?? "the team"} can draft examples`,
      note: "Used by Models · drafting examples",
      plain: true,
      onDone: () => {
        setMissing([]);
        setError(null);
        setReload((r) => r + 1);
      },
    });

  return (
    <ModelDialog
      wide
      top={64}
      title="Draft with a team"
      subtitle={`Your team reads a Domain and drafts examples for ${model.name}. Nothing is added until you accept it.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={cantStart}
            title={busyModel ? "A team is already drafting for this model." : undefined}
            onClick={() => void start()}
          >
            Start drafting
          </Button>
        </>
      }
    >
      {noDomains ? (
        <div className="md-note">
          <span>
            You have no Domains yet. Add your files to a Domain first.{" "}
            <a className="md-link" href="#/domains">
              Go to Domains
            </a>
          </span>
        </div>
      ) : (
        <Select
          label="Read from which Domain?"
          value={domainId}
          options={domainOptions}
          helper={
            notReady
              ? "This Domain has no ready files yet. Wait for its files, or pick another."
              : "Every example quotes the passage it came from, so you can check it."
          }
          onChange={(e) => setDomainId(e.target.value)}
        />
      )}

      <div className="md-numins">
        <label className="md-numin">
          <span className="md-lbl">Tests</span>
          <input
            type="number"
            min={0}
            max={25}
            value={tests}
            onChange={(e) => setTests(clampCount(e.target.value, 25))}
          />
          <span className="md-hint">Up to 25. Tests are never used for training.</span>
        </label>
        <label className="md-numin">
          <span className="md-lbl">Training examples</span>
          <input
            type="number"
            min={0}
            max={75}
            value={training}
            onChange={(e) => setTraining(clampCount(e.target.value, 75))}
          />
          <span className="md-hint">Up to 75. What a model will learn from.</span>
        </label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="md-teampick">
          <Select
            label="Which team?"
            value={teamId}
            options={(opts?.teams ?? []).map((t) => ({ value: t.team_id, label: t.name }))}
            onChange={(e) => setTeamId(e.target.value)}
          />
          {team && (
            <a href={`#/teams/${team.team_id}`}>
              Open on canvas
              <ArrowUpRight size={14} strokeWidth={1.7} aria-hidden />
            </a>
          )}
        </div>
        {team && (
          <div className="md-strip" aria-label="The team's steps">
            {team.steps.map((s, i) => (
              <span key={s.node_id} style={{ display: "contents" }}>
                {i > 0 && (
                  <span className="md-arr" aria-hidden>
                    {team.steps[i - 1].loops_with_next ? "⇄" : "→"}
                  </span>
                )}
                <div className={s.end ? "md-step md-step--end" : "md-step"}>
                  <b>{s.label}</b>
                  {!s.end && s.model && <span>{modelName(s.model)}</span>}
                </div>
              </span>
            ))}
          </div>
        )}
        <span className="md-hint">
          Every example is checked against its source before the Reviewer sees it. Quotes that
          aren't in your files, or{" "}
          {isChoice
            ? `answers that aren't one of your ${word(model.choices.length)} choices`
            : "answers without their key phrases"}
          , are sent back.
        </span>
      </div>

      <div className="md-costbox">
        <div className="md-costbox__top">
          <span className="md-costbox__label">Estimated cost</span>
          <span className="md-costbox__sum">
            {estimate ? aboutMoney(estimate.estimate_usd) : "—"}
          </span>
        </div>
        {estimate && (
          <>
            <span className="md-hint">
              {plural(tests + training, "example")} with {word(estimate.agents)} agent
              {estimate.agents === 1 ? "" : "s"}, paid on your own keys. {estimate.hint}
            </span>
            {estimate.unpriced.map((slug) => (
              <span key={slug} className="md-hint">
                {unlistedLine(slug)}
              </span>
            ))}
            <span className="md-hint">
              The run pauses and asks you if it reaches <b>{dollars(estimate.pause_usd)}</b>.
            </span>
          </>
        )}
      </div>
      <span className="md-hint">
        It takes a few minutes. You can leave this page; the drafts appear on the Drafts tab and in
        Needs you on Home.
      </span>
      {busyModel && (
        <span className="md-error" role="status">
          A team is already drafting for this model.
        </span>
      )}
      {error && (
        <span className="md-error" role="alert">
          {error}
        </span>
      )}
      {missing.map((provider) => (
        <div key={provider}>
          <Button variant="secondary" size="sm" onClick={() => addKey(provider)}>
            Add a key
          </Button>
        </div>
      ))}
    </ModelDialog>
  );
}
