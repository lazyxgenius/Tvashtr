const assert = require("assert");
const { createLocalRunSupervisor } = require("../electron/harness/localRuns.cjs");

async function main() {
  const sup = createLocalRunSupervisor({
    spawn: () => {
      let killed = false;
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
  await sup.stopAll();
  assert.strictEqual(sup.list().length, 0);
  console.log("local-runs.test.cjs OK");
}
main();
