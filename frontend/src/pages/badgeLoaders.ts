/**
 * Every area's nav-badge loader, registered once at start-up (Workspace imports this module).
 * One line per area: `registerBadgeLoader("<area>", async () => ({ …counts }))` — see
 * `lib/workspaceStatus.ts`.
 */
import { listDomainSummaries } from "../lib/api/domains";
import { getInbox } from "../lib/api/home";
import { isDesktopApp } from "../lib/desktopRepos";
import { registerBadgeLoader } from "../lib/workspaceStatus";

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
