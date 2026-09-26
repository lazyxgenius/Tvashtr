// Toolkit › Tools list shell (slice F3, group G1) — website and Desktop renders of Toolkit-Tools,
// Toolkit-ToolsDesktop, TkF-ToolTabs-1, TkF-ToolSearch-1..4 and TkF-ToolsEmpty-1. Fixtures in
// toolkit-tools-fixtures.mjs mirror the design's sample data.
import { SUMMARY, pair, toolkitRoutes } from "./toolkit-tools-fixtures.mjs";

const path = "/#/toolkit/tools";
const routes = toolkitRoutes();

// The artboards draw the typed box unfocused, so blur it after typing.
const type = (text) => async (page) => {
  const box = page.getByPlaceholder("Search tools");
  await box.fill(text);
  await box.blur();
};
const openStatus = async (page) => {
  await page.getByRole("combobox", { name: "Status" }).click();
};
const pickStatus = (label) => async (page) => {
  await openStatus(page);
  await page.getByRole("option", { name: label }).click();
  await page.mouse.move(0, 0);
};

export default [
  // Toolkit-Tools (and its Desktop artboard Toolkit-ToolsDesktop) + TkF-ToolTabs-1 (the same page).
  ...pair("tools", { path, routes }),
  // TkF-ToolSearch-1: "lin" filters the table live to linear.
  ...pair("search-lin", { path, routes, steps: type("lin") }),
  // TkF-ToolSearch-2: the Status listbox open.
  ...pair("status-open", { path, routes, steps: openStatus }),
  // TkF-ToolSearch-3: "Needs attention" picked.
  ...pair("status-attention", {
    path,
    routes,
    steps: pickStatus("Needs attention"),
  }),
  // TkF-ToolSearch-4: "slack" matches nothing.
  ...pair("search-slack", { path, routes, steps: type("slack") }),
  // TkF-ToolsEmpty-1: no tools yet (the nav badge hides at 0, TOOL-3).
  ...pair("empty", {
    path,
    routes: toolkitRoutes({
      tools: [],
      summary: { ...SUMMARY, tools: 0, tools_needing_attention: 0 },
    }),
  }),
];
