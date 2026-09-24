#!/usr/bin/env node
/**
 * Run every desktop test (`*.test.cjs`) under node's built-in test runner.
 * Run: npm test (in desktop/) or node desktop/scripts/run-tests.cjs
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.cjs"))
  .sort()
  .map((f) => path.join(dir, f));
const res = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(res.status === null ? 1 : res.status);
