/**
 * Every area's nav-badge loader, registered once at start-up (Workspace imports this module).
 * One line per area: `registerBadgeLoader("<area>", async () => ({ …counts }))` — see
 * `lib/workspaceStatus.ts`.
 */
import { listDomainSummaries } from "../lib/api/domains";
import { getInbox } from "../lib/api/home";
import { getToolkitSummary } from "../lib/api/tools";
import { isDesktopApp } from "../lib/desktopRepos";
import { registerBadgeLoader } from "../lib/workspaceStatus";
import { loadEngineBadges } from "./engines/engineBadges";

registerBadgeLoader("home", async () => ({
  home: (await getInbox(isDesktopApp() ? "desktop" : "website")).count,
}));

// Domains: the nav's per-domain children and their status dots (DM-1), in creation order.
registerBadgeLoader("domains", async () => ({
  domains: (await listDomainSummaries()).map((d) => ({
    id: d.domain_id,
    name: d.name,
    state: d.state,
  })),
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

registerBadgeLoader("engines", loadEngineBadges);
