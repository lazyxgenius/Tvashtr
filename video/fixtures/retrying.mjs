/**
 * 3.5 Retrying, then the backup-model switch (SAMPLE). The hero run ("Add a Hull moving average
 * indicator") on the film team as live-base.json captured it, at the Engineer's round 2: its model
 * is busy (retry 1 of 3, then 2 of 3, the pinned "The Engineer’s model is busy"), the person clicks
 * "Switch to the backup model now", and the Engineer carries on on deepseek/deepseek-chat.
 *
 * Copied from scripts/design-parity/scenarios/runs-fixtures.mjs (boardRoutes, Live-Retrying /
 * Live-Quiet) and rewritten to the story. Every word the server makes is made here as the server
 * makes it: line texts (backend/tvashtr/control_plane/activity.py _retry_text 344-347, backup
 * 485-495, gate/doc lines 720-790, _event_lines 350-470), the pinned callout (971-987, _retry_body
 * 1130-1142), labels (run_failure.node_label: "PM", "Domain", "Approval", gate kinds), the agent's
 * live block (live_state.derive / activity_line: backup_model only once a backup_model event exists).
 *
 * A moving clock (no frozen Date): the scene calls ctx.retrying.begin() when filming starts; until
 * then the reply holds still at retry 1 of 3. Retry 2 of 3 lands RETRY2_S after begin; the switch
 * happens when the page POSTs .../switch-backup (the film clicks it), and the Engineer's next steps
 * follow it. Money (Desktop reads, ?desktop_target=1): ran_on BOTH_AND_KEY throughout — the Query
 * domain round's DeepSeek answer is the run's one cost row; the Engineer's backup spend lands only
 * when its round ends, after this clip (desktop_jobs.py ran_on, team_run persist_agent_cost_step).
 *
 * Not reachable as filmed (video/SCENES.md): the per-attempt retry lines, the callout's switch and
 * POST .../switch-backup exist only for a Query domain round's model call (team_run
 * domain_query_step_v2 → gateway); an Engineer on the Claude subscription never retries or
 * switches, and an API-key Engineer switches only after its own retries, with one backup line.
 */
import { GRAPH, RAN_ON, TEAM_ID, clone, live, liveRoutes, story } from "./base.mjs";

export const RUN_ID = "3f6c1d2e-8a4b-4c7d-9e21-5b7a0c9d4e68";
const RUN_GRAPH_ID = "b8e4a0c2-6d1f-4e3a-8b5c-0f2d7c9a1e46"; // the run's copy of the team graph
const SPEC_ID = "c2d7e9f1-3a5b-4c8d-9e0f-1a2b3c4d5e6f";
export const RETRY2_S = 3; // retry 2 of 3 lands this long after begin()

const GATE_LABELS = { prd_approval: "Approval", ship_approval: "Ship approval", review_escalation: "Escalation", budget_approval: "Budget" };
const ROLE_LABELS = { pm: "PM", architect: "Architect", engineer: "Engineer", reviewer: "Reviewer", thinker: "Thinker", worker: "Worker", ship: "Ship", stop: "Stop", domain_query: "Domain" };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
/** run_failure.node_label: the label the Activity and the Now bar use. */
function label(n) {
  const c = n.config ?? {};
  if (n.kind === "gate") return GATE_LABELS[c.gate_kind] ?? (c.gate_kind ? cap(c.gate_kind.replaceAll("_", " ").trim()) : "Approval");
  if ((n.kind === "completion" || n.kind === "agent") && c.title?.trim()) return c.title.trim();
  return ROLE_LABELS[n.role_name] ?? cap(n.role_name.replaceAll("_", " ").trim());
}

const TEST = "python -m pytest -q tests/test_indicators.py";
const ENGINEER_MODEL = story.agents.engineer.model; // anthropic/claude-sonnet-5
const BACKUP = story.backup_model; // deepseek/deepseek-chat (the Engineer's fallback_model on the live graph)

export default (ctx) => {
  const team = GRAPH();
  const by = (role, gateKind) => team.nodes.find((n) => n.role_name === role && (!gateKind || n.config?.gate_kind === gateKind));
  const N = {
    pm: by("pm"),
    domain: by("domain_query"),
    gate: by("prd_gate"),
    eng: by("engineer"),
    rev: by("reviewer"),
    fixer: team.nodes.find((n) => n.config?.title === "Fixer"),
    scan: by("gate", "secret_leak_scan"),
    paths: by("gate", "diff_touches_forbidden_paths"),
    esc: by("escalation_gate"),
    ship: by("ship"),
    stop: by("stop"),
  };
  if (N.eng.config?.fallback_model !== BACKUP) throw new Error(`the film Engineer's backup is ${N.eng.config?.fallback_model}, not ${BACKUP}`);
  const LABEL = Object.fromEntries(team.nodes.map((n) => [n.id, label(n)]));

  // ---- the clock ----------------------------------------------------------------------------
  const st = { t0: null, switchedAt: null };
  ctx.retrying = {
    begin() {
      st.t0 ??= Date.now();
    },
  };
  const base = () => st.t0 ?? Date.now();
  const e = () => (st.t0 === null ? 0 : (Date.now() - st.t0) / 1000);
  const at = (s) => new Date(base() + s * 1000).toISOString(); // s seconds from begin()
  const sw = () => (st.switchedAt === null ? null : (Date.now() - st.switchedAt) / 1000);
  const afterSwitch = (s) => new Date(st.switchedAt + s * 1000).toISOString();

  // ---- the lines (activity.py's words) ------------------------------------------------------
  const line = (id, s, node, iteration, kind, text, tone = "neutral", refs = {}) => ({
    id,
    at: typeof s === "string" ? s : at(s),
    node_id: node ? node.id : null,
    label: node ? LABEL[node.id] : "Run",
    iteration,
    kind,
    text,
    tone,
    refs,
    from_run: null,
  });
  const tests = (id, s, node, iteration, passed, failed, tail) =>
    line(id, s, node, iteration, "tests", failed ? `Ran the tests: ${failed} failed, ${passed} passed` : `Ran the tests: all ${passed} passed`, failed ? "warn" : "ok", {
      command: TEST,
      running: false,
      started_at: typeof s === "number" ? at(s - 4) : s,
      exit_code: failed ? 1 : 0,
      output_tail: tail,
      passed,
      failed,
    });
  const edited = (id, s, node, iteration, file, added, removed) =>
    line(id, s, node, iteration, "edited", `Edited ${file}`, "neutral", { file, added, removed });
  const retryLine = (id, s, attempt, wait) =>
    line(id, s, N.eng, 2, "retry", `Model busy (too many requests). Trying again in ${wait} s · ${attempt} of 3`, "warn", {
      attempt,
      of: 3,
      wait_s: wait,
      next_at: at(s + wait),
      reason: "busy",
    });
  const VERDICT = ["Register hull_ma on INDICATORS", "Return None for the first period + √period − 2 values"];

  function lines() {
    const L = [
      line("run:start", -600, null, null, "started", `Started on ${story.repo.full_name}, branch ${story.repo.branch}`, "neutral", {
        repo: story.repo.full_name,
        branch: story.repo.branch,
      }),
      line("inv:1:start", -598, N.pm, 1, "started", "Started"),
      line(`doc:${SPEC_ID}:v1`, -560, N.pm, 1, "wrote_doc", "Wrote the spec (v1)", "neutral", { document_id: SPEC_ID, version: 1, name: "spec" }),
      line("inv:2:start", -558, N.domain, 1, "started", "Started"),
      // pass_to_spec: the Query domain adds its answer to the spec as v2 (team_run
      // append_domain_answer_to_spec_step), so your edits at the gate are v3.
      line(`doc:${SPEC_ID}:v2`, -547, N.domain, 1, "wrote_doc", "Wrote the spec (v2)", "neutral", { document_id: SPEC_ID, version: 2, name: "spec" }),
      line("task:1:open", -545, N.gate, 1, "gate_waiting", "Waiting for you to approve the spec", "warn", { task_id: 1, title: N.gate.config.title }),
      line("task:1:done", -480, N.gate, 1, "gate_approved", "Approved with your edits · spec v3", "ok", {
        task_id: 1,
        title: N.gate.config.title,
        edited_version: 3,
      }),
      line("inv:4:start", -478, N.eng, 1, "started", "Started"),
      line("ev:101", -465, N.eng, 1, "read", "Read 2 files in core/ and tests/", "neutral", { files: ["core/indicators.py", "tests/test_indicators.py"] }),
      edited("ev:104", -430, N.eng, 1, "core/indicators.py", 41, 0),
      edited("ev:106", -405, N.eng, 1, "tests/test_indicators.py", 28, 0),
      tests("ev:108", -380, N.eng, 1, 36, 0, ["36 passed in 1.84s"]),
      line("ev:110", -372, N.eng, 1, "message", "Finished its step"),
      line("inv:5:start", -368, N.rev, 1, "started", "Started"),
      line("ev:201", -350, N.rev, 1, "read", "Read 2 files in core/ and tests/", "neutral", { files: ["core/indicators.py", "tests/test_indicators.py"] }),
      tests("ev:204", -300, N.rev, 1, 36, 0, ["36 passed in 1.91s"]),
      line("inv:5:end", -262, N.rev, 1, "verdict", `Asked for 2 fixes: ${VERDICT.join("; ")}`, "warn", { verdict: "changes_requested", reasons: VERDICT }),
      line("inv:6:start", -258, N.eng, 2, "started", "Started round 2 with the reviewer's notes"),
      edited("ev:301", -235, N.eng, 2, "core/indicators.py", 9, 3),
      edited("ev:303", -205, N.eng, 2, "tests/test_indicators.py", 12, 1),
      tests("ev:305", -95, N.eng, 2, 37, 1, [
        "......................................F",
        "FAILED tests/test_indicators.py::test_hull_ma_warmup_is_none - AssertionError",
        "1 failed, 37 passed in 1.97s",
      ]),
      edited("ev:307", -45, N.eng, 2, "core/indicators.py", 2, 2),
      retryLine("ev:1500000001", -(10 - RETRY2_S + 0.5), 1, 10),
    ];
    if (e() >= RETRY2_S) L.push(retryLine("ev:1500000002", RETRY2_S, 2, 20));
    const s = sw();
    if (s !== null) {
      L.push(
        line("ev:1500000003", afterSwitch(0.3), N.eng, 2, "backup", `Switched to the backup model, ${BACKUP}`, "warn", {
          from_model: ENGINEER_MODEL,
          to_model: BACKUP,
        }),
      );
      if (s >= 2.5) L.push(edited("ev:311", afterSwitch(2.5), N.eng, 2, "core/indicators.py", 4, 1));
      if (s >= 5 && s < 9)
        L.push(
          line("ev:313", afterSwitch(5), N.eng, 2, "command", `Running ${TEST}`, "neutral", {
            command: TEST,
            running: true,
            started_at: afterSwitch(5),
            exit_code: null,
            output_tail: ["......................................"],
          }),
        );
      if (s >= 9) L.push(tests("ev:313", afterSwitch(5), N.eng, 2, 38, 0, ["38 passed in 1.88s"]));
    }
    return L;
  }

  // ---- who is doing what --------------------------------------------------------------------
  const plain = (live_state, activity = null, last = null) => ({
    live_state,
    last_event_at: last,
    activity,
    activity_started_at: last,
    retry: null,
    backup_model: null,
  });
  function engineerLive(L) {
    const s = sw();
    const newest = L.filter((l) => l.node_id === N.eng.id).at(-1);
    if (s === null) {
      const r = newest.refs;
      return {
        live_state: "retrying",
        last_event_at: newest.at,
        activity: `Model busy · trying again in ${r.wait_s} s (${r.attempt} of 3)`,
        activity_started_at: newest.at,
        retry: { attempt: r.attempt, of: 3, next_at: r.next_at },
        backup_model: null,
      };
    }
    const running = newest.kind === "command";
    const activity =
      newest.kind === "backup" ? newest.text : running ? `Running a command: ${TEST}` : newest.kind === "edited" ? "Edited a file" : "Asked the model for the next step";
    return {
      live_state: running ? "running_command" : "working",
      last_event_at: newest.at,
      activity,
      activity_started_at: newest.at,
      retry: null,
      backup_model: BACKUP,
    };
  }
  /** activity.py's agents: a finished step says its last line (a decided gate, its decision). */
  function lives(L) {
    const last = (node) => L.filter((l) => l.node_id === node.id).at(-1);
    return {
      [N.pm.id]: plain("done", last(N.pm).text, last(N.pm).at),
      [N.domain.id]: plain("done", last(N.domain).text, last(N.domain).at),
      [N.gate.id]: plain("done", "Approved with your edits · spec v3", at(-480)), // activity.py _approved_with_edits
      [N.eng.id]: engineerLive(L),
      [N.rev.id]: plain("done", last(N.rev).text, last(N.rev).at),
    };
  }
  /** The graph's live blocks (routers.get_run_graph → live_state.node_live): a finished step is a
   *  bare "done" — no activity, no time. */
  function graphLives(L) {
    const lv = lives(L);
    for (const id of Object.keys(lv)) if (id !== N.eng.id) lv[id] = plain("done");
    return lv;
  }
  // activity.py sorts the agents by canvas position (x, then y).
  const ordered = [...team.nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const kindOf = (n) => (n.kind === "terminal" ? n.config?.terminal_kind ?? "terminal" : n.kind);
  const limitOf = (n) =>
    team.edges.find((x) => x.conditions?.loop_limit != null && (x.source_node_id === n.id || x.target_node_id === n.id))?.conditions.loop_limit ?? null;
  const iterOf = { [N.pm.id]: 1, [N.domain.id]: 1, [N.gate.id]: 1, [N.eng.id]: 2, [N.rev.id]: 1 };

  // ---- money --------------------------------------------------------------------------------
  // Subscription work is not metered. The one metered call so far is the Query domain round's
  // answer on the DeepSeek key (team_run.domain_query_step_v2 → record_agent_cost; the question's
  // embedding is in its usage), so ran_on is mixed from the start (desktop_jobs.ran_on: a cost row
  // ⇒ all false). The Engineer's backup spend is written once its round ends
  // (persist_agent_cost_step), so it never shows inside this clip. Prices: litellm's
  // deepseek/deepseek-chat (0.28 / 0.42 $ per M) and text-embedding-3-small (0.02 $ per M).
  const DOMAIN_MODEL = BACKUP; // the account's one key (story.api_key: DeepSeek) answers the domain
  const DOMAIN_USAGE = { prompt_tokens: 1534, completion_tokens: 260, total_tokens: 1794, cost_usd: 0.000535 };
  const ranOn = () => clone(RAN_ON.BOTH_AND_KEY);
  const costRows = () => [
    {
      id: 1,
      workflow_id: RUN_ID,
      idempotency_key: `${RUN_ID}:domain-cost:${N.domain.id}:1`,
      model_requested: DOMAIN_MODEL,
      model_used: DOMAIN_MODEL,
      ...DOMAIN_USAGE,
      created_at: at(-547),
    },
  ];
  const spent = () => costRows().reduce((s, r) => s + r.cost_usd, 0);
  const isDesk = (req) => new URL(req.url()).searchParams.get("desktop_target") === "1";

  function activityReply(req) {
    const L = lines();
    const lv = lives(L);
    const agents = ordered.map((n) => ({
      node_id: n.id,
      origin_node_id: n.id,
      label: LABEL[n.id],
      kind: kindOf(n),
      iteration: iterOf[n.id] ?? 0,
      rounds_limit: limitOf(n),
      ...(lv[n.id] ?? plain("waiting")),
      model: n.model,
    }));
    const switched = sw() !== null;
    const r = L.filter((l) => l.kind === "retry").at(-1).refs;
    return {
      run_id: RUN_ID,
      status: "running",
      live_state: switched ? (agents.some((a) => a.live_state === "running_command") ? "running_command" : "working") : "retrying",
      cursor: `${L.at(-1).at}|${L.at(-1).id}`,
      total: L.length,
      agents,
      lines: L,
      pinned: switched
        ? null
        : {
            kind: "retrying",
            node_id: N.eng.id,
            label: "Engineer",
            title: "The Engineer’s model is busy",
            body: `Tvashtr tries again in ${r.wait_s} seconds. If it is still busy, the Engineer switches to its backup model, ${BACKUP}, and carries on. You don’t need to do anything.`,
            task_id: null,
            backup_model: BACKUP,
            gate_kind: null,
            resume: null,
            safe: null,
          },
      summary: null,
      number: 1,
      resumed_from: null,
      ...(isDesk(req) ? { ran_on: ranOn() } : {}),
    };
  }

  // ---- the run and its graph ----------------------------------------------------------------
  const inv = (id, iteration, status, outcome, start, end, cost = null) => ({
    invocation_id: id,
    iteration,
    status,
    outcome,
    outcome_detail: null,
    context_manifest: null,
    cost,
    connectors: null,
    started_at: at(start),
    ended_at: end === null ? null : at(end),
  });
  const invs = () => ({
    [N.pm.id]: ["done", [inv(1, 1, "done", "prd_written", -598, -560)]],
    // routers._cost_by_invocation: the domain round's DeepSeek spend. "answered" (the card's
    // badge) assumes the V2 docs cover the question; a NOT_FOUND round would say "No answer".
    [N.domain.id]: ["done", [inv(2, 1, "done", "answered", -558, -547, { ...DOMAIN_USAGE })]],
    [N.gate.id]: ["done", [inv(3, 1, "done", "approved", -545, -480)]],
    [N.eng.id]: ["running", [inv(4, 1, "done", "built", -478, -372), inv(6, 2, "running", null, -258, null)]],
    [N.rev.id]: ["done", [inv(5, 1, "done", "changes_requested", -368, -262)]],
  });
  function graphReply() {
    const lv = graphLives(lines());
    const I = invs();
    return {
      run_id: RUN_ID,
      team_graph_id: RUN_GRAPH_ID,
      nodes: team.nodes.map((n) => {
        const [status, invocations] = I[n.id] ?? ["idle", []];
        const { live_state, last_event_at, activity, activity_started_at, retry, backup_model } = lv[n.id] ?? plain("waiting");
        return {
          ...clone(n),
          origin_node_id: n.id,
          status,
          iteration: iterOf[n.id] ?? 0,
          invocations,
          live: { live_state, last_event_at, activity, activity_started_at, retry, backup_model },
          carried: null,
        };
      }),
      edges: clone(team.edges),
      // team_run._domain_round_event: a switch you asked for is also a run warning (the ⚠ row).
      resolution_warnings:
        sw() === null
          ? []
          : [{ source_kind: "fallback_model", name: BACKUP, reason: `primary '${ENGINEER_MODEL}' was busy — you switched to the backup model` }],
      live_state: sw() === null ? "retrying" : "working",
    };
  }
  function runRow(req) {
    return {
      id: RUN_ID,
      team_graph_id: RUN_GRAPH_ID,
      idea: story.runs.hero,
      status: "running",
      pm_document_id: SPEC_ID,
      ship_commit_sha: null,
      ship_tag: null,
      repo_path: null,
      base_ref: story.repo.branch,
      ship_branch: null,
      subpath: story.repo.folder,
      github_repo: story.repo.full_name,
      pr_url: null,
      cost_total_usd: null, // written only when the run ends (finalize_run_step); the ledger is spent_usd
      pair_id: null,
      pair_label: null,
      created_at: at(-600),
      updated_at: new Date().toISOString(),
      status_group: "running",
      target: { kind: "github", label: story.repo.full_name, base_ref: story.repo.branch, subpath: story.repo.folder },
      pr_number: null,
      budget_cap_usd: story.budget_usd,
      desktop_target: true,
      library_team_id: TEAM_ID,
      retry_of_run_id: null,
      team_version_number: 1,
      started_from: null,
      local_repo_label: null,
      team: { id: TEAM_ID, name: story.team.name },
      spent_usd: spent(),
      awaiting: null,
      failure: null,
      live_state: sw() === null ? "retrying" : "working",
      ...(isDesk(req) ? { ran_on: ranOn() } : {}),
    };
  }

  const routes = liveRoutes();
  Object.assign(routes, {
    "GET /api/account/preferences": { ...live("GET /api/account/preferences"), notify_asked: true },
    [`GET /api/runs/${RUN_ID}`]: (req) => ({ json: { run_id: RUN_ID, workflow_status: "PENDING", run: runRow(req), costs: costRows() } }),
    [`GET /api/runs/${RUN_ID}/graph`]: () => ({ json: graphReply() }),
    [`GET /api/runs/${RUN_ID}/tasks`]: { run_id: RUN_ID, tasks: [] },
    // document_views.run_documents: the spec the PM wrote (v1), the Query domain's answer added
    // (v2), saved by you on approval (v3). Its refs use agent_label (a title, else the role's
    // title), and every agent that reads the shared spec reads it.
    [`GET /api/runs/${RUN_ID}/documents`]: () => {
      const TITLES = { pm: "Product manager", engineer: "Engineer", reviewer: "Reviewer" };
      const ref = (n) => ({ node_id: n.id, clone_node_id: n.id, role_name: n.role_name, label: n.config?.title?.trim() || TITLES[n.role_name] });
      return {
        json: {
          run_id: RUN_ID,
          run: { run_id: RUN_ID, idea: story.runs.hero, status: "running", created_at: at(-600), live: true },
          documents: [
            {
              id: SPEC_ID,
              title: "Mini-PRD",
              doc_type: "prd",
              name: "spec",
              created_at: at(-560),
              updated_at: at(-480),
              is_shared_spec: true,
              version_count: 3,
              latest_version: {
                version_no: 3,
                created_at: at(-480),
                author: { kind: "human", node_id: null, role_name: null, label: "You" },
                note: "Approved with your edits", // routers.APPROVED_WITH_EDITS_NOTE
              },
              written_by: [ref(N.pm), ref(N.domain)],
              read_by: [ref(N.pm), ref(N.eng), ref(N.fixer), ref(N.rev)],
            },
          ],
        },
      };
    },
    [`GET /api/runs/${RUN_ID}/activity`]: (req) => ({ json: activityReply(req) }),
    // routers.py switch_node_to_backup: {switched: true}, 409 "nothing to switch" once it has.
    [`POST /api/runs/${RUN_ID}/nodes/${N.eng.id}/switch-backup`]: () => {
      if (st.switchedAt !== null) return { status: 409, json: { detail: "nothing to switch" } };
      st.switchedAt = Date.now();
      return { json: { switched: true } };
    },
  });
  return routes;
};
