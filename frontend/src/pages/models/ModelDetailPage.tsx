/** A model's page (`#/models/<id>[/results|settings]`): breadcrumb, name and job, the actions, the
 *  tabs. It owns what sits over the tabs: the test drawer, Run tests, Import CSV and History. */
import { useCallback, useEffect, useState } from "react";

import { Button, Tabs } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import { type ModelDetail, type ModelTest, getModel, restoreVersion } from "../../lib/api/models";
import { type ModelTab, navigate } from "../../lib/nav";
import { HistorySheet } from "./HistorySheet";
import { ImportCsvDialog } from "./ImportCsvDialog";
import { ModelKeySheet } from "./modelKeys";
import { ResultsTab } from "./ResultsTab";
import { RunTestsDialog } from "./RunTestsDialog";
import { SettingsTab } from "./SettingsTab";
import { TestDrawer } from "./TestDrawer";
import { TestsTab } from "./TestsTab";
import "./models.css";

/** The test the drawer shows; `test: null` is a new one. */
interface DrawerState {
  test: ModelTest | null;
  popup: boolean;
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

  const docked = drawer !== null && !drawer.popup;
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
            {tab === "tests" && (
              <>
                <Button variant="secondary" onClick={() => setImporting(true)}>
                  Import CSV
                </Button>
                <Button variant="secondary" onClick={() => setDrawer({ test: null, popup: false })}>
                  Add test
                </Button>
              </>
            )}
            {runButton}
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
