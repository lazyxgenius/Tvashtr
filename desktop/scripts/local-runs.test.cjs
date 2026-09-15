const assert = require("assert");
const { createLocalRunSupervisor } = require("../electron/harness/localRuns.cjs");

/**
 * Mirrors Electron before-quit: await stopAll so kills finish before quit continues.
 * (main.cjs uses preventDefault + await stopAll + app.exit.)
 */
async function awaitStopAllBeforeContinue(stopAll, after) {
  await stopAll();
  after();
}

async function main() {
  let killed = false;
  const sup = createLocalRunSupervisor({
    spawn: () => {
      return {
        pid: 4242,
        kill() {
          killed = true;
        },
        on() {},
        get killed() {
          return killed;
        },
      };
    },
    sendLog() {},
  });
  const { localRunId } = await sup.startLocal({
    teamGraphId: "t",
    idea: "x",
    provider: "claude",
  });
  assert.ok(localRunId);
  assert.strictEqual(sup.list().length, 1);

  let continued = false;
  await awaitStopAllBeforeContinue(() => sup.stopAll(), () => {
    continued = true;
  });
  assert.strictEqual(killed, true, "stopAll must kill workers before quit continues");
  assert.strictEqual(sup.list().length, 0);
  assert.strictEqual(continued, true);
  console.log("local-runs.test.cjs OK");
}
main();
