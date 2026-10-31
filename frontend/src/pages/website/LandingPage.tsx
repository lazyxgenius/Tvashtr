/**
 * `#/welcome` from 720px up (landing-1.md). Every picture is built in code (TeamPicture, mocks.tsx).
 * "Download for Mac" always goes to the download page, never straight to the file
 * (WEB-9); a signed-in visitor's "Start building" goes to Home with its label unchanged (OQ-21).
 */
import {
  Check,
  ClipboardCheck,
  Code,
  Download,
  GitBranch,
  Globe,
  KeyRound,
  Monitor,
  Play,
  Users,
  X,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { ButtonLink } from "../../design-system/components";
import type { AuthUser, Config } from "../../lib/api";
import { getSiteInfo } from "../../lib/api/site";
import { GithubIcon } from "../desktop/icons";
import { COPY } from "./copy";
import { PosterVideo, VideoDialog, watch } from "./DemoVideo";
import { Faq, faqItems } from "./Faq";
import { DEMO, REEL } from "./media";
import { Head, WhyRows } from "./LandingParts";
import { useLandingMotion } from "./useLandingMotion";
import { TeamPicture } from "./TeamPicture";

const STEPS = [
  [
    "Compose the team",
    "Start from a template or a blank canvas. Drop in agents and wire the flow.",
  ],
  ["Launch with an idea", "Describe what you want. Pick the repo. Watch each node work, live."],
  ["Review and ship", "Approve at your gates. Get a reviewed pull request on your repo."],
];

const TWO_WAYS = [
  // Honest copy (independent review): only steps on a Claude or Grok plan run on the Mac; the
  // rest of a Desktop run happens on Tvashtr's servers, as on the website.
  ["Where it runs", "Tvashtr’s servers", "Your computer, for steps on your plan"],
  ["Models", "Any provider, with your API keys", "Your Claude or Grok plan first, then API keys"],
  ["Your code", "Your GitHub repos", "GitHub repos and local folders"],
  ["Runs when you close it", "Keep going", "Steps on your plan stop; the rest go on"],
  ["Best for", "Trying it out, Domains, long hosted runs", "Using the plan you already pay for"],
];

const WHO: [ReactNode, string, string][] = [
  [
    <Code key="c" size={20} strokeWidth={1.6} aria-hidden />,
    "Engineers",
    "Point a team at your repo, wire the review loop the way you actually review, and get a reviewed PR back.",
  ],
  [
    <Zap key="z" size={20} strokeWidth={1.6} aria-hidden />,
    "Founders",
    "Turn an idea into a spec, a prototype, then shipped code, without hiring a whole team first.",
  ],
  [
    <Users key="u" size={20} strokeWidth={1.6} aria-hidden />,
    "Solo builders",
    "Run a small studio of agents end to end while you stay in the loop at the gates that matter.",
  ],
];

/** The two big calls to action (hero and closing). */
function Ctas({ start }: { start: string }) {
  return (
    <div className="web-ctas">
      <ButtonLink variant="primary" size="lg" href={start}>
        <GithubIcon size={17} />
        <span>Start building — sign in with GitHub</span>
      </ButtonLink>
      <ButtonLink variant="secondary" size="lg" href="#/download">
        <Download size={17} strokeWidth={1.6} aria-hidden />
        <span>Download for Mac</span>
      </ButtonLink>
    </div>
  );
}

export function LandingPage({
  user,
  config,
}: {
  /** undefined while the session check is in flight, null when signed out. */
  user: AuthUser | null | undefined;
  config: Config | null;
}) {
  const start = user ? "#/home" : "#/signin";
  const [stars, setStars] = useState<number | null>(null);
  const reel = useRef<HTMLVideoElement>(null);
  const [fullRun, setFullRun] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  useLandingMotion(page);
  useEffect(() => {
    let live = true;
    void getSiteInfo().then((info) => {
      if (live) setStars(info?.stars ?? null);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div ref={page}>
      <div className="web-hero web-warm">
        <section className="web-lead">
          <p className="web-lead__name">Tvashtr</p>
          <h1 className="web-lead__title">Compose your own team of AI agents</h1>
          <p className="web-lead__lede">
            Draw the team on a canvas: who plans, who builds, who reviews, and where you step in. It
            works on your real GitHub repo and hands back a reviewed pull request.
          </p>
          <div className="web-ctas">
            <Ctas start={start} />
            <button type="button" className="web-watch" onClick={() => watch(reel.current)}>
              <Play size={16} strokeWidth={1.6} aria-hidden />
              Watch the demo · 1 min
            </button>
          </div>
          <div className="web-lead__meta">
            <span>{COPY.heroMeta}</span>
            <span>No card needed</span>
            <span>Desktop: Mac only for now</span>
          </div>
        </section>

        <section className="web-counter">
          <TeamPicture />
        </section>
      </div>

      <section className="web-demo">
        <h2 className="web-demo__title">See it in a minute</h2>
        <PosterVideo media={REEL} label="Play the 1-minute demo, with sound" videoRef={reel} />
        <button type="button" className="web-watch" onClick={() => setFullRun(true)}>
          See one full run · 2 min
        </button>
        {fullRun && (
          <VideoDialog
            media={DEMO}
            title="One full run · 2 min"
            onClose={() => setFullRun(false)}
          />
        )}
      </section>

      <ul className="web-proof" data-rows>
        <li>
          <GitBranch size={18} strokeWidth={1.6} aria-hidden />
          Works on your real repos
        </li>
        <li>
          <ClipboardCheck size={18} strokeWidth={1.6} aria-hidden />
          Review loops and approval gates before it ships
        </li>
        <li>
          <KeyRound size={18} strokeWidth={1.6} aria-hidden />
          Your API keys, or your Claude / Grok plan
        </li>
        <li>
          <GithubIcon size={18} />
          {COPY.proofSource}
          {stars !== null &&
            ` · ${stars.toLocaleString("en-US")} ${stars === 1 ? "star" : "stars"}`}
        </li>
      </ul>

      <section className="web-sec web-gap">
        <Head
          eyebrow="The gap"
          title="Agent tools are either a black box or a pile of code."
          lede="Tvashtr sits in between: composable like a framework, legible like a teammate. And it works on your own repo."
        />
        <div className="web-gap__lists">
          <div>
            <div className="web-gap__label">Without Tvashtr</div>
            <ul className="web-gap__list" data-rows>
              {[
                "Wire orchestration by hand, or trust a black box",
                "No view into what each agent actually did",
                "Long runs drift away from what you asked for",
                "Demos on toy repos, not your codebase",
              ].map((t) => (
                <li key={t}>
                  <X size={17} strokeWidth={2} className="web-gap__x" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="web-gap__label web-gap__label--with">With Tvashtr</div>
            <ul className="web-gap__list" data-rows>
              {[
                "Draw the team on a canvas, wire it your way",
                "Open any node and read exactly what it did",
                "A living spec keeps every agent on the same page",
                "Runs on your repo and ships a reviewed PR",
              ].map((t) => (
                <li key={t}>
                  <Check size={17} strokeWidth={2} className="web-gap__check" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="product" className="web-sec web-why">
        <Head eyebrow="Why Tvashtr" title="Composable. Legible. Steerable." center />
        <WhyRows />
      </section>

      <section id="how" className="web-sec web-how">
        <Head eyebrow="How it works" title="From idea to reviewed pull request." center />
        <div className="web-how__path">
          <span className="web-how__line" aria-hidden="true" />
          <ol className="web-how__steps">
            {STEPS.map(([title, body], i) => (
              <li key={title}>
                <span className="web-how__n">{i + 1}</span>
                <div className="web-how__title">{title}</div>
                <div className="web-how__body">{body}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="web-band">
        <section id="two-ways" className="web-sec web-two-ways">
          <Head
            eyebrow="Two ways to run"
            title="Same teams. Run them where it suits you."
            lede="Sign in once. Your teams, tools and keys are the same on the website and on the Mac app."
          />
          <div className="web-two__wrap">
            <table className="web-two">
              <thead>
                <tr>
                  <td />
                  <th scope="col">
                    <div className="web-two__head">
                      <div className="web-two__name">
                        <Globe size={20} strokeWidth={1.6} aria-hidden />
                        <span className="web-two__title">Website</span>
                      </div>
                      <div>
                        <ButtonLink variant="secondary" size="md" href={start}>
                          <Globe size={15} strokeWidth={1.6} aria-hidden />
                          <span>Start on the web</span>
                        </ButtonLink>
                      </div>
                    </div>
                  </th>
                  <th scope="col">
                    <div className="web-two__head">
                      <div className="web-two__name">
                        <Monitor size={20} strokeWidth={1.6} aria-hidden />
                        <span className="web-two__title">Desktop app</span>
                        <span className="web-badge web-badge--cream">Mac</span>
                      </div>
                      <div>
                        <ButtonLink variant="primary" size="md" href="#/download">
                          <Download size={15} strokeWidth={1.6} aria-hidden />
                          <span>Download for Mac</span>
                        </ButtonLink>
                      </div>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {TWO_WAYS.map(([label, web, desktop]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{web}</td>
                    <td>{desktop}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="web-two__note">
            Desktop runs your own installed Claude Code or Grok. You sign in inside that tool;
            Tvashtr never sees your login. Tvashtr isn’t affiliated with Anthropic or xAI.
          </div>
        </section>
      </div>

      {/* The testimonial waits for a real, permitted quote (OQ-12). */}
      <section className="web-sec web-who">
        <Head eyebrow="Who it’s for" title="For people who want the team to be theirs." />
        <div className="web-who__list" data-rows>
          {WHO.map(([icon, title, body]) => (
            <div key={title}>
              <span className="tp__ico web-who__tile">{icon}</span>
              <div className="web-who__name">{title}</div>
              <div className="web-who__body">{body}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="web-sec web-questions">
        <Head eyebrow="Questions" title="Before you start." />
        <Faq items={faqItems(config)} initialOpen={0} />
      </section>

      <section className="web-close web-warm">
        <div data-rise>
          <h2 className="web-close__title">Start weaving.</h2>
          <p className="web-close__lede">{COPY.closingLede}</p>
          <Ctas start={start} />
        </div>
      </section>
    </div>
  );
}
