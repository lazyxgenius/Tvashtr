/**
 * The Engines pages' data (ENG-78/81/82): the provider directory + catalogue, the saved keys, the
 * subscription statuses (on Desktop the live bridge status wins over the server mirror; the website
 * reads the mirror and the runner's check-in) and where each provider is used. It loads when an
 * Engines page mounts and again whenever the window regains focus (team edits happen on the
 * canvas), and republishes the nav badges after every load and change.
 *
 * A failed first load is shown (`status: "error"` → "Couldn’t load your engines …" + Retry), never
 * swallowed; a failed refresh keeps the data already on screen (the header shows the backend as
 * unreachable).
 */
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  EMPTY_USAGE,
  type EngineUsage,
  type EnginesConfig,
  NO_RUNNER,
  type RunnerStatus,
  type SavedKey,
  completeStatuses,
  getEngineUsage,
  getEnginesConfig,
  getSubscriptions,
  listKeys,
  toSubscriptionStatus,
} from "../../lib/api/engines";
import { isDesktopApp } from "../../lib/desktopRepos";
import type { SubscriptionStatus } from "../../lib/engines";
import { publishBadges } from "../../lib/workspaceStatus";
import { enginesBridge, readLiveStatuses } from "./engineBridge";
import { type EngineInputs, type Surface, engineBadges } from "./engineModel";

export type LoadStatus = "loading" | "ready" | "error";

interface EnginesState {
  status: LoadStatus;
  config: EnginesConfig;
  keys: SavedKey[];
  subs: SubscriptionStatus[];
  runner: RunnerStatus;
  usage: EngineUsage;
}

export interface EnginesData extends EnginesState {
  surface: Surface;
  /** Everything `engineModel` needs, in one object. */
  inputs: EngineInputs;
  /** Reload everything (Retry, after a change elsewhere). */
  refresh: () => Promise<void>;
  /** Re-read the runner's check-in (and, on the website, the subscription mirror) only — the
   *  Subscriptions banner polls it (ENG-25). A failure keeps what is on screen. */
  refreshRunner: () => Promise<void>;
  /** Put one subscription's new status in place (a bridge push or an action's answer). */
  setSubscription: (status: SubscriptionStatus) => void;
  /** Replace the saved keys (after a save or remove) and republish the badges. */
  setKeys: (keys: SavedKey[]) => void;
}

const EMPTY_CONFIG: EnginesConfig = { directory: [], catalogue: [], embeddingPresets: [] };

const INITIAL: EnginesState = {
  status: "loading",
  config: EMPTY_CONFIG,
  keys: [],
  subs: completeStatuses([]),
  runner: NO_RUNNER,
  usage: EMPTY_USAGE,
};

const EnginesContext = createContext<EnginesData | null>(null);

function inputsOf(s: EnginesState, surface: Surface): EngineInputs {
  return {
    directory: s.config.directory,
    catalogue: s.config.catalogue,
    keys: s.keys,
    subs: s.subs,
    runner: s.runner,
    usage: s.usage,
    surface,
  };
}

export function EnginesDataProvider({ children }: { children: ReactNode }) {
  const surface: Surface = isDesktopApp() ? "desktop" : "website";
  const [state, setState] = useState<EnginesState>(INITIAL);
  const mounted = useRef(true);
  const current = useRef(state);
  current.current = state;

  const apply = useCallback(
    (next: EnginesState) => {
      if (!mounted.current) return;
      setState(next);
      if (next.status === "ready") publishBadges(engineBadges(inputsOf(next, surface)));
    },
    [surface],
  );

  const refresh = useCallback(async () => {
    const [config, keys, usage, mirror, live] = await Promise.allSettled([
      getEnginesConfig(),
      listKeys(),
      getEngineUsage(),
      getSubscriptions(),
      readLiveStatuses(),
    ]);
    const liveSubs = live.status === "fulfilled" ? live.value : null;
    const subs = liveSubs ?? (mirror.status === "fulfilled" ? mirror.value.subscriptions : null);
    if (
      config.status === "rejected" ||
      keys.status === "rejected" ||
      usage.status === "rejected" ||
      subs === null
    ) {
      // A refresh that fails keeps what is on screen; only a first load shows the error.
      const prev = current.current;
      if (prev.status !== "ready") apply({ ...prev, status: "error" });
      return;
    }
    apply({
      status: "ready",
      config: config.value,
      keys: keys.value,
      usage: usage.value,
      subs,
      runner: mirror.status === "fulfilled" ? mirror.value.runner : current.current.runner,
    });
  }, [apply]);

  const refreshRunner = useCallback(async () => {
    try {
      const mirror = await getSubscriptions();
      const prev = current.current;
      if (prev.status !== "ready") return;
      apply({
        ...prev,
        runner: mirror.runner,
        // Desktop keeps the live bridge status; the website shows the mirror (ENG-81).
        subs: surface === "desktop" ? prev.subs : mirror.subscriptions,
      });
    } catch {
      /* the header already shows the backend as unreachable */
    }
  }, [apply, surface]);

  // Load on mount, and again whenever the window regains focus (ENG-82).
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const setSubscription = useCallback(
    (status: SubscriptionStatus) => {
      const prev = current.current;
      apply({
        ...prev,
        subs: prev.subs.map((s) => (s.provider === status.provider ? status : s)),
      });
    },
    [apply],
  );

  // Desktop: the main process pushes every status change (after a Terminal sign-in, a refresh…).
  useEffect(() => {
    const engines = enginesBridge();
    if (!engines?.onStatus) return;
    return engines.onStatus((raw) => {
      const status = toSubscriptionStatus(raw);
      if (status) setSubscription(status);
    });
  }, [setSubscription]);

  const setKeys = useCallback((keys: SavedKey[]) => apply({ ...current.current, keys }), [apply]);

  const value = useMemo<EnginesData>(
    () => ({
      ...state,
      surface,
      inputs: inputsOf(state, surface),
      refresh,
      refreshRunner,
      setSubscription,
      setKeys,
    }),
    [state, surface, refresh, refreshRunner, setSubscription, setKeys],
  );
  return <EnginesContext.Provider value={value}>{children}</EnginesContext.Provider>;
}

// The provider and its hook belong together; a hook export doesn't break Fast Refresh's state.
// eslint-disable-next-line react-refresh/only-export-components
export function useEngines(): EnginesData {
  const ctx = useContext(EnginesContext);
  if (!ctx) throw new Error("useEngines() outside <EnginesDataProvider>");
  return ctx;
}
