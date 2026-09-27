// M-rails C8/C9: the gate_kinds that run a DETERMINISTIC guardrail check (vs the human-approval
// path). Mirrors the backend GUARDRAIL_GATE_KINDS frozenset.
export const GUARDRAIL_GATE_KINDS = new Set([
  "secret_leak_scan",
  "diff_touches_forbidden_paths",
  "output_schema_check",
]);

/** The one-line description under a gate / endpoint / Query-domain node's name in the drawer. */
export function legacySubtitle(kind: string, gateKind?: string): string {
  if (kind === "gate") {
    return GUARDRAIL_GATE_KINDS.has(gateKind ?? "")
      ? "An automatic guardrail"
      : "A human checkpoint";
  }
  if (kind === "terminal") return "An endpoint of the flow";
  return "Cited ask against a Domain";
}
