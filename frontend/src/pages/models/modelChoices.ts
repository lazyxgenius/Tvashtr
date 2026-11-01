/** What the Run dialog and the judge picker offer: the catalogue and the keys the account holds. */
import { useCallback, useEffect, useState } from "react";

import { type ProviderCatalogueEntry, getConfig, listProviders } from "../../lib/api";
import { requestAddKeys } from "../home/homeData";

export function useModelChoices(): {
  catalogue: ProviderCatalogueEntry[];
  held: string[] | null;
  reload: () => void;
} {
  const [catalogue, setCatalogue] = useState<ProviderCatalogueEntry[]>([]);
  const [held, setHeld] = useState<string[] | null>(null);
  const reload = useCallback(() => {
    listProviders()
      .then((ps) => setHeld(ps.map((p) => p.provider)))
      .catch(() => setHeld((h) => h ?? []));
  }, []);
  useEffect(() => {
    let live = true;
    getConfig()
      .then((c) => live && setCatalogue(c.provider_catalogue))
      .catch(() => undefined);
    reload();
    return () => {
      live = false;
    };
  }, [reload]);
  return { catalogue, held, reload };
}

/** Open the Add-key sheet in place for `provider`, to test `slug`. */
export function requestModelKey(provider: string, slug: string, onDone: () => void): void {
  requestAddKeys({
    teamName: "Models",
    providers: [provider],
    subtitle: `So Models can test ${slug}`,
    note: "Used by Models · running tests",
    examples: { [provider]: slug },
    savedMessage: (p) => `Key saved. Models can run on ${p}.`,
    plain: true,
    onDone,
  });
}
