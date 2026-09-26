/**
 * "Add key" requests that can outlive the Engines page. A toast's action ("Add xai" after a save,
 * "Add anthropic key" after a disconnect) stays up for 8s — long enough for the user to leave
 * Engines. The mounted Engines page listens and opens its sheet; when none is mounted, the request
 * waits here, the page goes back to Engines, and Engines opens the sheet as it mounts.
 */
import { type EnginesTab, navigate } from "../../lib/nav";
import type { AddKeyOptions } from "./ApiKeysPage";

type OpenSheet = (provider: string | undefined, options: AddKeyOptions | undefined) => void;

let listener: OpenSheet | null = null;
let pending: { provider?: string; options?: AddKeyOptions } | null = null;

/** The mounted Engines page opens the sheet for every request (and one left waiting). */
export function listenForAddKey(open: OpenSheet): () => void {
  listener = open;
  if (pending) {
    const { provider, options } = pending;
    pending = null;
    open(provider, options);
  }
  return () => {
    if (listener === open) listener = null;
  };
}

/** Open the Add key sheet — on this Engines page, or back on Engines (`tab`) if the user left. */
export function requestAddKey(
  provider: string | undefined,
  options: AddKeyOptions | undefined,
  tab: EnginesTab,
): void {
  if (listener) {
    listener(provider, options);
    return;
  }
  pending = { provider, options };
  navigate({ page: "engines", tab });
}

export function __resetAddKeyRequestsForTests(): void {
  listener = null;
  pending = null;
}
