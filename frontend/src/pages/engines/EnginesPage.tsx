/**
 * Engines (spec §4.1): Overview · Subscriptions · API keys, chosen by the address
 * (`#/engines`, `#/engines/subscriptions`, `#/engines/keys`). One data provider serves all three,
 * so switching tabs never refetches and the nav badges always match the page. One Add key sheet
 * serves every "Add key" on them (ENG-61), and one pair of dialogs every website "Open Tvashtr
 * Desktop" / "Open in Desktop" (ENG-48) and "Download" (ENG-47).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { openTvashtrDesktop } from "../../lib/desktopDeepLinks";
import { type ConnectTarget, type EnginesTab, navigate } from "../../lib/nav";
import { AddKeySheet, type AddKeyRequest } from "./AddKeySheet";
import { type AddKeyOptions, ApiKeysPage } from "./ApiKeysPage";
import { GetDesktopDialog, OpenDesktopDialog } from "./DesktopDialogs";
import { enginesBridge } from "./engineBridge";
import type { CellAction } from "./engineModel";
import { EnginesDataProvider, useEngines } from "./enginesData";
import { OverviewPage, type RowFlash } from "./OverviewPage";
import { SubscriptionsPage } from "./SubscriptionsPage";
import { useRowConnect } from "./useRowConnect";
import "./engines.css";

/** How long a changed row stays highlighted before it fades (ENG-23). */
const ROW_FLASH_MS = 2400;

function goSubscriptions(): void {
  navigate({ page: "engines", tab: "subscriptions" });
}

type DesktopDialog = { kind: "open"; connect: ConnectTarget | null } | { kind: "get" };

function EnginesTabs({
  tab,
  fix,
  connect,
}: {
  tab: EnginesTab;
  fix: boolean;
  connect: ConnectTarget | null;
}) {
  const [sheet, setSheet] = useState<(AddKeyRequest & { seq: number }) | null>(null);
  const [desktop, setDesktop] = useState<(DesktopDialog & { seq: number }) | null>(null);
  const [flash, setFlash] = useState<RowFlash | null>(null);
  const seq = useRef(0);
  const { surface } = useEngines();

  const flashRows = useCallback((providers: readonly string[]) => {
    if (!providers.length) return;
    seq.current += 1;
    setFlash({ providers, seq: seq.current });
  }, []);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), ROW_FLASH_MS);
    return () => window.clearTimeout(t);
  }, [flash]);
  const flashSaved = useCallback((provider: string) => flashRows([provider]), [flashRows]);

  const rowConnect = useRowConnect(flashRows);

  /** Hand `tvashtr://…` to the browser (inside the click, so the browser lets it through), then
   *  say what happens next. `sub` points Desktop at that card. */
  const openDesktop = useCallback((sub?: ConnectTarget | null) => {
    openTvashtrDesktop(sub);
    seq.current += 1;
    setDesktop({ kind: "open", connect: sub ?? null, seq: seq.current });
  }, []);

  const getDesktop = useCallback(() => {
    seq.current += 1;
    setDesktop({ kind: "get", seq: seq.current });
  }, []);
  const closeDesktop = useCallback(() => setDesktop(null), []);

  /** Open the Add key sheet: nothing picked, or `provider` picked in advance (ENG-74). */
  const addKey = useCallback((provider?: string, options?: AddKeyOptions) => {
    seq.current += 1;
    setSheet({
      provider,
      embeddings: options?.embeddings ?? false,
      banner: options?.banner ?? false,
      row: options?.row ?? false,
      seq: seq.current,
    });
  }, []);

  /** A row's Add key opens the sheet with that provider (ENG-15); a row's Connect on Desktop signs
   *  in from the row (ENG-16); the website's Open in Desktop opens Desktop on that subscription
   *  (OQ-2); re-checking and setting up a subscription happen on Subscriptions. */
  const connectRow = rowConnect.connect;
  const cellAction = useCallback(
    (action: CellAction) => {
      if (action.kind === "add-key") addKey(action.provider, { row: true });
      else if (action.kind === "open-desktop") openDesktop(connectTargetOf(action.sub));
      else if (
        action.kind === "connect" &&
        action.sub &&
        surface === "desktop" &&
        enginesBridge()?.connect
      )
        connectRow(action.sub);
      else goSubscriptions();
    },
    [addKey, openDesktop, connectRow, surface],
  );

  return (
    <>
      {tab === "overview" && (
        <OverviewPage
          highlightFixes={fix}
          checking={rowConnect.checking}
          flash={flash}
          onAddKey={addKey}
          onCellAction={cellAction}
          onOpenSubscriptions={goSubscriptions}
          onGetDesktop={getDesktop}
        />
      )}
      {tab === "subscriptions" && (
        <SubscriptionsPage
          highlight={connect}
          onAddKey={(p) => addKey(p)}
          onOpenDesktop={openDesktop}
          onGetDesktop={getDesktop}
        />
      )}
      {tab === "keys" && <ApiKeysPage onAddKey={addKey} />}
      <AddKeySheet
        request={sheet}
        onClose={() => setSheet(null)}
        onAddKey={addKey}
        onSaved={flashSaved}
      />
      {desktop?.kind === "open" && (
        <OpenDesktopDialog
          key={desktop.seq}
          connect={desktop.connect}
          onClose={closeDesktop}
          onGetDesktop={getDesktop}
        />
      )}
      {desktop?.kind === "get" && <GetDesktopDialog key={desktop.seq} onClose={closeDesktop} />}
    </>
  );
}

function connectTargetOf(sub: string | undefined): ConnectTarget | null {
  return sub === "claude" || sub === "grok" ? sub : null;
}

export function EnginesPage({
  tab,
  fix = false,
  connect = null,
}: {
  tab: EnginesTab;
  fix?: boolean;
  /** `#/engines/subscriptions?connect=…` (a `tvashtr://` link): highlight that card. */
  connect?: ConnectTarget | null;
}) {
  return (
    <EnginesDataProvider>
      <EnginesTabs tab={tab} fix={fix} connect={tab === "subscriptions" ? connect : null} />
    </EnginesDataProvider>
  );
}
