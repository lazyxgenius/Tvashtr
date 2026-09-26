/**
 * The website's questions (website.md WEB-17, OQ-11, OQ-28): a single-open accordion. The 1440
 * landing opens the first answer on load; opening another closes it.
 */
import { ArrowUp, ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import type { Config } from "../../lib/api";
import { COPY } from "./copy";

export interface FaqItem {
  q: string;
  a: string;
}

/** The providers that power at least one seat: never name one that runs nothing (NIM). */
function providerList(config: Config | null): string {
  const names = (config?.provider_catalogue ?? [])
    .filter((e) => e.thinker_default || e.worker_default)
    .map((e) => e.provider);
  if (names.length < 2) return names[0] ?? "a supported provider";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

// The items are shared by the 1440 and phone landings, next to the accordion that shows them.
// eslint-disable-next-line react-refresh/only-export-components
export function faqItems(config: Config | null): FaqItem[] {
  return [
    {
      q: "Do I need an API key?",
      a: "Not on Desktop if you already pay for Claude or Grok: Tvashtr uses your plan through your own Claude Code or Grok install. On the website, you add an API key for each provider your team uses.",
    },
    {
      q: "Does Tvashtr see my code or my Claude login?",
      a: "Your agents work in a private sandbox with the repos you connect. On Desktop, you sign in to Claude Code or Grok yourself; Tvashtr never sees or stores that login.",
    },
    {
      q: "Which models can I use?",
      a: `On the website, any model from ${providerList(config)}, with your own API key for that provider. You can also type a custom model ID. On Desktop, your Claude or Grok plan runs first, then the same API keys. Each agent in a team can use a different model.`,
    },
    {
      q: "What is Tvashtr Desktop for?",
      a: "Running your teams on your own Mac with the Claude or Grok plan you already pay for, on a local folder or a GitHub repo. It uses the same account, teams and keys as the website. Runs stop when you quit the app. Mac only for now.",
    },
    { q: "Is it open source?", a: COPY.faqOpenSource },
  ];
}

export function Faq({ items, initialOpen }: { items: FaqItem[]; initialOpen: number | null }) {
  const [open, setOpen] = useState(initialOpen);
  const id = useId();
  return (
    <div className="web-faq">
      {items.map((item, i) => {
        const expanded = open === i;
        const Icon = expanded ? ArrowUp : ChevronDown;
        return (
          <div key={item.q} className="web-faq__item">
            <button
              type="button"
              className="web-faq__q"
              aria-expanded={expanded}
              aria-controls={`${id}-${i}`}
              onClick={() => setOpen(expanded ? null : i)}
            >
              <span className="web-faq__q-text">{item.q}</span>
              <Icon size={18} strokeWidth={1.6} aria-hidden />
            </button>
            <p id={`${id}-${i}`} className="web-faq__a" hidden={!expanded}>
              {item.a}
            </p>
          </div>
        );
      })}
    </div>
  );
}
