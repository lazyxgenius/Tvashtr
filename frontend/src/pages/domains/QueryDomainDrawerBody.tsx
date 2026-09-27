/**
 * The Query domain node's drawer (DM-100…104, Dm-QueryNode, DmF-Step-4/5, DmF-Canvas-2/3). The
 * drawer shell (header, close) is the panel's: `QueryDomainPanel` loads what the drawer needs and
 * hands the shell a title, a subtitle ("Look up support docs · run 14") and this body.
 *
 * Setup: the Domain combobox (each domain with its status; one with no files can't be picked;
 * **New domain…** makes one and picks it), the line under the pick, "Question to ask", "Pass the
 * answer to the next agents" and "If the domain has no answer", then **Save**. Picking a domain on a
 * node still at its defaults renames it "Look up <name>" and fills the question (DM-101).
 * Last run (once it ran): the round, its badge, time and cost, what it asked, the answer with its
 * number chips and the sources, and where the answer went.
 */
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, ChevronDown, XCircle } from "lucide-react";

import { Button, Select, Switch, Tabs, TextArea } from "../../design-system/components";
import { cx, useDismiss } from "../../design-system/components/utils";
import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import {
  type DomainListItem,
  type NoAnswerPolicy,
  type QueryNodeLastRun,
  type QueryNodeRound,
  type QueryNodeSettings,
  getQueryNodeLastRun,
  listDomainSummaries,
  saveQueryNode,
} from "../../lib/api/domains";
import { SourceChip } from "./AnswerCard";
import { NewDomainDialog } from "./NewDomainDialog";
import { PassageExcerpt } from "./SourcesAside";
import { parseInline, passageMeta, sentenceCiting } from "./answerMarkers";
import {
  DEFAULT_TITLE,
  IDEA,
  NO_ANSWER_OPTIONS,
  afterPick,
  domainStatusLine,
  drawerSubtitle,
  passHelper,
  pickedStatus,
  readersAfter,
  roundBadge,
  roundMeta,
  specLine,
  usableDomain,
} from "./queryNodeFormat";
import { publishDomainNav } from "./useDomainList";
import "./ask.css";
import "./domains.css";
import "./newDomain.css";
import "./teams.css";
import "./queryNode.css";

const LEDE = "One cited lookup, every run. The answer and its sources show on the run log.";
const HELPER = "{idea} is replaced by the idea you launch the run with.";
const SAVED = "Saved — this drives the next run you launch.";

/** The node's settings as stored (absent pass/no-answer = off / keep going, OQ-21). */
function settingsOf(node: Pick<TeamGraphNode, "config" | "prompt">): QueryNodeSettings {
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  return {
    domain_id: typeof cfg.domain_id === "string" && cfg.domain_id ? cfg.domain_id : null,
    prompt: node.prompt ?? IDEA,
    title: typeof cfg.title === "string" ? cfg.title : "",
    pass_to_spec: cfg.pass_to_spec === true,
    on_no_answer: cfg.on_no_answer === "stop" ? "stop" : "continue",
  };
}

function DomainOptions({
  domains,
  selected,
  onPick,
  onNew,
}: {
  domains: DomainListItem[];
  selected: string | null;
  onPick: (d: DomainListItem) => void;
  onNew: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const move = (step: 1 | -1) => {
    const opts = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [],
    );
    const at = opts.findIndex((o) => o === document.activeElement);
    opts[Math.max(0, Math.min(opts.length - 1, at + step))]?.focus();
  };
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Domain"
      className="dm-rmlist dm-addstep__list dm-qd__list"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          move(e.key === "ArrowDown" ? 1 : -1);
        }
      }}
    >
      {domains.map((d) => {
        const on = d.domain_id === selected;
        const usable = usableDomain(d);
        return (
          <button
            key={d.domain_id}
            type="button"
            role="option"
            aria-selected={on}
            disabled={!usable}
            className="dm-rmopt dm-addstep__opt"
            onClick={() => onPick(d)}
          >
            {on ? (
              <Check className="dm-rmopt__check" size={15} strokeWidth={2} aria-hidden />
            ) : (
              <span className="dm-rmopt__pad" />
            )}
            <span className="dm-rmopt__text">
              <span className="dm-rmopt__label">{d.name}</span>
              <span className="dm-rmopt__sub">
                {usable ? domainStatusLine(d) : "No files yet — can’t be used"}
              </span>
            </span>
          </button>
        );
      })}
      {domains.length > 0 && <div role="separator" className="dm-qd__sep" />}
      <button
        type="button"
        role="option"
        aria-selected={false}
        className="dm-rmopt dm-addstep__opt"
        onClick={onNew}
      >
        <span className="dm-rmopt__pad" />
        <span className="dm-rmopt__text">
          <span className="dm-rmopt__label">New domain…</span>
        </span>
      </button>
    </div>
  );
}

function DomainPicker({
  domains,
  value,
  onPick,
  onNew,
}: {
  domains: DomainListItem[] | null;
  value: string | null;
  onPick: (d: DomainListItem) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const valueId = useId();
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  useDismiss(open, close, wrapRef);
  useEffect(() => {
    if (!open) return;
    const list = wrapRef.current;
    (
      list?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
      list?.querySelector<HTMLElement>('[role="option"]:not(:disabled)')
    )?.focus();
  }, [open]);

  const picked = domains?.find((d) => d.domain_id === value) ?? null;
  const status = picked ? pickedStatus(picked) : null;
  return (
    <div className="dm-qd__domain">
      <div className="dm-addstep__team" ref={wrapRef}>
        <div className={cx("ds-field", open && "dm-addstep__field--open")}>
          <span id={labelId} className={open ? "dm-addstep__label" : "ds-field__label"}>
            Domain
          </span>
          <button
            ref={buttonRef}
            type="button"
            className={cx("dm-sort__btn", open ? "dm-sort__btn--open" : "ds-select")}
            aria-labelledby={`${labelId} ${valueId}`}
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={!domains}
            onClick={() => (open ? close() : setOpen(true))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setOpen(true);
              }
            }}
          >
            <span id={valueId} className="dm-sort__value">
              {picked?.name ?? (domains ? "Pick a domain" : "Loading domains…")}
            </span>
            <ChevronDown
              className="dm-sort__chevron"
              size={open ? 15 : 16}
              strokeWidth={1.6}
              aria-hidden
            />
          </button>
        </div>
        {open && domains && (
          <DomainOptions
            domains={domains}
            selected={value}
            onPick={(d) => {
              onPick(d);
              close();
            }}
            onNew={() => {
              setOpen(false);
              onNew();
            }}
          />
        )}
      </div>
      {status && (
        <span className={cx("dm-qd__status", status.tone === "warn" && "dm-qd__status--warn")}>
          {status.tone === "ok" ? (
            <CheckCircle2 size={14} strokeWidth={1.6} aria-hidden />
          ) : (
            <AlertCircle size={14} strokeWidth={1.6} aria-hidden />
          )}
          {status.text}
        </span>
      )}
    </div>
  );
}

function Answer({ text }: { text: string }) {
  return (
    <div className="dm-qd__answer">
      {parseInline(text.replace(/\s*\n+\s*/g, " ")).map((part, i) =>
        part.kind === "chip" ? (
          <SourceChip key={i} n={part.n} />
        ) : part.kind === "bold" ? (
          <b key={i}>{part.text}</b>
        ) : part.kind === "code" ? (
          <code key={i}>{part.text}</code>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </div>
  );
}

export function LastRunBody({ round }: { round: QueryNodeRound }) {
  const badge = roundBadge(round);
  const meta = roundMeta(round);
  const line = specLine(round);
  const showAnswer = round.status !== "failed" && round.covered !== false && !!round.answer_text;
  return (
    <>
      <div className="dm-qd__round">
        <span className="dm-qd__roundno">Round {round.iteration}</span>
        {badge && <span className={`dm-pill dm-qd__badge--${badge.tone}`}>{badge.label}</span>}
        {meta && <span className="dm-qd__meta">{meta}</span>}
      </div>
      {round.question && <div className="dm-qd__asked">Asked: “{round.question}”</div>}
      {showAnswer && <Answer text={round.answer_text} />}
      {round.sources.length > 0 && (
        <aside className="dm-aside dm-qd__sources" aria-label="Sources">
          <div className="dm-aside__head">
            <span className="dm-aside__title">Sources for this answer</span>
          </div>
          <div className="dm-aside__list">
            {round.sources.map((p) => (
              <div key={p.number} className="dm-passage dm-qd__passage">
                <div className="dm-passage__head">
                  <SourceChip n={p.number} />
                  <span className="dm-passage__file">{p.filename}</span>
                  <span className="dm-passage__meta">{passageMeta(p, false)}</span>
                </div>
                <PassageExcerpt passage={p} cited={sentenceCiting(round.answer_text, p.number)} />
              </div>
            ))}
          </div>
        </aside>
      )}
      <span className={cx("dm-qd__status", `dm-qd__status--${line.tone}`)}>
        {line.tone === "ok" ? (
          <CheckCircle2 size={14} strokeWidth={1.6} aria-hidden />
        ) : line.tone === "danger" ? (
          <XCircle size={14} strokeWidth={1.6} aria-hidden />
        ) : null}
        {line.text}
      </span>
    </>
  );
}

type Tab = "setup" | "run";

export function QueryDomainDrawerBody({
  teamId,
  node,
  nodes,
  edges,
  domains,
  lastRun,
  onDomainsChanged,
  onSaved,
  onDraft,
}: {
  teamId: string;
  node: TeamGraphNode;
  nodes: TeamGraphNode[];
  edges: GraphEdge[];
  /** The account's domains (`null` while loading). */
  domains: DomainListItem[] | null;
  lastRun: QueryNodeLastRun | null;
  /** A domain was made from **New domain…** (reload the list). */
  onDomainsChanged: () => Promise<void> | void;
  onSaved: () => Promise<void> | void;
  /** The settings as edited (the drawer's subtitle and the canvas card follow them). */
  onDraft?: (draft: QueryNodeSettings) => void;
}) {
  const saved = useMemo(() => settingsOf(node), [node]);
  const [draft, setDraft] = useState<QueryNodeSettings>(saved);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [creating, setCreating] = useState(false);
  const round = lastRun?.rounds[0] ?? null;
  const [tab, setTab] = useState<Tab>("setup");

  // Report each edit; the latest callback is read from a ref, so a new one doesn't re-report.
  const onDraftRef = useRef(onDraft);
  useEffect(() => {
    onDraftRef.current = onDraft;
  });
  useEffect(() => onDraftRef.current?.(draft), [draft]);

  const changed = (Object.keys(draft) as (keyof QueryNodeSettings)[]).filter(
    (k) => draft[k] !== saved[k],
  );
  const dirty = changed.length > 0;
  const readers = useMemo(() => readersAfter(node.id, nodes, edges), [node.id, nodes, edges]);

  const pick = (d: DomainListItem) => {
    const previous = domains?.find((x) => x.domain_id === draft.domain_id)?.name ?? null;
    setDraft((s) => ({ ...s, domain_id: d.domain_id, ...afterPick(s, previous, d.name) }));
    setSaveError(false);
  };

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const body: Partial<QueryNodeSettings> = {
        // Saving from this drawer always stores both settings, so the node runs the new steps.
        pass_to_spec: draft.pass_to_spec,
        on_no_answer: draft.on_no_answer,
      };
      for (const k of changed) Object.assign(body, { [k]: draft[k] });
      await saveQueryNode(teamId, node.id, body);
      await onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const setup = (
    <>
      <p className="dm-qd__lede">{LEDE}</p>
      <DomainPicker
        domains={domains}
        value={draft.domain_id}
        onPick={pick}
        onNew={() => setCreating(true)}
      />
      <TextArea
        label="Question to ask"
        helper={HELPER}
        rows={3}
        value={draft.prompt}
        onChange={(e) => {
          const prompt = e.currentTarget.value;
          setDraft((s) => ({ ...s, prompt }));
        }}
      />
      <div className="dm-qd__switch">
        <Switch
          label="Pass the answer to the next agents"
          checked={draft.pass_to_spec}
          onCheckedChange={(on) => setDraft((s) => ({ ...s, pass_to_spec: on }))}
        />
        <span className="dm-qd__helper">{passHelper(readers)}</span>
      </div>
      <Select
        label="If the domain has no answer"
        options={NO_ANSWER_OPTIONS}
        value={draft.on_no_answer}
        onChange={(e) => {
          const v = e.currentTarget.value as NoAnswerPolicy;
          setDraft((s) => ({ ...s, on_no_answer: v }));
        }}
      />
    </>
  );

  const showRun = tab === "run" && round !== null;
  return (
    <div className="dm-qd">
      <div className={cx("dm-qd__body", showRun && "dm-qd__body--run")}>
        {round && (
          <Tabs<Tab>
            className="dm-qd__tabs"
            aria-label="Query domain"
            items={[
              { value: "setup", label: "Setup" },
              { value: "run", label: "Last run" },
            ]}
            value={tab}
            onChange={setTab}
          />
        )}
        {showRun ? <LastRunBody round={round} /> : setup}
      </div>
      {!showRun && (
        <footer className="dm-qd__foot">
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty}
            loading={saving}
            onClick={() => void save()}
          >
            Save
          </Button>
          {saveError ? (
            <span className="dm-qd__note dm-qd__note--error" role="alert">
              Couldn’t save — try again.
            </span>
          ) : dirty ? (
            <span className="dm-qd__note">Unsaved changes</span>
          ) : (
            <span className="dm-qd__note dm-qd__note--saved">{SAVED}</span>
          )}
        </footer>
      )}
      <NewDomainDialog
        open={creating}
        existingNames={(domains ?? []).map((d) => d.name)}
        onClose={() => setCreating(false)}
        onCreated={(made) => {
          setCreating(false);
          void Promise.resolve(onDomainsChanged()).then(() => {
            setDraft((s) => ({
              ...s,
              domain_id: made.domain_id,
              ...afterPick(
                s,
                domains?.find((x) => x.domain_id === s.domain_id)?.name ?? null,
                made.name,
              ),
            }));
          });
        }}
      />
    </div>
  );
}

/** Loads the account's domains (and keeps the nav's copy fresh) and the node's latest run. */
function useQueryDomainData(
  teamId: string,
  nodeId: string,
): {
  domains: DomainListItem[] | null;
  lastRun: QueryNodeLastRun | null;
  reloadDomains: () => Promise<void>;
} {
  const [domains, setDomains] = useState<DomainListItem[] | null>(null);
  const [lastRun, setLastRun] = useState<QueryNodeLastRun | null>(null);
  const live = useRef(true);

  const reloadDomains = useCallback(async () => {
    try {
      const list = await listDomainSummaries();
      if (!live.current) return;
      setDomains(list);
      publishDomainNav(list);
    } catch {
      if (live.current) setDomains((d) => d ?? []);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void reloadDomains();
    getQueryNodeLastRun(teamId, nodeId)
      .then((run) => live.current && setLastRun(run))
      .catch(() => undefined);
    return () => {
      live.current = false;
    };
  }, [teamId, nodeId, reloadDomains]);

  return { domains, lastRun, reloadDomains };
}

/**
 * The drawer for one Query domain node: loads its data and renders `children` — the panel's shell —
 * with the title, the subtitle ("Look up support docs · run 14") and the body.
 */
export function QueryDomainPanel({
  teamId,
  node,
  nodes,
  edges,
  onSaved,
  onDraft,
  children,
}: {
  teamId: string;
  node: TeamGraphNode;
  nodes: TeamGraphNode[];
  edges: GraphEdge[];
  onSaved: () => Promise<void> | void;
  /** The drawer's unsaved settings, as edited (the canvas card previews them, DmF-Canvas-3). */
  onDraft?: (draft: QueryNodeSettings) => void;
  children: (shell: { title: string; subtitle: string; body: ReactNode }) => ReactNode;
}) {
  const { domains, lastRun, reloadDomains } = useQueryDomainData(teamId, node.id);
  const [title, setTitle] = useState(settingsOf(node).title);
  const report = useCallback(
    (draft: QueryNodeSettings) => {
      setTitle(draft.title);
      onDraft?.(draft);
    },
    [onDraft],
  );
  return children({
    title: DEFAULT_TITLE,
    subtitle: drawerSubtitle(title.trim() || DEFAULT_TITLE, lastRun?.number),
    body: (
      <QueryDomainDrawerBody
        teamId={teamId}
        node={node}
        nodes={nodes}
        edges={edges}
        domains={domains}
        lastRun={lastRun}
        onDomainsChanged={reloadDomains}
        onSaved={onSaved}
        onDraft={report}
      />
    ),
  });
}
