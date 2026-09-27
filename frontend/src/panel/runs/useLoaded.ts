import { useCallback, useEffect, useState } from "react";

export interface Loaded<T> {
  /** "idle" while `key` is null (nothing to load). */
  state: "idle" | "loading" | "error" | "ready";
  value: T | null;
  retry: () => void;
}

/**
 * Load `load()` whenever `key` changes (null: don't). The Runs tab keys this agent's history on its
 * last run, so a finished round reloads it; the Docs tab keys a run's documents on the run.
 * `keep`: while a new key loads, `value` stays the last answer (state "loading"), so nothing blinks.
 */
export function useLoaded<T>(
  key: string | null,
  load: () => Promise<T>,
  { keep = false }: { keep?: boolean } = {},
): Loaded<T> {
  const [result, setResult] = useState<{ key: string; value: T | null; failed: boolean } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (key === null) return;
    let live = true;
    load().then(
      (value) => live && setResult({ key, value, failed: false }),
      () => live && setResult({ key, value: null, failed: true }),
    );
    return () => {
      live = false;
    };
    // `load` reads the same inputs `key` names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => {
    setResult(null);
    setAttempt((a) => a + 1);
  }, []);

  const mine = result !== null && result.key === key ? result : null;
  const state = key === null ? "idle" : !mine ? "loading" : mine.failed ? "error" : "ready";
  const kept = keep && key !== null && !mine && result && !result.failed ? result.value : null;
  return { state, value: mine?.value ?? kept, retry };
}
