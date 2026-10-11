// 3.1 Home's composer: the task, the repo, the branch, the folder core/ (and the $5 budget in Run
// options) → Launch. V2 records the whole hero run here (3.2–3.6 are re-taken from it; 3.7, 0.1,
// 5.1 and 6.1 work on it by id); --dry rehearses up to Launch.
import { buildFilmTeam, must } from "../film.mjs";
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
    // G3 (READING_KEY = none): no Query domain step in the hero team. New memories wait for
    // review (3.7 keeps one and discards one on camera), so review mode is on before the run.
    const { id } = await buildFilmTeam(ctx.api, { upTo: "final", skipDomain: true });
    must(await ctx.api("PATCH", "/api/memory/review-mode", { review_mode: true }), "memory review mode");
    return { team: id, task: ctx.story.runs.hero };
  },
  before: (ctx) => ctx.go(`#/teams/${ctx.state.team}`, ctx.page.getByRole("button", { name: "Run this team", exact: true })),
  film: (ctx) => recordedRun(ctx, { folder: ctx.story.repo.folder, branch: ctx.story.repo.branch }),
};
