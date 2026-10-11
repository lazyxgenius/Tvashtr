// 1.5 Domains: "Exchange API docs" — upload PDFs, ask, answer with sources (SAMPLE, brief F10:
// reading needs an embeddings key the film account doesn't hold). The fixtures answer every read;
// the PDFs are real files (video/fixtures/files/domains-*.pdf), set on the dialog's file input
// because "choose files" opens the macOS file panel, which the camera can't film.
import { PICKED, QUESTION } from "../../fixtures/domains.mjs";

export default {
  id: "1.5",
  title: "Domains: Exchange API docs — upload PDFs, ask, answer with sources",
  mode: "sample",
  fixtures: "domains",
  budget: 15,
  poster: 35.5, // the answer with Source 1 open in the Sources aside
  start: "#/domains",
  before: async ({ page }) => {
    await page.getByRole("heading", { name: "Give your agents your own documents" }).waitFor();
  },
  film: async ({ page, cam, story }) => {
    const name = story.domain.name;
    await cam.roi("empty", page.locator("main"));
    await cam.pause(1000);
    await cam.click(page.getByRole("button", { name: "New domain" }).first(), "New domain");
    const dialog = page.getByRole("dialog", { name: "New domain" });
    await dialog.waitFor();
    await cam.roi("dialog", dialog);
    await cam.type(dialog.getByLabel("Name"), name, "the domain's name");
    await cam.click(dialog.getByRole("radio", { name: /^Support/ }), "Support");
    // No openai key on this account: the product's own way out is the free Hugging Face model.
    await dialog.getByText("No openai key yet.").waitFor();
    await cam.pause(900);
    await cam.click(dialog.getByRole("button", { name: "Use the free Hugging Face model" }), "Use the free Hugging Face model");
    await dialog.getByText("token saved").waitFor();
    await cam.pause(800);
    await cam.click(dialog.getByRole("button", { name: "Next: add files" }), "Next: add files");
    await cam.hover(dialog.getByRole("button", { name: "choose files" }), "choose files");
    await page.locator('[data-testid="new-domain-files"]').setInputFiles(PICKED);
    cam.mark("three PDFs picked");
    await dialog.getByRole("list", { name: "Files to add" }).waitFor();
    await cam.pause(1200);
    await cam.click(dialog.getByRole("button", { name: "Create and read 3 files" }), "Create and read 3 files");

    // The domain's page: the files read one after another, then the ready toast.
    await page.getByRole("heading", { level: 1, name }).waitFor({ timeout: 15000 });
    await cam.roi("files", page.getByRole("region", { name: "Files" }));
    await page.getByText(`${name} is ready. Ask it a question.`).waitFor({ timeout: 15000 });
    await cam.pause(1200);

    // The ready toast's own way in (the toast closes on it, so it doesn't cover the composer).
    await cam.click(page.getByRole("button", { name: "Ask now", exact: true }), "Ask now");
    const composer = page.getByPlaceholder(`Ask ${name} a question`);
    await composer.waitFor();
    await cam.pause(700);
    await cam.type(composer, QUESTION, "the question", { cps: 20 });
    await cam.click(page.getByRole("button", { name: "Ask", exact: true }), "Ask");
    const answer = page.getByRole("article", { name: "Answer" });
    await answer.waitFor({ timeout: 15000 });
    await cam.roi("answer", answer);
    await cam.pause(1800);
    await cam.click(answer.getByRole("button", { name: "Source 1: exchange-api-limits.pdf" }).first(), "Source 1");
    const aside = page.getByRole("complementary", { name: "Sources" });
    await aside.getByRole("button", { name: "Copy passage" }).waitFor();
    await cam.roi("sources", aside);
    await cam.pause(2200);
  },
};
