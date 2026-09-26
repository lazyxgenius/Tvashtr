/**
 * The Settings tab's draft (DM-87): only the fields that differ from the saved settings, kept per
 * domain while the app is open — leave the tab and come back, the unsaved changes are still there.
 */
import { useState } from "react";

import type { SettingsDraft } from "./settingsFormat";

/** Unsaved edits per domain, kept while the app is open (only the fields that differ). */
const kept = new Map<string, Partial<SettingsDraft>>();

export function useDomainSettingsDraft(domainId: string, saved: SettingsDraft) {
  const [edits, setEdits] = useState<Partial<SettingsDraft>>(() => kept.get(domainId) ?? {});
  const set = (patch: Partial<SettingsDraft>) =>
    setEdits((e) => {
      const next: Partial<SettingsDraft> = { ...e, ...patch };
      for (const k of Object.keys(next) as (keyof SettingsDraft)[]) {
        if (String(next[k]) === String(saved[k])) delete next[k];
      }
      kept.set(domainId, next);
      return next;
    });
  const reset = () => {
    kept.delete(domainId);
    setEdits({});
  };
  return { draft: { ...saved, ...edits }, set, reset };
}

export function __resetSettingsDraftsForTests(): void {
  kept.clear();
}
