/**
 * Off-camera setup helpers for the scene scripts: each scene's starting state is built through the
 * app's own API (a node-side session as the filming account), never by writing the database.
 */
import story from "./story.mjs";

const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
};

/** The account holds exactly one API key (the story's DeepSeek); any other is removed. */
export async function keepOnlyKey(api, provider = story.api_key.provider) {
  const { providers } = must(await api("GET", "/api/providers"), "providers");
  if (!providers.some((p) => p.provider === provider))
    throw new Error(`the ${provider} key is missing — video/stack/reset re-seeds it`);
  for (const p of providers)
    if (p.provider !== provider) must(await api("DELETE", `/api/providers/${p.provider}`), `remove ${p.provider}`);
}

export async function teams(api) {
  return must(await api("GET", "/api/teams"), "teams").teams;
}

/** Clear every team named `name` (or matching a predicate) — see retireTeams: runs are kept. */
export async function deleteTeams(api, match) {
  const ok = typeof match === "function" ? match : (t) => t.name === match;
  for (const t of await teams(api)) if (ok(t)) await retireTeams(api, t.name);
}

/**
 * Clear the name for a fresh team: a same-named team with no runs is deleted; one with runs is
 * renamed "<name> (earlier)" — deleting a team cancels and deletes its runs, and a run made while
 * filming stays on the record.
 */
export async function retireTeams(api, name) {
  for (const t of await teams(api)) {
    if (t.name !== name) continue;
    const runs = must(await api("GET", `/api/teams/${t.team_graph_id}/runs`), "team runs").runs ?? [];
    if (runs.length) must(await api("PATCH", `/api/teams/${t.team_graph_id}`, { name: `${name} (earlier)` }), "rename");
    else must(await api("DELETE", `/api/teams/${t.team_graph_id}`), `delete ${name}`);
  }
}

export async function graph(api, id) {
  return must(await api("GET", `/api/teams/${id}/graph`), "graph");
}

export const byRole = (g, role) => g.nodes.find((n) => n.role_name === role);
export const byTitle = (g, title) => g.nodes.find((n) => n.config?.title === title);
const edge = (g, from, to) => g.edges.find((e) => e.source_node_id === from.id && e.target_node_id === to.id);

// ---- Toolkit (scene 1.3's results) -----------------------------------------------------------

/** The web-fetch tool and the GitHub skill in the library (as 1.3 leaves them). */
export async function ensureToolkit(api, { tool = true, skill = true } = {}) {
  const out = {};
  if (tool) {
    const lib = must(await api("GET", "/api/tool-library"), "tool library").tools;
    let t = lib.find((x) => x.name === story.toolkit.tool);
    if (!t) {
      const cat = must(await api("GET", "/api/tool-catalog"), "tool catalog").tools;
      const fetchTool = cat.find((x) => x.key === story.toolkit.tool);
      t = must(
        await api("POST", "/api/tool-library", { name: fetchTool.name, server_config: fetchTool.server_config }),
        "add tool",
      );
    }
    out.toolId = t.id;
  }
  if (skill) {
    const lib = must(await api("GET", "/api/skill-library"), "skill library").skills;
    let s = lib.find((x) => x.name === SKILL);
    if (!s) {
      const scan = must(await api("POST", "/api/skill-library/scan", { url: story.toolkit.skills_repo, ref: "main" }), "scan");
      const r = must(
        await api("POST", "/api/skill-library/import", {
          url: scan.url,
          ref: scan.ref,
          sha: scan.sha,
          skills: [SKILL],
          mode: "agent",
        }),
        "import skill",
      );
      s = (r.skills ?? r.imported ?? [r]).find((x) => x.name === SKILL) ?? r;
      if (!s.id) s = must(await api("GET", "/api/skill-library"), "skill library").skills.find((x) => x.name === SKILL);
    }
    out.skillId = s.id;
  }
  return out;
}
export const SKILL = "mcp-builder";

/** Remove what 1.3 adds on camera, so it can add it again. */
export async function clearToolkit(api) {
  for (const t of must(await api("GET", "/api/tool-library"), "tools").tools)
    must(await api("DELETE", `/api/tool-library/${t.id}`), "delete tool");
  for (const s of must(await api("GET", "/api/skill-library"), "skills").skills)
    must(await api("DELETE", `/api/skill-library/${s.id}`), "delete skill");
  for (const s of must(await api("GET", "/api/secrets"), "secrets").secrets ?? [])
    must(await api("DELETE", `/api/secrets/${s.name}`), "delete secret");
}

// ---- the domain -----------------------------------------------------------------------------

export async function ensureDomain(api) {
  const { domains } = must(await api("GET", "/api/domains"), "domains");
  const d = domains.find((x) => x.name === story.domain.name);
  if (d) return d.domain_id ?? d.id;
  return must(await api("POST", "/api/domains", { name: story.domain.name, template: "support" }), "domain").domain_id;
}

// ---- the film team, stage by stage (brief storyboard 2.1–2.7) ---------------------------------

export const STAGES = ["template", "pm", "domain", "guardrail", "models", "fixer", "final"];
export const PM_LINE =
  "Write the spec for one indicator at a time: its function in core/indicators.py, registered on INDICATORS, with tests in tests/test_indicators.py.";
const FIXER_PROMPT =
  "You are the Fixer. The Engineer failed or ran out of time. Read the spec and the Engineer's last notes, make the smallest change that makes the tests in tests/test_indicators.py pass, and say what you changed.";

/**
 * The film team named `name`, rebuilt from the template up to `upTo` (each stage is the state a
 * scene of chapter 2 starts from; "final" is 2.7's end state). Any team of that name is replaced.
 * Opening its canvas afterwards makes v1 (the first GET of its versions does).
 */
export async function buildFilmTeam(
  api,
  { name = story.team.name, upTo = "final", skipDomain = false, bareGuardrail = false } = {},
) {
  const stop = STAGES.indexOf(upTo);
  if (stop < 0) throw new Error(`no stage ${upTo}`);
  const at = (s) => STAGES.indexOf(s) <= stop;
  await retireTeams(api, name);
  const id = must(await api("POST", "/api/teams", { template: story.team.template, name }), "create team")
    .team_graph_id;
  let g = await graph(api, id);
  const pm = byRole(g, "pm");
  const eng = byRole(g, "engineer");
  const rev = byRole(g, "reviewer");
  const ship = byRole(g, "ship");
  const stopNode = byRole(g, "stop");
  const patch = async (n, body) =>
    must(
      await api("PATCH", `/api/teams/${id}/nodes/${n.id}`, n.model ? { prompt: n.prompt, model: n.model, ...body } : body),
      `patch ${n.role_name}`,
    );

  if (at("pm")) await patch(pm, { prompt: `${pm.prompt.trimEnd()}\n\n${PM_LINE}` });
  if (at("domain") && !skipDomain) {
    const did = await ensureDomain(api);
    must(
      await api("POST", `/api/domains/${did}/steps`, {
        team_id: id,
        after_node_id: pm.id,
        prompt: story.domain.question,
        pass_to_spec: true,
      }),
      "query domain step",
    );
  }
  if (at("guardrail")) {
    // bareGuardrail (2.4): two plain approval gates already wired in; the scene sets their checks
    // and the Engineer's tools and skills on camera.
    if (!bareGuardrail) {
      const kit = await ensureToolkit(api);
      await patch(eng, {
        tool_config: { tvashtr: { library: [kit.toolId] } },
        skills: [...(eng.skills ?? []), { type: "library", id: kit.skillId }],
      });
    }
    g = await graph(api, id);
    const r = byRole(g, "reviewer");
    const s = byRole(g, "ship");
    const gate = async (cfg, pos) => {
      const n = must(
        await api("POST", `/api/teams/${id}/nodes`, { node_kind: "gate", title: cfg.title, position: pos }),
        "add gate",
      );
      const description =
        cfg.gate_kind === "secret_leak_scan"
          ? "Scans the run's workspace for secrets before anything ships."
          : "Stops the run if the change touches servers/.";
      if (bareGuardrail) {
        // A plain approval gate with its real title and description: 2.4 sets its check on camera.
        must(await api("PATCH", `/api/teams/${id}/nodes/${n.id}`, { title: cfg.title, description }), "name gate");
        return n;
      }
      must(
        await api("PATCH", `/api/teams/${id}/nodes/${n.id}`, {
          gate_kind: cfg.gate_kind,
          title: cfg.title,
          description,
          ...(cfg.paths ? { forbidden_paths: cfg.paths } : {}),
        }),
        "set gate",
      );
      return n;
    };
    const g1 = await gate(story.guardrail.secret_scan, { x: s.position.x, y: 0 });
    const g2 = await gate(story.guardrail.forbidden, { x: s.position.x + 260, y: 0 });
    must(await api("POST", `/api/teams/${id}/positions`, { positions: { [s.id]: { x: s.position.x + 520, y: 0 } } }), "move ship");
    const old = edge(g, r, s);
    if (old) must(await api("DELETE", `/api/teams/${id}/edges/${old.id}`), "delete reviewer→ship");
    const add = (from, to, role, label) =>
      api("POST", `/api/teams/${id}/edges`, {
        source_node_id: from.id,
        target_node_id: to.id,
        role,
        ...(label ? { label } : {}),
      }).then((x) => must(x, `edge ${label ?? role}`));
    await add(r, g1, "branch", "approved");
    await add(g1, g2, "branch", "approved");
    await add(g1, stopNode, "branch", "rejected");
    await add(g2, s, "branch", "approved");
    await add(g2, stopNode, "branch", "rejected");
  }
  if (at("models")) {
    g = await graph(api, id);
    const A = story.agents;
    await patch(byRole(g, "pm"), { model: A.pm.model });
    await patch(byRole(g, "engineer"), { model: A.engineer.model, fallback_model: story.backup_model });
    await patch(byRole(g, "reviewer"), { model: A.reviewer.model });
  }
  if (at("fixer")) {
    g = await graph(api, id);
    const e = byRole(g, "engineer");
    await patch(e, { memory_remember_enabled: true });
    const fixer = must(
      await api("POST", `/api/teams/${id}/nodes`, {
        node_kind: "worker",
        title: story.agents.fixer.title,
        prompt: FIXER_PROMPT,
        model: story.agents.fixer.model,
        position: { x: e.position.x + 130, y: e.position.y + 360 },
      }),
      "add fixer",
    );
    must(
      await api("POST", `/api/teams/${id}/edges`, { source_node_id: e.id, target_node_id: fixer.id, role: "failure" }),
      "failure path",
    );
    must(
      await api("POST", `/api/teams/${id}/edges`, {
        source_node_id: fixer.id,
        target_node_id: byRole(g, "reviewer").id,
        role: "forward",
      }),
      "fixer → reviewer",
    );
  }
  if (at("final")) {
    g = await graph(api, id);
    // A clean left-to-right layout (what Tidy does on camera in 2.7).
    const t = (title) => byTitle(g, title);
    const main = [byRole(g, "pm"), byRole(g, "domain_query"), byRole(g, "prd_gate"), byRole(g, "engineer"),
      byRole(g, "reviewer"), t(story.guardrail.secret_scan.title), t(story.guardrail.forbidden.title), byRole(g, "ship")].filter(Boolean);
    const positions = {};
    main.forEach((n, i) => (positions[n.id] = { x: i * 250, y: 0 }));
    const x = (n) => positions[n.id].x;
    const eng = byRole(g, "engineer");
    positions[byRole(g, "stop").id] = { x: x(byRole(g, "prd_gate")), y: 230 };
    positions[byRole(g, "escalation_gate").id] = { x: x(eng), y: 230 };
    const fixer = byTitle(g, story.agents.fixer.title);
    if (fixer) positions[fixer.id] = { x: x(byRole(g, "reviewer")), y: 430 };
    must(await api("POST", `/api/teams/${id}/positions`, { positions }), "positions");
    must(
      await api("PUT", `/api/teams/${id}/layout`, {
        groups: [
          {
            id: "g-loop",
            label: story.loop.group,
            node_ids: [byRole(g, "engineer").id, byRole(g, "reviewer").id],
            folded: false,
          },
        ],
      }),
      "group the loop",
    );
  }
  g = await graph(api, id);
  const v = must(await api("GET", `/api/teams/${id}/validate`), "validate");
  return { id, g, validate: v };
}

export { must, story };
