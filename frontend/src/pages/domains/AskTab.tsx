/**
 * A domain's Ask tab (DM-55…67; Dm-Ask, DmF-Ask-1…4, DmF-Model-1…3): the lock line and **Clear
 * chat** (Undo, OQ-12), the thread of questions and cited answers, the composer (question, answer
 * model, "Use earlier messages", **Ask**) and the Sources aside. Empty, it suggests questions from
 * the file names. Reading and answering need API keys on both surfaces (OQ-27). **Save as test
 * question** opens the test sheet prefilled from the answer (DM-68/69); a not-covered answer's
 * **Add a file about it** opens Sources with the file picker (DM-62).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Lock, MessageSquare } from "lucide-react";

import { Button, Switch, TextArea, useToast } from "../../design-system/components";
import { listProviders } from "../../lib/api";
import {
  AskError,
  type DomainChatTurn,
  type DomainDetailView,
  type DomainFile,
  type DomainPassage,
  askDomainQuestion,
  clearDomainChat,
  listDomainChat,
  listDomainFiles,
  rereadDomainFiles,
  setDomainAnswerModel,
} from "../../lib/api/domains";
import { navigate } from "../../lib/nav";
import { AnswerCard } from "./AnswerCard";
import { AnswerModelPicker } from "./AnswerModelPicker";
import { plainAnswer, suggestKeywords, suggestQuestions } from "./answerMarkers";
import { answerModelLabel } from "./answerModels";
import { requestDomainKey } from "./domainKeys";
import { FilePreviewSheet } from "./FilePreviewSheet";
import { type AsideMode, SourcesAside } from "./SourcesAside";
import { type SheetMode, TestQuestionSheet } from "./TestQuestionSheet";
import { UNDO_MS } from "./useFileDeletes";
import { requestFilePicker } from "./useUploads";
import "./ask.css";

const BACKEND_DOWN = "Couldn’t reach Tvashtr — is the backend running?";
const VENDORS: Record<string, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  groq: "Groq",
  gemini: "Gemini",
  huggingface: "Hugging Face",
};

// "Use earlier messages" is on by default and kept for the browser session (DM-57).
let useEarlierSetting = true;

interface Problem {
  text: string;
  /** The raw server words (a tooltip), for a provider that didn't answer. */
  title?: string;
  action?: { label: string; onClick: () => void };
}

const article = (p: string) => (/^[aeiou]/i.test(p) ? "an" : "a");

/** DM-66: what went wrong, in words, with the way out. */
function askProblem(err: unknown, d: DomainDetailView, onKeySaved: () => void): Problem {
  const toSources = {
    label: "Go to Sources",
    onClick: () => navigate({ page: "domains", domainId: d.domain_id }),
  };
  if (!(err instanceof AskError)) return { text: BACKEND_DOWN };
  const p = err.missingProviders[0];
  if (p) {
    const reads = p === d.reading_model.provider;
    const role = reads ? "reads the question" : "writes the answer";
    const model = reads ? d.reading_model.label : (d.answer_model.label ?? p);
    return {
      text: `Add ${article(p)} ${p} key to ask — ${p} ${role}.`,
      // DM-66: the key sheet opens here, so the question typed stays in the composer.
      action: {
        label: `Add ${p} key`,
        onClick: () => requestDomainKey(p, reads ? "reading" : "answering", model, onKeySaved),
      },
    };
  }
  if (err.status === 422 && /ingest/i.test(err.message)) {
    return { text: "Add files and wait for them to be read before asking.", action: toSources };
  }
  if (err.status === 502) {
    const provider = /^embedding/i.test(err.message)
      ? d.reading_model.provider
      : d.answer_model.provider;
    const vendor = VENDORS[provider ?? ""] ?? provider ?? "The model";
    return { text: `${vendor} didn’t answer. Try again.`, title: err.message };
  }
  return { text: err.message || BACKEND_DOWN };
}

interface Focus {
  turn: number;
  mode: AsideMode;
  active: number | null;
}

export function AskTab({
  detail,
  now,
  onChanged,
}: {
  detail: DomainDetailView;
  now: Date;
  /** Something the header or other tabs show changed (answer model, last question, tests). */
  onChanged: () => void;
}) {
  const domainId = detail.domain_id;
  const name = detail.name;
  const toast = useToast();
  const [turns, setTurns] = useState<DomainChatTurn[] | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [useEarlier, setUseEarlier] = useState(useEarlierSetting);
  const [held, setHeld] = useState<string[] | null>(null);
  const [files, setFiles] = useState<DomainFile[]>([]);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [preview, setPreview] = useState<DomainPassage | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  // A Clear chat waiting for its Undo toast to close (OQ-12).
  const clearing = useRef<((keepalive: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    let live = true;
    listDomainChat(domainId)
      .then((t) => {
        if (!live) return;
        setTurns(t);
        const last = t.map((x) => Boolean(x.answer)).lastIndexOf(true);
        setFocus(last >= 0 ? { turn: last, mode: "sources", active: null } : null);
      })
      .catch(() => live && (setTurns([]), setProblem({ text: BACKEND_DOWN })));
    listProviders()
      .then((ps) => live && setHeld(ps.map((p) => p.provider)))
      .catch(() => undefined);
    listDomainFiles(domainId)
      .then((l) => live && setFiles(l.documents))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [domainId]);

  // Leaving the tab or the page sends a Clear chat that is still waiting.
  useEffect(() => {
    const flush = () => void clearing.current?.(true);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns?.length, pending]);

  // A new reading model: the old vectors are gone, asking waits for the re-read (DM-88; the server
  // refuses too). Re-reading with the same model leaves the other files searchable.
  const paused = detail.rereading?.reason === "reading_model";
  const noPieces = detail.pieces === 0;

  const clearChat = () => {
    if (!turns?.length) return;
    const before = turns;
    let sent = false;
    let undone = false;
    const commit = async (keepalive: boolean) => {
      if (sent || undone) return;
      sent = true;
      window.clearTimeout(timer);
      clearing.current = null;
      try {
        await clearDomainChat(domainId, { keepalive });
      } catch {
        setTurns(before);
        toast({ message: "Couldn’t clear the chat. It’s back.", tone: "error" });
      }
    };
    const timer = window.setTimeout(() => void commit(false), UNDO_MS);
    clearing.current = commit;
    setTurns([]);
    setFocus(null);
    toast({
      message: "Chat cleared.",
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          if (sent) {
            toast({ message: "The chat was already cleared.", tone: "error" });
            return;
          }
          undone = true;
          window.clearTimeout(timer);
          clearing.current = null;
          setTurns(before);
          setFocus(
            before.length ? { turn: before.length - 1, mode: "sources", active: null } : null,
          );
        },
      },
    });
  };

  const keySaved = () => {
    setProblem(null);
    listProviders()
      .then((ps) => setHeld(ps.map((p) => p.provider)))
      .catch(() => undefined);
    onChanged();
  };

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || pending || paused || turns === null) return;
    await clearing.current?.(false);
    const index = turns.length;
    setProblem(null);
    setDraft("");
    setPending(true);
    setTurns((t) => [...(t ?? []), { question, answer: null }]);
    try {
      const answer = await askDomainQuestion(domainId, question, useEarlier);
      setTurns((t) => (t ?? []).map((x, i) => (i === index ? { ...x, answer } : x)));
      setFocus({ turn: index, mode: "sources", active: null });
      onChanged();
    } catch (err) {
      setTurns((t) => (t ?? []).slice(0, index));
      setDraft(question);
      setProblem(askProblem(err, detail, keySaved));
    } finally {
      setPending(false);
    }
  };

  const changeModel = useCallback(
    async (slug: string | null) => {
      const config = detail.config;
      const before = detail.answer_model.configured;
      try {
        await setDomainAnswerModel(domainId, config, slug);
      } catch {
        toast({ message: "Couldn’t change the answer model.", tone: "error" });
        return;
      }
      onChanged();
      toast({
        message: `Answer model set to ${answerModelLabel(slug)} for this domain`,
        action: {
          label: "Undo",
          onClick: () =>
            void setDomainAnswerModel(domainId, config, before).then(onChanged, () =>
              toast({ message: "Couldn’t change the answer model.", tone: "error" }),
            ),
        },
      });
    },
    [detail.config, detail.answer_model.configured, domainId, onChanged, toast],
  );

  const copy = (text: string, done: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast({ message: done }))
      .catch(() => undefined);
  };

  // DM-68: the question, the cited files and suggested key words; a not-covered answer's files
  // start empty (DM-69).
  const saveTest = (turn: DomainChatTurn) => {
    const cited = turn.answer?.covered ? turn.answer.sources : [];
    const byId = new Map(
      cited.map((s) => [
        s.document_id,
        { document_id: s.document_id, filename: s.filename, exists: true },
      ]),
    );
    setSheet({
      kind: "answer",
      question: turn.question,
      files: [...byId.values()],
      keywords: suggestKeywords(
        turn.answer?.answer_text ?? "",
        cited.map((s) => s.excerpt),
      ),
    });
  };

  const saved = () => {
    setSheet(null);
    onChanged();
    toast({
      message: `Saved as test question ${detail.quality.cases + 1}`,
      action: {
        label: "View in Quality",
        onClick: () => navigate({ page: "domains", domainId, tab: "quality" }),
      },
    });
  };

  const suggestions = suggestQuestions(
    files.filter((f) => f.phase === "ready").map((f) => f.filename),
  );
  const shown = focus && turns?.[focus.turn]?.answer ? focus : null;
  const composerNote = paused
    ? `Ask is paused while ${name} re-reads its files.`
    : noPieces
      ? "Add files and wait for them to be read before asking."
      : null;

  return (
    <div className="dm-ask">
      <div className="dm-ask__main">
        <div className="dm-ask__lock">
          <Lock size={13} strokeWidth={1.6} aria-hidden />
          <span>Answers use only the files in {name}. Nothing else.</span>
          <span className="dm-ask__spacer" />
          <Button variant="ghost" size="sm" disabled={!turns?.length} onClick={clearChat}>
            Clear chat
          </Button>
        </div>

        <div className="dm-ask__thread" ref={thread} aria-live="polite">
          {turns !== null && turns.length === 0 ? (
            <div className="dm-ask__empty">
              <span className="dm-ask__tile">
                <MessageSquare size={22} strokeWidth={1.6} aria-hidden />
              </span>
              <h2 className="dm-ask__empty-title">Ask {name} anything</h2>
              <p className="dm-ask__empty-text">
                Every answer lists the files and passages it used. If the files don’t cover it,
                you’ll be told so.
              </p>
              {suggestions.length > 0 && !paused && !noPieces && (
                <>
                  <div className="dm-ask__pills">
                    {suggestions.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="dm-ask__pill"
                        onClick={() => {
                          setDraft(q);
                          void ask(q);
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <span className="dm-ask__hint">Suggested from your file names</span>
                </>
              )}
            </div>
          ) : (
            (turns ?? []).map((t, i) => (
              <div key={i} className="dm-ask__turn">
                <div className="dm-ask__q">{t.question}</div>
                {t.answer ? (
                  <AnswerCard
                    answer={t.answer}
                    domainName={name}
                    onChip={(n) => setFocus({ turn: i, mode: "sources", active: n })}
                    onShowFound={() => setFocus({ turn: i, mode: "found", active: null })}
                    onCopy={() => copy(plainAnswer(t.answer?.answer_text ?? ""), "Answer copied.")}
                    onSaveTest={() => saveTest(t)}
                    onAddFile={() => {
                      requestFilePicker();
                      navigate({ page: "domains", domainId });
                    }}
                  />
                ) : (
                  pending &&
                  i === turns!.length - 1 && (
                    <div className="dm-answer dm-answer--pending" role="status">
                      Searching {name}…
                    </div>
                  )
                )}
              </div>
            ))
          )}
        </div>

        <form
          className="dm-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <TextArea
            rows={3}
            placeholder={`Ask ${name} a question`}
            value={draft}
            disabled={paused}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(draft);
              }
            }}
          />
          <div className="dm-composer__row">
            <AnswerModelPicker
              model={detail.answer_model}
              held={held}
              onPick={(slug) => void changeModel(slug)}
            />
            <Switch
              label="Use earlier messages"
              checked={useEarlier}
              onCheckedChange={(on) => {
                useEarlierSetting = on;
                setUseEarlier(on);
              }}
            />
            <span className="dm-ask__spacer" />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="dm-btn-inline"
              loading={pending}
              disabled={!draft.trim() || paused || noPieces}
            >
              <ArrowUp size={15} strokeWidth={1.6} aria-hidden />
              <span>Ask</span>
            </Button>
          </div>
          {(problem || composerNote) && (
            <p className="dm-composer__note" role="alert" title={problem?.title}>
              <span>{problem?.text ?? composerNote}</span>
              {(problem?.action ?? (noPieces && !paused)) && (
                <button
                  type="button"
                  className="dm-link"
                  onClick={
                    problem?.action?.onClick ?? (() => navigate({ page: "domains", domainId }))
                  }
                >
                  {problem?.action?.label ?? "Go to Sources"}
                </button>
              )}
            </p>
          )}
        </form>
      </div>

      <SourcesAside
        answer={shown ? turns![shown.turn].answer : null}
        mode={shown?.mode ?? "sources"}
        active={shown?.active ?? null}
        onActivate={(n) => shown && setFocus({ ...shown, mode: "sources", active: n })}
        onBack={() => shown && setFocus({ ...shown, mode: "sources" })}
        onOpen={(p) => setPreview(p)}
        onCopy={(p) => copy(p.excerpt, "Passage copied.")}
      />

      {sheet && (
        <TestQuestionSheet
          domainId={domainId}
          mode={sheet}
          files={files}
          count={detail.quality.cases}
          onClose={() => setSheet(null)}
          onSaved={saved}
        />
      )}

      {preview && (
        <FilePreviewSheet
          domainId={domainId}
          documentId={preview.document_id}
          piece={preview.piece_number}
          fallbackName={preview.filename}
          now={now}
          onClose={() => setPreview(null)}
          onReread={(id) => {
            setPreview(null);
            void rereadDomainFiles(domainId, { document_ids: [id] }).then(onChanged, () =>
              toast({ message: "Couldn’t start reading.", tone: "error" }),
            );
          }}
        />
      )}
    </div>
  );
}
