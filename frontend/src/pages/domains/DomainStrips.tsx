/**
 * The two strips under a domain's header: the four-step setup strip until the first read finishes
 * (DM-37, DmF-First-4), then the one-line summary strip on the Sources tab (DM-34, Dm-Sources).
 */
import { Fragment } from "react";
import { Check, Circle, CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";

import type { DomainDetailView } from "../../lib/api/domains";
import { navigate } from "../../lib/nav";
import { type SetupIcon, type StripTone, setupSteps, summaryItems } from "./domainFormat";

const STRIP_ICON = { size: 14, strokeWidth: 1.6, "aria-hidden": true } as const;

function StripIcon({ tone }: { tone: StripTone }) {
  if (tone === "warn") return <TriangleAlert {...STRIP_ICON} />;
  if (tone === "todo") return <Circle {...STRIP_ICON} />;
  return <CircleCheck {...STRIP_ICON} />;
}

export function SummaryStrip({ detail }: { detail: DomainDetailView }) {
  const items = summaryItems(detail);
  return (
    <div className="dm-summary" aria-label="Summary">
      {items.map((item, i) => (
        <Fragment key={item.text}>
          {i > 0 && <span className="dm-summary__sep" aria-hidden />}
          <span className={`dm-summary__item dm-summary__item--${item.tone}`}>
            <StripIcon tone={item.tone} />
            {item.text}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function SetupMark({ icon, number }: { icon: SetupIcon; number: number }) {
  switch (icon) {
    case "done":
      return (
        <span className="dm-setup__mark dm-setup__mark--done">
          <Check size={13} strokeWidth={2.2} aria-hidden />
        </span>
      );
    case "spin":
      return (
        <span className="dm-setup__mark dm-setup__mark--spin">
          <LoaderCircle size={13} strokeWidth={2} aria-hidden />
        </span>
      );
    case "warn":
      return (
        <span className="dm-setup__mark dm-setup__mark--warn">
          <TriangleAlert size={13} strokeWidth={2} aria-hidden />
        </span>
      );
    default:
      return <span className="dm-setup__mark dm-setup__mark--step">{number}</span>;
  }
}

export function SetupStrip({ detail }: { detail: DomainDetailView }) {
  return (
    <ol className="dm-setup" aria-label="Set up this domain">
      {setupSteps(detail).map((step) => (
        <li key={step.number} className="dm-setup__step">
          <SetupMark icon={step.icon} number={step.number} />
          <div className="dm-setup__text">
            <span className="dm-setup__title">{step.title}</span>
            <span className="dm-setup__body">
              {step.body}
              {step.addKey && (
                <>
                  {" "}
                  <a
                    className="dm-link"
                    href="#/engines/keys"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate({ page: "engines", tab: "keys" });
                    }}
                  >
                    Add key
                  </a>
                </>
              )}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
