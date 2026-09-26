/**
 * The account's domains with their summaries, kept live (DM-4): loaded on mount and on window
 * focus, and every 3 s while any domain is being read. Each load also refreshes the nav's domain
 * rows and status dots, so the list and the nav never disagree.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { type DomainListItem, listDomainSummaries } from "../../lib/api/domains";
import { publishBadges } from "../../lib/workspaceStatus";
import { isReading } from "./domainFormat";

export const DOMAIN_POLL_MS = 3000;

export function publishDomainNav(items: DomainListItem[]): void {
  publishBadges({
    domains: items.map((d) => ({ id: d.domain_id, name: d.name, state: d.state })),
  });
}

export function useDomainList(): {
  items: DomainListItem[] | null;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [items, setItems] = useState<DomainListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);

  const reload = useCallback(async () => {
    try {
      const list = await listDomainSummaries();
      if (!live.current) return;
      setItems(list);
      setError(null);
      publishDomainNav(list);
    } catch (e) {
      if (!live.current) return;
      setError(e instanceof Error && e.message ? e.message : "Couldn’t load your domains.");
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      live.current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  const busy = items?.some(isReading) ?? false;
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => void reload(), DOMAIN_POLL_MS);
    return () => window.clearInterval(t);
  }, [busy, reload]);

  return { items, error, reload };
}
