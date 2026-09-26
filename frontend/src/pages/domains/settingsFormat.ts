/**
 * The Settings tab's rules (DM-80…DM-91): the draft a domain's settings open as, the numbers'
 * checks (the backend's copy), what changed, what saving it means ("No re-read needed" / "Re-reads
 * 14 files" / "Existing files keep 600") and the config it sends. Pure and tested.
 */
import type { DomainTemplate } from "../../lib/api/domains";
import { normalizeEmbeddingModel } from "../../lib/domains";
import { aboutMinutes, formatNumber, pieceSizeLabel, templateLabel } from "./domainFormat";
import { keyWord, readSeconds, readingModel, sameReadingWeights } from "./readingModels";

export type SearchMode = "dense" | "lexical" | "hybrid";

/** Search by, in the design's order (Meaning | Exact words | Both). */
export const SEARCH_MODES: { value: SearchMode; label: string }[] = [
  { value: "dense", label: "Meaning" },
  { value: "lexical", label: "Exact words" },
  { value: "hybrid", label: "Both" },
];

/** What the tab edits; the numbers stay text while typed. */
export interface SettingsDraft {
  template: string;
  /** The reading (embedding) model, normalised ("openai/text-embedding-3-small"). */
  reading: string;
  size: string;
  overlap: string;
  /** The answer model; `null` = the account default. */
  answer: string | null;
  mode: SearchMode;
  topK: string;
  rerank: boolean;
  graph: boolean;
}

export type SettingsField = keyof SettingsDraft;

const LABELS: Record<SettingsField, string> = {
  template: "Starting point",
  reading: "Reading model",
  size: "Piece size",
  overlap: "Overlap",
  answer: "Answer model",
  mode: "Search by",
  topK: "Passages per question",
  rerank: "Look wider, then keep the best",
  graph: "Include related passages",
};

const FIELDS = Object.keys(LABELS) as SettingsField[];
const SEARCH_FIELDS: SettingsField[] = ["mode", "topK", "rerank", "graph"];
const PIECE_FIELDS: SettingsField[] = ["template", "size", "overlap"];

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** The draft a domain's stored settings open as. */
export function draftOf(d: { template: string; config: Record<string, unknown> }): SettingsDraft {
  const chunking = obj(d.config.chunking);
  const retrieval = obj(d.config.retrieval);
  const generation = obj(d.config.generation);
  const mode = str(retrieval.mode);
  return {
    template: d.template,
    reading: normalizeEmbeddingModel(str(obj(d.config.embedding).model)),
    size: String(num(chunking.size, 800)),
    overlap: String(num(chunking.overlap, 100)),
    answer: typeof generation.model === "string" && generation.model ? generation.model : null,
    mode: SEARCH_MODES.some((m) => m.value === mode) ? (mode as SearchMode) : "dense",
    topK: String(num(retrieval.top_k, 8)),
    rerank: obj(retrieval.rerank).enabled === true,
    graph: obj(retrieval.graph).enabled === true,
  };
}

/** The fields that differ from the saved settings, in the tab's order. */
export function changedFields(saved: SettingsDraft, draft: SettingsDraft): SettingsField[] {
  return FIELDS.filter((f) => String(saved[f]) !== String(draft[f]));
}

const whole = (s: string): number | null => (/^\s*\d+\s*$/.test(s) ? Number(s) : null);

/** The numbers' checks (DM-83, DM-85), in the backend's words; empty when all is well. */
export function fieldErrors(d: SettingsDraft): Partial<Record<SettingsField, string>> {
  const errors: Partial<Record<SettingsField, string>> = {};
  const size = whole(d.size);
  const sizeOk = size !== null && size >= 100 && size <= 4000;
  if (!sizeOk) errors.size = "Use a number from 100 to 4,000.";
  const overlap = whole(d.overlap);
  if (overlap === null) {
    errors.overlap = `Use a number from 0 to ${formatNumber((sizeOk ? size : 4000) - 1)}.`;
  } else if (sizeOk && overlap >= size) {
    errors.overlap = "Overlap must be smaller than the piece size.";
  }
  const k = whole(d.topK);
  if (k === null || k < 1 || k > 30) errors.topK = "Use a number from 1 to 30.";
  if (d.answer !== null && !d.answer.trim()) errors.answer = "Type the model as provider/model.";
  return errors;
}

/** How many passages "Look wider" looks at first: the saved pool, at least twice what it keeps. */
export function widerPool(topK: number, saved: unknown): number {
  return Math.max(num(saved, 20), 2 * topK);
}

/** "Looks at 20 passages first, then keeps the best 8." */
export function widerHelper(d: SettingsDraft, config: Record<string, unknown>): string {
  const k = whole(d.topK) ?? num(obj(config.retrieval).top_k, 8);
  const pool = widerPool(k, obj(obj(config.retrieval).rerank).top_n);
  return `Looks at ${formatNumber(pool)} passages first, then keeps the best ${formatNumber(k)}.`;
}

/** The settings as the PATCH sends them: the stored config with the draft laid over it. */
export function configOf(
  config: Record<string, unknown>,
  d: SettingsDraft,
): Record<string, unknown> {
  const retrieval = obj(config.retrieval);
  const embedding = obj(config.embedding);
  const topK = Number(d.topK.trim());
  const stored = str(embedding.model);
  return {
    ...config,
    chunking: {
      ...obj(config.chunking),
      size: Number(d.size.trim()),
      overlap: Number(d.overlap.trim()),
    },
    embedding: {
      ...embedding,
      // An unchanged model keeps its stored spelling ("text-embedding-3-small").
      model: normalizeEmbeddingModel(stored) === d.reading ? stored : d.reading,
    },
    retrieval: {
      ...retrieval,
      mode: d.mode,
      top_k: topK,
      rerank: {
        model: null,
        ...obj(retrieval.rerank),
        enabled: d.rerank,
        top_n: widerPool(topK, obj(retrieval.rerank).top_n),
      },
      graph: { ...obj(retrieval.graph), enabled: d.graph },
    },
    generation: { ...obj(config.generation), model: d.answer?.trim() || null },
  };
}

export type SaveAction = "save" | "run-tests" | "reread" | "pieces";

export interface SaveImpact {
  /** "1 unsaved change · Search by: Both" / "2 unsaved changes". */
  summary: string;
  /** The amber note, or null. */
  note: string | null;
  action: SaveAction;
  label: string;
}

/** What saving the draft means (DM-87): the bar's words and the primary action. */
export function saveImpact(
  saved: SettingsDraft,
  draft: SettingsDraft,
  counts: { files: number; tests: number },
): SaveImpact | null {
  const changed = changedFields(saved, draft);
  if (changed.length === 0) return null;
  let summary = `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}`;
  if (changed.length === 1) {
    const [f] = changed;
    summary += ` · ${LABELS[f]}`;
    if (f === "mode") summary += `: ${SEARCH_MODES.find((m) => m.value === draft.mode)?.label}`;
  }
  const files = counts.files;
  if (
    files > 0 &&
    changed.includes("reading") &&
    !sameReadingWeights(saved.reading, draft.reading)
  ) {
    return {
      summary,
      note: `Re-reads ${formatNumber(files)} file${files === 1 ? "" : "s"}`,
      action: "reread",
      label: "Save and re-read",
    };
  }
  if (files > 0 && changed.some((f) => PIECE_FIELDS.includes(f))) {
    return {
      summary,
      note: `Existing files keep ${formatNumber(Number(saved.size))}`,
      action: "pieces",
      label: "Save",
    };
  }
  return counts.tests > 0 && changed.some((f) => SEARCH_FIELDS.includes(f))
    ? { summary, note: "No re-read needed", action: "run-tests", label: "Save and run tests" }
    : { summary, note: "No re-read needed", action: "save", label: "Save changes" };
}

/** "Support · 600-character pieces" (the Starting point options). */
export function templateOption(
  t: Pick<DomainTemplate, "template" | "name" | "piece_size">,
): string {
  return t.piece_size
    ? `${t.name || templateLabel(t.template)} · ${pieceSizeLabel(t.piece_size)}`
    : t.name || templateLabel(t.template);
}

/** The danger card's line (DM-86 with OQ-14's honest in-use sentence). */
export function dangerText(n: number, inUse: string | null): string {
  const what =
    n === 0
      ? "Removes its chat and test questions."
      : `Removes its ${formatNumber(n)} file${n === 1 ? "" : "s"}, pieces, chat and test questions.`;
  return inUse ? `${what} ${inUse}` : what;
}

const allFiles = (n: number) => (n === 1 ? "its file" : `all ${formatNumber(n)} files`);

/** How long re-reading the domain takes with `slug`, from the pieces it has now. */
export function rereadTime(pieces: number, slug: string): string {
  return aboutMinutes(readSeconds(pieces, slug));
}

/**
 * The warn banner once a reading model with other weights is picked (DM-88): the bold lead and the
 * rest — "This re-reads all 14 files" / " with Gemini embedding-001 (about 2 minutes). Ask and team
 * lookups pause until it’s done. Your gemini key is saved."
 */
export function rereadWarning(
  files: number,
  pieces: number,
  slug: string,
  keySaved: boolean,
): { lead: string; rest: string } {
  const m = readingModel(slug);
  const key = `${m.provider} ${keyWord(m.provider)}`;
  return {
    lead: `This re-reads ${allFiles(files)}`,
    rest:
      ` with ${m.label} (${rereadTime(pieces, slug)}). Ask and team lookups pause until it’s done. ` +
      (keySaved
        ? `Your ${key} is saved.`
        : `You don’t have ${/^[aeiou]/i.test(key) ? "an" : "a"} ${key} yet.`),
  };
}

/** The re-read confirm (DM-89): its title and text. */
export function rereadDialog(
  files: number,
  pieces: number,
  slug: string,
  name: string,
): { title: string; text: string } {
  const m = readingModel(slug);
  return {
    title: files === 1 ? "Re-read its file?" : `Re-read all ${formatNumber(files)} files?`,
    text:
      `Search compares pieces read by the same model, so every file is read again with ${m.label}. ` +
      `It takes ${rereadTime(pieces, slug)}. Teams that look up ${name} meanwhile wait.`,
  };
}

/** "New files will use 400-character pieces. Your 14 existing files still use 600 until …" (DM-90). */
export function pieceDialogText(size: number, oldSize: number, files: number): string {
  const existing =
    files === 1 ? "Your existing file" : `Your ${formatNumber(files)} existing files`;
  return (
    `New files will use ${pieceSizeLabel(size)}. ${existing} still ` +
    `${files === 1 ? "uses" : "use"} ${formatNumber(oldSize)} until ${files === 1 ? "it’s" : "they’re"} read again.`
  );
}

/** The toast after saving a piece-size change (DM-90). */
export function pieceSavedToast(
  size: number,
  reread: { files: number; tests: number } | null,
): string {
  if (!reread) return `Saved. New files use ${pieceSizeLabel(size)}.`;
  const files = `Re-reading ${formatNumber(reread.files)} file${reread.files === 1 ? "" : "s"}`;
  return reread.tests > 0
    ? `Saved. ${files}, then running ${formatNumber(reread.tests)} test${reread.tests === 1 ? "" : "s"}.`
    : `Saved. ${files}.`;
}
