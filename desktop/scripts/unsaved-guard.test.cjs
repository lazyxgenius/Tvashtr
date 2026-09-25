/**
 * Unsaved agent edits: the native "Keep editing / Discard and close" prompt on close and quit.
 *
 * Run: node --test desktop/scripts/unsaved-guard.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createUnsavedGuard,
  normaliseUnsaved,
  unsavedDialogOptions,
  DISCARD,
  KEEP_EDITING,
} = require("../electron/unsavedGuard.cjs");

test("a clean page closes without asking", () => {
  const guard = createUnsavedGuard();
  let asked = 0;
  assert.equal(guard.confirmDiscard(() => (asked += 1)), true);
  assert.equal(asked, 0);
});

test("dirty: Keep editing (or Esc) cancels; Discard and close proceeds and clears", () => {
  const guard = createUnsavedGuard();
  guard.set({ dirty: true, agentName: "Reviewer" });
  const seen = [];
  assert.equal(guard.confirmDiscard((o) => (seen.push(o), KEEP_EDITING)), false);
  assert.equal(guard.isDirty(), true);
  assert.equal(guard.confirmDiscard(() => DISCARD), true);
  assert.equal(guard.isDirty(), false, "a second close/quit doesn't ask again");
  assert.deepEqual(seen[0].buttons, ["Keep editing", "Discard and close"]);
  assert.equal(seen[0].cancelId, KEEP_EDITING);
  assert.equal(seen[0].defaultId, KEEP_EDITING);
  assert.equal(seen[0].message, "You have unsaved changes to Reviewer.");
});

test("renderer state is normalised", () => {
  assert.deepEqual(normaliseUnsaved(null), { dirty: false, agentName: null });
  assert.deepEqual(normaliseUnsaved({ dirty: "yes" }), { dirty: false, agentName: null });
  assert.deepEqual(normaliseUnsaved({ dirty: true, agentName: "  Spec\n writer " }), {
    dirty: true,
    agentName: "Spec writer",
  });
  assert.equal(normaliseUnsaved({ dirty: true, agentName: "x".repeat(500) }).agentName.length, 80);
  assert.equal(
    unsavedDialogOptions({ agentName: null }).message,
    "You have unsaved changes to an agent.",
  );
});
