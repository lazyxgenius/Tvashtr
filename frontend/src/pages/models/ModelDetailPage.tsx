/** A model's page (`#/models/<id>[/training|drafts|results|settings]`): breadcrumb, name and job,
 *  the actions, the tabs. It owns what sits over the tabs: the test, example and draft drawers, Run
 *  tests, Draft with a team, Import CSV, Download and History. */
import { useCallback, useEffect, useState } from "react";

import { Button, Menu, Tabs } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type Draft,
  type ModelDetail,
  type ModelTest,
  type TrainingExample,
  getModel,
  restoreTrainingVersion,
  restoreVersion,
  trainingDownloadUrl,
} from "../../lib/api/models";
import { type ModelTab, navigate } from "../../lib/nav";
import { DraftDialog } from "./DraftDialog";
import { DraftDrawer } from "./DraftDrawer";
import { DraftsTab } from "./DraftsTab";
import { ExampleDrawer } from "./ExampleDrawer";
import { HistorySheet } from "./HistorySheet";
import { ImportCsvDialog } from "./ImportCsvDialog";
import { ModelKeySheet } from "./modelKeys";
import { ResultsTab } from "./ResultsTab";
import { RunTestsDialog } from "./RunTestsDialog";
import { SettingsTab } from "./SettingsTab";
import { TestDrawer } from "./TestDrawer";
import { TestsTab } from "./TestsTab";
import { TrainingTab } from "./TrainingTab";
import "./models.css";

/** The test the drawer shows; `test: null` is a new one. */
interface DrawerState {
  test: ModelTest | null;
  popup: boolean;
}

/** Save the training set as a file (the server answers with an attachment). */
function downloadTraining(modelId: string, format: "jsonl" | "csv") {
  const a = document.createElement("a");
  a.href = trainingDownloadUrl(modelId, format);
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ModelDetailPage({ modelId, tab = "tests" }: { modelId: string; tab?: ModelTab }) {
  const [model, setModel] = useState<ModelDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [history, setHistory] = useState(false);
  // M2: the training example drawer (`example: null` = a new one), the draft drawer, the dialogs.
  const [exampleDrawer, setExampleDrawer] = useState<{ example: TrainingExample | null } | null>(
    null,
  );
  const [draftDrawer, setDraftDrawer] = useState<Draft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [importingTraining, setImportingTraining] = useState(false);
  const [trainingHistory, setTrainingHistory] = useState(false);
  const [viewingTraining, setViewingTraining] = useState<number | null>(null);

  const load = useCallback(() => {
    getModel(modelId)
      .then((m) => {
        setModel(m);
        setLoadFailed(false);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setLoadFailed(true);
      });
  }, [modelId]);
  useEffect(load, [load]);

  /** Something saved: read the model and the open tab again. */
  const changed = useCallback(() => {
    load();
    setTick((t) => t + 1);
  }, [load]);

  const go = (next: ModelTab) => {
    setDrawer(null);
    setViewing(null);
    setExampleDrawer(null);
    setDraftDrawer(null);
    setViewingTraining(null);
    navigate(
      { page: "models", modelId, tab: next === "tests" ? undefined : next },
      { replace: true },
    );
  };

  if (missing) {
    return (
      <div className="md-page">
        <div className="md-alert" role="status">
          <span>This model doesn’t exist any more.</span>
          <Button variant="secondary" size="sm" onClick={() => navigate({ page: "models" })}>
            Back to Models
          </Button>
        </div>
      </div>
    );
  }
  if (!model) {
    return loadFailed ? (
      <div className="md-page">
        <div className="md-alert" role="alert">
          <span>Couldn’t reach Tvashtr — is the backend running?</span>
          <Button variant="secondary" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      </div>
    ) : null;
  }

  const docked =
    (drawer !== null && !drawer.popup) || exampleDrawer !== null || draftDrawer !== null;
  const draftButton = (variant: "primary" | "secondary") => (
    <Button variant={variant} onClick={() => setDrafting(true)}>
      Draft with a team
    </Button>
  );
  const noTests = model.tests === 0;
  const runButton = (
    <Button
      variant="primary"
      disabled={noTests}
      title={noTests ? "Add a test first" : undefined}
      onClick={() => setRunning(true)}
    >
      Run tests
    </Button>
  );

  return (
    <div className={docked ? "md-page md-page--detail md-page--drawer" : "md-page md-page--detail"}>
      <nav className="md-crumb" aria-label="Breadcrumb">
        <a href="#/models">Models</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{model.name}</span>
      </nav>
      <header className="md-head md-head--detail">
        <div>
          <h1 className="md-h1">{model.name}</h1>
          <p className="md-lede">{model.job}</p>
        </div>
        {!docked && (
          <div className="md-head__actions">
            {tab === "tests" && viewing === null && (
              <>
                <Button variant="secondary" onClick={() => setImporting(true)}>
                  Import CSV
                </Button>
                <Button variant="secondary" onClick={() => setDrawer({ test: null, popup: false })}>
                  Add test
                </Button>
                {draftButton("secondary")}
              </>
            )}
            {tab === "drafts" && draftButton("secondary")}
            {tab === "training"
              ? viewingTraining === null && (
                  <>
                    <Menu
                      label="Download the training set"
                      trigger={(props) => (
                        <Button variant="secondary" disabled={!model.training} {...props}>
                          Download
                        </Button>
                      )}
                      items={[
                        {
                          key: "jsonl",
                          label: "JSONL",
                          onSelect: () => downloadTraining(modelId, "jsonl"),
                        },
                        {
                          key: "csv",
                          label: "CSV",
                          onSelect: () => downloadTraining(modelId, "csv"),
                        },
                      ]}
                    />
                    <Button variant="secondary" onClick={() => setImportingTraining(true)}>
                      Import CSV
                    </Button>
                    <Button variant="secondary" onClick={() => setExampleDrawer({ example: null })}>
                      Add example
                    </Button>
                    {draftButton("primary")}
                  </>
                )
              : runButton}
          </div>
        )}
      </header>
      <div className="md-tabs">
        <Tabs
          variant="line"
          aria-label="Model sections"
          value={tab}
          onChange={go}
          items={[
            { value: "tests" as const, label: "Tests", count: model.tests || undefined },
            {
              value: "training" as const,
              label: "Training examples",
              count: model.training || undefined,
            },
            { value: "drafts" as const, label: "Drafts", count: model.drafts || undefined },
            {
              value: "results" as const,
              label: "Results",
              count: model.runs_on_current || undefined,
            },
            { value: "settings" as const, label: "Settings" },
          ]}
        />
      </div>

      {tab === "tests" && (
        <TestsTab
          model={model}
          tick={tick}
          viewing={viewing}
          selected={drawer ? (drawer.test?.case_key ?? "new") : null}
          docked={docked}
          onOpen={(test) => setDrawer({ test, popup: false })}
          onImport={() => setImporting(true)}
          onHistory={() => setHistory(true)}
          onBack={() => setViewing(null)}
          onRestore={(version) => {
            void restoreVersion(modelId, version).then(() => {
              setViewing(null);
              changed();
            });
          }}
          onChanged={changed}
        />
      )}
      {tab === "training" && (
        <TrainingTab
          model={model}
          tick={tick}
          viewing={viewingTraining}
          selected={exampleDrawer ? (exampleDrawer.example?.example_key ?? "new") : null}
          docked={docked}
          onOpen={(example) => setExampleDrawer({ example })}
          onDraft={() => setDrafting(true)}
          onHistory={() => setTrainingHistory(true)}
          onBack={() => setViewingTraining(null)}
          onRestore={(version) => {
            void restoreTrainingVersion(modelId, version).then(() => {
              setViewingTraining(null);
              changed();
            });
          }}
          onChanged={changed}
        />
      )}
      {tab === "drafts" && (
        <DraftsTab
          model={model}
          tick={tick}
          onEdit={(d) => setDraftDrawer(d)}
          onDraft={() => setDrafting(true)}
          onChanged={changed}
        />
      )}
      {tab === "results" && (
        <ResultsTab model={model} tick={tick} onRun={() => setRunning(true)} onChanged={changed} />
      )}
      {tab === "settings" && (
        <SettingsTab
          key={model.model_id}
          model={model}
          onSaved={changed}
          onDeleted={() => navigate({ page: "models" })}
        />
      )}

      {drawer && (
        <TestDrawer
          key={drawer.test?.case_id ?? "new"}
          model={model}
          test={drawer.test}
          popup={drawer.popup}
          onTogglePopup={() => setDrawer({ ...drawer, popup: !drawer.popup })}
          onClose={() => setDrawer(null)}
          onSaved={() => {
            setDrawer(null);
            changed();
          }}
        />
      )}
      {exampleDrawer && (
        <ExampleDrawer
          key={exampleDrawer.example?.example_id ?? "new"}
          model={model}
          example={exampleDrawer.example}
          onClose={() => setExampleDrawer(null)}
          onSaved={() => {
            setExampleDrawer(null);
            changed();
          }}
        />
      )}
      {draftDrawer && (
        <DraftDrawer
          key={draftDrawer.draft_id}
          model={model}
          draft={draftDrawer}
          onClose={() => setDraftDrawer(null)}
          onSaved={() => {
            setDraftDrawer(null);
            changed();
          }}
        />
      )}
      {drafting && (
        <DraftDialog
          model={model}
          onClose={() => setDrafting(false)}
          onStarted={() => {
            setDrafting(false);
            changed();
            go("drafts");
          }}
        />
      )}
      {importingTraining && (
        <ImportCsvDialog
          kind="training"
          model={model}
          onClose={() => setImportingTraining(false)}
          onImported={() => {
            setImportingTraining(false);
            changed();
          }}
        />
      )}
      {trainingHistory && (
        <HistorySheet
          kind="training"
          model={model}
          onClose={() => setTrainingHistory(false)}
          onView={(version) => {
            setTrainingHistory(false);
            setViewingTraining(version === (model.training_version ?? 0) ? null : version);
          }}
        />
      )}
      {running && (
        <RunTestsDialog
          modelId={modelId}
          onClose={() => setRunning(false)}
          onStarted={() => {
            setRunning(false);
            changed();
            go("results");
          }}
        />
      )}
      {importing && (
        <ImportCsvDialog
          model={model}
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            changed();
          }}
        />
      )}
      {history && (
        <HistorySheet
          model={model}
          onClose={() => setHistory(false)}
          onView={(version) => {
            setHistory(false);
            setViewing(version === model.current_version ? null : version);
          }}
        />
      )}
      <ModelKeySheet />
    </div>
  );
}
