import { CircleCheck } from "lucide-react";
import { type FormEvent, useId, useMemo, useState } from "react";

import { Button, Input, Sheet } from "../../design-system/components";
import { reportFetchOk } from "../../lib/backendStatus";
import {
  type ScannedSkill,
  type Skill,
  type SkillRepoScan,
  importSkills,
  scanSkillRepo,
} from "../../lib/api/skills";
import { ApiDetailError } from "../../lib/api/runs";
import { foundSummary, matchesGlobs, parseGlobs, plural } from "./skillsModel";

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

/** The scan's refusal code (`detail: {code, message}`), if it sent one. */
function refusalCode(e: unknown): string | null {
  if (!(e instanceof ApiDetailError)) return null;
  const d = e.detail as { code?: unknown } | null;
  return d && typeof d.code === "string" ? d.code : null;
}

/**
 * "Add from GitHub" (Toolkit-SkillFromRepo, TkF-FromRepo-1…3): a right-side sheet that scans a repo
 * at a version (`POST /api/skill-library/scan`), lists the SKILL.md files it found with a checkbox
 * each (ones already in the library are marked and left out), narrows them with "Only these
 * skills" globs, and adds the checked ones as one library skill each, loading "Agent decides"
 * (`POST /api/skill-library/import`, pinned to the scanned commit). Mount it only while open, so
 * every opening starts empty.
 */
export function AddFromGithubSheet({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (added: Skill[], skipped: string[], repo: string) => void;
}) {
  const formId = useId();
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [filter, setFilter] = useState("");
  const [scan, setScan] = useState<SkillRepoScan | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<"find" | "add" | null>(null);
  const [errors, setErrors] = useState<{ url?: string; ref?: string; add?: string }>({});

  const globs = useMemo(() => parseGlobs(filter), [filter]);
  const shown: ScannedSkill[] = scan ? scan.skills.filter((s) => matchesGlobs(s.name, globs)) : [];
  const chosen = shown.filter((s) => !s.in_library && checked.has(s.name));

  // Changing where to look goes back to "Find skills": the list no longer answers the question.
  const editSource = (patch: { url?: string; ref?: string }) => {
    if (patch.url !== undefined) setUrl(patch.url);
    if (patch.ref !== undefined) setRef(patch.ref);
    setScan(null);
    setErrors({});
  };

  const find = async () => {
    setBusy("find");
    setErrors({});
    try {
      const found = await scanSkillRepo(url.trim(), ref.trim() || undefined);
      setScan(found);
      setChecked(new Set(found.skills.filter((s) => !s.in_library).map((s) => s.name)));
    } catch (e) {
      const code = refusalCode(e);
      // GitHub not answering comes back as a 502 from a live backend: the app itself is fine.
      if (code === "github_unreachable") reportFetchOk();
      setErrors(code === "ref_not_found" ? { ref: errorText(e) } : { url: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (!scan || chosen.length === 0) return;
    setBusy("add");
    setErrors({});
    try {
      const res = await importSkills({
        url: scan.url,
        ref: scan.ref,
        sha: scan.sha,
        skills: chosen.map((s) => s.name),
        mode: "agent",
      });
      onAdded(res.added, res.skipped, scan.repo);
    } catch (e) {
      setErrors({ add: errorText(e) });
      setBusy(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (scan) void add();
    else if (url.trim()) void find();
  };

  const toggle = (name: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const cancel = (
    <Button variant="ghost" size="sm" onClick={onClose} disabled={busy === "add"}>
      Cancel
    </Button>
  );

  return (
    <Sheet
      open
      title="Add skills from GitHub"
      subtitle="Pull SKILL.md files from a repo"
      onClose={onClose}
      width={540}
      footerNote={scan ? "Skills update when you change the version." : cancel}
      footer={
        scan ? (
          <>
            {cancel}
            <Button
              type="submit"
              form={formId}
              variant="primary"
              size="sm"
              disabled={chosen.length === 0}
              loading={busy === "add"}
            >
              Add {plural(chosen.length, "skill")}
            </Button>
          </>
        ) : (
          <Button
            type="submit"
            form={formId}
            variant="primary"
            size="sm"
            disabled={!url.trim()}
            loading={busy === "find"}
          >
            Find skills
          </Button>
        )
      }
    >
      <form id={formId} className="sk-fromrepo" onSubmit={submit} noValidate>
        <Input
          label="Repository"
          value={url}
          onChange={(e) => editSource({ url: e.target.value })}
          error={errors.url}
          autoComplete="off"
          spellCheck={false}
        />
        <Input
          label="Version"
          optional
          helper={scan ? "A branch, tag or commit. Pinning keeps runs repeatable." : undefined}
          value={ref}
          onChange={(e) => editSource({ ref: e.target.value })}
          error={errors.ref}
          autoComplete="off"
          spellCheck={false}
        />
        {scan && (
          <>
            <Input
              label="Only these skills"
              optional
              helper="Leave empty to add every skill in the repo."
              placeholder="review-*, pytest-*"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="sk-found" role="group" aria-label="Skills found">
              <span className="sk-found__summary">
                <CircleCheck size={14} strokeWidth={1.6} aria-hidden />
                {foundSummary(shown.length, scan.skills.length, scan.ref, scan.short_sha)}
              </span>
              {shown.length === 0 && (
                <span className="sk-found__none">No skills match those names.</span>
              )}
              {shown.map((s) => (
                <label key={s.path || s.name} className="sk-found__row">
                  <input
                    type="checkbox"
                    checked={!s.in_library && checked.has(s.name)}
                    disabled={s.in_library}
                    onChange={() => toggle(s.name)}
                  />
                  <span className="sk-found__name">{s.name}</span>
                  {s.in_library && <span className="sk-found__note">Already in your skills</span>}
                </label>
              ))}
            </div>
            {errors.add && (
              <div className="sk-found__error" role="alert">
                {errors.add}
              </div>
            )}
          </>
        )}
      </form>
    </Sheet>
  );
}
