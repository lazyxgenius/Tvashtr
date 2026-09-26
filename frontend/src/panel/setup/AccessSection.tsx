import { FileText, Lock, Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import type { ChangeGroup } from "../agentDraft";
import { AccessConfirm } from "./AccessConfirm";
import {
  knownDocuments,
  readsChips,
  type ReadsValue,
  specNameOf,
  withoutRead,
  writableDocuments,
} from "./documents";
import { ReadsPicker } from "./ReadsPicker";
import { SettingRow, SettingSection } from "./SettingRow";
import { FILE_ACCESS_HINT, TIPS, WRITES_VERDICT_HINT, WRITES_VERDICT_WARNING } from "./setupCopy";
import { WritesPicker } from "./WritesPicker";

type Open = "access" | "reads" | "writes" | null;

/**
 * Access & documents (PANEL-49..56): File access, the documents it reads (in order) and the one it
 * writes. The entry agent stays read-only, starts from the idea and writes the shared spec (Q5).
 * An agent that routes on a verdict asks before it may edit files (Q6) and can't write a
 * document: its verdict goes to Runs (Q3).
 */
export function AccessSection({
  agentName,
  nodeId,
  nodes,
  edges,
  editsAllowed,
  onEditsChange,
  isEntry,
  verdict,
  reads,
  onReadsChange,
  writesTo,
  onWritesChange,
  onNewDocument,
  changed = [],
}: {
  agentName: string;
  nodeId: string;
  /** The saved team: the documents other agents write and read. */
  nodes: TeamGraphNode[];
  edges: GraphEdge[];
  editsAllowed: boolean;
  onEditsChange: (next: boolean) => void;
  isEntry: boolean;
  /** It routes on a verdict (a branch arrow out of it). */
  verdict: boolean;
  reads: ReadsValue;
  onReadsChange: (next: ReadsValue) => void;
  writesTo: string;
  onWritesChange: (next: string) => void;
  /** A Writes name no agent on the team uses yet was picked (the drawer's toast, PANEL-56). */
  onNewDocument?: () => void;
  /** The parts that differ from the saved agent (their rows get the Changed dot). */
  changed?: readonly ChangeGroup[];
}) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const accessRow = useRef<HTMLDivElement>(null);
  const readsRow = useRef<HTMLDivElement>(null);
  const writesRow = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);

  const spec = specNameOf(nodes, edges);
  const accessHint = isEntry ? (
    <span className="nd-hint__lock">
      <span>
        <Lock size={12} strokeWidth={1.8} aria-hidden />
      </span>
      {FILE_ACCESS_HINT.entry}
    </span>
  ) : editsAllowed ? (
    verdict ? (
      FILE_ACCESS_HINT.editsVerdict
    ) : (
      FILE_ACCESS_HINT.edits
    )
  ) : (
    FILE_ACCESS_HINT.readOnly
  );
  const allowEdits = () => {
    if (editsAllowed) return;
    // Q6: only an agent that routes on a verdict asks first; the others switch straight away.
    if (verdict) setOpen("access");
    else onEditsChange(true);
  };

  // The chips it reads, in order. With no names listed it reads the spec by default.
  const chips = readsChips(reads, spec);

  const pickWrites = (name: string) => {
    close();
    const known = knownDocuments({ nodes, edges, selfId: nodeId });
    if (name && name !== writesTo && !known.some((d) => d.name === name)) onNewDocument?.();
    onWritesChange(name);
  };

  let writesControl;
  if (isEntry) {
    writesControl = (
      <div className="nd-chips">
        <span className="nd-chip">
          <FileText size={13} strokeWidth={1.7} aria-hidden />
          {spec}
          <span className="nd-chip__tag">default</span>
        </span>
      </div>
    );
  } else if (writesTo) {
    writesControl = (
      <div className="nd-chips">
        <span className="nd-chip">
          <FileText size={13} strokeWidth={1.7} aria-hidden />
          {writesTo}
          <button
            type="button"
            className="nd-chip__x"
            aria-label={`Remove ${writesTo}`}
            onClick={() => onWritesChange("")}
          >
            <X size={12} strokeWidth={1.8} />
          </button>
        </span>
      </div>
    );
  } else {
    writesControl = (
      <div className="nd-writes">
        <span className="nd-muted">Nothing</span>
        <button
          ref={chooseButton}
          type="button"
          className="nd-dashed"
          data-setup-row="writes"
          aria-haspopup="dialog"
          aria-expanded={open === "writes"}
          disabled={verdict}
          onClick={() => setOpen(open === "writes" ? null : "writes")}
        >
          <Plus size={12} strokeWidth={1.8} aria-hidden />
          Choose
        </button>
      </div>
    );
  }
  const writesHint =
    !isEntry && verdict ? (
      writesTo ? (
        <span className="nd-hint--warn">{WRITES_VERDICT_WARNING}</span>
      ) : (
        WRITES_VERDICT_HINT
      )
    ) : undefined;

  return (
    <SettingSection title="Access & documents">
      <SettingRow
        label="File access"
        tip={TIPS.fileAccess}
        hint={accessHint}
        changed={changed.includes("fileAccess")}
        gridRef={accessRow}
        overlay={
          open === "access" && (
            <AccessConfirm
              agentName={agentName}
              anchorRef={accessRow}
              triggerRef={editButton}
              onKeep={close}
              onAllow={() => {
                close();
                onEditsChange(true);
              }}
            />
          )
        }
      >
        <div className="tv-seg nd-seg" role="group" aria-label="File access">
          <button
            ref={editButton}
            type="button"
            className={`tv-seg__btn${editsAllowed ? " tv-seg__btn--active" : ""}`}
            aria-pressed={editsAllowed}
            disabled={isEntry}
            onClick={allowEdits}
          >
            Can edit files
          </button>
          <button
            type="button"
            className={`tv-seg__btn${!editsAllowed ? " tv-seg__btn--active" : ""}`}
            aria-pressed={!editsAllowed}
            disabled={isEntry}
            onClick={() => {
              if (open === "access") close();
              onEditsChange(false);
            }}
          >
            Read-only
          </button>
        </div>
      </SettingRow>
      <SettingRow
        label="Reads"
        tip={TIPS.reads}
        changed={changed.includes("reads")}
        gridRef={readsRow}
        overlay={
          open === "reads" && (
            <ReadsPicker
              value={reads}
              spec={spec}
              documents={knownDocuments({
                nodes,
                edges,
                selfId: nodeId,
                draftReads: reads.readsFrom,
              })}
              onChange={onReadsChange}
              onClose={close}
              anchorRef={readsRow}
              triggerRef={addButton}
            />
          )
        }
      >
        {isEntry ? (
          <span className="nd-plain">The idea you type when you press Run</span>
        ) : (
          <div className="nd-chips">
            {chips.length === 0 && <span className="nd-muted">Nothing</span>}
            {chips.map((name) => (
              <span key={name} className="nd-chip">
                <FileText size={13} strokeWidth={1.7} aria-hidden />
                {name}
                {name === spec && <span className="nd-chip__tag">default</span>}
                <button
                  type="button"
                  className="nd-chip__x"
                  aria-label={`Remove ${name}`}
                  onClick={() => onReadsChange(withoutRead(reads, name, spec))}
                >
                  <X size={12} strokeWidth={1.8} />
                </button>
              </span>
            ))}
            <button
              ref={addButton}
              type="button"
              className="nd-dashed"
              data-setup-row="reads"
              aria-haspopup="dialog"
              aria-expanded={open === "reads"}
              onClick={() => setOpen(open === "reads" ? null : "reads")}
            >
              <Plus size={12} strokeWidth={1.8} aria-hidden />
              Add
            </button>
          </div>
        )}
      </SettingRow>
      <SettingRow
        label="Writes"
        tip={TIPS.writes}
        hint={writesHint}
        changed={changed.includes("writes")}
        gridRef={writesRow}
        overlay={
          open === "writes" && (
            <WritesPicker
              value={writesTo}
              documents={writableDocuments(knownDocuments({ nodes, edges, selfId: nodeId }))}
              onPick={pickWrites}
              onClose={close}
              anchorRef={writesRow}
              triggerRef={chooseButton}
            />
          )
        }
      >
        {writesControl}
      </SettingRow>
    </SettingSection>
  );
}
