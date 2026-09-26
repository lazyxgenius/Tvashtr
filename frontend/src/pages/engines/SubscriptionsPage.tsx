/**
 * Engines › Subscriptions (Eng-Subs, Eng-Flow-Grok-*, Eng-Flow-Codex-*, EnF-FirstTime-2; the web
 * page Eng-SubsWeb): whether Tvashtr Desktop is checking in, then Claude, Grok and Codex in that
 * order (ENG-26), then the compliance disclosure (ENG-45).
 *
 * On Desktop every action goes through the bridge (optional-chained: an older build may lack a
 * method): Connect opens the vendor sign-in in Terminal and the card waits for the main process to
 * push the new status; Cancel stops that; Refresh asks the CLI again; Disconnect confirms first.
 * On the website the cards show the server mirror and every Desktop-only action is disabled; Open
 * Tvashtr Desktop and Download open the page's dialogs (ENG-47/48). A `tvashtr://` link can point
 * at one card (`#/engines/subscriptions?connect=grok`): that card is highlighted, nothing starts.
 */
import { Monitor, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, useToast } from "../../design-system/components";
import { toSubscriptionStatus } from "../../lib/api/engines";
import {
  SUBSCRIPTION_PROVIDERS,
  type SubscriptionProviderId,
  type SubscriptionStatus,
} from "../../lib/engines";
import type { ConnectTarget } from "../../lib/nav";
import { DisconnectDialog } from "./DisconnectDialog";
import { enginesBridge } from "./engineBridge";
import { useEngines } from "./enginesData";
import { EnginesDisclosure, EnginesHead, EnginesLoadError, EnginesSkeleton } from "./enginesUi";
import { SubscriptionCard } from "./SubscriptionCard";
import {
  CONNECT_FAILED,
  type CardAction,
  type CardUi,
  IDLE_UI,
  WEB_BANNER,
  connectedToast,
  refreshFailed,
  refreshToast,
  runnerBanner,
  subscriptionCard,
} from "./subscriptionModel";

const LEDE = "Run agents on your own Claude or Grok plan, from Tvashtr Desktop.";

/** How often the page re-reads the runner's check-in, so "Checked …" stays true (ENG-25). */
const RUNNER_POLL_MS = 20_000;

type UiMap = Record<SubscriptionProviderId, CardUi>;

const IDLE: UiMap = { claude: IDLE_UI, grok: IDLE_UI, codex: IDLE_UI };

export interface SubscriptionsActions {
  /** "Add anthropic key" on the disconnect toast (ENG-43). */
  onAddKey: (provider: string) => void;
  /** "Open Tvashtr Desktop" on the website: the banner's (no card) or a card's (ENG-38). */
  onOpenDesktop: (sub?: ConnectTarget) => void;
  /** "Download" on the website: the Get Tvashtr Desktop dialog (ENG-47). */
  onGetDesktop: () => void;
  /** The card a `tvashtr://…?connect=` link points at. */
  highlight?: ConnectTarget | null;
}

function RunnerBannerView() {
  const { runner } = useEngines();
  const b = runnerBanner(runner);
  return (
    <div
      className={`eng-runner eng-runner--${b.tone}`}
      role="note"
      aria-label="Tvashtr Desktop check-in"
    >
      <span className="eng-runner__text">
        {b.tone === "ok" ? (
          <Monitor size={15} strokeWidth={1.6} aria-hidden />
        ) : (
          <TriangleAlert size={15} strokeWidth={1.6} aria-hidden />
        )}
        {b.text}
      </span>
      {b.checked && <span className="eng-runner__checked">{b.checked}</span>}
    </div>
  );
}

function WebBanner({
  onOpenDesktop,
  onGetDesktop,
}: {
  onOpenDesktop: () => void;
  onGetDesktop: () => void;
}) {
  return (
    <div className="eng-webbanner" role="note">
      <Monitor size={16} strokeWidth={1.6} aria-hidden />
      <span className="eng-webbanner__text">{WEB_BANNER}</span>
      <Button variant="secondary" size="sm" onClick={onOpenDesktop}>
        Open Tvashtr Desktop
      </Button>
      <Button variant="ghost" size="sm" onClick={onGetDesktop}>
        Download
      </Button>
    </div>
  );
}

export function SubscriptionsPage({
  onAddKey,
  onOpenDesktop,
  onGetDesktop,
  highlight = null,
}: SubscriptionsActions) {
  const engines = useEngines();
  const { status, inputs, surface, subs, setSubscription, refreshRunner } = engines;
  const toast = useToast();
  const [ui, setUi] = useState<UiMap>(IDLE);
  const [disconnecting, setDisconnecting] = useState<SubscriptionProviderId | null>(null);
  const subsRef = useRef(subs);
  subsRef.current = subs;

  const patch = useCallback((sub: SubscriptionProviderId, p: Partial<CardUi>) => {
    setUi((u) => ({ ...u, [sub]: { ...u[sub], ...p } }));
  }, []);

  const statusOf = (sub: SubscriptionProviderId): SubscriptionStatus | undefined =>
    subsRef.current.find((s) => s.provider === sub);

  // Keep "Checked …" true: re-read the runner's check-in while the page is open.
  useEffect(() => {
    const id = window.setInterval(() => void refreshRunner(), RUNNER_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshRunner]);

  // A pending sign-in ends when the CLI reports it (the main process pushes it after the window
  // regains focus): connected → the toast; not installed or a failed check → the card says so.
  useEffect(() => {
    for (const s of subs) {
      const u = ui[s.provider];
      if (!u.waiting) continue;
      if (s.state === "connected") {
        toast({ message: connectedToast(s, u.waitingFrom) });
        patch(s.provider, { waiting: false, waitingFrom: null, refreshed: false });
      } else if (s.state === "error" || s.state === "needs_install") {
        patch(s.provider, { waiting: false, waitingFrom: null });
      }
    }
  }, [subs, ui, patch, toast]);

  const connect = async (sub: SubscriptionProviderId) => {
    const from = statusOf(sub)?.state ?? null;
    patch(sub, { waiting: true, waitingFrom: from, stillNotFound: false, refreshed: false });
    try {
      const answer = await enginesBridge()?.connect?.(sub);
      const next = toSubscriptionStatus(answer);
      if (!next) throw new Error("no status");
      setSubscription(next);
    } catch {
      patch(sub, { waiting: false, waitingFrom: null });
      toast({ message: CONNECT_FAILED, tone: "error" });
    }
  };

  const cancel = async (sub: SubscriptionProviderId) => {
    patch(sub, { waiting: false, waitingFrom: null });
    try {
      const next = toSubscriptionStatus(await enginesBridge()?.cancelConnect?.(sub));
      if (next) setSubscription(next);
    } catch {
      /* the card already shows the state before Connect */
    }
  };

  const refresh = async (sub: SubscriptionProviderId) => {
    const prev = statusOf(sub);
    patch(sub, { refreshing: true });
    let next: SubscriptionStatus | null;
    try {
      next = toSubscriptionStatus(await enginesBridge()?.refresh?.(sub));
    } catch {
      next = null;
    }
    if (!next) {
      patch(sub, { refreshing: false });
      toast({ message: refreshFailed(sub), tone: "error" });
      return;
    }
    setSubscription(next);
    patch(sub, {
      refreshing: false,
      refreshed: true,
      stillNotFound: next.state === "needs_install",
    });
    const message = prev ? refreshToast(prev, next) : null;
    if (message) toast({ message });
  };

  const act = (sub: SubscriptionProviderId, a: CardAction) => {
    if (a.kind === "connect") void connect(sub);
    else if (a.kind === "cancel") void cancel(sub);
    else if (a.kind === "refresh") void refresh(sub);
    else if (a.kind === "disconnect") setDisconnecting(sub);
    else onOpenDesktop(sub === "codex" ? undefined : sub);
  };

  return (
    <section className="eng-page" aria-labelledby="tv-engines-subs">
      <EnginesHead title="Subscriptions" lede={LEDE} titleId="tv-engines-subs" />
      {status !== "ready" ? (
        status === "error" ? (
          <EnginesLoadError onRetry={() => void engines.refresh()} />
        ) : (
          <EnginesSkeleton />
        )
      ) : (
        <>
          {surface === "desktop" ? (
            <RunnerBannerView />
          ) : (
            <WebBanner onOpenDesktop={() => onOpenDesktop()} onGetDesktop={onGetDesktop} />
          )}
          <div className="eng-subs">
            {SUBSCRIPTION_PROVIDERS.map((sub) => {
              const s = subs.find((r) => r.provider === sub);
              if (!s) return null;
              return (
                <SubscriptionCard
                  key={sub}
                  view={subscriptionCard(inputs, s, ui[sub])}
                  highlight={sub === highlight}
                  onAction={(a) => act(sub, a)}
                />
              );
            })}
          </div>
          <EnginesDisclosure />
        </>
      )}
      <DisconnectDialog
        sub={disconnecting}
        onClose={() => setDisconnecting(null)}
        onAddKey={onAddKey}
      />
    </section>
  );
}
