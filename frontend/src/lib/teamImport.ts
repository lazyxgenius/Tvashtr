/**
 * M4 (File-Imported): what an import left to fix, kept in this tab's session storage under the new
 * team's id, so the canvas's "things to fix" card and the agent cards' chips survive a reload.
 * `toast`: the "Imported as a new team" toast is still to show (the canvas shows it once).
 */
import type { ImportedTeam, ImportFix } from "./api/teams";
import type { Route } from "./nav";

/** What the file pickers offer: a team file is YAML or JSON. */
export const TEAM_FILE_ACCEPT = ".yaml,.yml,.json";

export interface ImportNotice {
  fixes: ImportFix[];
  note: string;
  /** The card was hidden (the chips stay). */
  hidden?: boolean;
  toast?: boolean;
}

const key = (teamId: string) => `tvashtr.teamImport.${teamId}`;

/** Session storage, or null where it's blocked (private windows, sandboxed previews). */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function writeImportNotice(teamId: string, notice: ImportNotice): void {
  try {
    storage()?.setItem(key(teamId), JSON.stringify(notice));
  } catch {
    // Storage full or blocked: the card shows until the page reloads.
  }
}

/** Right after an import: the canvas shows the toast, the card and the chips. */
export function rememberImport(team: ImportedTeam): void {
  writeImportNotice(team.team_graph_id, { fixes: team.fixes, note: team.note, toast: true });
}

export function readImportNotice(teamId: string): ImportNotice | null {
  try {
    const raw = storage()?.getItem(key(teamId));
    const notice = raw ? (JSON.parse(raw) as ImportNotice) : null;
    return notice && Array.isArray(notice.fixes) ? notice : null;
  } catch {
    return null;
  }
}

/** Where a fix is made: a connector's sign-in → Toolkit › Connectors, a tool / skill / secret → its
 *  Toolkit page, a model's provider key → Engines. null: GitHub (the GitHub App install), and a
 *  graph that can't run (changed on the canvas the card sits on). */
export function fixRoute(f: ImportFix): Route | null {
  if (f.action === "open_team") return null;
  if (f.action === "open_engines") return { page: "engines", tab: "overview", fix: true };
  if (f.action === "open_domains") return { page: "domains" };
  if (f.action === "sign_in")
    return f.target === "github" ? null : { page: "connectors", view: "connected" };
  if (f.key.startsWith("tool:")) return { page: "tools", view: "installed" };
  if (f.key.startsWith("skill:")) return { page: "skills", view: "mine" };
  if (f.key.startsWith("secret")) return { page: "secrets" };
  return { page: "connectors", view: "connected" };
}

const PROVIDER: Record<string, string> = { github: "GitHub" };
export const providerWord = (p: string) => PROVIDER[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Each node's chips: "Needs GitHub", "1 tool missing", "2 skills missing". */
export function fixChips(fixes: readonly ImportFix[]): Map<string, string[]> {
  const byNode = new Map<string, { needs: string[]; tools: number; skills: number }>();
  for (const f of fixes) {
    for (const id of f.node_ids) {
      const n = byNode.get(id) ?? { needs: [], tools: 0, skills: 0 };
      if (f.key.startsWith("tool:")) n.tools += 1;
      else if (f.key.startsWith("skill:")) n.skills += 1;
      else if (f.action === "open_engines") n.needs.push("Needs a model key");
      else if (f.action === "open_domains") n.needs.push("Needs a Domain");
      else
        n.needs.push(`Needs ${f.action === "sign_in" ? providerWord(f.target ?? "") : f.target}`);
      byNode.set(id, n);
    }
  }
  const chips = new Map<string, string[]>();
  for (const [id, n] of byNode) {
    chips.set(id, [
      ...new Set(n.needs),
      ...(n.tools ? [`${plural(n.tools, "tool")} missing`] : []),
      ...(n.skills ? [`${plural(n.skills, "skill")} missing`] : []),
    ]);
  }
  return chips;
}
