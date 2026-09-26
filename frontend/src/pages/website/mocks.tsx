/**
 * Static pictures of the product for the public website (website.md §5): no React Flow, nothing
 * focusable, hidden from assistive tech. Drawn exactly as the design draws them.
 */
import { ClipboardCheck, Terminal, Zap } from "lucide-react";
import type { ReactNode } from "react";

interface MockNode {
  left: number;
  top: number;
  kind: "START" | "AGENT";
  title: string;
  sub: string;
  model: string;
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
      <div className="web-mock__node-model">{node.model}</div>
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
