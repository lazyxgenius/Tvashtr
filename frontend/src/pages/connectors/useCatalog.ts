/**
 * Browse's catalog (`GET /api/connectors/catalog`): Featured first, then the MCP Registry. The
 * search words go to the server as `q=` (a moment after the typing stops) and the category chip as
 * `category=`; "Show more" asks for the next page with the answer's `next_offset`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { type CatalogPage, listCatalog } from "../../lib/api/connectors";

const TYPING_PAUSE_MS = 250;

export interface Catalog {
  query: string;
  setQuery: (query: string) => void;
  /** The search words the list on screen answers (trimmed). */
  applied: string;
  category: string | null;
  setCategory: (category: string | null) => void;
  /** null while the first answer is on its way. */
  page: CatalogPage | null;
  failed: boolean;
  retry: () => void;
  loadingMore: boolean;
  /** The last "Show more" didn't load (until the next try, or another list). */
  moreFailed: boolean;
  more: () => void;
  /** How many connectors the whole catalog holds (null until an unfiltered answer). */
  size: number | null;
}

export function useCatalog(enabled: boolean): Catalog {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Which list is on screen: a "Show more" answer for an older one is dropped.
  const generation = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setApplied(query.trim()), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!enabled) return;
    const mine = ++generation.current;
    setFailed(false);
    setLoadingMore(false);
    setMoreFailed(false);
    listCatalog({ q: applied, category: category ?? undefined }).then(
      (next) => {
        if (generation.current !== mine) return;
        setPage(next);
        if (!applied && !category) setSize(next.total);
      },
      () => generation.current === mine && setFailed(true),
    );
  }, [enabled, applied, category, attempt]);

  const more = useCallback(() => {
    if (!page || page.next_offset === null || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreFailed(false);
    listCatalog({ q: applied, category: category ?? undefined, offset: page.next_offset }).then(
      (next) => {
        if (generation.current !== mine) return;
        setLoadingMore(false);
        setPage({ ...next, items: [...page.items, ...next.items] });
      },
      () => {
        if (generation.current !== mine) return;
        setLoadingMore(false);
        setMoreFailed(true);
      },
    );
  }, [page, applied, category, loadingMore]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    query,
    setQuery,
    applied,
    category,
    setCategory,
    page,
    failed,
    retry,
    loadingMore,
    moreFailed,
    more,
    size,
  };
}
