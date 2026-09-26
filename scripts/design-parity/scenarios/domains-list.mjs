// Domains list boards (group G1), website and Desktop:
//   list    → Dm-List
//   empty   → Dm-ListEmpty, DmF-First-1 (the same page; First-1 only rings New domain)
//   find-1  → DmF-Find-1 ("contr")
//   find-2  → DmF-Find-2 ("filings 2025", no match)
//   find-3  → DmF-Find-3 (the Sort listbox open)
import { domainsRoutes, pair, typeAndBlur } from "./domains-fixtures.mjs";

const path = "/#/domains";
const routes = domainsRoutes();
const SEARCH = 'input[placeholder="Search domains"]';

export default [
  ...pair("list", { path, routes }),
  ...pair("empty", { path, routes: domainsRoutes({ domains: [] }) }),
  ...pair("find-1", {
    path,
    routes,
    steps: async (page) => {
      await page.locator("article").first().waitFor();
      await typeAndBlur(page, SEARCH, "contr");
    },
  }),
  ...pair("find-2", {
    path,
    routes,
    steps: async (page) => {
      await page.locator("article").first().waitFor();
      await typeAndBlur(page, SEARCH, "filings 2025");
    },
  }),
  ...pair("find-3", {
    path,
    routes,
    steps: async (page) => {
      await page.locator("article").first().waitFor();
      await page.getByRole("button", { name: "Sort" }).click();
      await page.getByRole("listbox", { name: "Sort" }).waitFor();
    },
  }),
];
