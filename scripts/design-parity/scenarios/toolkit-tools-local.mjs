// Toolkit › Tools › Add tool wizard, local command (slice F3, group G7) — website and Desktop
// renders of TkF-AddToolLocal-1..2 and Toolkit-AddTool2Local (= TkF-AddToolLocal-2): name it
// sqlite, then step 2 on "Local command" with a Command, Arguments and two Environment rows (a
// literal SQLITE_READONLY=true and API_KEY = ${SQLITE_API_KEY}, not set).
//
// sqlite isn't listed yet, so these frames keep the design's list as drawn (fetch, github, linear
// needing LINEAR_TOKEN) and nothing is written: the shared read-only routes are enough.
import { pair, toolkitRoutes } from "./toolkit-tools-fixtures.mjs";

const path = "/#/toolkit/tools";

const sheet = (page) => page.getByRole("dialog", { name: "Add a tool" });
const still = async (page) => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(0, 0);
};

// 1 · Add tool → step 1, named sqlite.
const step1 = async (page) => {
  await page
    .getByRole("button", { name: "Add tool", exact: true })
    .first()
    .click();
  await sheet(page).getByLabel("Name").fill("sqlite");
};
// 2 · Connection on Local command: the command, its arguments and two variables.
const step2 = async (page) => {
  await step1(page);
  await sheet(page).getByRole("button", { name: "Next: Connection" }).click();
  await sheet(page).getByRole("button", { name: "Local command" }).click();
  await sheet(page).getByLabel("Command").fill("uvx");
  await sheet(page)
    .getByLabel("Arguments")
    .fill("mcp-server-sqlite --db-path data.db");
  const add = sheet(page).getByRole("button", { name: "Add variable" });
  await add.click();
  await sheet(page)
    .getByRole("textbox", { name: "Variable name 1" })
    .fill("SQLITE_READONLY");
  await sheet(page)
    .getByRole("combobox", { name: "SQLITE_READONLY value" })
    .fill("true");
  await add.click();
  await sheet(page)
    .getByRole("textbox", { name: "Variable name 2" })
    .fill("API_KEY");
  await sheet(page)
    .getByRole("combobox", { name: "API_KEY value" })
    .fill("${SQLITE_API_KEY}");
};

export default [
  // TkF-AddToolLocal-1: step 1, A custom server chosen, Name "sqlite".
  ...pair("local-1", {
    path,
    routes: toolkitRoutes(),
    steps: async (page) => {
      await step1(page);
      await still(page);
    },
  }),
  // TkF-AddToolLocal-2 + Toolkit-AddTool2Local: step 2 on Local command.
  ...pair("local-2", {
    path,
    routes: toolkitRoutes(),
    steps: async (page) => {
      await step2(page);
      await still(page);
    },
  }),
];
