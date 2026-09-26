/**
 * A domain's Settings tab (DM-80…DM-91; Dm-Settings, DmF-Tune-1…4): how files are read, how
 * answers are written, how search works and the danger card. The Reading model select keeps the
 * design's 340px on a row of its own (the frame draws it overflowing into the next card). Editing shows the save bar with what
 * saving means; **Save and run tests** saves and goes to Quality, where the run with the new
 * setting is compared with the last one.
 *
 * The draft outlives the tab: leave it and come back, the unsaved changes are still there (the
 * proposed "Discard your changes to Settings?" confirm is not built). Reloading or closing the page
 * while there are some asks first.
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { CircleCheck, Trash } from "lucide-react";

import { Button, Input, Select, Switch, useToast } from "../../design-system/components";
import { ApiError, listProviders } from "../../lib/api";
import {
  type DomainDetailView,
  type DomainTemplate,
  listDomainTemplates,
  rereadDomainFiles,
  saveDomainSettings,
  startTestRun,
} from "../../lib/api/domains";
import { navigate } from "../../lib/nav";
import { refreshBadges } from "../../lib/workspaceStatus";
import { ANSWER_MODELS } from "./answerModels";
import { DeleteDomainDialog } from "./DeleteDomainDialog";
import { deleteDomainInUse, formatNumber, templateLabel } from "./domainFormat";
import { READING_MODELS, keySavedText, missingKeyText, readingModel } from "./readingModels";
import {
  SEARCH_MODES,
  type SaveImpact,
  configOf,
  dangerText,
  draftOf,
  fieldErrors,
  saveImpact,
  templateOption,
  widerHelper,
} from "./settingsFormat";
import { useDomainSettingsDraft } from "./useDomainSettingsDraft";
import "./settings.css";

const DEFAULT = "default";
const CUSTOM = "custom";

/**
 * Reloading or closing with unsaved changes asks first: the browser's prompt, and on Desktop its
 * own "Keep editing / Discard and close" (PANEL-21's bridge).
 */
function useLeaveGuard(dirty: boolean, name: string) {
  useEffect(() => {
    if (!dirty) return;
    const ask = (e: BeforeUnloadEvent) => e.preventDefault();
    const d = window.tvashtrDesktop;
    const app = d && typeof d === "object" ? d.app : undefined;
    window.addEventListener("beforeunload", ask);
    app?.setUnsavedChanges?.({ dirty: true, agentName: `${name} settings` });
    return () => {
      window.removeEventListener("beforeunload", ask);
      app?.setUnsavedChanges?.({ dirty: false });
    };
  }, [dirty, name]);
}

function Field({
  label,
  htmlFor,
  helper,
  wide,
  children,
}: {
  label: string;
  htmlFor: string;
  helper?: ReactNode;
  /** A row of its own (both columns). */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "dm-set__field dm-set__field--wide" : "dm-set__field"}>
      <label className="dm-set__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {helper}
    </div>
  );
}

function Problem({ id, text }: { id: string; text?: string }) {
  return text ? (
    <span className="dm-set__error" id={id} role="alert">
      {text}
    </span>
  ) : null;
}

function SaveBar({
  impact,
  saving,
  blocked,
  onDiscard,
  onSave,
}: {
  impact: SaveImpact;
  saving: boolean;
  blocked: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="dm-savebar" role="region" aria-label="Unsaved changes">
      <span className="dm-savebar__dot" aria-hidden />
      <span className="dm-savebar__summary">{impact.summary}</span>
      {impact.note && <span className="dm-savebar__note">{impact.note}</span>}
      <span className="dm-savebar__gap" />
      <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
        Discard
      </Button>
      <Button variant="primary" size="sm" onClick={onSave} loading={saving} disabled={blocked}>
        {impact.label}
      </Button>
    </div>
  );
}

export function SettingsTab({
  detail,
  onChanged,
}: {
  detail: DomainDetailView;
  onChanged: () => void;
}) {
  const id = detail.domain_id;
  const toast = useToast();
  const saved = useMemo(() => draftOf(detail), [detail]);
  const { draft, set, reset } = useDomainSettingsDraft(id, saved);
  const [templates, setTemplates] = useState<DomainTemplate[]>([]);
  const [held, setHeld] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let live = true;
    listDomainTemplates()
      .then((t) => live && setTemplates(t))
      .catch(() => undefined);
    listProviders()
      .then((ps) => live && setHeld(ps.map((p) => p.provider)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const errors = fieldErrors(draft);
  const impact = saveImpact(saved, draft, {
    files: detail.files.total,
    tests: detail.quality.cases,
  });
  useLeaveGuard(impact !== null, detail.name);

  const reading = readingModel(draft.reading);
  const keyHeld = held === null || held.includes(reading.provider);
  const blocked = Object.keys(errors).length > 0 || (impact?.action === "reread" && !keyHeld);

  const templateOptions = templates.some((t) => t.template === draft.template)
    ? templates.map((t) => ({ value: t.template, label: templateOption(t) }))
    : [{ value: draft.template, label: templateLabel(draft.template) }];
  const readingOptions = READING_MODELS.some((m) => m.slug === draft.reading)
    ? READING_MODELS.map((m) => ({ value: m.slug, label: m.label }))
    : [
        { value: draft.reading, label: reading.label },
        ...READING_MODELS.map((m) => ({ value: m.slug, label: m.label })),
      ];
  const listed = ANSWER_MODELS.some((m) => m.slug === draft.answer);
  const answerValue = draft.answer === null ? DEFAULT : listed ? draft.answer : CUSTOM;

  const pickTemplate = (value: string) => {
    const t = templates.find((x) => x.template === value);
    set({
      template: value,
      // DM-81: the starting point fills in its piece size and overlap.
      ...(t?.piece_size ? { size: String(t.piece_size), overlap: String(t.overlap ?? 0) } : {}),
    });
  };
  const pickAnswer = (value: string) => {
    if (value === DEFAULT) set({ answer: null });
    else if (value === CUSTOM) {
      const custom = saved.answer !== null && !ANSWER_MODELS.some((m) => m.slug === saved.answer);
      set({ answer: custom ? saved.answer : "" });
    } else set({ answer: value });
  };

  const save = async () => {
    if (!impact || blocked || saving) return;
    setSaving(true);
    try {
      await saveDomainSettings(id, {
        config: configOf(detail.config, draft),
        ...(draft.template !== saved.template ? { template: draft.template } : {}),
      });
    } catch (e) {
      setSaving(false);
      toast({
        message:
          e instanceof ApiError && e.status < 500 && e.message
            ? e.message
            : "Couldn’t save the settings — is the backend running?",
        tone: "error",
      });
      return;
    }
    const size = Number(draft.size);
    reset();
    setSaving(false);
    onChanged();
    const failed = (what: string) => (e: unknown) =>
      toast({
        message: `Saved, but ${what}${e instanceof ApiError && e.status < 500 && e.message ? `: ${e.message}` : "."}`,
        tone: "error",
      });
    if (impact.action === "run-tests") {
      // DM-91: run every test with the new setting; Quality shows it running.
      await startTestRun(id).catch(failed("the tests didn’t start"));
      navigate({ page: "domains", domainId: id, tab: "quality" });
    } else if (impact.action === "reread") {
      await rereadDomainFiles(id).catch(failed("the files didn’t start re-reading"));
      navigate({ page: "domains", domainId: id });
    } else if (impact.action === "pieces") {
      toast({ message: `Saved. New files use ${formatNumber(size)}-character pieces.` });
    }
  };

  const inUse = deleteDomainInUse(detail);

  return (
    <div className="dm-set">
      <div className="dm-set__grid">
        <div className="dm-set__col">
          <section className="dm-set__card" aria-labelledby="dm-set-read">
            <div className="dm-set__head">
              <span className="dm-set__eyebrow" id="dm-set-read">
                How files are read
              </span>
            </div>
            <div className="dm-set__pair">
              <Field
                label="Starting point"
                htmlFor="dm-set-template"
                helper={
                  <span className="dm-set__help">
                    Sets the piece size below. You can still change it.
                  </span>
                }
              >
                <Select
                  id="dm-set-template"
                  aria-label="Starting point"
                  options={templateOptions}
                  value={draft.template}
                  onChange={(e) => pickTemplate(e.target.value)}
                />
              </Field>
              <Field
                label="Reading model"
                htmlFor="dm-set-reading"
                wide
                helper={
                  <span className="dm-set__help">
                    Turns each piece into something search can compare.{" "}
                    {held !== null &&
                      (keyHeld ? (
                        <span className="dm-keytag">
                          <CircleCheck size={14} strokeWidth={1.6} aria-hidden />
                          {reading.provider} {keySavedText(reading.provider)}
                        </span>
                      ) : (
                        <span className="dm-keytag dm-keytag--missing">
                          {missingKeyText(reading.provider)}
                        </span>
                      ))}
                  </span>
                }
              >
                <span className="dm-set__w340">
                  <Select
                    id="dm-set-reading"
                    aria-label="Reading model"
                    options={readingOptions}
                    value={draft.reading}
                    onChange={(e) => set({ reading: e.target.value })}
                  />
                </span>
              </Field>
              <Field
                label="Piece size"
                htmlFor="dm-set-size"
                helper={
                  errors.size ? (
                    <Problem id="dm-set-size-error" text={errors.size} />
                  ) : (
                    <span className="dm-set__help">
                      Smaller pieces give sharper sources. Bigger pieces keep more context.
                    </span>
                  )
                }
              >
                <span className="dm-set__num">
                  <Input
                    id="dm-set-size"
                    size="sm"
                    inputMode="numeric"
                    value={draft.size}
                    className={errors.size ? "ds-input--error" : undefined}
                    aria-invalid={errors.size ? true : undefined}
                    aria-describedby={errors.size ? "dm-set-size-error" : undefined}
                    onChange={(e) => set({ size: e.target.value })}
                  />
                  <span className="dm-set__unit">characters</span>
                </span>
              </Field>
              <Field
                label="Overlap"
                htmlFor="dm-set-overlap"
                helper={
                  errors.overlap ? (
                    <Problem id="dm-set-overlap-error" text={errors.overlap} />
                  ) : (
                    <span className="dm-set__help">
                      Neighbouring pieces share this much, so sentences aren’t cut in half.
                    </span>
                  )
                }
              >
                <span className="dm-set__num">
                  <Input
                    id="dm-set-overlap"
                    size="sm"
                    inputMode="numeric"
                    value={draft.overlap}
                    className={errors.overlap ? "ds-input--error" : undefined}
                    aria-invalid={errors.overlap ? true : undefined}
                    aria-describedby={errors.overlap ? "dm-set-overlap-error" : undefined}
                    onChange={(e) => set({ overlap: e.target.value })}
                  />
                  <span className="dm-set__unit">characters</span>
                </span>
              </Field>
            </div>
          </section>

          <section className="dm-set__card dm-set__card--answers" aria-labelledby="dm-set-answers">
            <span className="dm-set__eyebrow" id="dm-set-answers">
              How answers are written
            </span>
            <Field
              label="Answer model"
              htmlFor="dm-set-answer"
              helper={
                <span className="dm-set__help">
                  Used by Ask and by Query domain nodes. Account default uses your default thinking
                  model.
                </span>
              }
            >
              <span className="dm-set__w340">
                <Select
                  id="dm-set-answer"
                  aria-label="Answer model"
                  options={[
                    ...ANSWER_MODELS.map((m) => ({ value: m.slug ?? DEFAULT, label: m.label })),
                    { value: CUSTOM, label: "Custom…" },
                  ]}
                  value={answerValue}
                  onChange={(e) => pickAnswer(e.target.value)}
                />
              </span>
              {answerValue === CUSTOM && (
                <span className="dm-set__w340">
                  <Input
                    size="sm"
                    mono
                    aria-label="Custom answer model"
                    placeholder="provider/model"
                    value={draft.answer ?? ""}
                    error={errors.answer}
                    onChange={(e) => set({ answer: e.target.value })}
                  />
                </span>
              )}
            </Field>
          </section>
        </div>

        <div className="dm-set__col">
          <section className="dm-set__card" aria-labelledby="dm-set-search">
            <span className="dm-set__eyebrow" id="dm-set-search">
              How search works
            </span>
            <div className="dm-set__pair">
              <div className="dm-set__field">
                <span className="dm-set__label" id="dm-set-mode">
                  Search by
                </span>
                <div className="dm-seg" role="group" aria-labelledby="dm-set-mode">
                  {SEARCH_MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      className="dm-seg__btn"
                      aria-pressed={draft.mode === m.value}
                      onClick={() => set({ mode: m.value })}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <span className="dm-set__help">
                  Meaning finds paraphrases. Exact words finds names and codes. Both merges the two.
                </span>
              </div>
              <Field
                label="Passages per question"
                htmlFor="dm-set-topk"
                helper={
                  errors.topK ? (
                    <Problem id="dm-set-topk-error" text={errors.topK} />
                  ) : (
                    <span className="dm-set__help">How many passages an answer can use.</span>
                  )
                }
              >
                <span className="dm-set__num">
                  <Input
                    id="dm-set-topk"
                    size="sm"
                    inputMode="numeric"
                    value={draft.topK}
                    className={errors.topK ? "ds-input--error" : undefined}
                    aria-invalid={errors.topK ? true : undefined}
                    aria-describedby={errors.topK ? "dm-set-topk-error" : undefined}
                    onChange={(e) => set({ topK: e.target.value })}
                  />
                </span>
              </Field>
              <div className="dm-set__field">
                <Switch
                  label="Look wider, then keep the best"
                  checked={draft.rerank}
                  onCheckedChange={(on) => set({ rerank: on })}
                />
                <span className="dm-set__help dm-set__help--switch">
                  {widerHelper(draft, detail.config)}
                </span>
              </div>
              <div className="dm-set__field">
                <Switch
                  label="Include related passages"
                  checked={draft.graph}
                  onCheckedChange={(on) => set({ graph: on })}
                />
                <span className="dm-set__help dm-set__help--switch">
                  Adds up to 4 more passages that mention the same names. Off by default.
                </span>
              </div>
            </div>
          </section>

          <section className="dm-set__danger" aria-labelledby="dm-set-danger">
            <div className="dm-set__danger-text">
              <div className="dm-set__danger-title" id="dm-set-danger">
                Delete this domain
              </div>
              <div className="dm-set__danger-line">{dangerText(detail.files.total, inUse)}</div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="dm-btn-inline"
              onClick={() => setDeleting(true)}
            >
              <Trash size={15} strokeWidth={1.6} aria-hidden />
              <span>Delete domain…</span>
            </Button>
          </section>
        </div>
      </div>

      {impact && (
        <SaveBar
          impact={impact}
          saving={saving}
          blocked={blocked}
          onDiscard={reset}
          onSave={() => void save()}
        />
      )}

      {deleting && (
        <DeleteDomainDialog
          domain={detail}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            reset();
            toast({ message: `${detail.name} deleted` });
            navigate({ page: "domains" });
            void refreshBadges();
          }}
        />
      )}
    </div>
  );
}
