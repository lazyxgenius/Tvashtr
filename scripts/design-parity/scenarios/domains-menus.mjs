// The ⋯ menus, rename and the two deletes (group G4), website and Desktop:
//   menu-1    → DmF-Menu-1 (Q3 filings' card menu open)
//   menu-2    → DmF-Menu-2 (Rename domain, "Q3 2026 filings" typed, Save name focused)
//   menu-3    → DmF-Menu-3 (Delete Vendor contracts?, the name typed, Delete domain focused)
//   menu-4    → DmF-Menu-4 (deleted: the card and nav row gone, the toast)
//   delfile-1 → DmF-DelFile-1 (pricing-2026.pdf's row menu open)
//   delfile-2 → DmF-DelFile-2 (Delete pricing-2026.pdf?, one test question expects it, Delete file focused)
//   delfile-3 → DmF-DelFile-3 (the row gone at once, counts down, the toast with Undo)
import {
  D,
  DESIGN_ORDER,
  DOMAINS,
  SUPPORT_FILES,
  detailOf,
  detailRoutes,
  domainsRoutes,
  pair,
  typeAndBlur,
} from "./domains-fixtures.mjs";

const list = "/#/domains";
const routes = domainsRoutes({ domains: DESIGN_ORDER });

/** Keyboard focus on a dialog's confirm button (the frames' coral ring is focus-visible). */
async function ringConfirm(dialog, page) {
  await dialog.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Tab");
}

async function cardMenu(page, name) {
  await page.locator("article").first().waitFor();
  await page.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menu", { name: `More actions for ${name}` }).waitFor();
}

async function deleteDialog(page) {
  await cardMenu(page, "Vendor contracts");
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Vendor contracts?" });
  await typeAndBlur(page, '[role="dialog"] input', "Vendor contracts");
  return dialog;
}

/** Deleting Vendor contracts: `GET /api/domains` answers without it after the DELETE. */
function deletingRoutes() {
  let gone = false;
  return {
    ...routes,
    "GET /api/domains": () => ({
      json: {
        domains: gone
          ? DOMAINS.filter((d) => d.domain_id !== D.vendor)
          : DESIGN_ORDER,
      },
    }),
    [`DELETE /api/domains/${D.vendor}`]: () => {
      gone = true;
      return {
        json: {
          domain_id: D.vendor,
          deleted: true,
          steps_cleared: 0,
          agents_cleared: 0,
        },
      };
    },
  };
}

async function deleteVendor(page) {
  const dialog = await deleteDialog(page);
  await dialog.getByRole("button", { name: "Delete domain" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Vendor contracts deleted" })
    .waitFor();
  await page
    .getByRole("article", { name: "Vendor contracts" })
    .waitFor({ state: "detached" });
}

// ---- A file's ⋯ menu and Delete file (Support docs' Sources) ----
const sources = `/#/domains/${D.support}`;
const PRICING = SUPPORT_FILES.find((f) => f.filename === "pricing-2026.pdf");
const fileRoutes = detailRoutes({
  detail: detailOf(DOMAINS[0]),
  files: SUPPORT_FILES,
  extra: {
    [`GET /api/domains/${D.support}/eval/cases`]: {
      cases: [
        {
          case_id: "c1",
          question: "How much is the Team plan?",
          expected_citation_doc_ids: [PRICING.document_id],
        },
        {
          case_id: "c2",
          question: "How do I turn on SSO?",
          expected_citation_doc_ids: [],
        },
      ],
    },
    [`DELETE /api/domains/${D.support}/documents/${PRICING.document_id}`]: {
      deleted: true,
    },
  },
});

async function fileMenu(page) {
  await page.locator("table tbody tr").first().waitFor();
  await page
    .getByRole("button", { name: "More actions for pricing-2026.pdf" })
    .click();
  await page.getByRole("menu").waitFor();
}

async function fileDialog(page) {
  await fileMenu(page);
  // Past the fold: a real click would scroll the page, which the frames draw unscrolled.
  await page
    .getByRole("menuitem", { name: "Delete file…" })
    .dispatchEvent("click");
  const dialog = page.getByRole("dialog", { name: "Delete pricing-2026.pdf?" });
  await dialog
    .getByText("1 test question expects this file", { exact: false })
    .waitFor();
  return dialog;
}

export default [
  ...pair("menu-1", {
    path: list,
    routes,
    steps: (page) => cardMenu(page, "Q3 filings"),
  }),
  ...pair("menu-2", {
    path: list,
    routes,
    steps: async (page) => {
      await cardMenu(page, "Q3 filings");
      await page.getByRole("menuitem", { name: "Rename" }).click();
      const dialog = page.getByRole("dialog", { name: "Rename domain" });
      await dialog.getByLabel("Name").fill("Q3 2026 filings");
      await ringConfirm(dialog, page);
    },
  }),
  ...pair("menu-3", {
    path: list,
    routes,
    steps: async (page) => {
      const dialog = await deleteDialog(page);
      await ringConfirm(dialog, page);
    },
  }),
  // Each render gets its own deleting state.
  {
    ...pair("menu-4", {})[0],
    path: list,
    routes: deletingRoutes(),
    steps: deleteVendor,
  },
  {
    ...pair("menu-4", {})[1],
    path: list,
    routes: deletingRoutes(),
    steps: deleteVendor,
  },
  ...pair("delfile-1", { path: sources, routes: fileRoutes, steps: fileMenu }),
  ...pair("delfile-2", {
    path: sources,
    routes: fileRoutes,
    steps: async (page) => {
      const dialog = await fileDialog(page);
      await ringConfirm(dialog, page);
    },
  }),
  ...pair("delfile-3", {
    path: sources,
    routes: fileRoutes,
    steps: async (page) => {
      const dialog = await fileDialog(page);
      await dialog.getByRole("button", { name: "Delete file" }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "pricing-2026.pdf deleted" })
        .waitFor();
    },
  }),
];
