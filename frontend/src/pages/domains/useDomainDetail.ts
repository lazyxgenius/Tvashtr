/**
 * One domain's summary for its page, kept live (DM-4): loaded on mount and on window focus, and
 * every 3 s while its files are being read (or `busy` says the Sources table still is). `tick`
 * counts the loads, so the Sources table reloads on the same beat and the counts in the tabs,
 * strip, header and table always move together. A load also refreshes this domain's nav dot.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "../../lib/api";
import { type DomainDetailView, getDomainDetail } from "../../lib/api/domains";
import { publishBadges, useNavBadges } from "../../lib/workspaceStatus";
import { isReading } from "./domainFormat";
import { DOMAIN_POLL_MS } from "./useDomainList";
import { readStamp } from "./useFileDeletes";

export function useDomainDetail(
  domainId: string,
  { busy = false }: { busy?: boolean } = {},
): {
  detail: DomainDetailView | null;
  /** The domain doesn't exist (any more) or isn't this account's. */
  missing: boolean;
  error: string | null;
  tick: number;
  /** When the shown summary's load started (`readStamp`), for the deferred file deletes. */
  stamp: number;
  reload: () => Promise<void>;
} {
  const [detail, setDetail] = useState<DomainDetailView | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [stamp, setStamp] = useState(0);
  const live = useRef(true);
  const nav = useNavBadges().domains;
  const navRef = useRef(nav);
  navRef.current = nav;

  const reload = useCallback(async () => {
    const started = readStamp();
    try {
      const d = await getDomainDetail(domainId);
      if (!live.current) return;
      setDetail(d);
      setStamp(started);
      setMissing(false);
      setError(null);
      setTick((t) => t + 1);
      // Keep this domain's nav row (name + status dot) in step with the page.
      const rows = navRef.current;
      const row = rows?.find((r) => r.id === d.domain_id);
      if (rows && row && (row.state !== d.state || row.name !== d.name)) {
        publishBadges({
          domains: rows.map((r) =>
            r.id === d.domain_id ? { ...r, name: d.name, state: d.state } : r,
          ),
        });
      }
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      else setError(e instanceof Error && e.message ? e.message : "Couldn’t load this domain.");
    }
  }, [domainId]);

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

  const polling = busy || (detail ? isReading(detail) : false);
  useEffect(() => {
    if (!polling) return;
    const t = window.setInterval(() => void reload(), DOMAIN_POLL_MS);
    return () => window.clearInterval(t);
  }, [polling, reload]);

  return { detail, missing, error, tick, stamp, reload };
}
