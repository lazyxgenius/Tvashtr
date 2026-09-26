import { ChevronRight, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button, Input, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type SkillDetail,
  type SkillUsageRow,
  createSkill,
  getSkill,
  updateSkill,
} from "../../lib/api/skills";
import { navigate, routeToHash } from "../../lib/nav";
import { RepoRulesCard, SkillRepoCard, SkillSettingsCard } from "./SkillEditorCards";
import { SkillMdEditor } from "./SkillMdEditor";
import { SkillsEmptyState } from "./SkillsEmptyState";
import {
  type DraftErrors,
  type SkillDraft,
  canSave,
  draftFromSkill,
  draftSource,
  emptyDraft,
  errorField,
  isDirty,
  shownMode,
  triggerError,
  validateDraft,
} from "./skillDraft";
import { handOffToSkills } from "./skillsHandoff";
import "./skills.css";

const LIST = { page: "skills", view: "mine" } as const;

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

/**
 * Toolkit › Skills › New skill / <name> (TkF-NewSkill-1…5, TkF-SkillSource-1, Toolkit-SkillEditor;
 * SKILL-21…36). `skillId` "new" writes a new skill; any other id loads that skill to edit.
 */
export function SkillEditorPage({ skillId }: { skillId: string }) {
  if (skillId === "new") return <SkillEditor key="new" skill={null} />;
  return <ExistingSkill key={skillId} id={skillId} />;
}

type Load =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error"; message: string }
  | { state: "ready"; skill: SkillDetail };

function ExistingSkill({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    getSkill(id).then(
      (skill) => live && setLoad({ state: "ready", skill }),
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) setLoad({ state: "missing" });
        else setLoad({ state: "error", message: errorText(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);

  if (load.state === "ready") return <SkillEditor skill={load.skill} />;
  return (
    <>
      <Crumbs current={load.state === "loading" ? "Loading…" : "Skill"} />
      {load.state === "loading" ? (
        <section className="sk-card" aria-label="Skill" aria-busy="true">
          <div className="sk-empty sk-loading">Loading the skill…</div>
        </section>
      ) : load.state === "missing" ? (
        <SkillsEmptyState
          icon={<TriangleAlert size={24} strokeWidth={1.6} />}
          title="This skill isn’t in your library"
          body="It may have been deleted. Your other skills are still in Toolkit › Skills."
          actions={
            <Button variant="secondary" size="sm" onClick={() => navigate(LIST)}>
              Back to skills
            </Button>
          }
        />
      ) : (
        <SkillsEmptyState
          icon={<TriangleAlert size={24} strokeWidth={1.6} />}
          title="Couldn’t load the skill"
          body={load.message}
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setLoad({ state: "loading" });
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          }
        />
      )}
    </>
  );
}

/** "Skills › <current>" — the link goes back to the list. */
function Crumbs({ current }: { current: string }) {
  return (
    <nav className="sk-crumbs" aria-label="Breadcrumb">
      <a
        href={routeToHash(LIST)}
        onClick={(e) => {
          e.preventDefault();
          navigate(LIST);
        }}
      >
        Skills
      </a>
      <ChevronRight size={13} strokeWidth={1.6} aria-hidden="true" />
      <span aria-current="page">{current}</span>
    </nav>
  );
}

function SkillEditor({ skill }: { skill: SkillDetail | null }) {
  const toast = useToast();
  const existing = skill !== null;
  const [saved, setSaved] = useState<SkillDraft>(() =>
    skill ? draftFromSkill(skill) : emptyDraft(),
  );
  const [draft, setDraft] = useState<SkillDraft>(saved);
  const [title, setTitle] = useState(skill?.name ?? "");
  const usedBy: SkillUsageRow[] | null = skill ? skill.used_by : null;
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameErrorId = useId();
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const patch = (p: Partial<SkillDraft>, clear: (keyof DraftErrors)[] = []) => {
    setDraft((d) => ({ ...d, ...p }));
    if (clear.some((k) => errors[k])) {
      setErrors((e) => {
        const next = { ...e };
        clear.forEach((k) => delete next[k]);
        return next;
      });
    }
  };

  const mode = shownMode(draft);

  const save = async () => {
    const found = validateDraft(draft);
    if (found.name || found.triggers) {
      setErrors(found);
      if (found.name) nameRef.current?.focus();
      return;
    }
    const name = draft.name.trim();
    setSaving(true);
    try {
      if (skill === null) {
        const created = await createSkill(name, draftSource(draft));
        handOffToSkills({ highlight: created.id });
        navigate(LIST);
        const target = { id: created.id, name: created.name };
        toast({
          message: `${created.name} saved. Add it to agents from their Skills & tools tab.`,
          action: {
            label: "Choose agents",
            onClick: () => {
              handOffToSkills({ openAgentsFor: target });
              navigate(LIST);
            },
          },
        });
        return;
      }
      const updated = await updateSkill(skill.id, { name, source: draftSource(draft) });
      const next = draftFromSkill(updated);
      setSaved(next);
      setDraft(next);
      setTitle(updated.name);
      setErrors({});
      toast({ message: `${updated.name} saved. Agents use it from their next run.` });
    } catch (e) {
      const field = e instanceof ApiError ? errorField(e.status, e.message) : null;
      if (field) {
        setErrors({ [field]: errorText(e) });
        if (field === "name") nameRef.current?.focus();
        if (field === "content") contentRef.current?.focus();
      } else {
        toast({ message: errorText(e), tone: "error" });
      }
    } finally {
      setSaving(false);
    }
  };

  // Discard reverts unsaved edits; with nothing to revert it leaves the page (SKILL-35).
  const discard = () => {
    if (isDirty(draft, saved)) {
      setDraft(saved);
      setErrors({});
    } else {
      navigate(LIST);
    }
  };

  return (
    <>
      <Crumbs current={existing ? title : "New skill"} />
      <div className="sk-ed-head">
        {existing ? (
          <h1 className="sk-ed-title">{title}</h1>
        ) : (
          // The error sits outside the Input so the field isn't remounted (and doesn't lose focus)
          // when an error comes or goes.
          <div className="sk-ed-namebox">
            <Input
              ref={nameRef}
              aria-label="Skill name"
              placeholder="name (e.g. house-style)"
              autoComplete="off"
              spellCheck={false}
              className={errors.name ? "ds-input--error" : undefined}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? nameErrorId : undefined}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value }, ["name"])}
            />
            {errors.name && (
              <span id={nameErrorId} className="ds-field__help ds-field__help--error" role="alert">
                {errors.name}
              </span>
            )}
          </div>
        )}
        <div className="sk-ed-actions">
          {existing ? (
            <Button variant="ghost" onClick={discard} disabled={saving}>
              Discard
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => navigate(LIST)} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={!canSave(draft)}
            loading={saving}
          >
            {existing ? "Save changes" : "Save skill"}
          </Button>
        </div>
      </div>

      <div className="sk-ed-grid">
        {draft.kind === "inline" ? (
          <SkillMdEditor
            value={draft.content}
            onChange={(content) => patch({ content }, ["content"])}
            error={errors.content}
            textareaRef={contentRef}
          />
        ) : draft.kind === "repo" ? (
          <SkillRepoCard
            url={draft.repoUrl}
            version={draft.repoRef}
            filter={draft.repoFilter}
            urlError={errors.repo ?? null}
            onChange={(p) => patch(p, p.repoUrl !== undefined ? ["repo"] : [])}
          />
        ) : (
          <RepoRulesCard />
        )}
        <SkillSettingsCard
          mode={mode}
          onMode={(m) => patch({ mode: m }, ["triggers"])}
          existing={existing}
          triggers={draft.triggers}
          onTriggers={(t) => patch({ triggers: t }, ["triggers"])}
          onTriggersBlur={() => {
            const err = triggerError(draft);
            if (err) setErrors((e) => ({ ...e, triggers: err }));
          }}
          triggersError={errors.triggers ?? null}
          kind={draft.kind}
          onKind={(kind) => patch({ kind, mode: draft.mode ?? mode }, ["content", "repo"])}
          usedBy={usedBy}
        />
      </div>
    </>
  );
}
