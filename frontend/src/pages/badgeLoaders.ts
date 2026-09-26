/**
 * Every area's nav-badge loader, registered once at start-up (Workspace imports this module).
 * One line per area: `registerBadgeLoader("<area>", async () => ({ …counts }))` — see
 * `lib/workspaceStatus.ts`.
 */
import { getInbox } from "../lib/api/home";
import { isDesktopApp } from "../lib/desktopRepos";
import { registerBadgeLoader } from "../lib/workspaceStatus";
import { loadEngineBadges } from "./engines/engineBadges";

registerBadgeLoader("home", async () => ({
  home: (await getInbox(isDesktopApp() ? "desktop" : "website")).count,
}));
registerBadgeLoader("engines", loadEngineBadges);
