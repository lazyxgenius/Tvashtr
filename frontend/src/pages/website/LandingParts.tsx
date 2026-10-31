/** What the desktop and phone landings share: the section heading and the product rows. */
import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { DomainMock, GateMock, SpecMock, TeamFragment } from "./mocks";

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
    mock: <TeamFragment />,
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

export function Head({
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

/** Each row's picture sits on a soft plate of the hero's lattice. */
export function WhyRows() {
  return (
    <>
      {WHY.map((row) => (
        <div
          key={row.eyebrow}
          id={row.id}
          className={`web-why__row${row.mockFirst ? " web-why__row--flip" : ""}`}
        >
          <div className="web-why__text" data-rise>
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
          <div className="web-plate web-warm" data-plate>
            {row.mock}
          </div>
        </div>
      ))}
    </>
  );
}
