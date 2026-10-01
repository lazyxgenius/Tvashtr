/**
 * The Retry prefill (HOME Needs you › Retry, and the run view's "Retry from the start"): the same
 * team, idea, target, branch, scope and budget, handed to Home's composer.
 */
import type { RunTarget } from "../../lib/api/runs";
import type { ComposerPrefill, ComposerTarget } from "./homeData";

export interface RetryableRun {
  id: string;
  idea: string;
  target?: RunTarget | null;
  github_repo?: string | null;
  base_ref?: string | null;
  subpath?: string | null;
  budget_cap_usd?: number | null;
}

function composerTargetOf(run: RetryableRun): ComposerTarget | null {
  const t = run.target;
  if (t?.kind === "github" && t.label) return { kind: "github", repo: t.label };
  if (t?.kind === "desktop_folder" && t.label)
    return { kind: "folder", path: t.label, label: t.label };
  if (t?.kind === "local" && t.label) return { kind: "local", path: t.label };
  if (t?.kind === "none") return { kind: "none" };
  if (run.github_repo) return { kind: "github", repo: run.github_repo };
  return null;
}

export function retryPrefill(run: RetryableRun, teamId: string | null): ComposerPrefill {
  return {
    teamId,
    idea: run.idea,
    target: composerTargetOf(run),
    baseRef: run.target?.base_ref ?? run.base_ref ?? null,
    subpath: run.target?.subpath ?? run.subpath ?? null,
    budget: run.budget_cap_usd ?? null,
    retryOfRunId: run.id,
  };
}
