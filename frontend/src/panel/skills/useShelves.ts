import { useCallback, useEffect, useState } from "react";

import {
  type SkillLibraryItem,
  type ToolLibraryItem,
  listSecrets,
  listSkillLibrary,
  listToolLibrary,
} from "../../lib/api";

export interface Shelves {
  /** The account's library skills and tools and its secret names; null while unknown. */
  skillLibrary: SkillLibraryItem[] | null;
  toolLibrary: ToolLibraryItem[] | null;
  secrets: string[] | null;
  /** Library shelves that failed to load; `retry` loads every shelf again. */
  failed: { skillLibrary: boolean; toolLibrary: boolean };
  retry: () => void;
  /** Items this drawer just put in the library (a preset's copy), so their rows are named. */
  addSkillItems: (items: SkillLibraryItem[]) => void;
}

/**
 * The shelves the Skills & tools tab and its add views read, loaded once the tab is first shown
 * (`enabled`). A shelf that fails to load leaves its rows generic ("Library skill"); the library
 * pickers say so and offer Try again (`failed` / `retry`).
 */
export function useShelves(enabled: boolean): Shelves {
  const [skillLibrary, setSkillLibrary] = useState<SkillLibraryItem[] | null>(null);
  const [toolLibrary, setToolLibrary] = useState<ToolLibraryItem[] | null>(null);
  const [secrets, setSecrets] = useState<string[] | null>(null);
  const [failed, setFailed] = useState({ skillLibrary: false, toolLibrary: false });
  // 0 = not wanted yet; each retry bumps it and loads again.
  const [attempt, setAttempt] = useState(0);
  if (enabled && attempt === 0) setAttempt(1);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (attempt === 0) return;
    let live = true;
    const fail = (shelf: "skillLibrary" | "toolLibrary") => () => {
      if (live) setFailed((f) => ({ ...f, [shelf]: true }));
    };
    setFailed({ skillLibrary: false, toolLibrary: false });
    listSkillLibrary()
      .then((v) => live && setSkillLibrary(v))
      .catch(fail("skillLibrary"));
    listToolLibrary()
      .then((v) => live && setToolLibrary(v))
      .catch(fail("toolLibrary"));
    listSecrets()
      .then((v) => live && setSecrets(v.map((s) => s.name)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [attempt]);

  const addSkillItems = useCallback((items: SkillLibraryItem[]) => {
    setSkillLibrary((prev) => [
      ...(prev ?? []).filter((x) => !items.some((i) => i.id === x.id)),
      ...items,
    ]);
  }, []);

  return { skillLibrary, toolLibrary, secrets, failed, retry, addSkillItems };
}
