/**
 * Static pictures of the product for the public website (website.md §5): no React Flow, nothing
 * focusable, hidden from assistive tech. Drawn exactly as the design draws them.
 */
import {
  BookOpen,
  ClipboardCheck,
  Eye,
  FileText,
  GitBranch,
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
  tone?: "start" | "ring" | "query";
  status?: { label: string; tone: "done" | "run" | "wait" };
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
      {node.status && (
        <div className="web-mock__node-status">
          <span className={`web-mock__status web-mock__status--${node.status.tone}`}>
            {node.status.label}
          </span>
        </div>
      )}
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
            stroke="#b0aea5"
            strokeWidth="1.5"
          />
          <path
            d="M306 120 C 306 150, 206 160, 206 190"
            fill="none"
            stroke="#b0aea5"
            strokeWidth="1.5"
          />
          <path
            d="M292 230 C 306 230, 306 230, 320 230"
            fill="none"
            stroke="#b0aea5"
            strokeWidth="1.5"
          />
          <path
            d="M406 190 C 406 150, 206 150, 206 190"
            fill="none"
            stroke="#d97757"
            strokeWidth="1.5"
            strokeDasharray="5 5"
          />
        </svg>
      </div>
      <span className="web-mock__pill">changes requested</span>
    </div>
  );
}

const PRODUCT: MockNode[] = [
  {
    left: 40,
    top: 150,
    kind: "START · ENTRY",
    title: "Product manager",
    sub: "Drafts the spec",
    model: "xai/grok-4.7",
    icon: <Zap {...ICON} />,
    tone: "start",
    status: { label: "Done", tone: "done" },
  },
  {
    left: 250,
    top: 60,
    kind: "QUERY DOMAIN",
    title: "Look up support docs",
    sub: "Support docs",
    icon: <BookOpen {...ICON} />,
    tone: "query",
    status: { label: "Answered", tone: "done" },
  },
  {
    left: 250,
    top: 250,
    kind: "AGENT",
    title: "Engineer",
    sub: "Builds the change",
    model: "anthropic/claude-sonnet-5",
    icon: <Terminal {...ICON} />,
    tone: "ring",
    status: { label: "Running · 4 min", tone: "run" },
  },
  {
    left: 460,
    top: 150,
    kind: "AGENT",
    title: "Reviewer",
    sub: "Checks against the spec",
    model: "xai/grok-4.7",
    icon: <ClipboardCheck {...ICON} />,
    status: { label: "Waiting", tone: "wait" },
  },
];

/** A numbered source, as the Domains answers cite them. */
function Cite({ n, hot = false }: { n: number; hot?: boolean }) {
  return <span className={`web-cite${hot ? " web-cite--hot" : ""}`}>{n}</span>;
}

/** The hero's window: the Docs team running, with the spec beside it (1120 × 560). */
export function ProductMock() {
  return (
    <div className="web-product" aria-hidden="true">
      <div className="web-product__bar">
        <span className="web-product__dots">
          <span />
          <span />
          <span />
        </span>
        <span className="web-product__name">Docs team</span>
        <span className="web-badge web-badge--coral">Running</span>
        <span className="web-product__repo">lazyxgenius/trade_mcp · $0.41</span>
      </div>
      <div className="web-product__body">
        <div className="web-product__canvas">
          <div className="web-product__canvas-inner">
            {PRODUCT.map((node) => (
              <NodeCard key={node.title} node={node} />
            ))}
            <div className="web-product__gate">
              <ShieldCheck {...ICON} />
              Gate: you approve the PR
            </div>
            <svg width="700" height="480" viewBox="0 0 700 480" className="web-mock__edges">
              <path
                d="M212 190 C 232 190, 232 100, 250 100"
                fill="none"
                stroke="#b0aea5"
                strokeWidth="1.5"
              />
              <path
                d="M212 190 C 232 190, 232 290, 250 290"
                fill="none"
                stroke="#d97757"
                strokeWidth="1.5"
                strokeDasharray="5 5"
              />
              <path
                d="M422 100 C 442 100, 442 190, 460 190"
                fill="none"
                stroke="#b0aea5"
                strokeWidth="1.5"
              />
              <path
                d="M422 290 C 442 290, 442 190, 460 190"
                fill="none"
                stroke="#d97757"
                strokeWidth="1.5"
                strokeDasharray="5 5"
              />
            </svg>
          </div>
        </div>
        <div className="web-product__spec">
          <div className="web-mock__row">
            <FileText size={15} strokeWidth={1.6} className="web-mock__ink" aria-hidden />
            <span className="web-product__spec-title">Spec · refund button</span>
            <span className="web-badge web-badge--cream">v3</span>
          </div>
          <div className="web-product__spec-meta">
            Edited by you 2 minutes ago · agents read it on their next step
          </div>
          <div className="web-product__rule" />
          <div className="web-product__h">Goal</div>
          <div className="web-product__p">
            Let customers ask for a refund from Billing without writing to support.
          </div>
          <div className="web-product__h">What the docs say</div>
          <div className="web-product__p">
            Full refund within 30 days
            <Cite n={1} />. Annual plans prorated after
            <Cite n={2} />.
          </div>
          <div className="web-product__h">Out of scope</div>
          <div className="web-product__p web-product__p--cut">
            <s>Partial refunds for monthly plans</s> — removed by you
          </div>
        </div>
      </div>
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
        <span className="web-badge web-badge--coral">v4 · you</span>
      </div>
      <div className="web-mock-card__text">
        Customers can request a refund from <b>Billing → Refunds</b> within 30 days.
      </div>
      <div className="web-mock-card__text web-mock-card__added">
        Show the refund amount before the customer confirms.{" "}
        <span className="web-mock-card__by">Added by you mid-run</span>
      </div>
      <div className="web-mock-card__seen">
        <Eye size={13} strokeWidth={1.6} aria-hidden />
        Engineer read v4 · 12 seconds ago
      </div>
    </div>
  );
}

/** Why Tvashtr, "Domains": an answer that shows the passage it came from. */
export function DomainMock() {
  return (
    <div className="web-mock-card web-mock-card--domain" aria-hidden="true">
      <div className="web-mock__row">
        <BookOpen size={16} strokeWidth={1.6} className="web-mock__ink" aria-hidden />
        <span className="web-mock-card__title">Support docs</span>
        <span className="web-badge web-badge--cream">14 files</span>
      </div>
      <div className="web-mock-card__ask">How long do customers have to ask for a refund?</div>
      <div className="web-mock-card__answer">
        Within 30 days of purchase
        <Cite n={1} />. Annual plans get a prorated refund after that
        <Cite n={2} hot />.
      </div>
      <div className="web-mock-card__quote">
        <span className="web-mock-card__file">billing-faq.pdf · page 4</span>
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
          Product manager finished v3. Engineers start when you approve.
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
          <span className="web-gates__title">Pull request #42 · Add self-serve refunds</span>
          <span className="web-badge web-badge--success">Approved by Reviewer</span>
        </div>
        <div className="web-gates__diff">+214 −38 · 6 files · 2 review rounds</div>
      </div>
    </div>
  );
}
