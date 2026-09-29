import { type ReactNode, useMemo } from "react";
import { FileText, History, Pin, Zap } from "lucide-react";

import { Badge, Button } from "../../design-system/components";
import type { DocDetail, DocVersion, RunDoc } from "../../lib/api/docs";
import { glyphForNode } from "../nodeGlyph";
import { whenShort } from "../runs/rounds";
import { docLabel } from "./agentDocs";
import { compareDocs, type DocDiff, linesLabel, renderMarkdown } from "./docMarkdown";
import {
  compareFrom,
  type DocPlace,
  pickVersions,
  readersOnly,
  versionNote,
  writerName,
} from "./docView";
import "./viewer.css";

/**
 * The panes the document viewer and the focus view's Docs tab share (DOCS-20..23, FOCUS-71..73):
 * the run's documents on the left, the document in the middle, its versions and readers on the right.
 */

/** The three columns: rail, the document, and the versions aside. */
export function DocColumns({
  rail,
  aside,
  narrow = false,
  children,
}: {
  rail: ReactNode;
  aside: ReactNode;
  /** The focus view's page is 620px wide, the viewer's 640px. */
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="dv-grid">
      {rail}
      <div className="dv-center">
        <div className={`dv-page${narrow ? " dv-page--narrow" : ""}`}>{children}</div>
      </div>
      {aside}
    </div>
  );
}

/** "This run’s documents" (DOCS-20 / FOCUS-71): pick one; the run it belongs to at the foot. */
export function DocRail({
  docs,
  currentId,
  onPick,
  run,
}: {
  docs: readonly RunDoc[];
  currentId: string;
  onPick: (doc: RunDoc) => void;
  /** 'Run “{idea}” · {when}' — or a run picker built on it. */
  run: ReactNode;
}) {
  return (
    <aside className="dv-rail" aria-label="This run’s documents">
      <div className="dv-label">This run’s documents</div>
      <ul className="dv-rail__list">
        {docs.map((d) => {
          const Icon = d.is_shared_spec ? Pin : FileText;
          const v = d.latest_version;
          return (
            <li key={d.id}>
              <button
                type="button"
                className={`dv-doc${d.id === currentId ? " dv-doc--on" : ""}`}
                aria-current={d.id === currentId || undefined}
                onClick={() => onPick(d)}
              >
                <span className="dv-doc__icon">
                  <Icon size={14} strokeWidth={1.6} aria-hidden />
                </span>
                <span>
                  <span className="dv-doc__title">{docLabel(d)}</span>
                  <span className="dv-doc__sub">
                    {writerName(d)} · {v ? `v${v.version_no}` : "no version yet"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {run}
    </aside>
  );
}

/** The rail's foot: 'Run “Add an RSI indicator” · 31m ago'. */
export function RunLine({ idea, when }: { idea: string; when: string }) {
  return (
    <>
      <History size={12} strokeWidth={1.6} aria-hidden /> Run “{idea || "Untitled run"}”
      {when && ` · ${when}`}
    </>
  );
}

/** Versions + Compare (DOCS-22, DOCS-33, DOCS-36) and "Who uses it" (DOCS-23). */
export function DocAside({
  detail,
  doc,
  place,
  onPlace,
}: {
  detail: DocDetail;
  /** The document in its run's list (writers and readers); null while that loads. */
  doc: RunDoc | null;
  place: DocPlace;
  onPlace: (next: DocPlace) => void;
}) {
  const { versions } = detail;
  const { latest, selected, from } = pickVersions(versions, place);
  const comparing = from !== null;
  const version = (no: number) => (no === latest?.version_no ? undefined : no);
  const pick = (v: DocVersion) => {
    if (!selected || v.version_no === selected.version_no) return;
    // Comparing: a click picks the version to compare with; otherwise it shows that version.
    onPlace(comparing ? { ...place, compare: v.version_no } : { version: version(v.version_no) });
  };
  const toggle = () =>
    onPlace(
      comparing || !selected
        ? { version: place.version }
        : { version: place.version, compare: compareFrom(versions, selected.version_no) },
    );
  return (
    <aside className="dv-side" aria-label="Versions">
      <div className="dv-side__head">
        <span className="dv-label">Versions</span>
        <Button
          variant={comparing ? "tint" : "ghost"}
          size="sm"
          aria-pressed={comparing}
          disabled={versions.length < 2}
          title={
            versions.length < 2 ? "Nothing to compare — this is the first version." : undefined
          }
          onClick={toggle}
        >
          Compare
        </Button>
      </div>
      <ul className="dv-vers">
        {[...versions].reverse().map((v) => {
          const on = v.version_no === selected?.version_no;
          const isFrom = v.version_no === from?.version_no;
          return (
            <li key={v.version_no}>
              <button
                type="button"
                className={`dv-ver${on ? " dv-ver--on" : isFrom ? " dv-ver--from" : ""}`}
                aria-current={on || undefined}
                onClick={() => pick(v)}
              >
                <div className="dv-ver__row">
                  <span className="dv-ver__no">v{v.version_no}</span>
                  {v.author?.kind === "human" ? (
                    <Badge variant="info">You</Badge>
                  ) : (
                    <Badge variant="neutral">Agent</Badge>
                  )}
                  <span className="dv-ver__when">{whenShort(v.created_at)}</span>
                </div>
                <div className="dv-ver__note">{versionNote(v)}</div>
              </button>
            </li>
          );
        })}
      </ul>
      {doc && <WhoUsesIt doc={doc} />}
    </aside>
  );
}

function WhoUsesIt({ doc }: { doc: RunDoc }) {
  const readers = readersOnly(doc);
  const writer = doc.written_by[0];
  const Glyph = doc.is_shared_spec ? Zap : glyphForNode("agent", writer?.role_name ?? "");
  return (
    <>
      <div className="dv-label">Who uses it</div>
      <div className="dv-who">
        <div className="dv-who__row">
          <span className="dv-who__key">Written by</span>
          <Glyph size={13} strokeWidth={1.6} aria-hidden />
          {writerName(doc)}
        </div>
        <div className="dv-who__row dv-who__row--top">
          <span className="dv-who__key">Read by</span>
          {readers.length > 0 ? (
            <span className="dv-who__badges">
              {readers.map((a) => (
                <Badge key={a.node_id} variant="neutral">
                  {a.label}
                </Badge>
              ))}
            </span>
          ) : (
            "No other agent"
          )}
        </div>
        {doc.is_shared_spec && (
          <div className="dv-who__note">
            Every agent reads the shared spec unless its Reads says otherwise.
          </div>
        )}
      </div>
    </>
  );
}

/** "Comparing v2 (You) → v3 (Product manager)   +2 lines  −1 line" (DOCS-34). */
function CompareBanner({ from, to, diff }: { from: DocVersion; to: DocVersion; diff: DocDiff }) {
  const who = (v: DocVersion) => ` (${v.author?.label ?? "Agent"})`;
  return (
    <div className="dv-compare" role="status">
      Comparing <b>v{from.version_no}</b>
      {who(from)} → <b>v{to.version_no}</b>
      {who(to)}
      <span className="dv-compare__counts">
        <span className="dv-compare__add">{linesLabel("+", diff.added)}</span>
        <span className="dv-compare__del">{linesLabel("−", diff.removed)}</span>
      </span>
    </div>
  );
}

/** The document, rendered (DOCS-21); comparing, the changes inline (DOCS-35). */
export function DocBody({ detail, place }: { detail: DocDetail; place: DocPlace }) {
  const { selected, from } = pickVersions(detail.versions, place);
  const content = selected?.content ?? "";
  const fromContent = from?.content ?? null;
  // One `{ __html }` object per text: a new object would make React rewrite the DOM on every render
  // (the run view re-renders on each poll), dropping the reader's text selection.
  const view = useMemo(() => {
    if (fromContent === null) return { html: { __html: renderMarkdown(content) }, diff: null };
    const diff = compareDocs(fromContent, content);
    return {
      html: null,
      diff,
      blocks: diff.blocks.map((b) => ({ op: b.op, html: { __html: b.html } })),
    };
  }, [fromContent, content]);
  if (!selected) return <p className="dv-empty">This document has no versions yet.</p>;
  if (!view.diff || !from)
    return <div className="dv-md" dangerouslySetInnerHTML={view.html ?? undefined} />;
  return (
    <>
      <CompareBanner from={from} to={selected} diff={view.diff} />
      <div className="dv-md">
        {view.blocks.map((b, i) => (
          <div
            key={i}
            className={b.op === "same" ? undefined : `dv-diff dv-diff--${b.op}`}
            {...(b.op !== "same" && {
              role: "group",
              "aria-label": b.op === "add" ? "Added" : "Removed",
            })}
            dangerouslySetInnerHTML={b.html}
          />
        ))}
      </div>
    </>
  );
}
