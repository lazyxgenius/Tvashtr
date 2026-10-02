/** M6 Agents-Recent: the composer's Recent tasks state (the list itself is `RecentTasks.tsx`). */
import { type KeyboardEvent, useEffect, useId, useState } from "react";

import { listRecentTasks, type RecentTask } from "../../lib/api/myAgents";

/** Typed this many characters before the list asks. */
const MIN_CHARS = 2;
const DEBOUNCE_MS = 150;

export interface RecentTasksApi {
  open: boolean;
  tasks: RecentTask[];
  active: number;
  setActive: (i: number) => void;
  listId: string;
  optionId: (i: number) => string;
  /** The textarea's ARIA (a combobox's: expanded, the list it controls, the chosen row) and its
   *  focus handlers (the list shows only while the box has focus). */
  comboProps: {
    "aria-autocomplete": "list";
    "aria-expanded": boolean;
    "aria-controls"?: string;
    "aria-activedescendant"?: string;
    onFocus: () => void;
    onBlur: () => void;
  };
  /** A real keystroke changed the text (the textarea's onChange). */
  onTyped: () => void;
  /** The text was set for the person (Retry, Run again, a launch): no list until they type. */
  reset: () => void;
  /** ↑ ↓ Enter Esc while the list is open; true when the key was taken. */
  onKeyDown: (e: KeyboardEvent) => boolean;
  pick: (t: RecentTask) => void;
}

/**
 * M6 Agents-Recent: the account's recent tasks matching what's typed (≥ 2 characters, 150ms after
 * the last keystroke), shown only while the idea box has focus and after a real keystroke (not
 * when Retry fills it). No row is chosen until ↑ / ↓ or a hover, so a plain Enter with none keeps
 * the textarea's own behaviour; Esc closes the list until the text changes again.
 */
export function useRecentTasks(query: string, onPick: (t: RecentTask) => void): RecentTasksApi {
  const [found, setFound] = useState<{ q: string; tasks: RecentTask[] }>({ q: "", tasks: [] });
  const [active, setActive] = useState(-1);
  // The text the list was closed at (Esc, or a pick): it stays closed until the text changes.
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [typed, setTyped] = useState(false);
  const [focused, setFocused] = useState(false);
  const listId = useId();
  const q = query.trim();

  useEffect(() => {
    if (!typed || q.length < MIN_CHARS) return;
    let live = true;
    const t = window.setTimeout(() => {
      listRecentTasks(q).then(
        (tasks) => live && setFound({ q, tasks }),
        () => live && setFound({ q, tasks: [] }),
      );
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q, typed]);

  // New text or a new answer starts with no row chosen.
  const [seen, setSeen] = useState({ q, found });
  if (seen.q !== q || seen.found !== found) {
    setSeen({ q, found });
    setActive(-1);
  }

  // Only the answer for this text (never the last text's rows while the new ones are on the way).
  const tasks = typed && q.length >= MIN_CHARS && found.q === q ? found.tasks : [];
  const open = focused && tasks.length > 0 && closedAt !== query;
  const optionId = (i: number) => `${listId}-${i}`;
  const pick = (t: RecentTask) => {
    setClosedAt(t.task);
    setTyped(false);
    onPick(t);
  };
  const onKeyDown = (e: KeyboardEvent): boolean => {
    // An IME is composing: its keys are the IME's.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return false;
    if (!open) return false;
    const n = tasks.length;
    if (e.key === "ArrowDown") setActive((active + 1) % n);
    else if (e.key === "ArrowUp") setActive(active <= 0 ? n - 1 : active - 1);
    else if (e.key === "Escape") setClosedAt(query);
    else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey && active >= 0)
      pick(tasks[active]);
    else return false;
    e.preventDefault();
    return true;
  };
  return {
    open,
    tasks,
    active: open ? active : -1,
    setActive,
    listId,
    optionId,
    comboProps: {
      "aria-autocomplete": "list",
      "aria-expanded": open,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open && active >= 0 ? optionId(active) : undefined,
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
    onTyped: () => setTyped(true),
    reset: () => setTyped(false),
    onKeyDown,
    pick,
  };
}
