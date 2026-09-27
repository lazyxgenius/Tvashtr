// F5 group G9 — the Tools sub-views: Panel-AddTool (the server form), Flow-PasteJson-1..3 (Add tool
// menu → the pasted mcp.json checked → the added rows + "2 servers added · 1 needs a secret" toast),
// each as a website and a Desktop render.
import { drawerReady, isolateDrawer } from "./panel-fixtures.mjs";
import {
  FULL,
  SKILLS,
  TOOLS,
  at,
  drawer,
  openMenu,
  pair,
  reviewer,
  routes,
} from "./panel-skills.mjs";

// The sheets' boards count "Skills & tools 4": house-style + pytest-review, fetch + github.
const FOUR = routes(
  reviewer({
    skills: SKILLS.filter((s) => s.type !== "library"),
    tool_config: TOOLS,
  }),
);

// The design's paste, as drawn (LINEAR_TOKEN isn't in Secrets; GITHUB_TOKEN is).
const PASTE = `{
  "mcpServers": {
    "linear": { "url": "https://mcp.linear.app/sse",
                "headers": { "Authorization": "Bearer \${LINEAR_TOKEN}" } },
    "sqlite": { "command": "uvx", "args": ["mcp-server-sqlite"] }
  }
}`;

/** The drawer alone on the Skills & tools tab, then the Add tool menu's `item`. */
const openSheet = (item) => async (page) => {
  await drawerReady(page);
  await isolateDrawer(page);
  await page.getByText("house-style").first().waitFor();
  await page
    .getByRole("button", { name: "Add tool" })
    .evaluate((el) => el.click());
  await page.getByRole("menuitem", { name: item }).click();
};

const paste = async (page) => {
  await openSheet("Paste mcp.json")(page);
  const box = page.getByRole("textbox", { name: "mcp.json" });
  await box.fill(PASTE);
  await page.getByText("2 servers found").waitFor();
  return box;
};

export default [
  ...pair(
    "Panel-AddTool",
    {
      ...drawer,
      height: 900,
      steps: async (p) => {
        await openSheet("Add a server")(p);
        await p.getByRole("textbox", { name: "Server name" }).fill("linear");
        await p
          .getByRole("textbox", { name: "URL" })
          .fill("https://mcp.linear.app/sse");
        await p.evaluate(() => document.activeElement?.blur());
        await p.mouse.move(0, 0);
      },
    },
    FOUR,
  ),
  ...pair(
    "Flow-PasteJson-1",
    {
      ...drawer,
      steps: async (p) => {
        await drawerReady(p);
        await isolateDrawer(p);
        await p.getByText("security-checklist").first().waitFor();
        await openMenu(p, p.getByRole("button", { name: "Add tool" }));
        await p.getByRole("menuitem", { name: "Paste mcp.json" }).hover();
      },
    },
    FULL,
  ),
  ...pair(
    "Flow-PasteJson-2",
    {
      ...drawer,
      steps: async (p) => {
        const box = await paste(p);
        // The box keeps the caret (its coral border), at the top of the text.
        await box.evaluate((el) => {
          el.setSelectionRange(0, 0);
          el.scrollTop = 0;
        });
        await p.mouse.move(0, 0);
      },
    },
    FOUR,
  ),
  ...pair(
    "Flow-PasteJson-3",
    {
      ...drawer,
      // The second of the board's "2 unsaved changes": the Images switch on Setup (not in view).
      path: at("setup"),
      steps: async (p) => {
        await drawerReady(p);
        await p
          .getByRole("switch", { name: "Images" })
          .evaluate((el) => el.click());
        await p.getByRole("tab", { name: /^Skills & tools/ }).click();
        await paste(p);
        await p.getByRole("button", { name: "Add 2 servers" }).click();
        await p.getByText("2 servers added · 1 needs a secret").waitFor();
        await p.evaluate(() => {
          document.activeElement?.blur();
          document.querySelector(".nd-body").scrollTop = 0;
        });
        await p.mouse.move(0, 0);
      },
    },
    FULL,
  ),
];
