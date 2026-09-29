import type { ReactNode } from "react";
import { ChevronDown, FileText, History, Info, X } from "lucide-react";

import { IconButton } from "../../design-system/components";
import { listRunDocs, type RunDoc, type TeamRun } from "../../lib/api/docs";
import { whenShort } from "../runs/rounds";
import { LoadState } from "../runs/RunsTab";
import { type Loaded, useLoaded } from "../runs/useLoaded";
import { docLabel, readersLine, specLine, versionLine, writtenBy } from "./agentDocs";
import { DocCard } from "./DocCard";
import { RunPicker } from "./RunPicker";
import "./docs.css";

const STATUS_WORD: Record<string, string> = {
  pending: "starting",
  running: "running",
  awaiting_human: "waiting for you",
  over_budget: "over budget",
};
const statusWord = (status: string) => STATUS_WORD[status] ?? status.replace(/_/g, " ");

/** When a run last moved: "31m ago" / "Sep 22". */
const runWhen = (r: TeamRun) => whenShort(r.updated_at ?? r.created_at);

export interface DocumentsDrawerProps {
  /** The team's runs, newest first (the run picker). */
  runs: Loaded<TeamRun[]>;
  /** The run whose documents are shown. */
  runId: string;
  /** Changes when a round finishes (the run view): the list looks again. */
  tick?: string;
  onPickRun: (runId: string) => void;
  /** The team's agents, for "read by all 3 agents". */
  agentCount: number;
  /** Open a document in the viewer. */
  onOpenDoc: (doc: RunDoc) => void;
  onClose: () => void;
}

/**
 * The toolbar's Documents drawer (DOCS-12..16): every document one run produced — the shared spec,
 * then what the agents wrote — with a picker for the team's other runs. It docks on the canvas's
 * left and never shows beside the agent drawer (OQ-20).
 */
export function DocumentsDrawer({
  runs,
  runId,
  tick = "",
  onPickRun,
  agentCount,
  onOpenDoc,
  onClose,
}: DocumentsDrawerProps) {
  // A finished round looks again, keeping the last answer meanwhile (never another run's).
  const docs = useLoaded(`${runId}:${tick}`, () => listRunDocs(runId), { keep: true });
  const value = docs.value?.run?.run_id === runId ? docs.value : null;
  const listed = runs.value?.find((r) => r.run_id === runId);
  const run = value?.run;
  const idea = listed?.idea ?? run?.idea ?? "";
  const when = listed ? runWhen(listed) : run ? whenShort(run.created_at) : "";

  let body: ReactNode;
  if (!value) {
    body = (
      <LoadState
        state={docs.state === "error" ? "error" : "loading"}
        loading="Loading documents"
        error="Couldn’t load this run’s documents."
        onRetry={docs.retry}
      />
    );
  } else {
    const all = value.documents;
    const shared = all.find((d) => d.is_shared_spec);
    const written = all.filter((d) => !d.is_shared_spec);
    body = (
      <>
        {shared && (
          <ul className="nd-docs__list">
            <DocCard
              shared
              title="Shared spec"
              sub={specLine(shared)}
              meta={versionLine(shared, agentCount)}
              onOpen={() => onOpenDoc(shared)}
            />
          </ul>
        )}
        <div className="dv-drawer__label">Written by agents</div>
        {written.length > 0 ? (
          <ul className="nd-docs__list dv-drawer__written">
            {written.map((d) => (
              <DocCard
                key={d.id}
                title={docLabel(d)}
                sub={writtenBy(d)}
                meta={readersLine(d)}
                onOpen={() => onOpenDoc(d)}
              />
            ))}
          </ul>
        ) : (
          <div className="nd-docs__note dv-drawer__written">
            {all.length === 0
              ? "No documents in this run yet."
              : "No agent wrote a document of its own in this run."}
          </div>
        )}
      </>
    );
  }

  return (
    <aside className="dv-drawer" aria-label="Documents">
      <header className="dv-drawer__head">
        <span className="dv-drawer__glyph">
          <FileText size={16} strokeWidth={1.6} aria-hidden />
        </span>
        <div className="dv-drawer__titles">
          <div className="dv-drawer__title">Documents</div>
          <div className="dv-drawer__sub">What this team’s agents wrote</div>
        </div>
        <IconButton size="sm" aria-label="Close documents" onClick={onClose}>
          <X size={16} strokeWidth={1.6} />
        </IconButton>
      </header>
      <>
        <div className="dv-drawer__run">
          <RunPicker
            runs={(runs.value ?? []).map((r) => ({
              run_id: r.run_id,
              idea: r.idea,
              detail: [runWhen(r), statusWord(r.status)].filter(Boolean).join(" · "),
            }))}
            current={runId}
            onPick={onPickRun}
            trigger={(t) => (
              <button type="button" className="dv-drawer__runbtn" {...t}>
                <History size={14} strokeWidth={1.6} aria-hidden />
                <span>
                  Run: <b>{idea || "Untitled run"}</b>
                  {when && ` · ${when}`}
                </span>
                <span className="dv-drawer__chev">
                  <ChevronDown size={14} strokeWidth={1.6} aria-hidden />
                </span>
              </button>
            )}
          />
        </div>
        <div className="dv-drawer__body">
          {body}
          <div className="dv-drawer__foot">
            <span className="dv-drawer__footicon">
              <Info size={13} strokeWidth={1.6} aria-hidden />
            </span>
            <span>
              Documents belong to a run. While a run is live you can edit the shared spec to steer
              it.
            </span>
          </div>
        </div>
      </>
    </aside>
  );
}
