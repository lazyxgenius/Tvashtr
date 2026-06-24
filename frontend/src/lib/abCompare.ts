// Pure derivations for the §14.3 A/B comparison view — the "which team config ships better"
// story, computed from a pair's two sides. No fetch, no React: every function here is a total
// pure function of its inputs, unit-tested in abCompare.test.ts.
//
// The delta is deliberately NOT a sha compare: two separate runs always ship distinct commits,
// so "did the review change what shipped" is read from terminal outcome + review effort, not the
// ship sha. The reasons ("what the review caught") come from the persisted outcome_detail.

import type { ABSide } from "./api";
import { RUN_TERMINAL, WORKFLOW_FAILED, WORKFLOW_TERMINAL } from "./status";

/** A side can no longer change when its run.status is a run-terminal OR its DBOS workflow_status
 *  is a workflow-terminal — the SAME sets the single-run poll-stop uses (status.ts). */
export function isSideTerminal(side: ABSide): boolean {
  return RUN_TERMINAL.has(side.status) || WORKFLOW_TERMINAL.has(side.workflow_status);
}

/** A side "shipped" iff its run completed AND it carries a ship tag (a delivery landed). */
export function isSideShipped(side: ABSide): boolean {
  return side.status === "completed" && side.ship_tag !== null;
}

// The status pill vocabulary, reusing deriveOverall's labels/tones (status.ts) but read from a
// *side* (status + workflow_status strings) rather than a RunRow — so the single-run path stays
// byte-for-byte unchanged. Tones map onto the existing `.tv-pill--{tone}` classes.
export type ABStatusTone = "running" | "paused" | "done" | "failed";
export function abSideStatus(side: ABSide): { label: string; tone: ABStatusTone } {
  switch (side.status) {
    case "completed":
      return { label: "Shipped", tone: "done" };
    case "awaiting_human":
      return { label: "Awaiting approval", tone: "paused" };
    case "rejected":
      return { label: "Rejected", tone: "failed" };
    case "cancelled":
      return { label: "Cancelled", tone: "failed" };
    case "over_budget":
      return { label: "Over budget", tone: "failed" };
    case "failed":
      return { label: "Failed", tone: "failed" };
  }
  // run.status carries no verdict (still "running"/"pending"): fall back to the workflow signal.
  if (side.workflow_status === "SUCCESS") return { label: "Shipped", tone: "done" };
  if (WORKFLOW_FAILED.has(side.workflow_status)) return { label: "Failed", tone: "failed" };
  return { label: "Running…", tone: "running" };
}

/** A human-readable name for a config side, derived from its team_shape. */
export function teamShapeLabel(teamShape: string): string {
  if (teamShape === "review_loop") return "review loop";
  if (teamShape === "two_node") return "no review";
  return teamShape;
}

export type ABHeadlineTone = "delta" | "no-delta" | "diverged" | "pending";

/**
 * The one-line verdict over a pair: did adding the review gate change what shipped?
 *
 *  - `< 2` sides → an incomplete pair (a partial launch left one side). `diverged`.
 *  - not all sides terminal → still running. `pending`.
 *  - both shipped, the review_loop side took **> 1** round → the gate sent the build back before
 *    approving: it caught something the no-review config shipped as-is. `delta`.
 *  - both shipped, the review_loop side took **≤ 1** round → the gate ran but didn't change the
 *    outcome. `no-delta`.
 *  - exactly one shipped → the configs diverged on whether anything shipped at all. `diverged`.
 *  - neither shipped (both terminal) → neither delivered. `diverged`.
 */
export function abHeadline(sides: ABSide[]): { headline: string; tone: ABHeadlineTone } {
  if (sides.length < 2) {
    return { headline: "Incomplete pair — only one side launched.", tone: "diverged" };
  }
  if (!sides.every(isSideTerminal)) {
    return { headline: "Comparison pending — both sides still running.", tone: "pending" };
  }

  const shipped = sides.filter(isSideShipped);

  if (shipped.length === sides.length) {
    // Both shipped — the delta (if any) is in how hard the review gate had to work.
    const reviewSide = sides.find((s) => s.team_shape === "review_loop");
    const rounds = reviewSide ? reviewSide.review_rounds.length : 0;
    if (rounds > 1) {
      const sentBack = rounds - 1;
      const times = sentBack === 1 ? "once" : `${sentBack} times`;
      return {
        headline:
          `Both shipped. The review gate sent the build back ${times} before approving — ` +
          "it caught and corrected something the no-review config shipped as-is.",
        tone: "delta",
      };
    }
    return {
      headline:
        "Both shipped. The review gate ran but didn't change the outcome — no measurable delta.",
      tone: "no-delta",
    };
  }

  if (shipped.length === 1) {
    const winner = shipped[0];
    const loser = sides.find((s) => s !== winner)!;
    // The loser's DERIVED status word (not the raw run.status) so a side terminal only via its
    // workflow_status doesn't read a live-sounding "running" inside a terminal verdict.
    const loserStatus = abSideStatus(loser).label.toLowerCase();
    return {
      headline: `Diverged — ${winner.pair_label} shipped, ${loser.pair_label} did not (${loserStatus}).`,
      tone: "diverged",
    };
  }

  // Both terminal, neither shipped.
  return { headline: "Neither side shipped — both ended without a delivery.", tone: "diverged" };
}
