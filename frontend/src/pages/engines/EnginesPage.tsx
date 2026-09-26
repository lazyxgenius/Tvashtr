/**
 * Engines (spec §4.1): Overview · Subscriptions · API keys, chosen by the address
 * (`#/engines`, `#/engines/subscriptions`, `#/engines/keys`). One data provider serves all three,
 * so switching tabs never refetches and the nav badges always match the page. One Add key sheet
 * serves every "Add key" on them (ENG-61).
 */
import { useCallback, useRef, useState } from "react";

import { type EnginesTab, navigate } from "../../lib/nav";
import { AddKeySheet, type AddKeyRequest } from "./AddKeySheet";
import { type AddKeyOptions, ApiKeysPage } from "./ApiKeysPage";
import type { CellAction } from "./engineModel";
import { EnginesDataProvider } from "./enginesData";
import { OverviewPage } from "./OverviewPage";
import { SubscriptionsPage } from "./SubscriptionsPage";
import "./engines.css";

function goSubscriptions(): void {
  navigate({ page: "engines", tab: "subscriptions" });
}

function EnginesTabs({ tab, fix }: { tab: EnginesTab; fix: boolean }) {
  const [sheet, setSheet] = useState<(AddKeyRequest & { seq: number }) | null>(null);
  const seq = useRef(0);

  /** Open the Add key sheet: nothing picked, or `provider` picked in advance (ENG-74). */
  const addKey = useCallback((provider?: string, options?: AddKeyOptions) => {
    seq.current += 1;
    setSheet({
      provider,
      embeddings: options?.embeddings ?? false,
      banner: options?.banner ?? false,
      seq: seq.current,
    });
  }, []);

  /** A row's Add key opens the sheet with that provider (ENG-15); connecting, re-checking and
   *  setting up a subscription happen on Subscriptions. */
  const cellAction = useCallback(
    (action: CellAction) => {
      if (action.kind === "add-key") addKey(action.provider);
      else goSubscriptions();
    },
    [addKey],
  );

  return (
    <>
      {tab === "overview" && (
        <OverviewPage
          highlightFixes={fix}
          onAddKey={addKey}
          onCellAction={cellAction}
          onOpenSubscriptions={goSubscriptions}
        />
      )}
      {tab === "subscriptions" && <SubscriptionsPage onAddKey={(p) => addKey(p)} />}
      {tab === "keys" && <ApiKeysPage onAddKey={addKey} />}
      <AddKeySheet request={sheet} onClose={() => setSheet(null)} onAddKey={addKey} />
    </>
  );
}

export function EnginesPage({ tab, fix = false }: { tab: EnginesTab; fix?: boolean }) {
  return (
    <EnginesDataProvider>
      <EnginesTabs tab={tab} fix={fix} />
    </EnginesDataProvider>
  );
}
