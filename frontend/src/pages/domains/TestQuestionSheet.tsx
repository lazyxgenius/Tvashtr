/**
 * Add or edit a test question (DM-71, DM-78; DmF-Qual-2/3) — a right sheet (520): the question,
 * the files it should find (a file picker: type to search, several may be picked, then chips +
 * **Add file**) and optional comma-separated key words. **Pick from Ask history** (DM-79) opens
 * it with the chat's questions, newest first; picking one fills the question and its cited files.
 * The server's 422 copy is shown as is ("Write the question first.", the 50 cap, OQ-26).
 * **Save as test question** in Ask (DM-68) opens it as "Save as a test question": the asked
 * question, the answer's cited files and key words suggested from the answer (OQ-15) as chips.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Info, Plus, X } from "lucide-react";

import { Button, Input, Sheet, useDismiss } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type DomainFile,
  type DomainTestCase,
  type DomainTestFile,
  listDomainChat,
  saveTestCase,
} from "../../lib/api/domains";
import { formatNumber } from "./domainFormat";
import { splitKeywords } from "./qualityFormat";
import "./menus.css";
import "./quality.css";

export type SheetMode =
  | { kind: "add" }
  | { kind: "history" }
  | { kind: "edit"; testCase: DomainTestCase; index: number }
  | { kind: "answer"; question: string; files: DomainTestFile[]; keywords: string[] };

const BACKEND_DOWN = "Couldn’t reach Tvashtr — is the backend running?";

/** The files a test question should find: a button that opens a searchable, multi-pick list. */
function FilePicker({
  files,
  picked,
  onToggle,
  onClose,
  labelId,
}: {
  files: DomainFile[];
  picked: string[];
  labelId: string;
  onToggle: (f: DomainFile) => void;
  onClose: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  useDismiss(true, onClose, wrap);
  // Typing goes to the trigger: the list keeps it focused (options don't take focus).
  useEffect(() => trigger.current?.focus(), []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? files.filter((f) => f.filename.toLowerCase().includes(q)) : files;
  }, [files, query]);
  const names = files.filter((f) => picked.includes(f.document_id)).map((f) => f.filename);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + shown.length) % Math.max(1, shown.length));
    } else if (e.key === "Enter" || (e.key === " " && !query)) {
      e.preventDefault();
      if (shown[active]) onToggle(shown[active]);
    } else if (e.key === "Backspace") {
      setQuery((q) => q.slice(0, -1));
      setActive(0);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      setQuery((q) => q + e.key);
      setActive(0);
    }
  };

  return (
    <div className="dm-fpick" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="dm-fpick__trigger"
        aria-haspopup="listbox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
        aria-labelledby={labelId}
        onClick={onClose}
        onKeyDown={onKeyDown}
      >
        <span className="dm-fpick__value">{query || names.join(", ") || "Pick a file"}</span>
        <ChevronDown size={15} strokeWidth={1.6} aria-hidden />
      </button>
      <ul
        id={listId}
        role="listbox"
        aria-multiselectable
        className="dm-fpick__list"
        aria-label="Files"
      >
        {shown.map((f, i) => {
          const on = picked.includes(f.document_id);
          return (
            <li
              key={f.document_id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={on}
              className={i === active ? "dm-fpick__opt dm-fpick__opt--active" : "dm-fpick__opt"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onToggle(f)}
            >
              {on ? (
                <Check size={15} strokeWidth={2} className="dm-fpick__check" aria-hidden />
              ) : (
                <span className="dm-fpick__gap" />
              )}
              <span className="dm-fpick__text">
                <span className="dm-fpick__name">{f.filename}</span>
                <span className="dm-fpick__pieces">
                  {formatNumber(f.pieces ?? f.pieces_total)} pieces
                </span>
              </span>
            </li>
          );
        })}
        {shown.length === 0 && <li className="dm-fpick__none">No file matches “{query}”.</li>}
      </ul>
    </div>
  );
}

export function TestQuestionSheet({
  domainId,
  mode,
  files,
  count,
  onClose,
  onSaved,
}: {
  domainId: string;
  mode: SheetMode;
  files: DomainFile[];
  /** How many test questions the domain has (the footer's "Question <n+1>"). */
  count: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = mode.kind === "edit" ? mode.testCase : null;
  const fromAnswer = mode.kind === "answer" ? mode : null;
  const [question, setQuestion] = useState(editing?.question ?? fromAnswer?.question ?? "");
  const [picks, setPicks] = useState<DomainTestFile[]>(
    editing?.expected_files ?? fromAnswer?.files ?? [],
  );
  const [keywords, setKeywords] = useState(editing?.expected_keywords.join(", ") ?? "");
  // Save-from-answer keeps key words as chips (DM-68); `keywords` is then the word being typed.
  const [words, setWords] = useState<string[]>(fromAnswer?.keywords ?? []);
  const addWords = () => {
    const more = splitKeywords(keywords).filter((w) => !words.includes(w));
    if (more.length) setWords([...words, ...more]);
    setKeywords("");
  };
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<{ question?: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const labelId = useId();
  const [history, setHistory] = useState<{ question: string; files: DomainTestFile[] }[] | null>(
    null,
  );

  useEffect(() => {
    if (mode.kind !== "history") return;
    let live = true;
    listDomainChat(domainId)
      .then((turns) => {
        if (!live) return;
        const seen = new Set<string>();
        const items = [];
        for (const t of [...turns].reverse()) {
          if (seen.has(t.question)) continue;
          seen.add(t.question);
          const cited = new Map<string, DomainTestFile>();
          for (const s of t.answer?.covered ? t.answer.sources : []) {
            cited.set(s.document_id, {
              document_id: s.document_id,
              filename: s.filename,
              exists: true,
            });
          }
          items.push({ question: t.question, files: [...cited.values()] });
        }
        setHistory(items);
      })
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [domainId, mode.kind]);

  const toggle = (f: DomainFile) =>
    setPicks((ps) =>
      ps.some((p) => p.document_id === f.document_id)
        ? ps.filter((p) => p.document_id !== f.document_id)
        : [...ps, { document_id: f.document_id, filename: f.filename, exists: true }],
    );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveTestCase(
        domainId,
        {
          question: question.trim(),
          expected_citation_doc_ids: picks.map((p) => p.document_id),
          expected_keywords: fromAnswer
            ? [...words, ...splitKeywords(keywords)]
            : splitKeywords(keywords),
        },
        editing?.case_id,
      );
      onSaved();
    } catch (err) {
      const text = err instanceof ApiError ? err.message : BACKEND_DOWN;
      setError({ text, question: text === "Write the question first." });
      setSaving(false);
    }
  };

  const number = mode.kind === "edit" ? mode.index + 1 : count + 1;
  const note = fromAnswer
    ? `Quality · ${count} test question${count === 1 ? "" : "s"}`
    : `Question ${number}`;

  return (
    <Sheet
      open
      title={
        fromAnswer
          ? "Save as a test question"
          : editing
            ? "Edit test question"
            : "Add a test question"
      }
      subtitle={
        fromAnswer
          ? "Quality will check that search keeps finding this"
          : "Something you already know the answer to"
      }
      onClose={onClose}
      footerNote={picking ? `Type to search ${files.length} files` : note}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
            {fromAnswer ? "Save test" : editing ? "Save changes" : "Add test"}
          </Button>
        </>
      }
    >
      {mode.kind === "history" && !question && (
        <div className="dm-qpick">
          <span className="dm-qsheet__label">From Ask</span>
          {history === null ? null : history.length === 0 ? (
            <p className="dm-qpick__none">No questions asked yet.</p>
          ) : (
            <ul className="dm-qpick__list">
              {history.map((h) => (
                <li key={h.question}>
                  <button
                    type="button"
                    className="dm-qpick__item"
                    onClick={() => {
                      setQuestion(h.question);
                      setPicks(h.files);
                    }}
                  >
                    {h.question}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Input
        label="Question"
        value={question}
        error={error?.question ? error.text : undefined}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <div className="dm-qsheet__files">
        <span className="dm-qsheet__label" id={labelId}>
          Files it should find
        </span>
        {picking || picks.length === 0 ? (
          picking ? (
            <FilePicker
              files={files}
              picked={picks.map((p) => p.document_id)}
              onToggle={toggle}
              onClose={() => setPicking(false)}
              labelId={labelId}
            />
          ) : (
            <button
              type="button"
              className="dm-fpick__trigger"
              aria-haspopup="listbox"
              aria-expanded={false}
              aria-labelledby={labelId}
              onClick={() => setPicking(true)}
            >
              <span className="dm-fpick__value dm-fpick__value--empty">Pick a file</span>
              <ChevronDown size={15} strokeWidth={1.6} aria-hidden />
            </button>
          )
        ) : (
          <div className="dm-qsheet__chips">
            {picks.map((p) => (
              <span key={p.document_id} className="dm-qchip">
                {p.filename ?? "Deleted file"}
                <button
                  type="button"
                  className="dm-qchip__x"
                  aria-label={`Remove ${p.filename ?? "deleted file"}`}
                  onClick={() => setPicks((ps) => ps.filter((x) => x !== p))}
                >
                  <X size={11} strokeWidth={1.6} aria-hidden />
                </button>
              </span>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="dm-btn-inline"
              onClick={() => setPicking(true)}
            >
              <Plus size={15} strokeWidth={1.6} aria-hidden />
              <span>Add file</span>
            </Button>
          </div>
        )}
        {fromAnswer && fromAnswer.files.length > 0 && (
          <span className="dm-qsheet__help">
            Taken from the answer’s sources. Any one of them counts as found.
          </span>
        )}
      </div>
      {fromAnswer ? (
        <div className="dm-qsheet__files">
          <span className="dm-qsheet__label">Key words</span>
          <div className="dm-qsheet__chips">
            {words.map((w) => (
              <span key={w} className="dm-qchip dm-qchip--word">
                {w}
                <button
                  type="button"
                  className="dm-qchip__x"
                  aria-label={`Remove ${w}`}
                  onClick={() => setWords(words.filter((x) => x !== w))}
                >
                  <X size={11} strokeWidth={1.6} aria-hidden />
                </button>
              </span>
            ))}
            <input
              className="dm-qsheet__word"
              aria-label="Add a key word"
              placeholder={words.length ? "" : "Type a key word, then Enter"}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              onBlur={addWords}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === ",") && keywords.trim()) {
                  e.preventDefault();
                  addWords();
                } else if (e.key === "Backspace" && !keywords && words.length) {
                  setWords(words.slice(0, -1));
                }
              }}
            />
          </div>
          <span className="dm-qsheet__help">
            All of these must show up in the passages found.
            {fromAnswer.keywords.length > 0 && " Suggested from the answer."}
          </span>
        </div>
      ) : (
        <Input
          label="Key words"
          optional
          helper="Comma-separated. All must appear in what search finds."
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />
      )}
      {fromAnswer && (
        <div className="dm-callout">
          <span className="dm-callout__icon">
            <Info size={14} strokeWidth={1.6} aria-hidden />
          </span>
          <span className="dm-callout__text">
            You don’t need the exact answer. Quality checks what search finds, not the wording.
          </span>
        </div>
      )}
      {error && !error.question && (
        <p className="dm-qsheet__error" role="alert">
          {error.text}
        </p>
      )}
    </Sheet>
  );
}
