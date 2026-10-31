/**
 * Static pictures of the product for the public website (website.md §5): no React Flow, nothing
 * focusable, hidden from assistive tech. Drawn exactly as the design draws them.
 */
import {
  BookOpen,
  ClipboardCheck,
  DraftingCompass,
  Eye,
  FileText,
  GitBranch,
  type LucideIcon,
  PenLine,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../design-system/components";

interface MockNode {
  left: number;
  top: number;
  kind: string;
  title: string;
  sub: string;
  model?: string;
  icon: ReactNode;
  tone?: "start" | "ring";
}

const ICON = { size: 13, strokeWidth: 1.6, "aria-hidden": true } as const;

/** The Architect's drafting compass (the design's own glyph). */
function CompassIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="1.8" />
      <path d="m3.5 20.5 7-9.8" />
      <path d="m13.6 10.6 6.9 9.9" />
      <path d="M9.8 15.2 12 12" />
    </svg>
  );
}

const TEAM: MockNode[] = [
  {
    left: 20,
    top: 40,
    kind: "START",
    title: "Product manager",
    sub: "Drafts the spec",
    model: "xai/grok-4.7",
    icon: <Zap {...ICON} />,
    tone: "start",
  },
  {
    left: 220,
    top: 40,
    kind: "AGENT",
    title: "Architect",
    sub: "Adds the design",
    model: "anthropic/claude-sonnet-5",
    icon: <CompassIcon />,
  },
  {
    left: 120,
    top: 190,
    kind: "AGENT",
    title: "Engineer",
    sub: "Builds it",
    model: "anthropic/claude-sonnet-5",
    icon: <Terminal {...ICON} />,
    tone: "ring",
  },
  {
    left: 320,
    top: 190,
    kind: "AGENT",
    title: "Reviewer",
    sub: "Checks the work",
    model: "xai/grok-4.7",
    icon: <ClipboardCheck {...ICON} />,
  },
];

function NodeCard({ node }: { node: MockNode }) {
  return (
    <div
      className={`web-mock__node${node.tone ? ` web-mock__node--${node.tone}` : ""}`}
      style={{ left: node.left, top: node.top }}
    >
      <div className="web-mock__node-head">
        <span className="web-mock__node-icon">{node.icon}</span>
        <div className="web-mock__node-text">
          <div className="web-mock__node-kind">{node.kind}</div>
          <div className="web-mock__node-title">{node.title}</div>
          <div className="web-mock__node-sub">{node.sub}</div>
        </div>
      </div>
      {node.model && <div className="web-mock__node-model">{node.model}</div>}
    </div>
  );
}

/** Web-SignIn's canvas: the four-agent team with the reviewer sending work back (540 × 340). */
export function TeamCanvasMock() {
  return (
    <div className="web-mock__canvas" aria-hidden="true">
      <div className="web-mock__canvas-inner">
        {TEAM.map((node) => (
          <NodeCard key={node.title} node={node} />
        ))}
        <svg width="520" height="320" viewBox="0 0 520 320" className="web-mock__edges">
          <path
            d="M192 80 C 206 80, 206 80, 220 80"
            fill="none"
            stroke="var(--stone-400)"
            strokeWidth="1.5"
          />
          <path
            d="M306 120 C 306 150, 206 160, 206 190"
            fill="none"
            stroke="var(--stone-400)"
            strokeWidth="1.5"
          />
          <path
            d="M292 230 C 306 230, 306 230, 320 230"
            fill="none"
            stroke="var(--stone-400)"
            strokeWidth="1.5"
          />
          <path
            d="M406 190 C 406 150, 206 150, 206 190"
            fill="none"
            stroke="var(--coral-500)"
            strokeWidth="1.5"
            strokeDasharray="5 5"
          />
        </svg>
      </div>
      <span className="web-mock__pill">changes requested</span>
    </div>
  );
}

/** A numbered source, as the Domains answers cite them. */
function Cite({ n }: { n: number }) {
  return <span className="web-cite">{n}</span>;
}

const CREW: { title: string; does: string; model: string; Icon: LucideIcon; start?: boolean }[] = [
  {
    title: "Product manager",
    does: "Drafts the spec",
    model: "grok-4.7",
    Icon: PenLine,
    start: true,
  },
  { title: "Architect", does: "Adds the design", model: "claude-sonnet-5", Icon: DraftingCompass },
  { title: "Engineer", does: "Builds it", model: "claude-sonnet-5", Icon: Terminal },
  { title: "Reviewer", does: "Checks the work", model: "grok-4.7", Icon: ClipboardCheck },
];

/** Why Tvashtr, "Your team is yours": a team you drew, with the Reviewer's way back. It flows with
 * its column, so its lines are percentages of the grid the cards sit in. */
export function TeamFragment() {
  return (
    <div className="web-crew" aria-hidden="true">
      <svg className="web-crew__lines" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M25 22H75C75 50 25 50 25 66H75" />
        <path className="web-crew__back" d="M75 66C75 104 25 104 25 66" />
      </svg>
      {CREW.map(({ title, does, model, Icon, start }) => (
        <div key={title} className={`web-crew__n${start ? " web-crew__n--start" : ""}`}>
          <span className="tp__head">
            <span className="tp__ico">
              <Icon size={13} strokeWidth={1.7} />
            </span>
            <span className="tp__t">{title}</span>
          </span>
          <span className="tp__does">{does}</span>
          <span className="tp__m">{model}</span>
        </div>
      ))}
      <span className="web-crew__label">changes requested</span>
    </div>
  );
}

/** Why Tvashtr, "Steerable live documents": the spec with a line added mid-run. */
export function SpecMock() {
  return (
    <div className="web-mock-card" aria-hidden="true">
      <div className="web-mock__row">
        <FileText size={16} strokeWidth={1.6} className="web-mock__ink" aria-hidden />
        <span className="web-mock-card__title">Spec · refund button</span>
        <span className="web-badge web-badge--coral">Edited by you</span>
      </div>
      <div className="web-mock-card__text">
        Customers can request a refund from <b>Billing → Refunds</b>.
      </div>
      <div className="web-mock-card__text web-mock-card__added">
        Show the refund amount before the customer confirms.{" "}
        <span className="web-mock-card__by">Added by you mid-run</span>
      </div>
      <div className="web-mock-card__seen">
        <Eye size={13} strokeWidth={1.6} aria-hidden />
        The Engineer read the new version
      </div>
    </div>
  );
}

/** Why Tvashtr, "Domains": an answer that shows the passage it came from. */
export function DomainMock() {
  return (
    <div className="web-mock-card" aria-hidden="true">
      <div className="web-mock__row">
        <BookOpen size={16} strokeWidth={1.6} className="web-mock__ink" aria-hidden />
        <span className="web-mock-card__title">Support docs</span>
      </div>
      <div className="web-mock-card__ask">What happens to an annual plan after a refund?</div>
      <div className="web-mock-card__answer">
        Customers get the unused whole months back
        <Cite n={1} />.
      </div>
      <div className="web-mock-card__quote">
        <span className="web-mock-card__file">billing-faq.pdf</span>
        <br />…<mark>we refund the unused whole months on a prorated basis</mark>…
      </div>
    </div>
  );
}

/** Why Tvashtr, "Gates": the approval waiting for you, and the reviewed pull request. The
 * buttons are pictures: no handlers, never focusable (WEB-10). */
export function GateMock() {
  return (
    <div className="web-gates" aria-hidden="true">
      <div className="web-gates__gate">
        <div className="web-mock__row">
          <ShieldCheck size={16} strokeWidth={1.6} className="web-gates__shield" aria-hidden />
          <span className="web-gates__title">Waiting for you · Approve the spec</span>
        </div>
        <div className="web-gates__text">
          The Product manager wrote the spec. The Engineer starts when you approve.
        </div>
        <div className="web-mock__row">
          <Button variant="primary" size="sm" tabIndex={-1}>
            Approve
          </Button>
          <Button variant="secondary" size="sm" tabIndex={-1}>
            Request changes
          </Button>
        </div>
      </div>
      <div className="web-gates__pr">
        <div className="web-mock__row">
          <GitBranch size={16} strokeWidth={1.6} className="web-gates__branch" aria-hidden />
          <span className="web-gates__title">Pull request · Add self-serve refunds</span>
        </div>
        <span className="web-badge web-badge--success">Approved by Reviewer</span>
      </div>
    </div>
  );
}
