import { useState } from "react";
import { X } from "lucide-react";

import {
  inspectRepo,
  LARGE_REPO_FILE_THRESHOLD,
  type RepoInspect,
  type RunTeamOptions,
  type TeamGraphNode,
} from "../lib/api";

// M-unify U3: a node's ONE capability distinction — edits-off ⇒ it runs the full agent loop read-only
// (only its report/verdict leaves the sandbox). Falls back to the backend's kind-mapped default (agent
// ⇒ edits-on) for a node/fixture predating the field.
const isEditsOff = (n: TeamGraphNode): boolean => !(n.edits_allowed ?? n.kind === "agent");

// The curated action verbs (imperative base forms — the shape instruction-prompts use).
const ACTION_VERBS = [
  "implement",
  "build",
  "create",
  "write",
  "edit",
  "modify",
  "add",
  "fix",
  "refactor",
  "delete",
  "rename",
  "generate",
  "update",
  "change",
  "remove",
  "rewrite",
];
// A sentence that NEGATES ("do NOT modify, create, or delete …") or is about the node's OWN
// report/verdict/spec deliverable (which an edits-off node LEGITIMATELY writes) is not a
// misconfiguration — skip it. Precision-first, so the advisory never cries wolf on a correctly
// edits-off node (e.g. the Reviewer's "Write a file named REVIEW_VERDICT.json").
const NEGATOR = /\b(?:not|never|without|avoid|don't|dont|cannot|can't|cant)\b/;
const DELIVERABLE = /\b(?:report(?:\.md)?|review_verdict(?:\.json)?|verdict|prd|spec)\b/;

// The first file-editing action verb an edits-off node's prompt POSITIVELY asks for (else null),
// scanned per sentence so list-negation and deliverable-writing are excluded.
function askedActionVerb(prompt: string | null): string | null {
  if (!prompt) return null;
  for (const sentence of prompt.toLowerCase().split(/[.!?\n]+/)) {
    if (NEGATOR.test(sentence) || DELIVERABLE.test(sentence)) continue;
    for (const verb of ACTION_VERBS) {
      if (new RegExp(`\\b${verb}\\b`).test(sentence)) return verb;
    }
  }
  return null;
}

/**
 * The launch panel (M-brownfield Slice 2, D5). Clicking "Run this team" OPENS this; it does not fire
 * the run. One unified surface where the user (a) types a feature request (the idea — optional;
 * empty ⇒ the server default, the greenfield byte-for-byte contract), and (b) optionally points the
 * run at a real local git repo (a typed absolute path + a base branch), validated through
 * `POST /api/repo/inspect`. A large-repo advisory (D4) names the team's worker node(s). Run calls
 * back with the assembled options; the brownfield fields are included ONLY when the repo validated.
 *
 * Brownfield is a run-TARGET choice, not a separate mode — the team graph is identical either way.
 */
export function LaunchPanel({
  teamNodes,
  starting,
  onLaunch,
  onClose,
}: {
  teamNodes: TeamGraphNode[];
  starting: boolean;
  onLaunch: (opts: RunTeamOptions) => void;
  onClose: () => void;
}) {
  const [idea, setIdea] = useState("");
  const [repoOn, setRepoOn] = useState(false);
  const [repoPath, setRepoPath] = useState("");
  const [inspect, setInspect] = useState<RepoInspect | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [baseRef, setBaseRef] = useState("");
  const [hintDismissed, setHintDismissed] = useState(false);
  // scoped-mount Slice 2: the picked package to scope the run to. "" = whole repo (the default);
  // any other value is a tracked package dir threaded to the run as `subpath`.
  const [scope, setScope] = useState("");

  // The validated git result, narrowed to its `is_git: true` variant (else null). The whole
  // brownfield surface — branch dropdown, the hint, the Run-into-repo enablement — keys off this.
  const repoInfo = inspect && inspect.is_git ? inspect : null;
  const validated = repoOn && repoInfo !== null;

  const runInspect = async () => {
    const path = repoPath.trim();
    if (!path) {
      setInspect(null);
      return;
    }
    setInspecting(true);
    try {
      const result = await inspectRepo(path);
      setInspect(result);
      if (result.is_git) {
        setBaseRef(result.current_branch ?? result.branches[0] ?? "");
        setHintDismissed(false);
        setScope(""); // a fresh repo defaults to whole-repo (never carry a stale package)
      }
    } catch {
      setInspect({ is_git: false, error: "Couldn't reach the server to inspect that path." });
    } finally {
      setInspecting(false);
    }
  };

  // D4: the worker nodes whose model the hint suggests strengthening — agent-kind nodes, by their
  // visible label (`role_name`). Empty for a thinker-only team (then the hint omits the names).
  const workerNames = teamNodes.filter((n) => n.kind === "agent").map((n) => n.role_name);
  // scoped-mount Slice 2: the repo's top-level packages the Scope picker offers ([] when the repo
  // has none, or on a client/fixture predating the field). Whole repo = "" (the default).
  const subpaths = repoInfo?.subpaths ?? [];
  const bigRepo = validated && repoInfo.tracked_file_count > LARGE_REPO_FILE_THRESHOLD;
  // The large-repo advisory ESCALATES: it fires only while a big repo is still whole-repo
  // (scope === ""). Once a package is picked, scoping IS the fix for the context-overflow, so the
  // nudge resolves. Still dismissible (D4 — a recommendation, never a blocker).
  const showHint = bigRepo && !hintDismissed && scope === "";

  // M-unify U3: the pre-launch action-verb advisory (NON-BLOCKING) — every edits-off node whose prompt
  // POSITIVELY asks for a file edit. Independent of the repo target; a nudge, never a gate.
  const editsOffAsks = teamNodes
    .map((n) => ({ node: n, verb: isEditsOff(n) ? askedActionVerb(n.prompt) : null }))
    .filter((x): x is { node: TeamGraphNode; verb: string } => x.verb !== null);

  const launch = () => {
    const opts: RunTeamOptions = {};
    if (idea.trim()) opts.idea = idea.trim();
    if (validated) {
      opts.repo_path = repoPath.trim();
      opts.base_ref = baseRef;
      // scoped-mount Slice 2: only a picked package threads through; whole-repo ("") omits it, so
      // the whole-repo brownfield launch stays byte-for-byte the prior contract.
      if (scope) opts.subpath = scope;
    }
    onLaunch(opts);
  };

  // Run is disabled only when the user asked for a repo but it isn't a validated git repo (D5:
  // "the Run-into-repo path stays disabled" on a bad path). Greenfield is always launchable.
  const runDisabled = starting || (repoOn && !validated);

  const nodeWord = workerNames.length === 1 ? "node" : "node(s)";
  const hintNames = workerNames.length > 0 ? `: ${workerNames.join(", ")}` : "";

  return (
    <div className="tv-launch tv-card" role="dialog" aria-label="Launch run">
      <header className="tv-launch__head">
        <div className="tv-launch__title">Run this team</div>
        <button
          type="button"
          className="tv-panel__close"
          onClick={onClose}
          aria-label="Close launch panel"
          title="Close"
        >
          <X size={16} strokeWidth={1.7} />
        </button>
      </header>

      <div className="tv-launch__body">
        <label className="tv-field">
          <span className="tv-field__label">Feature request</span>
          <span className="tv-field__hint">
            What should the team build? Leave empty to use the default idea.
          </span>
          <textarea
            className="tv-launch__input tv-launch__textarea"
            value={idea}
            rows={3}
            aria-label="Feature request"
            placeholder="e.g. Add a subtract(a, b) function and a unit test."
            onChange={(e) => setIdea(e.target.value)}
          />
        </label>

        <div className="tv-field">
          <span className="tv-field__label">Work on a local repo</span>
          <div className="tv-seg" role="group" aria-label="Work on a local repo">
            <button
              type="button"
              aria-pressed={!repoOn}
              className={`tv-seg__btn${!repoOn ? " tv-seg__btn--active" : ""}`}
              onClick={() => setRepoOn(false)}
            >
              Off
            </button>
            <button
              type="button"
              aria-pressed={repoOn}
              className={`tv-seg__btn${repoOn ? " tv-seg__btn--active" : ""}`}
              onClick={() => setRepoOn(true)}
            >
              On
            </button>
          </div>
          <span className="tv-field__hint">
            Off ⇒ a fresh greenfield app. On ⇒ the team works on an isolated branch of your real
            repo; your working tree is never touched.
          </span>
        </div>

        {repoOn && (
          <>
            <label className="tv-field">
              <span className="tv-field__label">Repo path</span>
              <span className="tv-field__hint">
                Absolute path to a local git repo (typed — a browser can’t hand the server a
                folder).
              </span>
              <input
                className="tv-launch__input"
                type="text"
                value={repoPath}
                spellCheck={false}
                aria-label="Repo path"
                placeholder="/Users/you/code/your-repo"
                onChange={(e) => {
                  setRepoPath(e.target.value);
                  setInspect(null);
                }}
                onBlur={() => void runInspect()}
              />
            </label>

            {inspecting && <p className="tv-launch__note">Inspecting…</p>}

            {inspect && !inspect.is_git && (
              <div className="tv-validity" role="status">
                <span className="tv-validity__lead">Not a git repo:</span>
                <span>{inspect.error}</span>
              </div>
            )}

            {validated && (
              <label className="tv-field">
                <span className="tv-field__label">Base branch</span>
                <span className="tv-field__hint">
                  The branch the run’s work branch is cut from. {repoInfo.tracked_file_count}{" "}
                  tracked files.
                </span>
                <select
                  className="tv-launch__input tv-launch__select"
                  value={baseRef}
                  aria-label="Base branch"
                  onChange={(e) => setBaseRef(e.target.value)}
                >
                  {repoInfo.branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {validated && subpaths.length > 0 && (
              <label className="tv-field">
                <span className="tv-field__label">Scope</span>
                <span className="tv-field__hint">
                  Limit the team to one package so it doesn’t drown in a large repo. Whole repo by
                  default.
                </span>
                <select
                  className="tv-launch__input tv-launch__select"
                  value={scope}
                  aria-label="Scope"
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="">Whole repo</option>
                  {subpaths.map((s) => (
                    <option key={s.path} value={s.path}>
                      {s.path} ({s.file_count} files)
                    </option>
                  ))}
                </select>
              </label>
            )}

            {showHint && (
              <div className="tv-launch__hint" role="note">
                <span>
                  Large repo (~{repoInfo.tracked_file_count} files). Working on existing code this
                  size is harder —{" "}
                  {subpaths.length > 0
                    ? "scope the run to a package above, or use a bigger-context model on your worker "
                    : "consider a stronger model on your worker "}
                  {nodeWord}
                  {hintNames}. Edit a node to change its model.
                </span>
                <button
                  type="button"
                  className="tv-btn tv-btn--link tv-launch__dismiss"
                  onClick={() => setHintDismissed(true)}
                >
                  Dismiss
                </button>
              </div>
            )}
          </>
        )}

        {editsOffAsks.length > 0 && (
          <div className="tv-launch__warn" role="note" aria-label="Edits-off action-verb advisory">
            {editsOffAsks.map(({ node, verb }) => (
              <span key={node.id}>
                <strong>{node.role_name}</strong> can’t write files (edits off) but its prompt asks
                it to <code>{verb}</code> — did you mean to allow edits?
              </span>
            ))}
          </div>
        )}

        <div className="tv-launch__actions">
          <button type="button" className="tv-btn" onClick={launch} disabled={runDisabled}>
            {starting ? "Starting…" : "Run"}
          </button>
          <button type="button" className="tv-btn tv-btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
