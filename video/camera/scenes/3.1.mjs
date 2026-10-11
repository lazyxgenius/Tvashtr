// 3.1 Home's composer: the task, the repo, the branch, the folder core/ (and the $5 budget in Run
// options) → Launch. V2 records the whole hero run here (3.2–3.6 are re-taken from it); --dry
// rehearses up to Launch.
import { buildFilmTeam, ensureDomain } from "../film.mjs";
import { recordedRun } from "../flows.mjs";

export default {
  id: "3.1",
  title: "Home composer: task, repo, branch, folder core/ → Launch (records the hero run)",
  mode: "record",
  record: "hero",
  notifyAsk: true,
  castEvery: 2,
  budget: 15,
  setup: async (ctx) => {
    await ensureDomain(ctx.api);
    const { id } = await buildFilmTeam(ctx.api, { upTo: "final" });
    return { team: id, task: ctx.story.runs.hero };
  },
  before: (ctx) => ctx.go(`#/teams/${ctx.state.team}`, ctx.page.getByRole("button", { name: "Run this team", exact: true })),
  film: (ctx) => recordedRun(ctx, { folder: ctx.story.repo.folder, branch: ctx.story.repo.branch }),
};
