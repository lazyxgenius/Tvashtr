/**
 * What the document viewer and the focus view's Docs tab show (DOCS-18..36): which version, which
 * one it's compared with, and the header's lines.
 */
import type { DocDetail, DocVersion, RunDoc, RunDocAgent } from "../../lib/api/docs";
import { joinAnd } from "../nodeActions";

/** Where a reader is: a version (none = the latest) and, comparing, the version it's compared with. */
export interface DocPlace {
  version?: number;
  compare?: number;
}

/** The latest version, the one shown (DOCS-22) and the one it's compared with (DOCS-36). */
export function pickVersions(
  versions: readonly DocVersion[],
  place: DocPlace,
): { latest: DocVersion | null; selected: DocVersion | null; from: DocVersion | null } {
  const latest = versions.at(-1) ?? null;
  const selected = versions.find((v) => v.version_no === place.version) ?? latest;
  const from =
    place.compare !== undefined && place.compare !== selected?.version_no
      ? (versions.find((v) => v.version_no === place.compare) ?? null)
      : null;
  return { latest, selected, from };
}

/** Compare starts from the version before the shown one (the next one when it's the first). */
export function compareFrom(versions: readonly DocVersion[], shown: number): number | undefined {
  const i = versions.findIndex((v) => v.version_no === shown);
  return (versions[i - 1] ?? versions[i + 1])?.version_no;
}

/** "Shared spec" for the run's spec, else the document's name. */
export const detailLabel = (doc: Pick<DocDetail, "is_shared_spec" | "name">): string =>
  doc.is_shared_spec ? "Shared spec" : doc.name;

/** The agents that read a document without writing it (the "Read by" badges, OQ-12). */
export function readersOnly(doc: RunDoc): RunDocAgent[] {
  const writers = new Set(doc.written_by.map((a) => a.node_id));
  return doc.read_by.filter((a) => !writers.has(a.node_id));
}

/** Who writes a document: its writers, else whoever wrote its latest version. */
export function writerName(doc: RunDoc): string {
  if (doc.written_by.length > 0) return joinAnd(doc.written_by.map((a) => a.label));
  return doc.latest_version?.author?.label ?? "No one";
}

/** The viewer's subtitle (DOCS-18). */
export function docSubtitle(detail: DocDetail, doc: RunDoc | null): string {
  if (detail.is_shared_spec) return "The PRD for this run · everyone reads it";
  if (!doc) return "";
  const readers = readersOnly(doc);
  const read = readers.length > 0 ? ` · read by ${joinAnd(readers.map((a) => a.label))}` : "";
  return `Written by ${writerName(doc)}${read}`;
}

/** "Product manager · Updated acceptance after review" under a version (DOCS-22). */
export const versionNote = (v: DocVersion): string =>
  [v.author?.label ?? "Agent", v.note].filter(Boolean).join(" · ");
