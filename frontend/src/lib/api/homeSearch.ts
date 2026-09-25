/**
 * The small reads the ⌘K palette and the get-started checklist need: a page of the account's runs
 * (`GET /api/runs`, runs.md) and the Needs-you items (`GET /api/inbox`). Only the fields those two
 * use are typed here; the requests go through Home's full clients (`runs.ts`, `home.ts`).
 */
import { isDesktopApp } from "../desktopRepos";
import { getInbox } from "./home";
import { listRunsPage } from "./runs";

export interface RunBrief {
  run_id: string;
  idea: string;
  status: string;
  created_at: string;
  updated_at?: string;
  pr_url?: string | null;
  pr_number?: number | null;
  ship_branch?: string | null;
  desktop_target?: boolean;
  team?: { id: string; name: string } | null;
}

export interface InboxBrief {
  key: string;
  kind: string;
  since?: string;
  count?: number;
  team?: { id: string; name: string } | null;
  target?: string;
  run?: { id: string; idea?: string; status?: string } | null;
  task?: { id: number; kind: string; title?: string } | null;
}

/** The newest runs (optionally matching `q` in the idea or team name). */
export async function listRunsBrief(
  opts: { q?: string; limit?: number } = {},
): Promise<RunBrief[]> {
  const page = await listRunsPage({ q: opts.q, limit: opts.limit ?? 50 });
  return page.runs;
}

/** Home's Needs-you items, oldest first (shares an in-flight request with Home and the badge). */
export async function getInboxBrief(): Promise<InboxBrief[]> {
  return (await getInbox(isDesktopApp() ? "desktop" : "website")).items;
}
