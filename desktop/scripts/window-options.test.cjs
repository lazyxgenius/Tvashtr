/**
 * Run: node --test desktop/scripts/window-options.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert");

const { mainWindowOptions } = require("../electron/windowOptions.cjs");

test("macOS hides the system title bar so the app draws the design's 30px strip", () => {
  const o = mainWindowOptions({ platform: "darwin", preload: "/p.cjs" });
  assert.strictEqual(o.titleBarStyle, "hidden");
  assert.deepStrictEqual(o.trafficLightPosition, { x: 12, y: 9 });
  assert.strictEqual(o.width, 1440);
  assert.strictEqual(o.height, 900);
});

test("other platforms keep the native frame", () => {
  for (const platform of ["win32", "linux"]) {
    const o = mainWindowOptions({ platform, preload: "/p.cjs" });
    assert.strictEqual(o.titleBarStyle, undefined);
    assert.strictEqual(o.trafficLightPosition, undefined);
  }
});

test("the window keeps the sandboxed, isolated renderer on every platform", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const { webPreferences } = mainWindowOptions({ platform, preload: "/p.cjs" });
    assert.strictEqual(webPreferences.preload, "/p.cjs");
    assert.strictEqual(webPreferences.contextIsolation, true);
    assert.strictEqual(webPreferences.nodeIntegration, false);
    assert.strictEqual(webPreferences.sandbox, true);
  }
});

test("first paint is paper cream, not the old dark splash", () => {
  assert.strictEqual(mainWindowOptions({ platform: "linux", preload: "" }).backgroundColor, "#faf9f5");
});
