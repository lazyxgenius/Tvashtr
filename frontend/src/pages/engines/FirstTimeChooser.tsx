/**
 * Engines › Overview before anything is set up (EnF-FirstTime-1, ENG-75/76): no key saved and no
 * subscription connected. Two ways to run — a Claude or Grok plan on Tvashtr Desktop, or an API key
 * anywhere — and the subscription disclosure.
 */
import { KeyRound, Monitor } from "lucide-react";

import { Button } from "../../design-system/components";
import { EnginesDisclosure, EnginesHead } from "./enginesUi";

export function FirstTimeChooser({
  onConnect,
  onAddKey,
}: {
  /** Connect a subscription: go to Subscriptions (Desktop page, or the web one with Open/Download). */
  onConnect: () => void;
  onAddKey: () => void;
}) {
  return (
    <>
      <EnginesHead
        title="Engines"
        lede="The models your agents run on. Pick at least one way to run before you launch a team."
      />
      <section className="eng-card" aria-labelledby="eng-ft-title">
        <div className="eng-ft__intro">
          <h2 className="eng-ft__q" id="eng-ft-title">
            How do you want your agents to run?
          </h2>
          <div className="eng-ft__sub">
            You can use both. Desktop tries your subscription first, then an API key.
          </div>
        </div>
      </section>
      <div className="eng-ft__cards">
        <div className="eng-ft__card">
          <span className="eng-ft__icon">
            <Monitor size={19} strokeWidth={1.6} aria-hidden />
          </span>
          <h3 className="eng-ft__title">Use my Claude or Grok plan</h3>
          <div className="eng-ft__text">
            Runs on this computer from Tvashtr Desktop. No API key needed. Usage counts against your
            own plan.
          </div>
          <div>
            <Button variant="primary" onClick={onConnect}>
              Connect a subscription
            </Button>
          </div>
        </div>
        <div className="eng-ft__card">
          <span className="eng-ft__icon">
            <KeyRound size={19} strokeWidth={1.6} aria-hidden />
          </span>
          <h3 className="eng-ft__title">Add an API key</h3>
          <div className="eng-ft__text">
            Works on the website and on Desktop. Pay the provider per use. Good for hosted runs and
            Domains.
          </div>
          <div>
            <Button variant="secondary" onClick={onAddKey}>
              Add API key
            </Button>
          </div>
        </div>
      </div>
      <EnginesDisclosure />
    </>
  );
}
