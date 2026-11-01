import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { mockApi } from "../domains/domainsTestUtils";
import { ImportCsvDialog } from "./ImportCsvDialog";
import { ModelDetailPage } from "./ModelDetailPage";
import { ModelsListPage } from "./ModelsListPage";
import { NewModelDialog } from "./NewModelDialog";
import { RunTestsDialog } from "./RunTestsDialog";
import { SettingsTab } from "./SettingsTab";
import { TestDrawer } from "./TestDrawer";
import { CONFIG, HELD, aCard, aModel, aRun, aTest, someRuns, someTests } from "./modelsTestUtils";

const refused =
  (detail: unknown, status = 422) =>
  () =>
    new Response(JSON.stringify({ detail }), { status });

function renderIn(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
  window.location.hash = "";
});

describe("the Models list", () => {
  it("first time: the centred card, three steps, New model", async () => {
    mockApi({ "GET /api/models": { models: [] }, "GET /api/config": CONFIG });
    renderIn(<ModelsListPage />);
    await screen.findByRole("heading", { name: "Every model starts with its tests" });
    expect(screen.getByText("Describe the job")).toBeInTheDocument();
    expect(screen.getByText("Add tests")).toBeInTheDocument();
    expect(screen.getByText("Run them")).toBeInTheDocument();
    // Only the card's button: the header's shows once there are models.
    expect(screen.getAllByRole("button", { name: "New model" })).toHaveLength(1);
  });

  it("with models: chips, best on your tests, and all three badges", async () => {
    mockApi({
      "GET /api/config": CONFIG,
      "GET /api/models": {
        models: [
          aCard({
            model_id: "m1",
            name: "Tested",
            badge: "tested",
            tested_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
            best: [
              aRun({ provider_label: "Anthropic", model_name: "claude-sonnet-5-5" }),
              aRun({ run_id: "r2", passed: 43, total_usd: 0.04, price_known: false }),
            ],
          }),
          aCard({ model_id: "m2", name: "Fresh", answer_kind: "text", tests: 18 }),
          aCard({ model_id: "m3", name: "Changed", badge: "changed" }),
          aCard({ model_id: "m4", name: "Empty", tests: 0, current_version: 0 }),
        ],
      },
    });
    renderIn(<ModelsListPage />);
    const tested = await screen.findByRole("link", { name: "Tested" });
    expect(within(tested).getByText("Tested 2 h ago")).toBeInTheDocument();
    expect(within(tested).getByText("50 tests")).toBeInTheDocument();
    expect(within(tested).getByText("Pick from a list · 2 choices")).toBeInTheDocument();
    expect(within(tested).getByText("Test set v4")).toBeInTheDocument();
    expect(within(tested).getByText("Best on your tests")).toBeInTheDocument();
    expect(within(tested).getByText("46 / 50")).toBeInTheDocument();
    expect(within(tested).getByText("$0.21 for all 50")).toBeInTheDocument();
    expect(within(tested).getByText("cost not listed")).toBeInTheDocument();

    const fresh = screen.getByRole("link", { name: "Fresh" });
    expect(within(fresh).getByText("Not run yet")).toBeInTheDocument();
    expect(within(fresh).getByText("Write text")).toBeInTheDocument();
    expect(
      within(fresh).getByText("No results yet. Run its tests to see how models do."),
    ).toBeInTheDocument();

    const changed = screen.getByRole("link", { name: "Changed" });
    expect(within(changed).getByText("Tests changed since last run")).toBeInTheDocument();
    expect(
      within(changed).getByText(
        "Its tests changed since the last run. Run them again to see scores.",
      ),
    ).toBeInTheDocument();

    const empty = screen.getByRole("link", { name: "Empty" });
    expect(within(empty).getByRole("button", { name: "Run tests" })).toBeDisabled();
    expect(within(empty).queryByText(/Test set/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New model" })).toBeInTheDocument();
  });

  it("clicking a card opens the model; its Run tests opens the dialog instead", async () => {
    mockApi({
      "GET /api/config": CONFIG,
      "GET /api/providers": HELD,
      "GET /api/models": { models: [aCard()] },
      "GET /api/models/m1": aModel(),
      "POST /api/models/m1/estimate": {
        tests: 2,
        version: 4,
        models: [],
        summary: { judge_tests: 0, judges: [], uses_exact: true, uses_contains: false },
      },
    });
    renderIn(<ModelsListPage />);
    const card = await screen.findByRole("link", { name: "Claims triage" });
    fireEvent.click(within(card).getByRole("button", { name: "Run tests" }));
    await screen.findByRole("dialog", { name: "Run tests" });
    expect(window.location.hash).not.toContain("models/m1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(card);
    expect(window.location.hash).toBe("#/models/m1");
  });
});

describe("New model", () => {
  const open = () => {
    const onCreated = vi.fn();
    renderIn(<NewModelDialog onClose={vi.fn()} onCreated={onCreated} />);
    return onCreated;
  };

  it("adds and removes choices, and refuses a duplicate in place", () => {
    mockApi({});
    open();
    const input = screen.getByRole("textbox", { name: "Add a choice" });
    fireEvent.change(input, { target: { value: "Motor" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "motor" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("That choice is already in the list.");
    fireEvent.click(screen.getByRole("button", { name: "Remove Motor" }));
    expect(screen.queryByRole("button", { name: "Remove Motor" })).not.toBeInTheDocument();
  });

  it("Write text hides the choices", () => {
    mockApi({});
    open();
    expect(screen.getByText("The choices")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Write text/ }));
    expect(screen.queryByText("The choices")).not.toBeInTheDocument();
  });

  it("shows the server's words beside their field", async () => {
    mockApi({ "POST /api/models": refused("That name is taken. Pick another.") });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Create model" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That name is taken. Pick another.");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true");
  });

  it("sends what was typed and hands back the model", async () => {
    const calls = mockApi({ "POST /api/models": aModel() });
    const onCreated = open();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "N" } });
    fireEvent.change(screen.getByRole("textbox", { name: "The job, in one sentence" }), {
      target: { value: "J" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Write text/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create model" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls[0].body).toEqual({ name: "N", job: "J", answer_kind: "text", choices: [] });
  });
});

describe("the test drawer", () => {
  const routes = {
    "GET /api/config": CONFIG,
    "GET /api/providers": HELD,
    "GET /api/models/m1/tests/k1/results": { results: [] },
  };
  function open(model = aModel(), test: ReturnType<typeof aTest> | null = aTest()) {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const onTogglePopup = vi.fn();
    renderIn(
      <TestDrawer
        model={model}
        test={test}
        popup={false}
        onTogglePopup={onTogglePopup}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    return { onSaved, onClose, onTogglePopup };
  }
  const textModel = () =>
    aModel({ answer_kind: "text", choices: [], name: "Router", current_version: 2 });

  it("a choice model: a Select of the choices and only Exact match", () => {
    mockApi(routes);
    open();
    expect(screen.getByRole("heading", { name: "Test 1" })).toBeInTheDocument();
    expect(screen.getByText("Claims triage · test set v4")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Expected answer" })).toHaveValue("Motor");
    const seg = screen.getByRole("group", { name: "How to score" });
    expect(
      within(seg)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Exact match"]);
    expect(
      screen.getByText("Pick-from-a-list tests are scored by exact match."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Saving makes test set v5. Earlier results stay tied to v4."),
    ).toBeInTheDocument();
  });

  it("a text model starts a new test on Must contain, with its chips and helper", () => {
    mockApi(routes);
    open(textModel(), null);
    expect(screen.getByRole("heading", { name: "New test" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Must contain" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Words it must contain")).toBeInTheDocument();
    expect(
      screen.getByText("Each word or phrase must appear in the answer. Case doesn't matter."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete test" })).not.toBeInTheDocument();
  });

  it("AI judge: the rubric, the judge picker on held models only, and the words", async () => {
    mockApi(routes);
    open(textModel(), null);
    fireEvent.click(screen.getByRole("button", { name: "AI judge" }));
    expect(
      screen.getByRole("textbox", { name: "What a right answer must do" }),
    ).toBeInTheDocument();
    const judge = await screen.findByRole("combobox", { name: "Judge model" });
    await waitFor(() =>
      expect(
        within(judge)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual([
        "Groq gpt-oss-120b · your Groq key",
        "DeepSeek deepseek-chat · your DeepSeek key",
        "Custom…",
      ]),
    );
    expect(judge).toHaveValue("groq/openai/gpt-oss-120b");
    expect(
      screen.getByText("The judge runs on your key too. Its cost is added to each run's total."),
    ).toBeInTheDocument();
    fireEvent.change(judge, { target: { value: "__custom__" } });
    expect(screen.getByRole("textbox", { name: "Judge model" })).toHaveValue("");
  });

  it("each way of scoring has its hint", () => {
    mockApi(routes);
    open(textModel(), null);
    fireEvent.click(screen.getByRole("button", { name: "Exact match" }));
    expect(
      screen.getByText(
        "The answer must match the expected answer. Case, spaces and a final full stop don't matter.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Words it must contain")).not.toBeInTheDocument();
  });

  it("the Last run box shows each verdict and the judge's reason", async () => {
    mockApi({
      ...routes,
      "GET /api/models/m1/tests/k1/results": {
        results: [
          {
            run_id: "a",
            model_slug: "x/claude-sonnet-5-5",
            model_name: "claude-sonnet-5-5",
            completed_at: new Date(Date.now() - 3_600_000).toISOString(),
            verdict: "pass",
            reason: "Names the app and marks it high.",
            judge_model: "x/j",
            answer: "a",
          },
          {
            run_id: "b",
            model_slug: "x/gpt",
            model_name: "gpt",
            completed_at: null,
            verdict: "fail",
            reason: 'Missing: "high urgency"',
            judge_model: null,
            answer: "b",
          },
        ],
      },
    });
    open(textModel());
    expect(await screen.findByText("Last run · 1 h ago")).toBeInTheDocument();
    expect(screen.getByText('Judge: "Names the app and marks it high."')).toBeInTheDocument();
    expect(screen.getByText('Missing: "high urgency"')).toBeInTheDocument();
    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
  });

  it("shows the server's words beside their field, and saves", async () => {
    const calls = mockApi({
      ...routes,
      "POST /api/models/m1/tests": refused("Write the input first."),
    });
    const { onSaved } = open(aModel(), null);
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    expect(await screen.findByText("Write the input first.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Input" })).toHaveAttribute("aria-invalid", "true");
    expect(onSaved).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("saving an edit sends the fields; saving nothing new just closes", async () => {
    const calls = mockApi({
      ...routes,
      "PUT /api/models/m1/tests/k1": { test: aTest(), version: 5 },
    });
    const { onSaved, onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    expect(onClose).toHaveBeenCalled();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "Input" }), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({
      input: "new",
      expected: "Motor",
      scoring: "exact",
    });
  });

  it("the expand control asks for the pop-up; Delete confirms with the version words", async () => {
    mockApi({ ...routes, "DELETE /api/models/m1/tests/k1": { version: 5 } });
    const { onTogglePopup, onSaved } = open();
    fireEvent.click(screen.getByRole("button", { name: "Open as a pop-up" }));
    expect(onTogglePopup).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete test" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete test 1?" });
    expect(dialog).toHaveTextContent(
      "This makes test set v5 without it. Earlier results stay tied to v4.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete test" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

describe("Import CSV", () => {
  const choose = (text: string) => {
    const file = new File([text], "claims.csv", { type: "text/csv" });
    // jsdom's File has no text().
    Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
    fireEvent.change(screen.getByTestId("model-csv-file"), { target: { files: [file] } });
  };

  it("previews, then imports all or nothing", async () => {
    const calls = mockApi({
      "POST /api/models/m1/tests/import": (init?: RequestInit) =>
        (JSON.parse(init?.body as string) as { dry_run: boolean }).dry_run
          ? { ready: 12, next_version: 5, errors: [], imported: false }
          : { ready: 12, next_version: 5, errors: [], imported: true },
    });
    const onImported = vi.fn();
    renderIn(<ImportCsvDialog model={aModel()} onClose={vi.fn()} onImported={onImported} />);
    expect(
      screen.getByText(/The first row names the columns. You need input and expected./),
    ).toBeInTheDocument();
    choose("input,expected\na,Motor\n");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "12 tests ready to import. They become test set v5.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Import 12 tests" }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(calls.map((c) => (c.body as { dry_run: boolean }).dry_run)).toEqual([true, false]);
    expect((calls[0].body as { filename: string }).filename).toBe("claims.csv");
  });

  it("lists every bad row and offers no import", async () => {
    mockApi({
      "POST /api/models/m1/tests/import": {
        ready: 0,
        next_version: 5,
        errors: ["Line 3: “Moto” isn't one of the choices.", "Line 4: Write the input first."],
        imported: false,
      },
    });
    renderIn(<ImportCsvDialog model={aModel()} onClose={vi.fn()} onImported={vi.fn()} />);
    choose("input,expected\n");
    const alert = await screen.findByRole("alert");
    expect(
      within(alert)
        .getAllByRole("listitem")
        .map((l) => l.textContent),
    ).toEqual(["Line 3: “Moto” isn't one of the choices.", "Line 4: Write the input first."]);
    expect(alert).toHaveTextContent("Fix the file and choose it again. Nothing was imported.");
    expect(screen.queryByRole("button", { name: /^Import \d/ })).not.toBeInTheDocument();
  });
});

describe("Run tests", () => {
  const estimate = (over = {}) => ({
    tests: 50,
    version: 4,
    summary: { judge_tests: 0, judges: [], uses_exact: true, uses_contains: false },
    models: [
      {
        model: "groq/openai/gpt-oss-120b",
        price_known: true,
        estimate_usd: 0.02,
        model_usd: 0.02,
        judge_usd: 0,
        unpriced_judges: [],
      },
      {
        model: "deepseek/deepseek-chat",
        price_known: true,
        estimate_usd: 0.04,
        model_usd: 0.04,
        judge_usd: 0,
        unpriced_judges: [],
      },
    ],
    ...over,
  });
  const routes = (over = {}) => ({
    "GET /api/config": CONFIG,
    "GET /api/providers": HELD,
    "GET /api/models/m1": aModel({ tests: 50 }),
    "POST /api/models/m1/estimate": estimate(),
    ...over,
  });
  const open = () => {
    const onStarted = vi.fn();
    renderIn(<RunTestsDialog modelId="m1" onClose={vi.fn()} onStarted={onStarted} />);
    return onStarted;
  };
  const row = (name: RegExp) =>
    screen.getByRole("checkbox", { name }).closest(".md-mrow") as HTMLElement;

  it("shows each model's cost, the total, the lines and the button's words", async () => {
    mockApi(routes());
    open();
    expect(await screen.findByText("All 50 tests from test set v4 of Claims triage")).toBeTruthy();
    await screen.findByText(/paid on your own keys/);
    expect(within(row(/Groq/)).getByText("about $0.02")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Groq gpt-oss-120b/ })).toBeChecked();
    expect(within(row(/Groq/)).getByText("Your Groq key")).toBeInTheDocument();
    expect(screen.getByText("about $0.04")).toBeInTheDocument();
    expect(
      screen.getByText(
        "1 model × 50 tests, paid on your own keys. These tests use exact match, so no judge model is needed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run 50 tests on 1 model" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /DeepSeek/ }));
    expect(screen.getByRole("button", { name: "Run 50 tests on 2 models" })).toBeInTheDocument();
    expect(screen.getByText("about $0.06")).toBeInTheDocument();
  });

  it("a provider with no key is disabled with Add a key", async () => {
    mockApi(routes());
    open();
    await screen.findByText(/paid on your own keys/);
    const box = screen.getByRole("checkbox", { name: /OpenAI gpt-4o-mini/ });
    expect(box).toBeDisabled();
    const r = box.closest(".md-mrow") as HTMLElement;
    expect(within(r).getByText("No OpenAI key yet")).toBeInTheDocument();
    expect(within(r).getByRole("button", { name: "Add a key" })).toBeInTheDocument();
  });

  it("a model with no listed price says so and stays out of the total", async () => {
    mockApi(
      routes({
        "POST /api/models/m1/estimate": estimate({
          models: [
            {
              model: "groq/openai/gpt-oss-120b",
              price_known: false,
              estimate_usd: null,
              model_usd: null,
              judge_usd: null,
              unpriced_judges: [],
            },
          ],
        }),
      }),
    );
    open();
    expect(await screen.findByText("price not listed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No listed price for gpt-oss-120b: its cost shows after the run if the provider reports it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("about $0.00")).toBeInTheDocument();
  });

  it("names the judge when there are judge tests", async () => {
    mockApi(
      routes({
        "POST /api/models/m1/estimate": estimate({
          summary: {
            judge_tests: 4,
            judges: ["openai/gpt-4o-mini"],
            uses_exact: false,
            uses_contains: false,
          },
        }),
      }),
    );
    open();
    expect(
      await screen.findByText(/These tests include 4 AI-judge tests, judged by gpt-4o-mini/),
    ).toHaveTextContent("The judge's cost is included.");
  });

  it("Custom model… takes provider/model, refusing anything else", async () => {
    const calls = mockApi(routes());
    open();
    await screen.findByText(/paid on your own keys/);
    fireEvent.click(screen.getByRole("button", { name: "Custom model…" }));
    const input = screen.getByRole("textbox", { name: "Custom model" });
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Type it as provider/model, like groq/llama-3.3-70b-versatile.",
    );
    fireEvent.change(input, { target: { value: "groq/custom-1" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("checkbox", { name: /Groq custom-1/ })).toBeChecked();
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            (c.body as { models: string[] }).models.includes("groq/custom-1"),
        ),
      ).toBe(true),
    );
  });

  it("starts the ticked models; the server's refusal shows in place", async () => {
    const calls = mockApi(routes({ "POST /api/models/m1/runs": { runs: [aRun()] } }));
    const onStarted = open();
    await screen.findByText(/paid on your own keys/);
    fireEvent.click(screen.getByRole("button", { name: "Run 50 tests on 1 model" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(calls.find((c) => c.path.endsWith("/runs"))?.body).toEqual({
      models: ["groq/openai/gpt-oss-120b"],
    });
    cleanup();
    mockApi(
      routes({
        "POST /api/models/m1/runs": refused({
          missing_providers: ["openai"],
          message: "You have no key for: openai. Add it under Engines first.",
        }),
      }),
    );
    open();
    await screen.findByText(/paid on your own keys/);
    fireEvent.click(screen.getByRole("button", { name: "Run 50 tests on 1 model" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You have no key for: openai. Add it under Engines first.",
    );
  });

  it("with nothing ticked, says pick a model", async () => {
    mockApi(routes());
    open();
    await screen.findByText(/paid on your own keys/);
    fireEvent.click(screen.getByRole("checkbox", { name: /Groq/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run 50 tests on 0 models" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pick at least one model.");
  });
});

describe("the model page", () => {
  const routes = (over = {}) => ({
    "GET /api/config": CONFIG,
    "GET /api/providers": HELD,
    "GET /api/models/m1": aModel(),
    "GET /api/models/m1/tests": someTests(),
    "GET /api/models/m1/runs": someRuns(),
    "GET /api/account/preferences": {},
    ...over,
  });

  it("the Tests tab: breadcrumb, tabs, version line, choices and the table", async () => {
    mockApi(
      routes({
        "GET /api/models/m1/tests": someTests({
          last_runs: [
            {
              run_id: "a",
              model_slug: "anthropic/claude-sonnet-5-5",
              model_name: "claude-sonnet-5-5",
              completed_at: null,
            },
            {
              run_id: "b",
              model_slug: "groq/openai/gpt-oss-120b",
              model_name: "gpt-oss-120b",
              completed_at: null,
            },
          ],
          tests: [
            aTest({ last_run: [{ verdict: "pass" }, { verdict: "fail" }] }),
            aTest({ case_id: "c2", case_key: "k2", position: 2, last_run: [null, null] }),
          ],
        }),
      }),
    );
    renderIn(<ModelDetailPage modelId="m1" />);
    const table = await screen.findByRole("region", { name: "Tests" });
    expect(screen.getByRole("link", { name: "Models" })).toHaveAttribute("href", "#/models");
    expect(screen.getByRole("tab", { name: /Tests/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Test set v4")).toBeInTheDocument();
    expect(screen.getByText("Edited 2 h ago by you")).toBeInTheDocument();
    expect(screen.getByText("Answers are one of:")).toBeInTheDocument();
    const header = within(table).getByRole("columnheader", { name: /Last run/ });
    expect(header).toHaveTextContent("Last run · sonnet-5-5 / gpt-oss-120b");
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByText("Pass")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Fail")).toBeInTheDocument();
    expect(within(rows[2]).queryByText("Pass")).not.toBeInTheDocument();
    expect(within(rows[2]).getByText("—")).toBeInTheDocument();
  });

  it("shows the first 25 tests, then all of them", async () => {
    const tests = Array.from({ length: 30 }, (_, i) =>
      aTest({ case_id: `c${i}`, case_key: `k${i}`, position: i + 1 }),
    );
    mockApi(routes({ "GET /api/models/m1/tests": someTests({ tests }) }));
    renderIn(<ModelDetailPage modelId="m1" />);
    const table = await screen.findByRole("region", { name: "Tests" });
    expect(within(table).getAllByRole("row")).toHaveLength(26);
    expect(screen.getByText("Showing 25 of 30 tests")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 30" }));
    expect(within(table).getAllByRole("row")).toHaveLength(31);
  });

  it("no tests yet: the empty card, and Run tests is disabled", async () => {
    mockApi(
      routes({
        "GET /api/models/m1": aModel({ tests: 0, current_version: 0 }),
        "GET /api/models/m1/tests": someTests({ tests: [], version: 0, created_at: null }),
      }),
    );
    renderIn(<ModelDetailPage modelId="m1" />);
    await screen.findByRole("heading", { name: "No tests yet" });
    expect(
      screen.getByText("Add a test by hand, or import a CSV with the columns input and expected."),
    ).toBeInTheDocument();
    const run = screen.getByRole("button", { name: "Run tests" });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute("title", "Add a test first");
  });

  it("clicking a row opens the drawer beside the table, and it can pop up and dock back", async () => {
    mockApi(routes({ "GET /api/models/m1/tests/k1/results": { results: [] } }));
    const { container } = renderIn(<ModelDetailPage modelId="m1" />);
    const table = await screen.findByRole("region", { name: "Tests" });
    fireEvent.click(within(table).getByText("Rear-ended at a red light."));
    expect(screen.getByRole("heading", { name: "Test 1" })).toBeInTheDocument();
    expect(within(table).getAllByRole("row")[1]).toHaveClass("md-row--on");
    expect(container.querySelector(".md-page--drawer")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add test" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open as a pop-up" }));
    expect(container.querySelector(".md-page--drawer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dock to the side" }));
    expect(container.querySelector(".md-page--drawer")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Test 1" })).not.toBeInTheDocument();
  });

  it("the row's menu deletes with the version words", async () => {
    const calls = mockApi(routes({ "DELETE /api/models/m1/tests/k1": { version: 5 } }));
    renderIn(<ModelDetailPage modelId="m1" />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for test 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete test 1?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete test" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("History: view an older version read-only, back, and restore", async () => {
    const calls = mockApi(
      routes({
        "GET /api/models/m1/versions": {
          versions: [
            {
              version: 4,
              change_note: "Added test 2",
              created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
              tests: 2,
              runs: 3,
            },
            {
              version: 2,
              change_note: "Imported 12 tests from claims.csv",
              created_at: null,
              tests: 1,
              runs: 1,
            },
          ],
        },
        "POST /api/models/m1/versions/2/restore": { version: 5 },
        "GET /api/models/m1/tests": (_: unknown, url: URL) =>
          someTests({ version: Number(url.searchParams.get("version") ?? 4) }),
      }),
    );
    renderIn(<ModelDetailPage modelId="m1" />);
    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    const sheet = await screen.findByRole("dialog", { name: "Test set history" });
    expect(await within(sheet).findByText("Added test 2")).toBeInTheDocument();
    expect(within(sheet).getByText("you · 2 h ago · 3 runs")).toBeInTheDocument();
    fireEvent.click(within(sheet).getAllByRole("button", { name: "View" })[1]);
    await screen.findByText("You’re looking at test set v2. It can’t be changed.");
    expect(screen.queryByRole("button", { name: /More actions/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore as v5" }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith("/versions/2/restore"))).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByText(/You’re looking at test set/)).not.toBeInTheDocument(),
    );
  });

  it("History: Back returns to the current version", async () => {
    mockApi(
      routes({
        "GET /api/models/m1/versions": {
          versions: [
            { version: 2, change_note: "Added test 1", created_at: null, tests: 1, runs: 0 },
          ],
        },
      }),
    );
    renderIn(<ModelDetailPage modelId="m1" />);
    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to v4" }));
    await waitFor(() =>
      expect(screen.queryByText(/You’re looking at test set/)).not.toBeInTheDocument(),
    );
  });

  it("a model that's gone says so", async () => {
    mockApi({ "GET /api/models/m1": refused("model not found", 404) });
    renderIn(<ModelDetailPage modelId="m1" />);
    expect(await screen.findByText("This model doesn’t exist any more.")).toBeInTheDocument();
  });

  describe("Results", () => {
    const compare = {
      version: 4,
      a: aRun({ run_id: "a", model_name: "claude-sonnet-5-5" }),
      b: aRun({ run_id: "c", model_name: "gpt-oss-120b" }),
      counts: { total: 50, agree: 43, both_right: 40, both_wrong: 3, only_a: 6, only_b: 1 },
      rows: [
        {
          position: 5,
          case_key: "k5",
          input: "Third claim",
          expected: "Fraud review",
          a: { answer: "Fraud review", verdict: "pass", reason: null, right: true },
          b: { answer: "**Motor.**", verdict: "fail", reason: null, right: false },
          differ: true,
        },
        {
          position: 6,
          case_key: "k6",
          input: "A pet dog",
          expected: "Other",
          a: { answer: "Other", verdict: "pass", reason: null, right: true },
          b: { answer: "Other", verdict: "pass", reason: null, right: true },
          differ: false,
        },
      ],
    };
    const finished = () =>
      someRuns({
        best_run_id: "a",
        lowest_cost_run_id: "c",
        versions_with_runs: [
          { version: 4, runs: 3 },
          { version: 2, runs: 2 },
        ],
        runs: [
          aRun({ run_id: "a", model_name: "claude-sonnet-5-5", provider_label: "Anthropic" }),
          aRun({ run_id: "b", model_name: "deepseek-chat", passed: 43, total_usd: 0.04 }),
          aRun({
            run_id: "c",
            model_name: "gpt-oss-120b",
            provider_label: "Groq",
            passed: 41,
            total_usd: 0.02,
            avg_latency_ms: 600,
          }),
        ],
      });

    it("score cards: badges, bars and the line of facts", async () => {
      mockApi(
        routes({ "GET /api/models/m1/runs": finished(), "GET /api/models/m1/compare": compare }),
      );
      renderIn(<ModelDetailPage modelId="m1" tab="results" />);
      const best = (
        await screen.findByText("claude-sonnet-5-5", {
          selector: ".md-rcard__names *",
        })
      ).closest("article") as HTMLElement;
      expect(within(best).getByText("Best score")).toBeInTheDocument();
      expect(within(best).getByText("46 / 50")).toBeInTheDocument();
      expect(within(best).getByText("92% passed")).toBeInTheDocument();
      expect(within(best).getByText("$0.21 for all 50")).toBeInTheDocument();
      expect(within(best).getByText("1.4 s per answer")).toBeInTheDocument();
      expect(within(best).getByText("2 h ago")).toBeInTheDocument();
      expect(best.querySelector(".md-rcard__fill--best")).toHaveStyle({ width: "92%" });
      const cheap = screen
        .getByText("gpt-oss-120b", { selector: ".md-rcard__names *" })
        .closest("article") as HTMLElement;
      expect(within(cheap).getByText("Lowest cost")).toBeInTheDocument();
      expect(screen.getByText("3 runs on this version")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Runs on earlier versions (2)" }),
      ).toBeInTheDocument();
    });

    it("compare: the sentence, the differ filter and the answers as given", async () => {
      mockApi(
        routes({ "GET /api/models/m1/runs": finished(), "GET /api/models/m1/compare": compare }),
      );
      renderIn(<ModelDetailPage modelId="m1" tab="results" />);
      const only = await screen.findByRole("button", { name: "Only where they differ (7)" });
      const section = screen.getByRole("region", { name: "Compare two models" });
      expect(section).toHaveTextContent(
        "They agree on 43 of 50 tests (40 both right, 3 both wrong). claude-sonnet-5-5 is right on 6 where gpt-oss-120b is wrong; gpt-oss-120b is right on 1 where claude-sonnet-5-5 is wrong.",
      );
      expect(only).toHaveAttribute("aria-pressed", "true");
      expect(within(section).getByText("**Motor.**")).toBeInTheDocument();
      expect(within(section).queryByText("A pet dog")).not.toBeInTheDocument();
      fireEvent.click(within(section).getByRole("button", { name: "All 50" }));
      expect(within(section).getByText("A pet dog")).toBeInTheDocument();
      expect(
        within(section).getByText(/Only runs on the same test set version are compared/),
      ).toBeInTheDocument();
      expect(within(section).getByRole("combobox", { name: "First" })).toHaveDisplayValue(
        "claude-sonnet-5-5 · 46 / 50",
      );
    });

    it("a running card shows progress and Stop; a stopped one its words; a failed one Run again", async () => {
      const calls = mockApi(
        routes({
          "GET /api/models/m1/runs": someRuns({
            runs: [
              aRun({ run_id: "a", status: "running", done: 23, passed: 20, completed_at: null }),
              aRun({ run_id: "b", status: "stopped", done: 23, passed: 20 }),
              aRun({
                run_id: "c",
                status: "failed",
                error_message: "401 bad key",
                model_slug: "groq/x",
              }),
              aRun({ run_id: "d", errors: 2, first_error: "boom", judge_cost_usd: 0.01 }),
              aRun({ run_id: "e", price_known: false }),
            ],
          }),
          "POST /api/models/m1/runs/a/stop": aRun({ run_id: "a", status: "running" }),
          "POST /api/models/m1/runs": { runs: [] },
        }),
      );
      renderIn(<ModelDetailPage modelId="m1" tab="results" />);
      expect(await screen.findByText("23 of 50 done")).toBeInTheDocument();
      expect(screen.getByText("20 / 23")).toBeInTheDocument();
      expect(document.querySelector(".md-rcard__fill--running")).toHaveStyle({ width: "46%" });
      expect(screen.getByText("Stopped")).toBeInTheDocument();
      expect(screen.getByText("Stopped after 23 of 50")).toBeInTheDocument();
      expect(screen.getByText("This run failed: 401 bad key")).toBeInTheDocument();
      expect(screen.queryByText("Best score")).not.toBeInTheDocument();
      expect(screen.getByText("2 couldn’t be scored")).toHaveAttribute("title", "boom");
      expect(screen.getByText("Includes $0.01 for the AI judge.")).toBeInTheDocument();
      expect(screen.getByText("cost not listed")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      await waitFor(() => expect(calls.some((c) => c.path.endsWith("/a/stop"))).toBe(true));
      fireEvent.click(screen.getByRole("button", { name: "Run again" }));
      await waitFor(() =>
        expect(calls.find((c) => c.method === "POST" && c.path.endsWith("/runs"))?.body).toEqual({
          models: ["groq/x"],
        }),
      );
    });

    it("with fewer than two finished runs, compare says so", async () => {
      mockApi(routes({ "GET /api/models/m1/runs": someRuns({ runs: [aRun()] }) }));
      renderIn(<ModelDetailPage modelId="m1" tab="results" />);
      expect(
        await screen.findByText("Compare needs two finished runs on this version."),
      ).toBeInTheDocument();
    });

    it("no runs on this version: the words, and earlier versions are a click away", async () => {
      mockApi(
        routes({
          "GET /api/models/m1/runs": (_: unknown, url: URL) =>
            url.searchParams.get("version") === "2"
              ? someRuns({
                  version: 2,
                  runs: [aRun({ version: 2 })],
                  versions_with_runs: [{ version: 2, runs: 2 }],
                })
              : someRuns({ versions_with_runs: [{ version: 2, runs: 2 }] }),
        }),
      );
      renderIn(<ModelDetailPage modelId="m1" tab="results" />);
      await screen.findByRole("heading", { name: "No runs on test set v4 yet." });
      expect(
        screen.getByText("Run its tests to see how each model does, and for how much."),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Runs on earlier versions (2)" }));
      expect(await screen.findByText("Test set v2")).toBeInTheDocument();
      await screen.findByRole("button", { name: "Back to test set v4" });
    });

    it("polls while a run is going, then stops", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let reads = 0;
        mockApi(
          routes({
            "GET /api/models/m1/runs": () => {
              reads += 1;
              return someRuns({
                runs: [
                  reads === 1
                    ? aRun({ status: "running", done: 1, completed_at: null })
                    : aRun({ status: "completed" }),
                ],
              });
            },
          }),
        );
        renderIn(<ModelDetailPage modelId="m1" tab="results" />);
        await screen.findByText("1 of 50 done");
        await vi.advanceTimersByTimeAsync(3100);
        await screen.findByText("46 / 50");
        const settled = reads;
        await vi.advanceTimersByTimeAsync(9000);
        // The model reloads once when the run ends; after that nothing polls.
        expect(reads).toBeLessThanOrEqual(settled + 1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("Settings", () => {
  const open = (model = aModel()) => {
    const onSaved = vi.fn();
    const onDeleted = vi.fn();
    renderIn(<SettingsTab model={model} onSaved={onSaved} onDeleted={onDeleted} />);
    return { onSaved, onDeleted };
  };

  it("saves the name alone, and the job with the choices", async () => {
    const calls = mockApi({ "PATCH /api/models/m1": aModel() });
    const { onSaved } = open();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(calls[0].body).toEqual({ name: "New" });
    fireEvent.change(screen.getByRole("textbox", { name: "The job, in one sentence" }), {
      target: { value: "Job" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(calls[1].body).toEqual({ job: "Job", choices: ["Motor", "Home"] });
    expect(
      screen.getByText(
        "Changing the job or the choices makes a new test set version, since models see them with every test.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Kind of answer: Pick from a list — set when the model was made."),
    ).toBeInTheDocument();
  });

  it("a text model has no choices", () => {
    mockApi({});
    open(aModel({ answer_kind: "text", choices: [] }));
    expect(screen.queryByText("The choices")).not.toBeInTheDocument();
    expect(
      screen.getByText("Kind of answer: Write text — set when the model was made."),
    ).toBeInTheDocument();
  });

  it("shows the server's words in place", async () => {
    mockApi({ "PATCH /api/models/m1": refused("That name is taken. Pick another.") });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That name is taken. Pick another.");
  });

  it("Delete this model confirms with the words", async () => {
    mockApi({ "DELETE /api/models/m1": () => new Response(null, { status: 204 }) });
    const { onDeleted } = open(aModel({ tests: 50 }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this model" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete Claims triage?" });
    expect(dialog).toHaveTextContent(
      "Its 50 tests, every test set version and every result are deleted. This can’t be undone.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete model" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });
});
