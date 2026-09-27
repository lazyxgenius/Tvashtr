/* eslint-disable react-refresh/only-export-components -- test helpers, never hot-reloaded */
/** Shared fixtures and the mounted page for the Toolkit › Skills tests. */
import { render, screen } from "@testing-library/react";

import { ToastProvider } from "../../design-system/components";
import { useNav } from "../../lib/nav";
import { useNavBadges } from "../../lib/workspaceStatus";
import { SkillEditorPage } from "./SkillEditorPage";
import { SkillsPage } from "./SkillsPage";

export const inline = (name: string, mode = "always", triggers?: string[]) => ({
  type: "inline",
  name,
  content: `# ${name}`,
  mode,
  ...(triggers ? { triggers } : {}),
});
export const skill = (
  id: string,
  name: string,
  source: object,
  usage = { agents: 0, teams: 0 },
  updated = "2026-09-23T12:00:00+00:00",
) => ({ id, name, source, created_at: updated, updated_at: updated, usage });

export const LIBRARY = [
  skill(
    "s3",
    "security-checklist",
    inline("security-checklist", "trigger", ["auth", "secrets", "tokens"]),
    undefined,
    "2026-09-24T12:00:00+00:00",
  ),
  skill("s1", "house-style", inline("house-style"), { agents: 2, teams: 1 }),
  skill(
    "s2",
    "pytest-review",
    { type: "repo", url: "https://github.com/org/skills", ref: "main", mode: "agent" },
    { agents: 1, teams: 1 },
    "2026-09-21T12:00:00+00:00",
  ),
];

function Badges() {
  const b = useNavBadges();
  return <output aria-label="skills badge">{b.skills ?? ""}</output>;
}

/** The pages as Workspace mounts them: the address picks the list tab or the editor. */
function Harness() {
  const { route } = useNav();
  return (
    <>
      {route.page === "skills" ? (
        <SkillsPage view={route.view} />
      ) : route.page === "skill" ? (
        <SkillEditorPage skillId={route.skillId} />
      ) : (
        <p>elsewhere</p>
      )}
      <Badges />
    </>
  );
}

export function renderAt(hash: string) {
  window.location.hash = hash;
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

export const table = () => screen.getByRole("region", { name: "Your skills" });
