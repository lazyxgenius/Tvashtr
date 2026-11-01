/** The Models list (`#/models`): the first-time card, or one card per model with "Best on your
 *  tests", a status badge and, for a model with no results on its tests, Run tests. */
import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";

import { Badge, Button } from "../../design-system/components";
import { type ModelCard, listModels } from "../../lib/api/models";
import { navigate } from "../../lib/nav";
import { ModelKeySheet } from "./modelKeys";
import { ago, kindChip, plural, runCost } from "./modelsFormat";
import { NewModelDialog } from "./NewModelDialog";
import { RunTestsDialog } from "./RunTestsDialog";
import "./models.css";

const STEPS = [
  ["Step 1", "Describe the job", "One sentence, and the kind of answer you expect."],
  ["Step 2", "Add tests", "Type them in or import a CSV. Keep adding as you learn."],
  ["Step 3", "Run them", "On the models you hold keys for. Compare any two side by side."],
] as const;

function FirstTime({ onNew }: { onNew: () => void }) {
  return (
    <section className="md-card md-first">
      <span className="md-first__tile">
        <ClipboardCheck size={22} strokeWidth={1.7} aria-hidden />
      </span>
      <h2 className="md-first__title">Every model starts with its tests</h2>
      <p className="md-lede md-first__lede">
        Pick one job you want done well, like sorting claims into teams. Write down real cases with
        the right answers. Tvashtr runs them on the models you have keys for and shows which does
        best, and what it costs.
      </p>
      <ol className="md-first__steps">
        {STEPS.map(([step, title, text]) => (
          <li key={step} className="md-first__step">
            <div className="md-eyebrow">{step}</div>
            <div className="md-first__step-title">{title}</div>
            <div className="md-first__step-text">{text}</div>
          </li>
        ))}
      </ol>
      <Button variant="primary" onClick={onNew}>
        New model
      </Button>
    </section>
  );
}

function StatusBadge({ model }: { model: ModelCard }) {
  if (model.badge === "tested") {
    return (
      <Badge variant="success" dot>
        Tested {ago(model.tested_at)}
      </Badge>
    );
  }
  if (model.badge === "changed")
    return <Badge variant="warning">Tests changed since last run</Badge>;
  return <Badge variant="neutral">Not run yet</Badge>;
}

function ModelCardView({ model, onRun }: { model: ModelCard; onRun: () => void }) {
  const open = () => navigate({ page: "models", modelId: model.model_id });
  const empty =
    model.badge === "changed"
      ? "Its tests changed since the last run. Run them again to see scores."
      : "No results yet. Run its tests to see how models do.";
  return (
    <article
      className="md-card md-mcard"
      role="link"
      tabIndex={0}
      aria-label={model.name}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) open();
      }}
    >
      <div className="md-mcard__top">
        <div>
          <h2 className="md-mcard__name">{model.name}</h2>
          <p className="md-mcard__job">{model.job}</p>
        </div>
        <StatusBadge model={model} />
      </div>
      <div className="md-mcard__chips">
        <span className="md-chip">{plural(model.tests, "test")}</span>
        <span className="md-chip">{kindChip(model)}</span>
        {model.current_version > 0 && (
          <span className="md-chip">Test set v{model.current_version}</span>
        )}
      </div>
      {model.best.length > 0 ? (
        <div className="md-mcard__best">
          <div className="md-eyebrow">Best on your tests</div>
          <div className="md-mcard__rows">
            {model.best.map((r) => (
              <div key={r.run_id} className="md-mcard__row">
                <span>
                  {r.provider_label} <span className="md-mono">{r.model_name}</span>
                </span>
                <span className="md-mcard__score">
                  {r.passed} / {r.cases_total}
                </span>
                <span className="md-mcard__cost">{runCost(r)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="md-mcard__none">
          <span>{empty}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={model.tests === 0}
            title={model.tests === 0 ? "Add a test first" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onRun();
            }}
          >
            Run tests
          </Button>
        </div>
      )}
    </article>
  );
}

export function ModelsListPage() {
  const [models, setModels] = useState<ModelCard[] | null>(null);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(() => {
    listModels()
      .then((m) => {
        setModels(m);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  const first = models !== null && models.length === 0;

  return (
    <div className="md-page">
      <header className="md-head">
        <div>
          <h1 className="md-h1">Models</h1>
          <p className="md-lede">
            Each model is one job you want done well. Write its tests, run them on the models you
            have keys for, and see which one does the job best, and for how much.
          </p>
        </div>
        {models !== null && !first && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            New model
          </Button>
        )}
      </header>
      {models === null && error && (
        <div className="md-alert" role="alert">
          <span>Couldn’t reach Tvashtr — is the backend running?</span>
          <Button variant="secondary" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      )}
      {first && <FirstTime onNew={() => setCreating(true)} />}
      {models !== null && !first && (
        <div className="md-mgrid">
          {models.map((m) => (
            <ModelCardView key={m.model_id} model={m} onRun={() => setRunning(m.model_id)} />
          ))}
        </div>
      )}
      {creating && (
        <NewModelDialog
          onClose={() => setCreating(false)}
          onCreated={(m) => navigate({ page: "models", modelId: m.model_id })}
        />
      )}
      {running && (
        <RunTestsDialog
          modelId={running}
          onClose={() => setRunning(null)}
          onStarted={() => navigate({ page: "models", modelId: running, tab: "results" })}
        />
      )}
      <ModelKeySheet />
    </div>
  );
}
