/**
 * The small reads the ⌘K palette and the get-started checklist need: a page of the account's runs
 * (`GET /api/runs`, runs.md) and the Needs-you items (`GET /api/inbox`). Only the fields those two
 * use are typed here; Home's own run and inbox sections have their full clients.
 */
import { apiUrl } from "../api";
import { reportFetchFailed, reportFetchOk } from "../backendStatus";

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

async function getJSON<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(url));
  } catch (err) {
    reportFetchFailed();
    throw err;
  }
  if (res.status >= 502 && res.status <= 504) reportFetchFailed();
  else reportFetchOk();
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

/** The newest runs (optionally matching `q` in the idea or team name). */
export async function listRunsBrief(
  opts: { q?: string; limit?: number } = {},
): Promise<RunBrief[]> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  params.set("limit", String(opts.limit ?? 50));
  const body = await getJSON<{ runs?: RunBrief[] }>(`/api/runs?${params.toString()}`);
  return body.runs ?? [];
}

/** Home's Needs-you items, oldest first. */
export async function getInboxBrief(): Promise<InboxBrief[]> {
  const surface =
    document.documentElement.dataset.tvashtrDesktop === "true" ? "desktop" : "website";
  const body = await getJSON<{ items?: InboxBrief[] }>(`/api/inbox?surface=${surface}`);
  return body.items ?? [];
}
