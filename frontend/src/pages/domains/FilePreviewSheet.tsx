/**
 * A file's pieces (DM-51, DmF-Preview-2): the right sheet (560) with the file's name, kind, size,
 * pieces and date, "Find in this file", the piece cards (50 at a time), how often recent answers
 * cited it, Download original and Re-read. `piece` scrolls to and marks one piece (from Ask).
 */
import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";

import { Button, ButtonLink, Input, Sheet } from "../../design-system/components";
import { type DomainFilePieces, domainFileUrl, getDomainFilePieces } from "../../lib/api/domains";
import { formatAdded, formatNumber, formatSize, kindName, pieceExcerpt } from "./domainFormat";

const PAGE = 50;
/** The most pieces the API serves at once. */
const MAX_PAGE = 200;
const FIND_DELAY_MS = 250;

export function FilePreviewSheet({
  domainId,
  documentId,
  piece,
  fallbackName,
  now,
  onClose,
  onReread,
}: {
  domainId: string;
  documentId: string;
  piece?: number;
  /** The file's name from the table, shown while its pieces load. */
  fallbackName: string;
  now: Date;
  onClose: () => void;
  onReread: (documentId: string, filename: string) => void;
}) {
  const [data, setData] = useState<DomainFilePieces | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [query, setQuery] = useState("");
  const [more, setMore] = useState(false);
  // The offset of the first piece loaded: a piece opened from Ask past the first 200 (the most the
  // API serves at once) loads from that piece, with earlier pieces a click away.
  const [first, setFirst] = useState(0);
  const marked = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(find.trim()), FIND_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [find]);

  useEffect(() => {
    let live = true;
    // Enough of the first page to reach a piece opened from Ask (the API serves 200 at most).
    const start = !query && piece !== undefined && piece > MAX_PAGE ? piece - 1 : 0;
    const limit = start ? PAGE : Math.min(MAX_PAGE, Math.max(PAGE, piece ?? 0));
    getDomainFilePieces(domainId, documentId, { q: query, offset: start || undefined, limit })
      .then((d) => {
        if (!live) return;
        setData(d);
        setFirst(start);
        setError(null);
      })
      .catch((e: unknown) => {
        if (live)
          setError(e instanceof Error && e.message ? e.message : "Couldn’t load this file.");
      });
    return () => {
      live = false;
    };
  }, [domainId, documentId, query, piece]);

  const showMore = () => {
    if (!data || more) return;
    setMore(true);
    getDomainFilePieces(domainId, documentId, {
      q: query,
      offset: first + data.pieces.length,
      limit: PAGE,
    })
      .then((next) =>
        setData((cur) => (cur ? { ...next, pieces: [...cur.pieces, ...next.pieces] } : next)),
      )
      .catch(() => undefined)
      .finally(() => setMore(false));
  };

  const showEarlier = () => {
    if (!data || more || first === 0) return;
    const from = Math.max(0, first - PAGE);
    setMore(true);
    getDomainFilePieces(domainId, documentId, { q: query, offset: from, limit: first - from })
      .then((prev) => {
        setData((cur) => (cur ? { ...cur, pieces: [...prev.pieces, ...cur.pieces] } : prev));
        setFirst(from);
      })
      .catch(() => undefined)
      .finally(() => setMore(false));
  };

  useEffect(() => {
    if (piece !== undefined && data) marked.current?.scrollIntoView?.({ block: "center" });
  }, [piece, data]);

  const doc = data?.document;
  const name = doc?.filename ?? fallbackName;
  const subtitle = doc
    ? [
        kindName(doc.kind),
        formatSize(doc.byte_size),
        doc.pieces === null
          ? null
          : `${formatNumber(doc.pieces)} ${doc.pieces === 1 ? "piece" : "pieces"}`,
        `added ${formatAdded(doc.created_at, now).replace("Just now", "just now")}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const used = data?.used_in_answers;
  const ofTotal = doc?.pieces_total ?? 0;

  return (
    <Sheet
      open
      width={560}
      title={name}
      subtitle={subtitle}
      onClose={onClose}
      footerNote={
        used && used.of > 0
          ? `Used in ${formatNumber(used.count)} of the last ${formatNumber(used.of)} ${
              used.of === 1 ? "answer" : "answers"
            }`
          : undefined
      }
      footer={
        <>
          {/* Same window, never a new one: on Desktop a new window opens in the system browser,
              which has no session (D2). */}
          <ButtonLink
            variant="ghost"
            size="sm"
            className="dm-btn-inline"
            href={domainFileUrl(domainId, documentId)}
            download={name}
          >
            <Download size={15} strokeWidth={1.6} aria-hidden />
            <span>Download original</span>
          </ButtonLink>
          <Button
            variant="secondary"
            size="sm"
            className="dm-btn-inline"
            onClick={() => onReread(documentId, name)}
          >
            <RefreshCw size={15} strokeWidth={1.6} aria-hidden />
            <span>Re-read</span>
          </Button>
        </>
      }
    >
      <div className="dm-find">
        <Input
          size="sm"
          placeholder="Find in this file"
          aria-label="Find in this file"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
      </div>
      {error && (
        <p className="dm-preview__note" role="alert">
          {error}
        </p>
      )}
      {data && data.pieces.length === 0 && (
        <p className="dm-preview__note">
          {query
            ? `No pieces mention “${query}”.`
            : doc?.phase === "ready"
              ? "This file has no pieces."
              : "Its pieces show here once it has been read."}
        </p>
      )}
      {data && data.pieces.length > 0 && first > 0 && (
        <div>
          <Button variant="ghost" size="sm" loading={more} onClick={showEarlier}>
            Show earlier pieces
          </Button>
        </div>
      )}
      {data && data.pieces.length > 0 && (
        <ul className="dm-pieces">
          {data.pieces.map((p) => (
            <li
              key={p.number}
              ref={p.number === piece ? marked : undefined}
              className={p.number === piece ? "dm-piece dm-piece--marked" : "dm-piece"}
            >
              <div className="dm-piece__head">
                <span className="dm-piece__label">
                  Piece {formatNumber(p.number)} of {formatNumber(ofTotal)}
                </span>
                <span className="dm-piece__chars">
                  {p.page !== null && `page ${p.page} · `}
                  {formatNumber(p.chars)} characters
                </span>
              </div>
              <div className="dm-piece__text">{pieceExcerpt(p.text, p.number, query)}</div>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > first + data.pieces.length && (
        <div>
          <Button variant="ghost" size="sm" loading={more} onClick={showMore}>
            Show more
          </Button>
        </div>
      )}
    </Sheet>
  );
}
