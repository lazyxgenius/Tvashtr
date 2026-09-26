import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Checkbox, useToast } from "../../../design-system/components";
import { listProviders, type ProviderCredential } from "../../../lib/api";
import {
  cancelPlanConnect,
  connectPlan,
  disconnectPlan,
  getPlanStatuses,
  onPlanStatus,
  refreshPlan,
  thisComputer,
} from "../../../lib/desktopApp";
import { saveDesktopSetup, type DesktopSetup } from "../../../lib/desktopSetup";
import type { SubscriptionStatus } from "../../../lib/engines";
import { navigate } from "../../../lib/nav";
import { KeyIcon } from "../icons";
import { CodexRow, PlanRow } from "./PlanRow";
import { canContinue, codexRow, type PlanProvider, planInUse, planRowViews } from "./planRows";
import { SetupFrame, SetupHead } from "./SetupFrame";
import { TerminalSignInOverlay } from "./TerminalSignInOverlay";

type Statuses = Partial<Record<SubscriptionStatus["provider"], SubscriptionStatus>>;

const CONSENT =
  "I understand: Tvashtr runs my own Claude Code and Grok on this Mac. I sign in inside those " +
  "tools, and Tvashtr never sees my login. Usage counts against my plan.";

/** The overlay closes when the sign-in reaches one of these (DT-23). */
const SIGN_IN_DONE = new Set<SubscriptionStatus["state"]>(["connected", "needs_install", "error"]);

/**
 * Setup step 2, Engines (desktop-app.md DT-19..DT-27; DT-Engines, DtF-Run-3/4/5): how agents run
 * on this Mac. The plan rows come from the bridge (`engines.getStatus` + `onStatus`), never the
 * server mirror. Continue needs one way to run: a plan in use with the consent ticked, or no plan
 * in use and a saved API key. Skip for now goes on with nothing set up.
 */
export function EnginesStep({
  login,
  setup,
  onSwitch,
  onUseKey,
  onSetUp,
}: {
  login: string;
  setup: DesktopSetup;
  onSwitch: () => void;
  /** "Use an API key instead" (the setup key sheet, DT-26). */
  onUseKey: () => void;
  /** A plan's "Set up" (the install sheet, DT-25). */
  onSetUp: (provider: PlanProvider) => void;
}) {
  const toast = useToast();
  const mac = thisComputer();
  const [statuses, setStatuses] = useState<Statuses>({});
  const [keys, setKeys] = useState<ProviderCredential[]>([]);
  const [consent, setConsent] = useState(setup.planConsentAt !== null);
  const [signingIn, setSigningIn] = useState<PlanProvider | null>(null);
  const [busy, setBusy] = useState<PlanProvider | null>(null);
  // The row state before a Terminal sign-in, restored by Cancel (DT-23).
  const beforeSignIn = useRef<SubscriptionStatus | null>(null);
  const signingInRef = useRef(signingIn);
  signingInRef.current = signingIn;

  const put = useCallback((s: SubscriptionStatus | null) => {
    if (s) setStatuses((prev) => ({ ...prev, [s.provider]: s }));
  }, []);

  useEffect(() => {
    let alive = true;
    void getPlanStatuses().then((list) => {
      if (!alive || !list) return;
      // A status pushed meanwhile is newer than the launch answer.
      setStatuses((prev) => {
        const next: Statuses = {};
        for (const s of list) next[s.provider] = s;
        return { ...next, ...prev };
      });
    });
    void listProviders()
      .then((list) => {
        if (alive && Array.isArray(list)) setKeys(list);
      })
      .catch(() => undefined);
    const unsubscribe = onPlanStatus((s) => {
      put(s);
      if (signingInRef.current === s.provider && SIGN_IN_DONE.has(s.state)) setSigningIn(null);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [put]);

  /** DT-23: open the vendor's login in Terminal; the row and overlay wait for it. */
  const connect = useCallback(
    async (provider: PlanProvider) => {
      beforeSignIn.current = statuses[provider] ?? null;
      setSigningIn(provider);
      try {
        const s = await connectPlan(provider);
        if (signingInRef.current !== provider) return; // cancelled meanwhile
        put(s);
        if (!s || SIGN_IN_DONE.has(s.state)) setSigningIn(null);
      } catch {
        if (signingInRef.current === provider) setSigningIn(null);
        toast({ message: "Couldn’t open Terminal. Try again.", tone: "error" });
      }
    },
    [put, statuses, toast],
  );

  const cancel = useCallback(() => {
    const provider = signingInRef.current;
    if (!provider) return;
    setSigningIn(null);
    put(beforeSignIn.current);
    void cancelPlanConnect(provider);
  }, [put]);

  const run = useCallback(
    async (provider: PlanProvider, fn: (p: PlanProvider) => Promise<SubscriptionStatus | null>) => {
      setBusy(provider);
      try {
        put(await fn(provider));
      } catch {
        toast({ message: "Something went wrong on this Mac. Try again.", tone: "error" });
      } finally {
        setBusy(null);
      }
    },
    [put, toast],
  );

  const tickConsent = useCallback(
    async (checked: boolean) => {
      setConsent(checked);
      try {
        await saveDesktopSetup({ planConsentAt: checked ? new Date().toISOString() : null });
      } catch {
        setConsent(!checked);
        toast({ message: "Couldn’t save this Mac’s setup. Try again.", tone: "error" });
      }
    },
    [toast],
  );

  const next = useCallback(() => {
    // Best effort: the saved step only decides where a relaunch resumes.
    void saveDesktopSetup({ step: "project" }).catch(() => undefined);
    navigate({ page: "setup", step: "project" });
  }, []);

  const rows = planRowViews(statuses, { mac, signingIn });
  const inUse = planInUse(statuses);
  const codex = codexRow(statuses.codex ?? null, mac);

  return (
    <SetupFrame
      step="engines"
      login={login}
      onSwitch={onSwitch}
      footer={{
        onSkip: next,
        primary: {
          label: "Continue",
          disabled: !canContinue({ planInUse: inUse, consent, savedKeys: keys.length }),
          onClick: next,
        },
      }}
      overlay={
        signingIn && (
          <TerminalSignInOverlay
            plan={signingIn === "claude" ? "Claude" : "Grok"}
            onCancel={cancel}
          />
        )
      }
    >
      <SetupHead
        title="How should your agents run?"
        lede={`We looked for AI tools on ${mac}. Your plan is used first; API keys are the backup.`}
      />
      <div className="st-rows">
        {rows.map((view) => (
          <PlanRow
            key={view.provider}
            view={view}
            busy={busy === view.provider}
            onPlanSwitch={(on) =>
              on ? void connect(view.provider) : void run(view.provider, disconnectPlan)
            }
            onAction={(does) => {
              if (does === "connect") void connect(view.provider);
              else if (does === "cancel") cancel();
              else if (does === "refresh") void run(view.provider, refreshPlan);
              else onSetUp(view.provider);
            }}
          />
        ))}
        <CodexRow line={codex.line} installUrl={codex.installUrl} />
        <div className="st-row st-row--keys">
          <KeyIcon size={18} />
          <div className="st-row__keys-text">
            <div className="st-row__keys-title">API keys</div>
            <div className="st-row__line">
              Works everywhere, including the website. Pay the provider per use.
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={onUseKey}>
            <KeyIcon size={15} />
            <span>Use an API key instead</span>
          </Button>
        </div>
      </div>
      <div className="st-consent">
        <Checkbox
          label={CONSENT.replace("this Mac", mac)}
          checked={consent}
          onChange={(e) => void tickConsent(e.target.checked)}
        />
      </div>
      <div className="st-fineprint">
        Tvashtr isn’t affiliated with or endorsed by Anthropic or xAI.
      </div>
    </SetupFrame>
  );
}
