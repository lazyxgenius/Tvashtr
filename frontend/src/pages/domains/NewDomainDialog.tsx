/**
 * New domain (Dm-NewDialog, DmF-First-2/3, DmF-NoKey-1…4; DM-22…DM-29), a 720px two-step dialog.
 *
 * Step 1 names the domain, picks one of five starting points (radio cards) and shows which reading
 * model reads its files: the key-saved line with **Change** (swaps in the reading-model list), or —
 * with no key for that model's provider — the warn callout with **Add <p> key** (Home's
 * `AddKeySheet`, in its Domains copy) and **Use the free Hugging Face model** (which still needs a
 * free token, OQ-9). Step 2 collects files (drop zone or picker); **Create and read N files**
 * creates the domain, uploads them one by one — reading starts by itself — and lands on the new
 * domain's page. **Skip — add files later** creates it empty.
 */
import { type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, KeyRound, TriangleAlert, Upload, X } from "lucide-react";

import { Button, IconButton, Input, useToast } from "../../design-system/components";
import { ApiError, listProviders } from "../../lib/api";
import {
  type DomainDetailView,
  type DomainTemplate,
  createNewDomain,
  listDomainTemplates,
  uploadDomainDocument,
} from "../../lib/api/domains";
import { type ProviderDirectoryEntry, getHomeConfig } from "../../lib/api/home";
import { isDesktopApp } from "../../lib/desktopRepos";
import { useModalDialog } from "../../lib/useModalDialog";
import { AddKeySheet } from "../home/AddKeySheet";
import { requestAddKeys } from "../home/homeData";
import {
  UPLOAD_ACCEPT,
  createLabel,
  domainNameProblem,
  formatSize,
  kindOfName,
  pickProblem,
  pieceSizeLabel,
} from "./domainFormat";
import { KeySavedTag, ReadingModelOptions } from "./ReadingModelOptions";
import {
  DEFAULT_READING_MODEL,
  FREE_READING_MODEL,
  addKeyLabel,
  keySavedToast,
  readingExamples,
  readingModel,
} from "./readingModels";
import "./newDomain.css";

const CREATE_FAILED = "Couldn’t create the domain — is the backend running?";
const READING_MODEL_REFUSED = "Pick a reading model from the list.";

/** The starting points if the templates can't be loaded (the backend's copy, design order). */
const FALLBACK_TEMPLATES: DomainTemplate[] = [
  {
    template: "support",
    name: "Support",
    description: "Help center and product docs",
    piece_size: 600,
  },
  {
    template: "legal",
    name: "Legal",
    description: "Contracts and policies · precise sources",
    piece_size: 500,
  },
  {
    template: "financial",
    name: "Financial",
    description: "Filings, metrics, investor docs",
    piece_size: 700,
  },
  {
    template: "scientific",
    name: "Scientific",
    description: "Papers and methods · more context",
    piece_size: 1000,
  },
  {
    template: "blank",
    name: "Blank",
    description: "Start from defaults and tune it yourself",
    piece_size: 800,
  },
];

interface Picked {
  id: number;
  file: File;
  problem: string | null;
}

let nextPickId = 1;

function NewDomainBody({
  initialTemplate,
  existingNames,
  onClose,
  onCreated,
}: {
  initialTemplate?: string;
  existingNames: string[];
  onClose: () => void;
  onCreated: (domain: DomainDetailView) => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<DomainTemplate[]>(FALLBACK_TEMPLATES);
  const [template, setTemplate] = useState(initialTemplate ?? "support");
  const [model, setModel] = useState(DEFAULT_READING_MODEL);
  const [held, setHeld] = useState<string[] | null>(null);
  const [directory, setDirectory] = useState<ProviderDirectoryEntry[]>([]);
  const [picking, setPicking] = useState(false);
  const [files, setFiles] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<null | "creating" | { done: number; total: number }>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [focusNext, setFocusNext] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ref = useModalDialog<HTMLDivElement>(true, () => {
    if (!busy) onClose();
  });

  // The name field on open and on Back; the dialog itself on step 2 (its field unmounts).
  useEffect(() => {
    if (step === 1) nameRef.current?.focus();
    else ref.current?.focus();
  }, [step, ref]);

  useEffect(() => {
    let live = true;
    listDomainTemplates()
      .then((t) => {
        if (live && t.length > 0) setTemplates(t);
      })
      .catch(() => undefined);
    listProviders()
      .then((ps) => live && setHeld(ps.map((p) => p.provider)))
      .catch(() => live && setHeld(null));
    getHomeConfig()
      .then((c) => live && setDirectory(c.provider_directory.filter((d) => d.embeddings)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // After the key sheet saves, focus returns to the dialog's next step (DM-25, DmF-NoKey-3).
  useEffect(() => {
    if (!focusNext) return;
    nextRef.current?.focus();
    setFocusNext(false);
  }, [focusNext]);

  // A file dropped outside the drop zone must not open in the window (D1, page side).
  useEffect(() => {
    const stop = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  const current = readingModel(model);
  const keySaved = held === null ? null : held.includes(current.provider);
  const good = files.filter((f) => !f.problem);
  const cleanName = name.trim();
  const locked = busy !== null;

  const addKey = () => {
    requestAddKeys({
      teamName: "Domains",
      providers: [current.provider],
      subtitle: `So Domains can read files with ${current.label}`,
      note: "Used by Domains · reading files",
      examples: readingExamples(current),
      savedMessage: keySavedToast,
      plain: true,
      onDone: () => {
        listProviders()
          .then((ps) => setHeld(ps.map((p) => p.provider)))
          .catch(() => undefined);
        setFocusNext(true);
      },
    });
  };

  const next = () => {
    const problem = domainNameProblem(name, existingNames);
    if (problem) {
      setNameError(problem);
      nameRef.current?.focus();
      return;
    }
    setPicking(false);
    setStep(2);
  };

  const pick = (list: FileList | File[] | null) => {
    if (!list) return;
    const added = Array.from(list).map((file) => ({
      id: nextPickId++,
      file,
      problem: pickProblem(file),
    }));
    if (added.length) setFiles((fs) => [...fs, ...added]);
  };

  const create = async (withFiles: boolean) => {
    const uploads = withFiles ? good : [];
    setBusy("creating");
    setCreateError(null);
    let domain: DomainDetailView;
    try {
      domain = await createNewDomain({
        name: cleanName,
        template,
        ...(model !== DEFAULT_READING_MODEL ? { embedding_model: model } : {}),
      });
    } catch (e) {
      setBusy(null);
      if (e instanceof ApiError && e.status === 409) {
        setNameError(e.message);
        setStep(1);
        return;
      }
      if (e instanceof ApiError && e.status === 422 && e.message !== READING_MODEL_REFUSED) {
        setNameError(e.message);
        setStep(1);
        return;
      }
      setCreateError(e instanceof ApiError && e.status === 422 ? e.message : CREATE_FAILED);
      return;
    }
    const failed: string[] = [];
    for (let i = 0; i < uploads.length; i += 1) {
      setBusy({ done: i, total: uploads.length });
      try {
        await uploadDomainDocument(domain.domain_id, uploads[i].file);
      } catch {
        failed.push(uploads[i].file.name);
      }
    }
    setBusy(null);
    if (failed.length === 1) {
      toast({ message: `Couldn’t add ${failed[0]}. Add it again from Sources.`, tone: "error" });
    } else if (failed.length > 1) {
      toast({
        message: `Couldn’t add ${failed.length} files. Add them again from Sources.`,
        tone: "error",
      });
    }
    onCreated(domain);
  };

  const onRadioKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const at = templates.findIndex((t) => t.template === template);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const to = templates[(at + step + templates.length) % templates.length];
    if (!to) return;
    setTemplate(to.template);
    const el = e.currentTarget.querySelector<HTMLButtonElement>(`[data-template="${to.template}"]`);
    el?.focus();
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (!locked) pick(e.dataTransfer.files);
  };

  const keyArea = picking ? (
    <div className="dm-newdlg__models">
      <span className="dm-newdlg__label">Reading model</span>
      <ReadingModelOptions
        value={model}
        held={held}
        onPick={(slug) => {
          setModel(slug);
          setPicking(false);
        }}
        onCancel={() => setPicking(false)}
      />
    </div>
  ) : keySaved === false ? (
    <div className="dm-newdlg__warn">
      <div className="dm-newdlg__warn-text">
        <TriangleAlert size={15} strokeWidth={1.6} aria-hidden />
        {current.provider === "huggingface" ? (
          <span>
            <b>No huggingface token yet.</b> Hugging Face BGE-small is free, but it needs a free
            token from huggingface.co. You can create the domain now, but files wait until a token
            is added.
          </span>
        ) : (
          <span>
            <b>{`No ${current.provider} key yet.`}</b>
            {` Files are read with ${current.label}, which needs one. You can create the domain now, but files wait until a key is added.`}
          </span>
        )}
      </div>
      <div className="dm-newdlg__warn-actions">
        <Button variant="tint" size="sm" className="dm-btn-inline" onClick={addKey}>
          <KeyRound size={15} strokeWidth={1.6} aria-hidden />
          <span>{addKeyLabel(current.provider)}</span>
        </Button>
        {current.provider !== "huggingface" && (
          <Button variant="ghost" size="sm" onClick={() => setModel(FREE_READING_MODEL)}>
            Use the free Hugging Face model
          </Button>
        )}
      </div>
    </div>
  ) : (
    <div className="dm-newdlg__keyline">
      <KeyRound size={14} strokeWidth={1.6} aria-hidden />
      <span>
        Files are read with <b>{current.label}</b>
      </span>
      {keySaved && <KeySavedTag provider={current.provider} />}
      <span className="dm-newdlg__change">
        <a
          href="#"
          role="button"
          className="dm-newdlg__link"
          onClick={(e) => {
            e.preventDefault();
            setPicking(true);
          }}
        >
          Change
        </a>
      </span>
    </div>
  );

  return (
    <>
      <div className="ds-scrim" onClick={() => !locked && onClose()} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="New domain"
        className={step === 1 ? "ds-dialog dm-newdlg" : "ds-dialog dm-newdlg dm-newdlg--files"}
        tabIndex={-1}
      >
        <header className="dm-newdlg__head">
          <div className="dm-newdlg__titles">
            <h2 className="dm-newdlg__title">New domain</h2>
            <div className="dm-newdlg__sub">
              {step === 1
                ? "Step 1 of 2 · Name it and pick what kind of files it holds"
                : `Step 2 of 2 · Add files to ${cleanName}`}
            </div>
          </div>
          <IconButton size="sm" aria-label="Close" onClick={onClose} disabled={locked}>
            <X size={16} strokeWidth={1.6} aria-hidden />
          </IconButton>
        </header>

        {step === 1 ? (
          <div className="dm-newdlg__body">
            <Input
              ref={nameRef}
              label="Name"
              placeholder="e.g. Support docs"
              value={name}
              maxLength={200}
              error={nameError ?? undefined}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  next();
                }
              }}
            />
            <div className="dm-newdlg__group">
              <span className="dm-newdlg__label" id="dm-newdlg-start">
                Starting point
              </span>
              <div
                className="dm-newdlg__grid"
                role="radiogroup"
                aria-labelledby="dm-newdlg-start"
                onKeyDown={onRadioKey}
              >
                {templates.map((t) => {
                  const checked = t.template === template;
                  return (
                    <button
                      key={t.template}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      tabIndex={checked ? 0 : -1}
                      data-template={t.template}
                      className="dm-tplradio"
                      onClick={() => setTemplate(t.template)}
                    >
                      <span className="dm-tplradio__top">
                        <span className="dm-tplradio__dot" aria-hidden>
                          {checked && <span className="dm-tplradio__fill" />}
                        </span>
                        <span className="dm-tplradio__name">{t.name}</span>
                      </span>
                      <span className="dm-tplradio__desc">{t.description}</span>
                      {t.piece_size ? (
                        <span className="dm-tplradio__size">{pieceSizeLabel(t.piece_size)}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
            {keyArea}
          </div>
        ) : (
          <div className="dm-newdlg__body">
            <div
              className={dragging ? "dm-dropzone dm-dropzone--over" : "dm-dropzone"}
              onDragOver={(e) => {
                e.preventDefault();
                if (!dragging) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className="dm-dropzone__tile">
                <Upload size={20} strokeWidth={1.6} aria-hidden />
              </span>
              <div className="dm-dropzone__line">
                Drop files here, or{" "}
                <a
                  href="#"
                  role="button"
                  className="dm-dropzone__pick"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!locked) fileRef.current?.click();
                  }}
                >
                  choose files
                </a>
              </div>
              <div className="dm-dropzone__hint">
                PDF, Markdown, text or HTML · up to 10 MB each · as many as you like
              </div>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={UPLOAD_ACCEPT}
                hidden
                data-testid="new-domain-files"
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {files.length > 0 && (
              <ul className="dm-picked" aria-label="Files to add">
                {files.map((f) => (
                  <li key={f.id} className="dm-picked__row">
                    <span className="dm-kind">{kindOfName(f.file.name)}</span>
                    <span className="dm-picked__name">{f.file.name}</span>
                    {f.problem && <span className="dm-picked__problem">{f.problem}</span>}
                    <span className="dm-picked__size">{formatSize(f.file.size)}</span>
                    <IconButton
                      size="sm"
                      aria-label={`Remove ${f.file.name}`}
                      disabled={locked}
                      onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}
                    >
                      <X size={16} strokeWidth={1.6} aria-hidden />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="dm-newdlg__info">
              <span className="dm-newdlg__info-icon">
                <Info size={14} strokeWidth={1.6} aria-hidden />
              </span>
              <span>
                {keySaved === false
                  ? `Files are saved now and read once you add ${current.provider === "huggingface" ? "a huggingface token" : `an ${current.provider} key`}.`
                  : "Reading starts as soon as the domain is created. It takes about a minute for small files."}
              </span>
            </div>
            {createError && (
              <div className="dm-newdlg__error" role="alert">
                {createError}
              </div>
            )}
          </div>
        )}

        <footer className="dm-newdlg__foot">
          {step === 1 ? (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button ref={nextRef} variant="primary" size="sm" onClick={next}>
                Next: add files
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep(1)} disabled={locked}>
                Back
              </Button>
              <span className="dm-newdlg__spacer" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void create(false)}
                disabled={locked}
              >
                Skip — add files later
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={good.length === 0}
                loading={locked}
                onClick={() => void create(true)}
              >
                {busy === "creating"
                  ? "Creating…"
                  : busy
                    ? `Adding files · ${busy.done + 1} of ${busy.total}`
                    : createLabel(good.length, keySaved !== false)}
              </Button>
            </>
          )}
        </footer>
      </div>
      <AddKeySheet directory={directory} desktop={isDesktopApp()} />
    </>
  );
}

export function NewDomainDialog({
  open,
  initialTemplate,
  existingNames = [],
  onClose,
  onCreated,
}: {
  open: boolean;
  initialTemplate?: string;
  /** The account's domain names, for the Next check (the server checks again on create). */
  existingNames?: string[];
  onClose: () => void;
  onCreated: (domain: DomainDetailView) => void;
}) {
  if (!open) return null;
  return createPortal(
    <NewDomainBody
      initialTemplate={initialTemplate}
      existingNames={existingNames}
      onClose={onClose}
      onCreated={onCreated}
    />,
    document.body,
  );
}
