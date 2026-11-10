/** Run tests, cost first: which models, what each should cost, and the button that names both. */
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Checkbox, Input } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type Estimate,
  type ModelDetail,
  estimateRun,
  getModel,
  startRuns,
} from "../../lib/api/models";
import { ModelDialog } from "./ModelDialog";
import { requestModelKey, useModelChoices } from "./modelChoices";
import {
  aboutMoney,
  estimateLine,
  estimateTotal,
  modelRows,
  plural,
  runButtonLabel,
  unlistedLine,
} from "./modelsFormat";

const BAD_SLUG = "Type it as provider/model, like groq/llama-3.3-70b-versatile.";
const SLUG_SHAPE = /^[a-z0-9][a-z0-9_.-]*\/\S+$/;

export function RunTestsDialog({
  modelId,
  onClose,
  onStarted,
}: {
  modelId: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const { catalogue, held, reload: reloadKeys } = useModelChoices();
  const [model, setModel] = useState<ModelDetail | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [checked, setChecked] = useState<string[] | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getModel(modelId)
      .then((m) => {
        if (!live) return;
        setModel(m);
        setExtra(m.pre_checked);
        setChecked(m.pre_checked);
      })
      .catch(() => live && setError("Couldn’t reach Tvashtr — is the backend running?"));
    return () => {
      live = false;
    };
  }, [modelId]);

  const rows = useMemo(() => modelRows(catalogue, held ?? [], extra), [catalogue, held, extra]);
  const usable = useMemo(() => rows.filter((r) => r.held).map((r) => r.slug), [rows]);
  const usableKey = usable.join("|");

  const refresh = useCallback(() => {
    if (!usableKey) return;
    estimateRun(modelId, usableKey.split("|"))
      .then(setEstimate)
      .catch(() => undefined);
  }, [modelId, usableKey]);
  useEffect(refresh, [refresh]);

  // A pre-checked model whose key has gone can't run: only held rows count as ticked.
  const ticked = (checked ?? []).filter((s) => usable.includes(s));
  const toggle = (slug: string) =>
    setChecked((c) => {
      const now = c ?? [];
      return now.includes(slug) ? now.filter((s) => s !== slug) : [...now, slug];
    });

  const addCustom = () => {
    const slug = (custom ?? "").trim();
    if (!SLUG_SHAPE.test(slug)) {
      setCustomError(BAD_SLUG);
      return;
    }
    setExtra((x) => (x.includes(slug) ? x : [...x, slug]));
    setChecked((c) => [...(c ?? []), slug]);
    setCustom(null);
    setCustomError(null);
  };

  const run = async () => {
    if (ticked.length === 0) {
      setError("Pick at least one model.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await startRuns(modelId, ticked);
      onStarted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn’t start the run. Try again.");
      setBusy(false);
    }
  };

  const tests = model?.tests ?? 0;
  const estimates = estimate?.models ?? [];
  const priceOf = (slug: string) => estimates.find((e) => e.model === slug);
  const unlisted = [
    ...ticked.filter((s) => priceOf(s)?.price_known === false),
    ...new Set(estimates.filter((e) => ticked.includes(e.model)).flatMap((e) => e.unpriced_judges)),
  ];

  const tickedEstimates = estimates.filter((e) => ticked.includes(e.model));
  const learned = tickedEstimates.some((e) => e.learned);
  const thinkers = rows.filter((r) =>
    tickedEstimates.some((e) => e.model === r.slug && e.thinks && !e.learned),
  );

  return (
    <ModelDialog
      title="Run tests"
      subtitle={
        model
          ? `All ${plural(tests, "test")} from test set v${model.current_version} of ${model.name}`
          : undefined
      }
      onClose={onClose}
      top={80}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void run()}>
            {runButtonLabel(tests, ticked.length)}
          </Button>
        </>
      }
    >
      <fieldset className="md-runmodels">
        <legend className="md-lbl">Which models?</legend>
        <div className="md-runmodels__rows">
          {rows.map((row) => {
            const on = ticked.includes(row.slug);
            const label = `${row.providerLabel} ${row.name}`;
            if (!row.held) {
              return (
                <div key={row.slug} className="md-mrow md-mrow--off">
                  <Checkbox
                    disabled
                    label={label}
                    description={`No ${row.providerLabel} key yet`}
                  />
                  <a
                    href="#"
                    role="button"
                    className="md-mrow__add"
                    onClick={(e) => {
                      e.preventDefault();
                      requestModelKey(row.provider, row.slug, reloadKeys);
                    }}
                  >
                    Add a key
                  </a>
                </div>
              );
            }
            const price = priceOf(row.slug);
            return (
              <div key={row.slug} className={on ? "md-mrow md-mrow--on" : "md-mrow"}>
                <Checkbox
                  checked={on}
                  onChange={() => toggle(row.slug)}
                  label={label}
                  description={`Your ${row.providerLabel} key`}
                />
                <span className="md-mrow__cost">
                  {price
                    ? price.estimate_usd === null
                      ? "price not listed"
                      : aboutMoney(price.estimate_usd)
                    : ""}
                </span>
              </div>
            );
          })}
        </div>
        {custom === null ? (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setCustom("")}>
              Custom model…
            </Button>
          </div>
        ) : (
          <Input
            size="sm"
            autoFocus
            aria-label="Custom model"
            placeholder="provider/model"
            value={custom}
            helper="Any model you hold a key for, then press Enter."
            error={customError ?? undefined}
            onChange={(e) => {
              setCustom(e.target.value);
              setCustomError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setCustom(null);
                setCustomError(null);
              }
            }}
          />
        )}
      </fieldset>

      <div className="md-estimate">
        <div className="md-estimate__top">
          <span className="md-estimate__label">Estimated cost</span>
          <span className="md-estimate__sum">{aboutMoney(estimateTotal(estimates, ticked))}</span>
        </div>
        {estimate && (
          <span className="md-hint">
            {estimateLine(ticked.length, estimate.tests, estimate.summary)}
          </span>
        )}
        {unlisted.map((slug) => (
          <span key={slug} className="md-hint">
            {unlistedLine(slug)}
          </span>
        ))}
        {thinkers.map((r) => (
          <span key={r.slug} className="md-hint">
            {`${r.providerLabel} ${r.name} thinks before it answers. Its first estimate can be several times too low.`}
          </span>
        ))}
        <span className="md-hint">
          {learned
            ? "Based on what these models really used on your past tests."
            : "The estimate uses each model's listed price and the length of your tests. The real cost shows when the run ends."}
        </span>
      </div>
      <span className="md-hint">
        You can leave this page. Results fill in on the Results tab as each test finishes.
      </span>
      {error && (
        <span className="md-error" role="alert">
          {error}
        </span>
      )}
    </ModelDialog>
  );
}
