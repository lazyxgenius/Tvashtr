import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { Badge, Button, Select, Sheet, TextArea } from "../../design-system/components";
import { reportFetchOk } from "../../lib/backendStatus";
import {
  type Memory,
  type MemoryPolarity,
  type MemoryRepo,
  createMemory,
  isEmbeddingFailure,
  listMemoryRepos,
} from "../../lib/api/memory";
import { ApiDetailError } from "../../lib/api/runs";
import { FORCE_CHOICES, FORCE_VARIANT, defaultRepo } from "./memoryModel";

type Applies = "every" | "one";

const EMPTY = "Write the memory first.";

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

/**
 * Add memory (Toolkit-AddMemory, TkF-AddMemory-1…3): a right-side sheet with what agents should
 * remember, where it applies (every repo, or one repo — the one you ran on last to start with) and
 * how strongly (MUST first). A memory you add skips the Inbox and applies right away
 * (`POST /api/memories`). Mount it only while open: Cancel, Close and Escape drop the draft.
 */
export function AddMemorySheet({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  /** `repo` is the one repo's label, or `null` for every repo. */
  onAdded: (memory: Memory, repo: string | null) => void;
}) {
  const formId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState("");
  const [contentError, setContentError] = useState<string | null>(null);
  const [repos, setRepos] = useState<MemoryRepo[] | null>(null);
  const [applies, setApplies] = useState<Applies | null>(null);
  const [repoKey, setRepoKey] = useState<string | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [polarity, setPolarity] = useState<MemoryPolarity>("require");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every repo a memory can go to, including the ones your GitHub App reaches but you haven't run
  // on yet. Without any, the memory applies to every repo.
  useEffect(() => {
    let live = true;
    listMemoryRepos({ includeGithub: true }).then(
      (r) => live && setRepos(r),
      () => live && setRepos([]),
    );
    return () => {
      live = false;
    };
  }, []);

  // Start where the text goes (the sheet's own trap would focus Close first).
  useEffect(() => textRef.current?.focus(), []);

  const noRepos = repos !== null && repos.length === 0;
  const scope: Applies = applies ?? (noRepos ? "every" : "one");
  const repo =
    repos?.find((r) => r.repo_key === repoKey) ?? (repos ? defaultRepo(repos) : null) ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const text = content.trim();
    if (!text) {
      setContentError(EMPTY);
      textRef.current?.focus();
      return;
    }
    if (scope === "one" && !repo) {
      setRepoError("Choose a repo first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const added = await createMemory({
        content: text,
        polarity,
        repo_key: scope === "one" && repo ? repo.repo_key : null,
      });
      onAdded(added, scope === "one" && repo ? repo.label : null);
    } catch (err) {
      setBusy(false);
      if (isEmbeddingFailure(err)) {
        // The app answered; only the embedding service behind it didn't.
        reportFetchOk();
        setError("The embedding service didn’t answer, so nothing was saved. Try again.");
      } else if (err instanceof ApiDetailError && err.detail === "content is required") {
        setContentError(EMPTY);
      } else setError(`Couldn’t add the memory: ${errorText(err)}`);
    }
  };

  return (
    <Sheet
      open
      title="Add memory"
      subtitle="A fact or rule your agents should keep in mind"
      onClose={onClose}
      width={560}
      footerNote="Memories you add apply right away."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" size="sm" loading={busy}>
            Add memory
          </Button>
        </>
      }
    >
      <form id={formId} className="mem-add" onSubmit={(e) => void submit(e)} noValidate>
        <TextArea
          ref={textRef}
          label="What should agents remember?"
          rows={3}
          value={content}
          error={contentError}
          onChange={(e) => {
            setContent(e.target.value);
            if (contentError) setContentError(null);
          }}
        />

        <div className="mem-add__group">
          <span className="mem-add__label">Applies to</span>
          <div className="tv-seg mem-add__seg" role="group" aria-label="Applies to">
            {(
              [
                ["every", "Every repo"],
                ["one", "One repo"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={scope === value ? "tv-seg__btn tv-seg__btn--active" : "tv-seg__btn"}
                aria-pressed={scope === value}
                disabled={value === "one" && noRepos}
                onClick={() => {
                  setApplies(value);
                  setRepoError(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {scope === "one" && (
            <Select
              aria-label="Repo"
              className="mem-add__repo"
              disabled={repos === null}
              value={repo?.repo_key ?? ""}
              error={repoError}
              onChange={(e) => {
                setRepoKey(e.target.value);
                setRepoError(null);
              }}
            >
              {repos === null ? (
                <option value="">Loading repos…</option>
              ) : (
                repos.map((r) => (
                  <option key={r.repo_key} value={r.repo_key}>
                    {r.label}
                  </option>
                ))
              )}
            </Select>
          )}
        </div>

        <div className="mem-add__group" role="radiogroup" aria-labelledby={`${formId}-force`}>
          <span className="mem-add__label" id={`${formId}-force`}>
            How strongly
          </span>
          {FORCE_CHOICES.map((c) => (
            <label
              key={c.polarity}
              className={
                c.polarity === polarity ? "mem-add__force mem-add__force--on" : "mem-add__force"
              }
            >
              {/* No `value`: the checked state lives in React, like the design's bare radios. */}
              <input
                type="radio"
                name="force"
                checked={c.polarity === polarity}
                onChange={() => setPolarity(c.polarity)}
              />
              <span className="mem-add__badge">
                <Badge variant={FORCE_VARIANT[c.polarity]}>{c.label}</Badge>
              </span>
              <span className="mem-add__hint">{c.hint}</span>
            </label>
          ))}
        </div>

        {error && (
          <p className="mem-add__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
