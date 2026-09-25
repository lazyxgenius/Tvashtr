import { Maximize2, ShieldCheck } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useState } from "react";

import { type DocumentDetail, getDocument, getGraph } from "../../lib/api";
import type { InboxApproval } from "../../lib/api/home";
import { Badge, Button, ConfirmDialog, Sheet, TextArea } from "../../design-system/components";
import { approvalTitle, elapsedShort } from "./homeFormat";

const ROLE_NAMES: Record<string, string> = {
  pm: "Product manager",
  architect: "Architect",
  engineer: "Engineer",
  reviewer: "Reviewer",
};

/** Inline `code` and **bold** inside one line of the spec. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) out.push(<code key={i++}>{tok.slice(1, -1)}</code>);
    else out.push(<b key={i++}>{tok.slice(2, -2)}</b>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The spec as the design shows it: h1, paragraphs, h2 sections and bullet lists. */
export function SpecMarkdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
      para = [];
    }
  };
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push(
        h[1].length === 1 ? (
          <h1 key={blocks.length}>{inline(h[2])}</h1>
        ) : (
          <h2 key={blocks.length}>{inline(h[2])}</h2>
        ),
      );
    } else if (li) {
      flush();
      blocks.push(
        <div key={blocks.length} className="hm-spec__li">
          <span className="hm-spec__bullet">•</span>
          <span>{inline(li[1])}</span>
        </div>,
      );
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return <Fragment>{blocks}</Fragment>;
}

/**
 * "Approve the spec" (HmF-Approve-2): a 620px sheet beside Home with who wrote the spec, its
 * version and how long the run has waited, the paused-at note, the spec itself, and Open run /
 * Reject… / Approve and continue. Reject… stacks the "Reject the spec?" alertdialog (HmF-Reject-1)
 * with an optional note.
 */
export function ApproveSheet({
  item,
  onClose,
  onOpenRun,
  onApprove,
  onReject,
}: {
  item: InboxApproval | null;
  onClose: () => void;
  onOpenRun: () => void;
  onApprove: () => Promise<void>;
  onReject: (note: string) => Promise<void>;
}) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [docError, setDocError] = useState(false);
  const [author, setAuthor] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const runId = item?.run.id ?? null;
  const documentId = item?.document_id ?? null;

  useEffect(() => {
    setDoc(null);
    setDocError(false);
    setAuthor(null);
    setRejecting(false);
    setNote("");
    if (!documentId || !runId) return;
    let live = true;
    getDocument(documentId)
      .then((d) => live && setDoc(d))
      .catch(() => live && setDocError(true));
    getGraph(runId)
      .then((g) => {
        if (!live) return;
        const targets = new Set(g.edges.map((e) => e.target_node_id));
        const entry = g.nodes.find((n) => !targets.has(n.id)) ?? g.nodes[0];
        if (!entry) return;
        const title = (entry.config as { title?: unknown } | null)?.title;
        setAuthor(
          typeof title === "string" && title
            ? title
            : (ROLE_NAMES[entry.role_name] ?? entry.role_name),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [documentId, runId]);

  if (!item) return null;
  const latest = doc?.versions[doc.versions.length - 1] ?? null;
  const writtenBy =
    latest?.created_by === "human" ? "Edited by you" : author ? `Written by ${author}` : null;
  const title = approvalTitle(item.task.kind);
  const teamName = item.team?.name ?? "This team";

  const approve = async () => {
    setBusy("approve");
    try {
      await onApprove();
    } finally {
      setBusy(null);
    }
  };
  const reject = async () => {
    setBusy("reject");
    try {
      await onReject(note.trim());
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Sheet
        open
        width={620}
        title={title}
        subtitle={`${teamName} · “${item.run.idea}”`}
        onClose={onClose}
        footerNote={
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<Maximize2 size={13} strokeWidth={1.6} aria-hidden />}
            onClick={onOpenRun}
          >
            Open run
          </Button>
        }
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRejecting(true)}
              disabled={busy !== null}
            >
              Reject…
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy === "approve"}
              onClick={() => void approve()}
            >
              Approve and continue
            </Button>
          </>
        }
      >
        <div className="hm-approve__badges">
          {writtenBy && <Badge variant="neutral">{writtenBy}</Badge>}
          {latest && <Badge variant="neutral">Version {latest.version_no}</Badge>}
          <Badge variant="warning" dot>
            Waiting {elapsedShort(item.since)}
          </Badge>
        </div>
        <div className="hm-approve__note">
          <ShieldCheck size={15} strokeWidth={1.6} aria-hidden />
          <span>
            The run is paused at <b>{item.task.gate_role}</b>.{" "}
            {item.task.next_role
              ? `Approve to let the ${item.task.next_role} start building.`
              : "Approve to let the run continue."}
            {documentId ? " You can still edit the spec while the run is live." : ""}
          </span>
        </div>
        {documentId ? (
          <div className="hm-spec">
            {latest ? (
              <SpecMarkdown source={latest.content} />
            ) : docError ? (
              <p>Couldn’t load the spec. Open the run to read it.</p>
            ) : (
              <p className="hm-spec__loading">Loading the spec…</p>
            )}
          </div>
        ) : (
          <div className="hm-spec">
            <p>{item.task.title}</p>
          </div>
        )}
      </Sheet>
      <ConfirmDialog
        open={rejecting}
        title={item.task.kind === "prd_approval" ? "Reject the spec?" : "Reject and stop?"}
        confirmLabel="Reject and stop run"
        busy={busy === "reject"}
        onConfirm={() => void reject()}
        onCancel={() => setRejecting(false)}
      >
        <div className="hm-reject">
          <span>The run stops and is marked Stopped. Nothing is built or pushed.</span>
          <TextArea
            label="What should change next time?"
            optional
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
