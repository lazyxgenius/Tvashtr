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
  /** Items this drawer just put in the library (a preset's copy), so their rows are named. */
  addSkillItems: (items: SkillLibraryItem[]) => void;
}

/**
 * The shelves the Skills & tools tab and its add views read, loaded once the tab is first shown
 * (`enabled`). A shelf that fails to load leaves its rows generic ("Library skill"), nothing more.
 */
export function useShelves(enabled: boolean): Shelves {
  const [skillLibrary, setSkillLibrary] = useState<SkillLibraryItem[] | null>(null);
  const [toolLibrary, setToolLibrary] = useState<ToolLibraryItem[] | null>(null);
  const [secrets, setSecrets] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  if (enabled && !loaded) setLoaded(true);

  useEffect(() => {
    if (!loaded) return;
    let live = true;
    listSkillLibrary()
      .then((v) => live && setSkillLibrary(v))
      .catch(() => {});
    listToolLibrary()
      .then((v) => live && setToolLibrary(v))
      .catch(() => {});
    listSecrets()
      .then((v) => live && setSecrets(v.map((s) => s.name)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [loaded]);

  const addSkillItems = useCallback((items: SkillLibraryItem[]) => {
    setSkillLibrary((prev) => [
      ...(prev ?? []).filter((x) => !items.some((i) => i.id === x.id)),
      ...items,
    ]);
  }, []);

  return { skillLibrary, toolLibrary, secrets, addSkillItems };
}
