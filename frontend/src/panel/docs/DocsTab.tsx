import { type ReactNode, useState } from "react";
import { ArrowRight, Check, ChevronDown, FileText, History, Pin } from "lucide-react";

import { Button, Menu } from "../../design-system/components";
import { listRunDocs, type NodeRuns, type NodeRunSummary, type RunDoc } from "../../lib/api/nodes";
import { PrdView } from "../PrdView";
import { runLine, whenShort } from "../runs/rounds";
import { SubView } from "../SubView";
import { EmptyCard, LoadState } from "../runs/RunsTab";
import { type Loaded, useLoaded } from "../runs/useLoaded";
import { agentDocs, readBy, specLine, versionLine, writtenBy } from "./agentDocs";
import "./docs.css";

export interface DocsTabProps {
  nodeId: string;
  name: string;
  isEntry: boolean;
  /** It branches on a verdict, so it writes no document (Q3). */
  verdict: boolean;
  writesTo: string;
  readsFrom: readonly string[];
  /** The team's agents, for "read by all 3 agents". */
  agentCount: number;
  /** This agent's runs (the same history the Runs tab shows); "idle" when it never ran. */
  history: Loaded<NodeRuns>;
  /** Open a document (in the drawer). */
  onOpenDoc: (doc: RunDoc) => void;
  /** "See all documents in this run" (in the drawer). */
  onOpenAll: (docs: RunDoc[]) => void;
  /** "Set in Setup": the Setup tab, on Reads or Writes. */
  onSetup: (row: "reads" | "writes") => void;
}

/**
 * Docs (PANEL-75..80): the documents of one of this agent's runs — the shared spec, what this agent
 * writes and what it reads — with the run switcher ("Change") and a link to all of the run's
 * documents.
 */
export function DocsTab(props: DocsTabProps) {
  const { history } = props;
  const [picked, setPicked] = useState<string | null>(null);
  if (history.state === "loading" || history.state === "error") {
    return (
      <LoadState
        state={history.state}
        loading="Loading runs"
        error="Couldn’t load this agent’s runs."
        onRetry={history.retry}
      />
    );
  }
  const runs = history.value?.runs ?? [];
  const run = runs.find((r) => r.run_id === picked) ?? runs[0];
  if (!run) {
    return (
      <EmptyCard
        title="No documents yet"
        icon={<FileText size={28} strokeWidth={1.4} aria-hidden />}
      >
        Run the team and this agent’s documents show up here.
      </EmptyCard>
    );
  }
  return <RunDocs key={run.run_id} {...props} run={run} runs={runs} onPick={setPicked} />;
}

function RunDocs({
  nodeId,
  name,
  isEntry,
  verdict,
  writesTo,
  readsFrom,
  agentCount,
  onOpenDoc,
  onOpenAll,
  onSetup,
  run,
  runs,
  onPick,
}: DocsTabProps & {
  run: NodeRunSummary;
  runs: NodeRunSummary[];
  onPick: (runId: string) => void;
}) {
  const docs = useLoaded(run.run_id, () => listRunDocs(run.run_id));
  const when = whenShort(run.last_round_at ?? run.created_at);
  const open = (doc: RunDoc) => () => onOpenDoc(doc);

  let body: ReactNode;
  if (docs.state !== "ready") {
    body = (
      <LoadState
        state={docs.state === "error" ? "error" : "loading"}
        loading="Loading documents"
        error="Couldn’t load this run’s documents."
        onRetry={docs.retry}
      />
    );
  } else {
    const mine = agentDocs(docs.value ?? [], nodeId, { writesTo, readsFrom });
    const setIn = (row: "reads" | "writes") => (
      <button type="button" className="nd-link" onClick={() => onSetup(row)}>
        Set in Setup
      </button>
    );
    let writes: ReactNode;
    if (isEntry) {
      writes = <Note>{name} is the entry agent, so it writes the Shared spec above.</Note>;
    } else if (mine.writes.length > 0 || mine.missingWrite) {
      writes = (
        <ul className="nd-docs__list">
          {mine.writes.map((d) => (
            <DocCard
              key={d.id}
              title={d.name}
              sub={readBy(d)}
              meta={versionLine(d)}
              onOpen={open(d)}
            />
          ))}
          {mine.missingWrite && <DocCard title={mine.missingWrite} sub="Not written in this run" />}
        </ul>
      );
    } else if (verdict) {
      // Q3: a verdict agent's Writes can't be chosen in Setup, so there's nothing to set there.
      writes = <Note>No document. Its verdict goes to Runs.</Note>;
    } else {
      writes = <Note action={setIn("writes")}>No document.</Note>;
    }
    let reads: ReactNode;
    if (isEntry) {
      reads = <Note>The idea you type when you press Run.</Note>;
    } else if (mine.reads.length > 0 || mine.missingReads.length > 0) {
      reads = (
        <ul className="nd-docs__list">
          {mine.reads.map((d) =>
            d.is_shared_spec ? (
              <DocCard
                key={d.id}
                title="Shared spec"
                sub={readsFrom.length === 0 ? "Read first, by default" : writtenBy(d)}
                meta={
                  d.latest_version ? `v${d.latest_version.version_no} · same as above` : undefined
                }
                onOpen={open(d)}
              />
            ) : (
              <DocCard
                key={d.id}
                title={d.name}
                sub={writtenBy(d)}
                meta={versionLine(d)}
                onOpen={open(d)}
              />
            ),
          )}
          {mine.missingReads.map((n) => (
            <DocCard key={n} title={n} sub="Not written in this run" />
          ))}
        </ul>
      );
    } else {
      reads = <Note action={setIn("reads")}>Reads no documents.</Note>;
    }
    body = (
      <>
        {mine.shared && (
          <ul className="nd-docs__list">
            <DocCard
              shared
              title="Shared spec"
              sub={specLine(mine.shared)}
              meta={versionLine(mine.shared, agentCount)}
              onOpen={open(mine.shared)}
            />
          </ul>
        )}
        <Group title="This agent writes">{writes}</Group>
        <Group title="This agent reads">{reads}</Group>
      </>
    );
  }

  return (
    <div className="nd-docs">
      <div className="nd-docs__from">
        <span className="nd-docs__run">
          <History size={13} strokeWidth={1.6} aria-hidden />
          From run “{run.idea || "Untitled run"}”{when && ` · ${when}`}
        </span>
        <Menu
          label="Choose a run"
          items={runs.map((r) => ({
            key: r.run_id,
            label: r.idea || "Untitled run",
            description: runLine(r),
            icon:
              r.run_id === run.run_id ? (
                <Check size={15} strokeWidth={1.6} aria-hidden />
              ) : (
                <span />
              ),
            onSelect: () => onPick(r.run_id),
          }))}
          trigger={(t) => (
            <button type="button" className="nd-docs__change" {...t}>
              Change
              <ChevronDown size={12} strokeWidth={1.6} aria-hidden />
            </button>
          )}
        />
      </div>
      {body}
      {docs.state === "ready" && (
        <button
          type="button"
          className="nd-link nd-docs__all"
          onClick={() => onOpenAll(docs.value ?? [])}
        >
          See all documents in this run
          <ArrowRight size={14} strokeWidth={1.6} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** The Docs tab's sheet: one document open, over the run's list when it came from there. */
export interface DocSheetState {
  /** "See all documents in this run" (null: a document opened from the tab). */
  docs: RunDoc[] | null;
  open: RunDoc | null;
}

const docTitle = (doc: RunDoc) => (doc.is_shared_spec ? "Shared spec" : doc.name);

/**
 * The run's documents inside the drawer (PANEL-76/79), read-only: every document of the run, or one
 * document with its versions (`PrdView`). The Docs area's viewer and documents drawer replace it.
 */
export function RunDocSheet({
  sheet,
  onChange,
  onClose,
}: {
  sheet: DocSheetState;
  onChange: (next: DocSheetState) => void;
  onClose: () => void;
}) {
  const { docs, open } = sheet;
  if (open) {
    return (
      <SubView
        title={docTitle(open)}
        backLabel={docs ? "Back to documents" : "Back"}
        onBack={docs ? () => onChange({ docs, open: null }) : onClose}
      >
        <PrdView
          documentId={open.id}
          editable={false}
          emptyHint=""
          subject={open.is_shared_spec ? "spec" : "document"}
        />
      </SubView>
    );
  }
  return (
    <SubView title="Documents in this run" onBack={onClose}>
      {docs && docs.length > 0 ? (
        <ul className="nd-docs__list">
          {docs.map((d) => (
            <DocCard
              key={d.id}
              shared={d.is_shared_spec}
              title={docTitle(d)}
              sub={d.is_shared_spec ? specLine(d) : writtenBy(d)}
              meta={versionLine(d)}
              onOpen={() => onChange({ docs, open: d })}
            />
          ))}
        </ul>
      ) : (
        <Note>No documents in this run.</Note>
      )}
    </SubView>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="nd-docs__group">
      <div className="nd-section__head">
        <span className="nd-section__title">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Note({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="nd-docs__note">
      <span>{children}</span>
      {action}
    </div>
  );
}

function DocCard({
  title,
  sub,
  meta,
  shared = false,
  onOpen,
}: {
  title: string;
  sub: string;
  meta?: string;
  shared?: boolean;
  onOpen?: () => void;
}) {
  return (
    <li className={`nd-doc${shared ? " nd-doc--shared" : ""}`}>
      {shared && (
        <span className="nd-doc__eyebrow">
          <Pin size={11} strokeWidth={1.6} aria-hidden />
          Shared · everyone reads this
        </span>
      )}
      <div className="nd-doc__row">
        <span className="nd-doc__icon">
          <FileText size={15} strokeWidth={1.6} aria-hidden />
        </span>
        <div className="nd-doc__id">
          <div className="nd-doc__title">{title}</div>
          <div className="nd-doc__sub">{sub}</div>
        </div>
        {onOpen && (
          <Button variant="secondary" size="sm" onClick={onOpen}>
            Open
          </Button>
        )}
      </div>
      {meta && <div className="nd-doc__meta">{meta}</div>}
    </li>
  );
}
