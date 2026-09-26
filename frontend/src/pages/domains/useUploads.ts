/**
 * Adding files to a domain from its Sources tab (DM-48, DmF-Drag-1…4). Dropped or picked files are
 * checked here first (type, 10 MB): a rejected one stays as a local "Needs attention" row until
 * removed, with a toast offering "Remove it". The rest upload two at a time with progress; the
 * server starts reading each one by itself. After the batch: "<n> files added to <name>".
 *
 * This session's uploads sit on top of the table in the order they were added (Drag-2 draws the
 * new rows first); `withUploads` merges them into the server's list.
 */
import { useCallback, useRef, useState } from "react";

import { useToast } from "../../design-system/components";
import { type DomainFile, uploadDomainFile } from "../../lib/api/domains";
import { formatNumber, kindOfName, pickProblem, uploadProblem } from "./domainFormat";
import { readStamp } from "./useFileDeletes";

/** Local rows' ids start with this (they have no ⋯ actions but Remove). */
export const LOCAL_PREFIX = "local:";

export function isLocalFile(f: Pick<DomainFile, "document_id">): boolean {
  return f.document_id.startsWith(LOCAL_PREFIX);
}

export interface Upload {
  key: string;
  name: string;
  size: number;
  addedAt: string;
  /** 0–1 while uploading. */
  progress: number;
  /** Why it wasn't added (the row's reason); set = a local Needs attention row. */
  problem: string | null;
  /** The server's id once uploaded, and the `readStamp` taken then. */
  documentId: string | null;
  doneStamp: number;
}

/** A rejected file's reason in the table (DM-43). */
function rowProblem(f: { name: string; size: number }): string | null {
  const why = pickProblem(f);
  if (!why) return null;
  return why === "Over 10 MB."
    ? "Over 10 MB. Split it or compress it, then add it again."
    : "Only PDF, Markdown, text or HTML files can be read.";
}

function localRow(u: Upload): DomainFile {
  return {
    document_id: u.key,
    filename: u.name,
    byte_size: u.size,
    created_at: u.addedAt,
    version: 1,
    kind: kindOfName(u.name),
    phase: u.problem ? "needs_attention" : "uploading",
    pieces: null,
    pieces_total: 0,
    pieces_done: 0,
    progress: u.problem ? null : u.progress,
    problem: u.problem ? { kind: "local", message: u.problem, fix: null } : null,
    matched: null,
  };
}

/**
 * The table's rows: this session's uploads first (a local row until the server's list has the
 * file — `listStamp` is when that list's load started), then every other server row in order.
 * `showLocal` is false while a search or filter is on.
 */
export function withUploads(
  documents: DomainFile[],
  uploads: Upload[],
  { listStamp, showLocal }: { listStamp: number; showLocal: boolean },
): { rows: DomainFile[]; uploading: number; rejected: number } {
  const byId = new Map(documents.map((d) => [d.document_id, d]));
  const top: DomainFile[] = [];
  let uploading = 0;
  let rejected = 0;
  for (const u of uploads) {
    const server = u.documentId ? byId.get(u.documentId) : undefined;
    if (server) {
      top.push(server);
      byId.delete(server.document_id);
    } else if (showLocal && (!u.documentId || listStamp < u.doneStamp)) {
      top.push(localRow(u));
      if (u.problem) rejected += 1;
      else uploading += 1;
    }
  }
  return {
    rows: [...top, ...documents.filter((d) => byId.has(d.document_id))],
    uploading,
    rejected,
  };
}

export function useUploads({
  domainId,
  domainName,
  onUploaded,
}: {
  domainId: string;
  domainName: string;
  /** One file reached the server: reload the summary and the table. */
  onUploaded: () => void;
}) {
  const toast = useToast();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const seq = useRef(0);
  const aborts = useRef(new Map<string, () => void>());

  const patch = useCallback((key: string, next: Partial<Upload>) => {
    setUploads((us) => us.map((u) => (u.key === key ? { ...u, ...next } : u)));
  }, []);

  const remove = useCallback((key: string) => {
    aborts.current.get(key)?.();
    setUploads((us) => us.filter((u) => u.key !== key));
  }, []);

  const add = useCallback(
    async (files: File[]) => {
      const addedAt = new Date().toISOString();
      const batch = files.map((file) => {
        seq.current += 1;
        const u: Upload = {
          key: `${LOCAL_PREFIX}${seq.current}`,
          name: file.name,
          size: file.size,
          addedAt,
          progress: 0,
          problem: rowProblem(file),
          documentId: null,
          doneStamp: 0,
        };
        return { u, file };
      });
      if (batch.length === 0) return;
      setUploads((us) => [...batch.map((b) => b.u), ...us]);
      for (const { u, file } of batch) {
        if (!u.problem) continue;
        toast({
          message: uploadProblem(file),
          tone: "error",
          action: { label: "Remove it", onClick: () => remove(u.key) },
        });
      }
      const queue = batch.filter((b) => !b.u.problem);
      let added = 0;
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const { u, file } = next;
          const up = uploadDomainFile(domainId, file, (progress) => patch(u.key, { progress }));
          aborts.current.set(u.key, up.abort);
          try {
            const doc = await up.done;
            added += 1;
            patch(u.key, { documentId: doc.document_id, progress: 1, doneStamp: readStamp() });
            onUploaded();
          } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") continue;
            const why = e instanceof Error && e.message ? e.message : "The upload failed.";
            patch(u.key, { problem: `Couldn’t add this file: ${why.replace(/\.$/, "")}.` });
            toast({
              message: `${u.name} wasn’t added. ${why}`,
              tone: "error",
              action: { label: "Remove it", onClick: () => remove(u.key) },
            });
          } finally {
            aborts.current.delete(u.key);
          }
        }
      };
      await Promise.all([worker(), worker()]);
      if (added > 0) {
        toast({
          message: `${added === 1 ? "1 file" : `${formatNumber(added)} files`} added to ${domainName}`,
        });
      }
    },
    [domainId, domainName, onUploaded, patch, remove, toast],
  );

  return { uploads, add, remove, busy: uploads.some((u) => !u.problem && !u.documentId) };
}
