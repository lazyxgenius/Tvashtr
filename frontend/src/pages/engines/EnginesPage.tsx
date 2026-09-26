/**
 * Engines (spec §4.1): Overview · Subscriptions · API keys, chosen by the address
 * (`#/engines`, `#/engines/subscriptions`, `#/engines/keys`). One data provider serves all three,
 * so switching tabs never refetches and the nav badges always match the page.
 */
import { type EnginesTab, navigate } from "../../lib/nav";
import type { CellAction } from "./engineModel";
import { EnginesDataProvider } from "./enginesData";
import { EnginesHead } from "./enginesUi";
import { OverviewPage } from "./OverviewPage";
import "./engines.css";

function goSubscriptions(): void {
  navigate({ page: "engines", tab: "subscriptions" });
}

/** Where a key is added. The API keys page is where keys live. */
function addKey(): void {
  navigate({ page: "engines", tab: "keys" });
}

/** Connecting, re-checking and setting up a subscription happen on Subscriptions. */
function cellAction(action: CellAction): void {
  if (action.kind === "add-key") addKey();
  else goSubscriptions();
}

export function EnginesPage({ tab, fix = false }: { tab: EnginesTab; fix?: boolean }) {
  return (
    <EnginesDataProvider>
      {tab === "overview" && (
        <OverviewPage
          highlightFixes={fix}
          onAddKey={addKey}
          onCellAction={cellAction}
          onOpenSubscriptions={goSubscriptions}
        />
      )}
      {tab === "subscriptions" && (
        <EnginesHead
          title="Subscriptions"
          lede="Run agents on your own Claude or Grok plan, from Tvashtr Desktop."
        />
      )}
      {tab === "keys" && (
        <EnginesHead
          title="API keys"
          lede="Stored encrypted for your account. We only ever show the last 4 characters. Keys work on the website and on Tvashtr Desktop."
        />
      )}
    </EnginesDataProvider>
  );
}
