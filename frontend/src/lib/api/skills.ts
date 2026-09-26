/**
 * Toolkit › Skills (B-TOOLKIT contract, `docs/superpowers/plans/api/toolkit.md` § Skills): the
 * account's skill library, the free presets, one skill with the agents that use it, create / edit /
 * delete / duplicate, which agents have it on, and "Add from GitHub" (scan + import).
 *
 * Every answer is shape-checked here, at the boundary: a list answer in another shape is a failed
 * load (the page shows its error state), and a single malformed item is dropped rather than
 * blanking the whole list. Errors come back as `ApiDetailError` (status + the backend's own
 * message, and the structured `detail` for scan / import refusals).
 */
import { apiRequest } from "./runs";

export type SkillMode = "always" | "trigger" | "agent";

export interface InlineSkillSource {
  type: "inline";
  name: string;
  content: string;
  mode: SkillMode;
  triggers?: string[];
}

/** A GitHub repo: a bundle row (`filter` = globs) or one imported skill (`filter` = its name). */
export interface RepoSkillSource {
  type: "repo";
  url: string;
  ref: string;
  filter?: string | null;
  mode?: SkillMode;
  triggers?: string[];
  resolved_sha?: string;
}

/** Legacy: the rules of the repo a run works on (not offered in Toolkit; old rows still list). */
export interface ProjectRulesSkillSource {
  type: "project_rules";
}

export type SkillSource = InlineSkillSource | RepoSkillSource | ProjectRulesSkillSource;

export interface Skill {
  id: string;
  name: string;
  source: SkillSource;
  created_at: string;
  updated_at: string;
  usage: { agents: number; teams: number };
}

/** One agent that has the skill on ("<Role> · <Team>"). `title` is the agent's own name, if set. */
export interface SkillUsageRow {
  node_id: string;
  role_name: string | null;
  title: string | null;
  team_id: string;
  team_name: string;
}

export interface SkillDetail extends Skill {
  used_by: SkillUsageRow[];
}

export interface SkillPreset {
  key: string;
  /** The library name an added preset gets ("caveman", "tdd", "yagni"). */
  name: string;
  title: string;
  description: string;
  badge: string;
  source: InlineSkillSource;
}

/** An agent in the "Turn on for agents" picker, grouped by team. */
export interface SkillAgent {
  node_id: string;
  role_name: string | null;
  title: string | null;
  kind: string;
  edits_allowed: boolean;
  enabled: boolean;
  overridden: boolean;
  mode: SkillMode | null;
  triggers: string[] | null;
}

export interface SkillAgentTeam {
  team_id: string;
  team_name: string;
  agents: SkillAgent[];
}

export interface SkillAgentsResult {
  agents: SkillUsageRow[];
  agent_count: number;
  team_count: number;
}

export interface ScannedSkill {
  name: string;
  path: string;
  description: string | null;
  in_library: boolean;
}

export interface SkillRepoScan {
  repo: string;
  url: string;
  ref: string;
  sha: string;
  short_sha: string;
  skills: ScannedSkill[];
}

export interface SkillImportRequest {
  url: string;
  ref: string;
  sha: string;
  skills: string[];
  mode: SkillMode;
  triggers?: string[] | null;
  on_conflict?: "skip" | "replace" | "error";
}

// ---- shape checks ----

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const MODES: readonly string[] = ["always", "trigger", "agent"];
const isMode = (v: unknown): v is SkillMode => str(v) && MODES.includes(v);
const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter(str) : undefined;

function parseSource(raw: unknown, rowName: string): SkillSource | null {
  if (!isObj(raw)) return null;
  if (raw.type === "inline") {
    if (!str(raw.content)) return null;
    return {
      type: "inline",
      name: str(raw.name) ? raw.name : rowName,
      content: raw.content,
      mode: isMode(raw.mode) ? raw.mode : "always",
      ...(strList(raw.triggers) ? { triggers: strList(raw.triggers) } : {}),
    };
  }
  if (raw.type === "repo") {
    if (!str(raw.url)) return null;
    return {
      type: "repo",
      url: raw.url,
      ref: str(raw.ref) && raw.ref ? raw.ref : "main",
      filter: str(raw.filter) ? raw.filter : null,
      ...(isMode(raw.mode) ? { mode: raw.mode } : {}),
      ...(strList(raw.triggers) ? { triggers: strList(raw.triggers) } : {}),
      ...(str(raw.resolved_sha) ? { resolved_sha: raw.resolved_sha } : {}),
    };
  }
  if (raw.type === "project_rules") return { type: "project_rules" };
  return null;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** One skill item, or null when it isn't one (a newer server's unknown source type, say). */
export function parseSkill(raw: unknown): Skill | null {
  if (!isObj(raw) || !str(raw.id) || !str(raw.name)) return null;
  const source = parseSource(raw.source, raw.name);
  if (!source) return null;
  const created = str(raw.created_at) ? raw.created_at : "";
  const usage = isObj(raw.usage) ? raw.usage : {};
  return {
    id: raw.id,
    name: raw.name,
    source,
    created_at: created,
    updated_at: str(raw.updated_at) ? raw.updated_at : created,
    usage: { agents: count(usage.agents), teams: count(usage.teams) },
  };
}

function parseUsageRow(raw: unknown): SkillUsageRow | null {
  if (!isObj(raw) || !str(raw.node_id) || !str(raw.team_id)) return null;
  return {
    node_id: raw.node_id,
    role_name: str(raw.role_name) ? raw.role_name : null,
    title: str(raw.title) ? raw.title : null,
    team_id: raw.team_id,
    team_name: str(raw.team_name) ? raw.team_name : "",
  };
}

const usageRows = (v: unknown): SkillUsageRow[] =>
  Array.isArray(v) ? v.map(parseUsageRow).filter((r): r is SkillUsageRow => r !== null) : [];

function expectSkill(body: unknown, what: string): Skill {
  const skill = parseSkill(body);
  if (!skill) throw new Error(`Unexpected answer from ${what}`);
  return skill;
}

function parsePreset(raw: unknown): SkillPreset | null {
  if (!isObj(raw) || !str(raw.key) || !str(raw.name) || !str(raw.title)) return null;
  const source = parseSource(raw.source, raw.name);
  if (!source || source.type !== "inline") return null;
  return {
    key: raw.key,
    name: raw.name,
    title: raw.title,
    description: str(raw.description) ? raw.description : "",
    badge: str(raw.badge) ? raw.badge : "Free",
    source,
  };
}

function parseAgent(raw: unknown): SkillAgent | null {
  if (!isObj(raw) || !str(raw.node_id)) return null;
  return {
    node_id: raw.node_id,
    role_name: str(raw.role_name) ? raw.role_name : null,
    title: str(raw.title) ? raw.title : null,
    kind: str(raw.kind) ? raw.kind : "agent",
    edits_allowed: raw.edits_allowed === true,
    enabled: raw.enabled === true,
    overridden: raw.overridden === true,
    mode: isMode(raw.mode) ? raw.mode : null,
    triggers: strList(raw.triggers) ?? null,
  };
}

function parseAgentsResult(body: unknown, what: string): SkillAgentsResult {
  if (!isObj(body) || !Array.isArray(body.agents))
    throw new Error(`Unexpected answer from ${what}`);
  return {
    agents: usageRows(body.agents),
    agent_count: count(body.agent_count),
    team_count: count(body.team_count),
  };
}

const enc = encodeURIComponent;

// ---- library ----

/** GET /api/skill-library — the account's skills (oldest first; the page sorts by name). */
export async function listSkills(): Promise<Skill[]> {
  const body = await apiRequest<unknown>("GET", "/api/skill-library");
  if (!isObj(body) || !Array.isArray(body.skills))
    throw new Error("Unexpected answer from /api/skill-library");
  return body.skills.map(parseSkill).filter((s): s is Skill => s !== null);
}

/** GET /api/skill-library/{id} — one skill plus the agents that use it. */
export async function getSkill(id: string): Promise<SkillDetail> {
  const body = await apiRequest<unknown>("GET", `/api/skill-library/${enc(id)}`);
  const skill = expectSkill(body, "/api/skill-library/{id}");
  return { ...skill, used_by: usageRows(isObj(body) ? body.used_by : null) };
}

/** POST /api/skill-library — create-only: 409 "You already have a skill called <name>.". */
export async function createSkill(
  name: string,
  source: SkillSource,
  opts: { onConflict?: "error" | "replace" } = {},
): Promise<Skill> {
  const q = opts.onConflict === "replace" ? "?on_conflict=replace" : "";
  const body = await apiRequest<unknown>("POST", `/api/skill-library${q}`, { name, source });
  return expectSkill(body, "POST /api/skill-library");
}

/** PATCH /api/skill-library/{id} — rename and/or replace the source (409 on a taken name). */
export async function updateSkill(
  id: string,
  patch: { name?: string; source?: SkillSource },
): Promise<Skill> {
  const body = await apiRequest<unknown>("PATCH", `/api/skill-library/${enc(id)}`, patch);
  return expectSkill(body, "PATCH /api/skill-library/{id}");
}

/** DELETE /api/skill-library/{id} — also takes it off every agent; idempotent. */
export async function deleteSkill(id: string): Promise<{ removed_from_agents: number }> {
  const body = await apiRequest<unknown>("DELETE", `/api/skill-library/${enc(id)}`);
  return { removed_from_agents: count(isObj(body) ? body.removed_from_agents : 0) };
}

/** POST /api/skill-library/{id}/duplicate — a copy named `<name>-copy` (`-copy-2`, …). */
export async function duplicateSkill(id: string): Promise<Skill> {
  const body = await apiRequest<unknown>("POST", `/api/skill-library/${enc(id)}/duplicate`);
  return expectSkill(body, "POST /api/skill-library/{id}/duplicate");
}

// ---- agents ----

/** GET /api/skill-library/{id}/agents — every agent by team, `enabled` = has the skill on. */
export async function getSkillAgents(id: string): Promise<SkillAgentTeam[]> {
  const body = await apiRequest<unknown>("GET", `/api/skill-library/${enc(id)}/agents`);
  if (!isObj(body) || !Array.isArray(body.teams))
    throw new Error("Unexpected answer from /api/skill-library/{id}/agents");
  return body.teams.flatMap((t): SkillAgentTeam[] => {
    if (!isObj(t) || !str(t.team_id)) return [];
    const agents = Array.isArray(t.agents)
      ? t.agents.map(parseAgent).filter((a): a is SkillAgent => a !== null)
      : [];
    return [{ team_id: t.team_id, team_name: str(t.team_name) ? t.team_name : "", agents }];
  });
}

/** PUT /api/skill-library/{id}/agents — exactly these agents have the skill on afterwards. */
export async function setSkillAgents(id: string, nodeIds: string[]): Promise<SkillAgentsResult> {
  const body = await apiRequest<unknown>("PUT", `/api/skill-library/${enc(id)}/agents`, {
    node_ids: nodeIds,
  });
  return parseAgentsResult(body, "PUT /api/skill-library/{id}/agents");
}

// ---- presets ----

/** GET /api/skill-presets — the free presets (Caveman, TDD discipline, YAGNI). */
export async function listSkillPresets(): Promise<SkillPreset[]> {
  const body = await apiRequest<unknown>("GET", "/api/skill-presets");
  if (!isObj(body) || !Array.isArray(body.skills))
    throw new Error("Unexpected answer from /api/skill-presets");
  return body.skills.map(parsePreset).filter((p): p is SkillPreset => p !== null);
}

// ---- Add from GitHub ----

/** POST /api/skill-library/scan — the skills a repo holds at a ref (`ref` empty → default branch).
 *  Refusals carry `detail: {code, message}` (repo_not_found, invalid_url, ref_not_found, …). */
export async function scanSkillRepo(url: string, ref?: string): Promise<SkillRepoScan> {
  const body = await apiRequest<unknown>("POST", "/api/skill-library/scan", {
    url,
    ...(ref ? { ref } : {}),
  });
  if (!isObj(body) || !str(body.sha) || !Array.isArray(body.skills))
    throw new Error("Unexpected answer from /api/skill-library/scan");
  return {
    repo: str(body.repo) ? body.repo : "",
    url: str(body.url) ? body.url : url,
    ref: str(body.ref) ? body.ref : (ref ?? ""),
    sha: body.sha,
    short_sha: str(body.short_sha) ? body.short_sha : body.sha.slice(0, 7),
    skills: body.skills.flatMap((s): ScannedSkill[] =>
      isObj(s) && str(s.name)
        ? [
            {
              name: s.name,
              path: str(s.path) ? s.path : "",
              description: str(s.description) ? s.description : null,
              in_library: s.in_library === true,
            },
          ]
        : [],
    ),
  };
}

/** POST /api/skill-library/import — one library row per chosen skill. */
export async function importSkills(
  req: SkillImportRequest,
): Promise<{ added: Skill[]; skipped: string[] }> {
  const body = await apiRequest<unknown>("POST", "/api/skill-library/import", req);
  if (!isObj(body) || !Array.isArray(body.added))
    throw new Error("Unexpected answer from /api/skill-library/import");
  return {
    added: body.added.map(parseSkill).filter((s): s is Skill => s !== null),
    skipped: strList(body.skipped) ?? [],
  };
}
