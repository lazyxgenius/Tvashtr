/**
 * Every area's nav-badge loader, registered once at start-up (Workspace imports this module).
 * One line per area: `registerBadgeLoader("<area>", async () => ({ …counts }))` — see
 * `lib/workspaceStatus.ts`.
 */
import { getInbox } from "../lib/api/home";
import { getToolkitSummary } from "../lib/api/tools";
import { isDesktopApp } from "../lib/desktopRepos";
import { registerBadgeLoader } from "../lib/workspaceStatus";

registerBadgeLoader("home", async () => ({
  home: (await getInbox(isDesktopApp() ? "desktop" : "website")).count,
}));

// Toolkit: one loader for the whole group (spec §3.3) — Tools / Skills counts, Memory "N new" and
// Secrets "N missing", from GET /api/toolkit/summary. Toolkit pages call `refreshBadges()` after a
// change.
registerBadgeLoader("toolkit", async () => {
  const s = await getToolkitSummary();
  return {
    tools: s.tools,
    skills: s.skills,
    memoryInbox: s.memory.inbox,
    secretsMissing: s.secrets_missing,
  };
});
