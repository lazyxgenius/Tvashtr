/**
 * `#/welcome` at 1440 (website.md WEB-9..18; design Web-Landing). Every picture is a static mock
 * (mocks.tsx). "Download for Mac" always goes to the download page, never straight to the file
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
  Users,
  X,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { ButtonLink } from "../../design-system/components";
import type { AuthUser, Config } from "../../lib/api";
import { getSiteInfo } from "../../lib/api/site";
import { GithubIcon } from "../desktop/icons";
import { COPY } from "./copy";
import { Faq, faqItems } from "./Faq";
import { DomainMock, GateMock, ProductMock, SpecMock, TeamCanvasMock } from "./mocks";

const WHY: {
  id?: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  mock: ReactNode;
  mockFirst?: boolean;
}[] = [
  {
    eyebrow: "Your team is yours",
    title: "Draw the process you actually use.",
    body: "Add a product manager, an architect, two engineers and a picky reviewer, or just one agent. Wire who hands work to whom and where it loops back.",
    points: [
      "Pick the model for each role",
      "Loops with a limit, so runs can’t spin forever",
      "Save it, re-run it, fork it",
    ],
    mock: <TeamCanvasMock />,
  },
  {
    eyebrow: "Steerable live documents",
    title: "A living spec every agent reads.",
    body: "The spec is a real document you can edit while the team works. Change your mind mid-run and the next agent to read it follows the new version.",
    points: ["Every version kept", "See who read which version", "Edit in place, like a doc"],
    mock: <SpecMock />,
    mockFirst: true,
  },
  {
    id: "domains",
    eyebrow: "Domains",
    title: "Your own documents, with sources.",
    body: "Put your help docs, contracts or papers in a domain. You and your agents ask it questions, and every answer shows the exact passage it came from.",
    points: [
      "Answers only from your files",
      "Test that search finds the right file",
      "Use it as a team step, or let an agent search",
    ],
    mock: <DomainMock />,
  },
  {
    eyebrow: "Gates",
    title: "You step in where it matters.",
    body: "Put an approval gate after the spec, before shipping, or anywhere else. The reviewer checks the work against the spec before you ever see a pull request.",
    points: [
      "Approve or send back with notes",
      "Reviewed PRs on your own repo",
      "Stop a run at any time",
    ],
    mock: <GateMock />,
    mockFirst: true,
  },
];

const STEPS = [
  [
    "Compose the team",
    "Start from a template or a blank canvas. Drop in agents and wire the flow.",
  ],
  ["Launch with an idea", "Describe what you want. Pick the repo. Watch each node work, live."],
  ["Review and ship", "Approve at your gates. Get a reviewed pull request on your repo."],
];

const TWO_WAYS = [
  ["Where it runs", "Tvashtr’s servers", "Your computer"],
  ["Models", "Any provider, with your API keys", "Your Claude or Grok plan first, then API keys"],
  ["Your code", "Your GitHub repos", "GitHub repos and local folders"],
  ["Runs when you close it", "Keep going", "Stop when you quit the app"],
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

function Head({
  eyebrow,
  title,
  lede,
  center = false,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  center?: boolean;
}) {
  return (
    <div className={`web-sec__head${center ? " web-sec__head--center" : ""}`}>
      <span className="web-eyebrow">{eyebrow}</span>
      <h2 className="web-h2">{title}</h2>
      {lede && <p className="web-sec__lede">{lede}</p>}
    </div>
  );
}

/** The two big calls to action (hero and closing). */
function Ctas({ start, onDark = false }: { start: string; onDark?: boolean }) {
  return (
    <div className="web-ctas">
      <ButtonLink variant="primary" size="lg" href={start}>
        <GithubIcon size={17} />
        <span>Start building — sign in with GitHub</span>
      </ButtonLink>
      <ButtonLink
        variant="secondary"
        size="lg"
        href="#/download"
        className={onDark ? "web-btn--on-dark" : undefined}
      >
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
    <>
      <section className="web-hero">
        <div className="web-hero__in">
          <span className="web-badge web-badge--cream">{COPY.heroPill}</span>
          <h1 className="web-hero__title">
            Compose your own team of AI agents, <em>not just use one.</em>
          </h1>
          <p className="web-hero__lede">
            Draw the team on a canvas: who plans, who builds, who reviews, and where you step in. It
            works on your real GitHub repo and hands back a reviewed pull request.
          </p>
          <Ctas start={start} />
          <div className="web-hero__meta">
            <span>{COPY.heroMeta}</span>
            <span>No card needed</span>
            <span>Desktop: Mac only for now</span>
          </div>
        </div>
        <div className="web-hero__mock">
          <ProductMock />
        </div>
      </section>

      <div className="web-sec web-sec--proof">
        <ul className="web-proof">
          <li>
            <GitBranch size={18} strokeWidth={1.6} aria-hidden />
            Works on your real repos
          </li>
          <li>
            <ClipboardCheck size={18} strokeWidth={1.6} aria-hidden />
            Every change reviewed before it ships
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
      </div>

      <section className="web-sec web-sec--gap">
        <Head
          eyebrow="The gap"
          title="Agent tools are either a black box or a pile of code."
          lede="Tvashtr sits in between: composable like a framework, legible like a teammate. And it works on your own repo."
        />
        <div className="web-gap">
          <div className="web-gap__card">
            <div className="web-gap__label">// without Tvashtr</div>
            <ul className="web-gap__list">
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
          <div className="web-gap__card web-gap__card--with">
            <div className="web-gap__label">// with Tvashtr</div>
            <ul className="web-gap__list">
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

      <section id="product" className="web-sec web-sec--why">
        <Head eyebrow="Why Tvashtr" title="Composable. Legible. Steerable." />
        <div className="web-why__space" />
        {WHY.map((row) => {
          const text = (
            <div className="web-why__text">
              <span className="web-eyebrow">{row.eyebrow}</span>
              <h3 className="web-h3">{row.title}</h3>
              <p className="web-why__body">{row.body}</p>
              <ul className="web-why__points">
                {row.points.map((p) => (
                  <li key={p}>
                    <Check size={16} strokeWidth={2} aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          );
          return (
            <div
              key={row.eyebrow}
              id={row.id}
              className={`web-why__row${row.mockFirst ? " web-why__row--flip" : ""}`}
            >
              {row.mockFirst && row.mock}
              {text}
              {!row.mockFirst && row.mock}
            </div>
          );
        })}
      </section>

      <section id="how" className="web-sec web-sec--how">
        <Head eyebrow="How it works" title="From idea to reviewed pull request." center />
        <ol className="web-cards">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="web-card">
              <span className="web-card__n">{i + 1}</span>
              <div className="web-card__title">{title}</div>
              <div className="web-card__body">{body}</div>
            </li>
          ))}
        </ol>
      </section>

      <section id="two-ways" className="web-sec web-sec--two">
        <Head
          eyebrow="Two ways to run"
          title="Same teams. Run them where it suits you."
          lede="Sign in once. Your teams, tools and keys are the same on the website and on the Mac app."
        />
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
        <div className="web-two__note">
          Desktop runs your own installed Claude Code or Grok. You sign in inside that tool; Tvashtr
          never sees your login. Tvashtr isn’t affiliated with Anthropic or xAI.
        </div>
      </section>

      {/* The testimonial waits for a real, permitted quote (OQ-12). */}
      <section className="web-sec web-sec--who">
        <Head eyebrow="Who it’s for" title="For people who want the team to be theirs." />
        <div className="web-cards web-cards--who">
          {WHO.map(([icon, title, body]) => (
            <div key={title} className="web-card">
              <span className="web-card__tile">{icon}</span>
              <div className="web-card__name">{title}</div>
              <div className="web-card__body">{body}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="web-sec web-sec--faq">
        <Head eyebrow="Questions" title="Before you start." />
        <Faq items={faqItems(config)} initialOpen={0} />
      </section>

      <section className="web-sec web-sec--close">
        <div className="web-close">
          <h2 className="web-close__title">Start weaving.</h2>
          <p className="web-close__lede">{COPY.closingLede}</p>
          <Ctas start={start} onDark />
        </div>
      </section>
    </>
  );
}
