import { type ReactNode, useState } from "react";
import { FileText, Maximize2, Pin } from "lucide-react";

import { Badge, Button } from "../../design-system/components";
import { getDocument, listRunDocs, type RunDoc } from "../../lib/api/docs";
import type { NodeRuns } from "../../lib/api/nodes";
import { DocAside, DocBody, DocColumns, DocRail, RunLine } from "../docs/DocPanes";
import { type DocPlace, pickVersions } from "../docs/docView";
import { RunPicker } from "../docs/RunPicker";
import { runLine, whenShort } from "../runs/rounds";
import { EmptyCard, LoadState } from "../runs/RunsTab";
import { type Loaded, useLoaded } from "../runs/useLoaded";

/**
 * The focus view's Docs tab (Focus-Docs, FOCUS-71..73): the documents of one of this agent's runs in
 * the viewer's three panes — the run's documents, the chosen one rendered, its versions and readers.
 * The rail's foot picks another run (OQ-16); Open takes the document to the viewer.
 */
export function FocusDocsTab({
  history,
  onOpenDoc,
}: {
  /** This agent's runs (the drawer's Docs and Runs tabs read the same history). */
  history: Loaded<NodeRuns>;
  onOpenDoc: (docId: string, place: DocPlace) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  if (history.state === "loading" || history.state === "error") {
    return (
      <div className="dv-center">
        <LoadState
          state={history.state}
          loading="Loading runs"
          error="Couldn’t load this agent’s runs."
          onRetry={history.retry}
        />
      </div>
    );
  }
  const runs = history.value?.runs ?? [];
  const run = runs.find((r) => r.run_id === picked) ?? runs[0];
  if (!run) {
    return (
      <div className="dv-center">
        <EmptyCard
          title="No documents yet"
          icon={<FileText size={28} strokeWidth={1.4} aria-hidden />}
        >
          Run the team and this agent’s documents show up here.
        </EmptyCard>
      </div>
    );
  }
  const foot = (
    <RunPicker
      runs={runs.map((r) => ({ run_id: r.run_id, idea: r.idea, detail: runLine(r) }))}
      current={run.run_id}
      onPick={setPicked}
      trigger={(t) => (
        <button type="button" className="dv-rail__run" {...t}>
          <RunLine idea={run.idea} when={whenShort(run.last_round_at ?? run.created_at)} />
        </button>
      )}
    />
  );
  return <RunDocs key={run.run_id} runId={run.run_id} foot={foot} onOpenDoc={onOpenDoc} />;
}

function RunDocs({
  runId,
  foot,
  onOpenDoc,
}: {
  runId: string;
  foot: ReactNode;
  onOpenDoc: (docId: string, place: DocPlace) => void;
}) {
  const docs = useLoaded(runId, () => listRunDocs(runId).then((d) => d.documents));
  const [chosen, setChosen] = useState<string | null>(null);
  const [place, setPlace] = useState<DocPlace>({});
  const all = docs.value ?? [];
  const doc = all.find((d) => d.id === chosen) ?? all.find((d) => d.is_shared_spec) ?? all[0];
  const detail = useLoaded(doc?.id ?? null, () => getDocument(doc?.id ?? ""));
  const pick = (d: RunDoc) => {
    setChosen(d.id);
    setPlace({});
  };
  const rail = <DocRail docs={all} currentId={doc?.id ?? ""} onPick={pick} run={foot} />;

  if (docs.state !== "ready" || !doc || detail.state !== "ready" || !detail.value) {
    const failed = docs.state === "error" || detail.state === "error";
    return (
      <DocColumns rail={rail} aside={<aside className="dv-side" aria-label="Versions" />} narrow>
        {docs.state === "ready" && !doc ? (
          <p className="dv-note">No documents in this run yet.</p>
        ) : (
          <LoadState
            state={failed ? "error" : "loading"}
            loading="Loading the document"
            error="Couldn’t load this run’s documents."
            onRetry={docs.state === "error" ? docs.retry : detail.retry}
          />
        )}
      </DocColumns>
    );
  }
  const shown = pickVersions(detail.value.versions, place).selected;
  return (
    <DocColumns
      rail={rail}
      aside={<DocAside detail={detail.value} doc={doc} place={place} onPlace={setPlace} />}
      narrow
    >
      <div className="dv-docmeta">
        {doc.is_shared_spec ? (
          <Badge variant="accent">
            <Pin size={11} strokeWidth={1.6} aria-hidden /> Shared spec
          </Badge>
        ) : (
          <Badge variant="neutral">{doc.name}</Badge>
        )}
        {shown && (
          <span className="dv-docmeta__line">
            v{shown.version_no} · written by {shown.author?.label ?? "an agent"} ·{" "}
            {whenShort(shown.created_at)}
          </span>
        )}
        <span className="dv-docmeta__open">
          <Button
            variant="secondary"
            size="sm"
            className="nd-btn-flush"
            onClick={() => onOpenDoc(doc.id, place)}
          >
            <Maximize2 size={13} strokeWidth={1.6} aria-hidden />
            <span>Open</span>
          </Button>
        </span>
      </div>
      <DocBody detail={detail.value} place={place} />
    </DocColumns>
  );
}
