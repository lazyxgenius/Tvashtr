/** What the desktop and phone landings share: the section heading and the product rows. */
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

import { DomainMock, GateMock, SpecMock, TeamFragment } from "./mocks";

const WHY: {
  id?: string;
  key: string;
  title: string;
  body: string;
  points: string[];
  mock: ReactNode;
  mockFirst?: boolean;
}[] = [
  {
    key: "Your team is yours",
    title: "Draw the process you actually use.",
    body: "Add a product manager, an architect, two engineers and a picky reviewer, or just one agent. Wire who hands work to whom and where it loops back.",
    points: [
      "Pick the model for each role",
      "Loops with a limit, so runs can’t spin forever",
      "Save it, re-run it, fork it",
    ],
    mock: <TeamFragment />,
  },
  {
    key: "Steerable live documents",
    title: "A living spec every agent reads.",
    body: "The spec is a real document you can edit while the team works. Change your mind mid-run and the next agent to read it follows the new version.",
    points: ["Every version kept", "See who read which version", "Edit in place, like a doc"],
    mock: <SpecMock />,
    mockFirst: true,
  },
  {
    id: "domains",
    key: "Domains",
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
    key: "Gates",
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

const WHO = [
  [
    "Engineers",
    "Point a team at your repo, wire the review loop the way you actually review, and get a reviewed PR back.",
  ],
  [
    "Founders",
    "Turn an idea into a spec, a prototype, then shipped code, without hiring a whole team first.",
  ],
  [
    "Solo builders",
    "Run a small studio of agents end to end while you stay in the loop at the gates that matter.",
  ],
];

export function Head({
  title,
  lede,
  center = false,
}: {
  title: string;
  lede?: string;
  center?: boolean;
}) {
  return (
    <div className={`web-sec__head${center ? " web-sec__head--center" : ""}`} data-rise>
      <h2 className="web-h2">{title}</h2>
      {lede && <p className="web-sec__lede">{lede}</p>}
    </div>
  );
}

/** Each row's picture sits on a soft plate of the hero's lattice. */
export function WhyRows() {
  return (
    <>
      {WHY.map((row) => (
        <div
          key={row.key}
          id={row.id}
          className={`web-why__row${row.mockFirst ? " web-why__row--flip" : ""}`}
        >
          <div className="web-why__text" data-rise>
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
          <div className="web-plate web-warm" data-plate>
            {row.mock}
          </div>
        </div>
      ))}
    </>
  );
}

export function GapSection() {
  return (
    <section className="web-sec web-gap">
      <Head
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
  );
}

/** Three moves on one path. Its id stays on the desktop page; the phone's `how` is the team picture. */
export function HowSection({ id }: { id?: string }) {
  return (
    <section id={id} className="web-sec web-how">
      <Head title="From idea to reviewed pull request." center />
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
  );
}

export function WhoSection() {
  return (
    <section className="web-sec web-who">
      <Head title="For people who want the team to be theirs." />
      <div className="web-who__list" data-rows>
        {WHO.map(([title, body]) => (
          <div key={title}>
            <div className="web-who__name">{title}</div>
            <div className="web-who__body">{body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
