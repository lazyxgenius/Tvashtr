/**
 * The Add-key sheet on a domain's page (DM-25, DM-66): Ask's **Add <p> key** and the Settings
 * warning open the F2 `AddKeySheet` in place, so the page — and a question being typed — stays.
 * `DomainDetailPage` mounts the sheet once; the tabs call `requestDomainKey`.
 */
import { useEffect, useState } from "react";

import { type ProviderDirectoryEntry, getHomeConfig } from "../../lib/api/home";
import { isDesktopApp } from "../../lib/desktopRepos";
import { AddKeySheet } from "../home/AddKeySheet";
import { requestAddKeys } from "../home/homeData";
import { ANSWER_MODELS } from "./answerModels";
import { READING_MODELS, keySavedToast } from "./readingModels";

/** The providers Domains can read or answer with (never NVIDIA NIM). */
const DOMAIN_PROVIDERS = new Set<string>([
  ...READING_MODELS.map((m) => m.provider),
  ...ANSWER_MODELS.flatMap((m) => (m.provider ? [m.provider] : [])),
]);

export function DomainKeySheet() {
  const [directory, setDirectory] = useState<ProviderDirectoryEntry[]>([]);
  useEffect(() => {
    let live = true;
    getHomeConfig()
      .then(
        (c) =>
          live &&
          setDirectory(c.provider_directory.filter((d) => DOMAIN_PROVIDERS.has(d.provider))),
      )
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return <AddKeySheet directory={directory} desktop={isDesktopApp()} />;
}

/** Open the sheet for `provider`'s key, used to read files or to write answers with `model`. */
// eslint-disable-next-line react-refresh/only-export-components -- the sheet's one entry point
export function requestDomainKey(
  provider: string,
  use: "reading" | "answering",
  model: string,
  onDone?: () => void,
): void {
  const models = use === "reading" ? READING_MODELS : ANSWER_MODELS;
  const example = models.find((m) => m.provider === provider)?.slug;
  requestAddKeys({
    teamName: "Domains",
    providers: [provider],
    subtitle:
      use === "reading"
        ? `So Domains can read files with ${model}`
        : `So Domains can write answers with ${model}`,
    note: use === "reading" ? "Used by Domains · reading files" : "Used by Domains · answering",
    examples: example ? { [provider]: example } : undefined,
    savedMessage: keySavedToast,
    plain: true,
    onDone,
  });
}
