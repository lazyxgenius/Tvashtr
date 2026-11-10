/** The Drafts tab (M2, prompts/m2-design/Drafts.dc.html): drafts a team handed in, newest batch
 *  first, each with its bar; the filters, the selection, Accept and Reject; each card with its
 *  Test / Training switch, its answer, its input, its source and the Reviewer's line. While a team
 *  works the cards appear (polled every 3 s) and accepting waits for the hand-in. */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Lock, TriangleAlert } from "lucide-react";

import { Button, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type Draft,
  type DraftBatch,
  type DraftKind,
  type Drafts,
  type ModelDetail,
  acceptDrafts,
  listDrafts,
  rejectDrafts,
  setDraftKind,
} from "../../lib/api/models";
import { acceptLine, ago, money, plural, sourceFileLine } from "./modelsFormat";

const POLL_MS = 3_000;
// The design shows the first four cards, then "Show all {n}" (Drafts.dc.html).
const FIRST_CARDS = 4;
const NOT_SAMPLED = "Passed the source check. The Reviewer checks a sample, not every draft.";
const STOPPED =
  "The run stopped before the Reviewer finished. These drafts passed the source check but weren't reviewed.";
const WAIT = "You can accept once the team hands in.";

type Filter = "all" | "test" | "training" | "flagged";

function BatchBar({ batch }: { batch: DraftBatch }) {
  const n = batch.drafts.length;
  if (batch.state === "drafting") {
    const wanted = batch.tests_wanted + batch.training_wanted;
    return (
      <div className="md-runbar" role="status">
        <span>
          <b>Drafting…</b> {batch.handed_in} of {wanted} so far
        </span>
        <span className="md-runbar__sep" aria-hidden />
        <span>
          <a href={batch.team_id ? `#/teams/${batch.team_id}` : "#"}>{batch.team_name}</a> · read{" "}
          <b>{batch.domain_name}</b>
        </span>
        <span className="md-runbar__sep" aria-hidden />
        <span>{WAIT}</span>
      </div>
    );
  }
  return (
    <div className="md-runbar">
      <span>
        <b>{plural(n, "draft")}</b> from{" "}
        <a href={batch.team_id ? `#/teams/${batch.team_id}` : "#"}>{batch.team_name}</a> · read{" "}
        <b>{batch.domain_name}</b>
      </span>
      {batch.state === "ready" && batch.completed_at && (
        <>
          <span className="md-runbar__sep" aria-hidden />
          <span>Finished {ago(batch.completed_at)}</span>
        </>
      )}
      {batch.cost_usd !== null && (
        <>
          <span className="md-runbar__sep" aria-hidden />
          <span>
            Cost <b>{money(batch.cost_usd)}</b>
          </span>
        </>
      )}
      <span className="md-runbar__sep" aria-hidden />
      <span>{batch.state === "stopped" ? STOPPED : batch.reviewer_line}</span>
    </div>
  );
}

function Verdict({ draft }: { draft: Draft }) {
  if (draft.review === "ok" || draft.review === "flagged") {
    const ok = draft.review === "ok";
    return (
      <div className="md-verdict">
        <span className={ok ? "md-v md-v--ok" : "md-v md-v--cr"}>
          {ok ? "Approved" : "Flagged"}
        </span>
        <span>
          {draft.reviewed_by ?? "Reviewer"}: {draft.review_note}
        </span>
      </div>
    );
  }
  return (
    <div className="md-verdict">
      <span className="md-v md-v--none">Not sampled</span>
      <span>{NOT_SAMPLED}</span>
    </div>
  );
}

function DraftCard({
  draft,
  isChoice,
  checked,
  locked,
  onCheck,
  onKind,
  onEdit,
  onReject,
}: {
  draft: Draft;
  isChoice: boolean;
  checked: boolean;
  /** The team is still drafting: nothing can be selected yet. */
  locked: boolean;
  onCheck: (on: boolean) => void;
  onKind: (kind: DraftKind) => void;
  onEdit: () => void;
  onReject: () => void;
}) {
  const n = draft.number;
  return (
    <article className={draft.review === "flagged" ? "md-dcard md-dcard--flag" : "md-dcard"}>
      <div className="md-dcard__cb">
        <input
          type="checkbox"
          checked={checked}
          disabled={locked}
          aria-label={`Select draft ${n}`}
          onChange={(e) => onCheck(e.target.checked)}
        />
      </div>
      <div className="md-dcard__body">
        <div className="md-dcard__top">
          <div className="md-dkind" role="group" aria-label={`Draft ${n} is a`}>
            <button
              type="button"
              aria-pressed={draft.kind === "test"}
              onClick={() => draft.kind !== "test" && onKind("test")}
            >
              <Lock size={12} strokeWidth={1.7} aria-hidden />
              Test
            </button>
            <button
              type="button"
              aria-pressed={draft.kind === "training"}
              onClick={() => draft.kind !== "training" && onKind("training")}
            >
              Training
            </button>
          </div>
          <span className="md-dcard__label">
            {draft.kind === "test" ? "Expected answer" : "Answer"}
          </span>
          {isChoice ? (
            <span className="md-ans">{draft.answer}</span>
          ) : (
            <span className="md-ans md-ans--wrap">{draft.answer}</span>
          )}
          {draft.edited && <span className="md-dcard__edited">Edited by you</span>}
        </div>
        <p className="md-dcard__inp">{draft.input}</p>
        {draft.blocked && (
          <div className="md-warn" role="note">
            <TriangleAlert
              size={15}
              strokeWidth={1.7}
              aria-hidden
              style={{ flex: "none", marginTop: 2 }}
            />
            <span>{draft.blocked}</span>
          </div>
        )}
        <div className="md-src">
          <span className="md-src__file">
            <FileText size={13} strokeWidth={1.7} aria-hidden />
            {sourceFileLine(draft.source)}
          </span>
          <q className="md-src__q">{draft.source.quote}</q>
          {!isChoice && draft.must_contain.length > 0 && (
            <span className="md-hint">Key phrases: {draft.must_contain.join(" · ")}</span>
          )}
        </div>
        {!draft.blocked && <Verdict draft={draft} />}
      </div>
      <div className="md-dcard__acts">
        <button type="button" className="md-lnk" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="md-lnk" onClick={onReject}>
          Reject
        </button>
      </div>
    </article>
  );
}

export function DraftsTab({
  model,
  tick,
  onEdit,
  onDraft,
  onChanged,
}: {
  model: ModelDetail;
  tick: number;
  onEdit: (draft: Draft) => void;
  onDraft: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<Drafts | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [poll, setPoll] = useState(0);
  const id = model.model_id;

  const load = useCallback(() => {
    return listDrafts(id)
      .then((d) => {
        setData(d);
        setFailed(false);
        return d;
      })
      .catch(() => {
        setFailed(true);
        return null;
      });
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, tick, poll]);

  const drafting = data?.batches.some((b) => b.state === "drafting") ?? false;
  useEffect(() => {
    if (!drafting) return;
    const t = window.setTimeout(() => setPoll((p) => p + 1), POLL_MS);
    return () => window.clearTimeout(t);
  }, [drafting, data]);

  const cards = useMemo(() => {
    if (!data) return [];
    return data.batches.flatMap((b) => b.drafts.map((d) => ({ batch: b, draft: d })));
  }, [data]);

  if (!data) {
    return failed ? (
      <div className="md-alert" role="alert">
        <span>Couldn’t reach Tvashtr — is the backend running?</span>
      </div>
    ) : null;
  }

  if (data.batches.length === 0) {
    return (
      <section className="md-card md-empty">
        <h2 className="md-empty__title">No drafts to review</h2>
        <p className="md-empty__text">
          A team reads one of your Domains and drafts tests and training examples, each quoting its
          source. Nothing is added until you accept it.
        </p>
        <div className="md-empty__actions">
          <Button variant="primary" size="sm" onClick={onDraft}>
            Draft with a team
          </Button>
        </div>
      </section>
    );
  }

  const isChoice = data.answer_kind === "choice";
  const open = cards.filter((c) => c.batch.state !== "drafting");
  const isPicked = (d: Draft) => picked[d.draft_id] ?? d.selected;
  const selected = open.filter((c) => isPicked(c.draft)).map((c) => c.draft);
  const selTests = selected.filter((d) => d.kind === "test").length;
  const counts = {
    all: cards.length,
    test: cards.filter((c) => c.draft.kind === "test").length,
    training: cards.filter((c) => c.draft.kind === "training").length,
    flagged: cards.filter((c) => c.draft.review === "flagged").length,
  };
  const shownCards = cards.filter(
    (c) =>
      filter === "all" ||
      (filter === "flagged" ? c.draft.review === "flagged" : c.draft.kind === filter),
  );
  const visible = all ? shownCards : shownCards.slice(0, FIRST_CARDS);
  const left = open.length - selected.length;

  const accept = async () => {
    setBusy(true);
    try {
      const out = await acceptDrafts(
        id,
        selected.map((d) => d.draft_id),
      );
      const added = [
        out.accepted_tests ? plural(out.accepted_tests, "test") : null,
        out.accepted_training ? plural(out.accepted_training, "training example") : null,
      ].filter(Boolean);
      toast({
        message: added.length
          ? `Added ${added.join(" and ")}.${out.refused.length ? ` ${plural(out.refused.length, "draft")} couldn't be accepted.` : ""}`
          : "Nothing could be accepted.",
        tone: out.refused.length ? "error" : "success",
      });
      setPicked({});
      onChanged();
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : "Couldn’t accept the drafts.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const reject = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      await rejectDrafts(id, ids);
      setPicked({});
      onChanged();
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : "Couldn’t reject the drafts.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const flip = async (draft: Draft, kind: DraftKind) => {
    try {
      await setDraftKind(id, draft.draft_id, kind);
      setPicked((p) => {
        const next = { ...p };
        delete next[draft.draft_id];
        return next;
      });
      void load();
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : "Couldn’t change the draft.",
        tone: "error",
      });
    }
  };

  const toolbar = (
    <div className="md-drafts__bar">
      <div className="tv-seg" role="group" aria-label="Which drafts to show">
        {(
          [
            ["all", "All"],
            ["test", "Tests"],
            ["training", "Training"],
            ["flagged", "Flagged"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? "tv-seg__btn tv-seg__btn--active" : "tv-seg__btn"}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label} {counts[key]}
          </button>
        ))}
      </div>
      <div className="md-drafts__acts">
        <span className="md-hint">
          {open.length === 0
            ? WAIT
            : `${selected.length} selected${left > 0 ? " · flagged drafts and copies of your tests are left out" : ""}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || selected.length === 0}
          onClick={() => void reject(selected.map((d) => d.draft_id))}
        >
          Reject selected
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          disabled={selected.length === 0}
          title={open.length === 0 ? WAIT : undefined}
          onClick={() => void accept()}
        >
          Accept {selected.length}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {data.batches.map((batch, i) => {
        const mine = visible.filter((c) => c.batch.batch_id === batch.batch_id);
        return (
          <Fragment key={batch.batch_id}>
            <section className="md-batch" aria-label={`Drafts from ${batch.team_name}`}>
              <BatchBar batch={batch} />
              {i === 0 && toolbar}
              <div className="md-drafts__list">
                {mine.map(({ draft }) => (
                  <DraftCard
                    key={draft.draft_id}
                    draft={draft}
                    isChoice={isChoice}
                    locked={batch.state === "drafting"}
                    checked={batch.state !== "drafting" && isPicked(draft)}
                    onCheck={(on) => setPicked((p) => ({ ...p, [draft.draft_id]: on }))}
                    onKind={(kind) => void flip(draft, kind)}
                    onEdit={() => onEdit(draft)}
                    onReject={() => void reject([draft.draft_id])}
                  />
                ))}
              </div>
            </section>
          </Fragment>
        );
      })}
      <div className="md-drafts__foot">
        <span className="md-hint">{acceptLine(selTests, selected.length - selTests, data)}</span>
        {!all && shownCards.length > FIRST_CARDS && (
          <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
            Show all {shownCards.length}
          </Button>
        )}
      </div>
    </>
  );
}
