// 3.2 The live run view: the Now bar, Activity, the notifications ask. V2 re-takes it from 3.1's
// recording of the hero run (from the launch); V1 rehearses it on the F5 proof recording.
// F5's proof is this scene's "proof" part (a short cut of 3.2 on a tiny task, recorded live) and
// "replay" part (that recording filmed again with the Desktop runner idle, matched pairs checked).
import { buildFilmTeam } from "../film.mjs";
import { activity, answerNotifyAsk, ids, MARK, nowBar, recordedRun, runPath } from "../flows.mjs";

const proofTeam = async (ctx) => {
  // The film team without the Query domain step (an unread domain has no answer to give).
  const { id } = await buildFilmTeam(ctx.api, { upTo: "final", skipDomain: true });
  return { team: id, task: ctx.story.runs.proof };
};
const toCanvas = (ctx) => ctx.go(`#/teams/${ids(ctx).team}`, ctx.page.getByRole("button", { name: "Run this team", exact: true }));
const proofFlow = (ctx) => recordedRun(ctx, { edit: "Keep the change to README.md only." });

export default {
  id: "3.2",
  title: "The live run view: Now bar, Activity, the notifications ask",
  mode: "replay",
  recording: "hero",
  rehearse: "proof-3.2",
  from: (r) => MARK.launch(r) + 1500,
  budget: 25,
  before: async (ctx) => {
    await ctx.go(runPath(ctx));
    await nowBar(ctx.page).waitFor({ timeout: 60000 });
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    await answerNotifyAsk(ctx, "Not now", { wait: 6000 });
    await cam.roi("now", nowBar(page));
    await cam.roi("activity", activity(page));
    await cam.hover(nowBar(page).getByRole("button").first(), "the Now bar");
    await cam.pause(2500);
    await cam.hover(activity(page).locator("li.lv-line").last(), "Activity");
    await cam.pause(6000);
  },
  parts: [
    {
      key: "proof",
      title: "F5 proof: a short cut of 3.2 on a tiny task, recorded live",
      mode: "record",
      record: "proof-3.2",
      recording: undefined,
      rehearse: undefined,
      from: undefined,
      notifyAsk: true,
      castEvery: 2,
      setup: proofTeam,
      before: toCanvas,
      film: proofFlow,
    },
    {
      key: "replay",
      title: "F5 proof: the recorded run replayed (the Desktop runner idle)",
      mode: "replay",
      recording: "proof-3.2",
      rehearse: undefined,
      from: 0,
      pairsFrom: "3.2-proof",
      castEvery: 2,
      before: toCanvas,
      film: proofFlow,
    },
  ],
};
