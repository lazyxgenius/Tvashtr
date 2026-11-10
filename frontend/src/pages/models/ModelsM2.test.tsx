/** M2: the example builder's screens — the Draft with a team dialog's states, a drafting / ready /
 *  stopped batch, the Reviewer's three lines, flipping, editing, Accept counts, the Training tab
 *  (Add, Import, Download, History) and the lock on the Tests tab. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import type { Draft, DraftBatch, Drafts, DraftingOptions } from "../../lib/api/models";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { mockApi } from "../domains/domainsTestUtils";
import { DraftDialog } from "./DraftDialog";
import { ModelDetailPage } from "./ModelDetailPage";
import { CONFIG, HELD, aModel, aTest, someTests } from "./modelsTestUtils";
import { acceptLine, locatorShort, sourceFileLine, versionLine } from "./modelsFormat";

const CHOICES = ["Motor", "Property", "Health", "Travel", "Fraud review", "Other"];
const model = (over = {}) =>
  aModel({
    name: "Claims triage",
    job: "Reads a new insurance claim and picks the team that should handle it.",
    choices: CHOICES,
    tests: 3,
    training_version: 2,
    training: 1,
    drafts: 4,
    ...over,
  });

function aDraft(over: Partial<Draft> = {}): Draft {
  return {
    draft_id: "d1",
    number: 1,
    kind: "test",
    input: "My parked car was hit by a reversing truck in the office lot.",
    answer: "Motor",
    must_contain: [],
    source: {
      file: "motor-claims-guide.pdf",
      quote: "Damage to an insured vehicle caused by another vehicle is handled by the Motor team.",
      locator: "page 4",
    },
    review: "ok",
    review_note: "the quote covers a parked car hit by another vehicle; Motor is right.",
    reviewed_by: "Reviewer",
    edited: false,
    blocked: null,
    selected: true,
    ...over,
  };
}

function aBatch(over: Partial<DraftBatch> = {}): DraftBatch {
  return {
    batch_id: "b1",
    run_id: "r1",
    state: "ready",
    team_id: "t1",
    team_name: "Example builder",
    domain_name: "Claims handbook",
    tests_wanted: 2,
    training_wanted: 2,
    handed_in: 4,
    drafts_total: 4,
    created_at: new Date(Date.now() - 600_000).toISOString(),
    completed_at: new Date(Date.now() - 180_000).toISOString(),
    cost_usd: 0.08,
    estimate_usd: 0.09,
    review_rounds: 2,
    sent_back: 1,
    reviewer_line: "Reviewer checked 10, sent back once, then approved",
    drafts: [
      aDraft(),
      aDraft({
        draft_id: "d2",
        number: 2,
        kind: "training",
        answer: "Fraud review",
        review: "none",
        review_note: null,
        reviewed_by: null,
      }),
      aDraft({
        draft_id: "d3",
        number: 3,
        review: "flagged",
        answer: "Property",
        review_note: "the quote covers the building, not a car.",
        selected: false,
      }),
      aDraft({
        draft_id: "d4",
        number: 4,
        kind: "training",
        answer: "Health",
        blocked:
          "This matches test 3, so it can't be trained on. Edit it into a different case, or reject it.",
        selected: false,
      }),
    ],
    ...over,
  };
}

const drafts = (over: Partial<Drafts> = {}): Drafts => ({
  batches: [aBatch()],
  open: 4,
  test_version: 4,
  training_version: 2,
  answer_kind: "choice",
  choices: CHOICES,
  ...over,
});

const OPTIONS: DraftingOptions = {
  domains: [
    { domain_id: "dom1", name: "Claims handbook", ready_files: 14 },
    { domain_id: "dom2", name: "Empty one", ready_files: 0 },
  ],
  teams: [
    {
      team_id: "t1",
      name: "Example builder",
      builder: true,
      steps: [
        {
          node_id: "n1",
          label: "Reader",
          model: "vertex_ai/gemini-3-flash-preview",
          end: false,
          hand_in: false,
          loops_with_next: false,
        },
        {
          node_id: "n2",
          label: "Writer",
          model: "vertex_ai/gemini-3-flash-preview",
          end: false,
          hand_in: false,
          loops_with_next: true,
        },
        {
          node_id: "n3",
          label: "Reviewer",
          model: "deepseek/deepseek-chat",
          end: false,
          hand_in: false,
          loops_with_next: false,
        },
        {
          node_id: "n4",
          label: "Hand in",
          model: null,
          end: true,
          hand_in: true,
          loops_with_next: false,
        },
      ],
    },
  ],
  drafting: false,
  answer_kind: "choice",
  choices: CHOICES,
};

const ESTIMATE = {
  estimate_usd: 0.09,
  from_history: true,
  runs: 6,
  hint: "Based on what these models really used on your last 6 runs.",
  unpriced: [],
  pause_usd: 0.5,
  agents: 3,
};

function renderIn(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
  window.location.hash = "";
});

const base = (over = {}) => ({
  "GET /api/config": CONFIG,
  "GET /api/providers": HELD,
  "GET /api/models/m1": model(),
  ...over,
});

describe("the M2 format helpers", () => {
  it("say what accepting will do", () => {
    const d = drafts();
    expect(acceptLine(9, 18, { ...d, test_version: 4, training_version: 2 })).toBe(
      "Accepting adds 9 tests (test set v5) and 18 training examples (training set v3) in one step. Each keeps its source.",
    );
    expect(acceptLine(1, 0, d)).toBe(
      "Accepting adds 1 test (test set v5) in one step. Each keeps its source.",
    );
    expect(acceptLine(0, 0, d)).toBe("Select the drafts to accept.");
  });

  it("name a source and a version line", () => {
    expect(sourceFileLine({ file: "a.pdf", quote: "q", locator: "page 4" })).toBe("a.pdf · page 4");
    expect(sourceFileLine({ file: "a.md", quote: "q" })).toBe("a.md");
    expect(locatorShort("page 11")).toBe("p. 11");
    const iso = new Date(Date.now() - 12 * 60_000).toISOString();
    expect(versionLine("Added 9 tests from Example builder", iso)).toBe(
      "9 added from Example builder, 12 min ago",
    );
    expect(versionLine("Edited test 2", iso)).toBe("Edited 12 min ago by you");
  });
});

describe("Draft with a team", () => {
  const open = (over = {}) => {
    const onStarted = vi.fn();
    const calls = mockApi(
      base({
        "GET /api/models/m1/drafting": OPTIONS,
        "POST /api/models/m1/drafting/estimate": ESTIMATE,
        ...over,
      }),
    );
    renderIn(<DraftDialog model={model()} onClose={vi.fn()} onStarted={onStarted} />);
    return { onStarted, calls };
  };

  it("shows the Domain, the counts, the team's steps, the estimate and the pause amount", async () => {
    open();
    expect(await screen.findByRole("dialog", { name: "Draft with a team" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your team reads a Domain and drafts examples for Claims triage. Nothing is added until you accept it.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Claims handbook · 14 files" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Tests").value).toBe("10");
    expect(screen.getByLabelText<HTMLInputElement>("Training examples").value).toBe("20");
    const strip = screen.getByLabelText("The team's steps");
    expect(strip).toHaveTextContent("Reader");
    expect(strip).toHaveTextContent("gemini-3-flash-preview");
    expect(strip).toHaveTextContent("⇄");
    expect(strip).toHaveTextContent("Hand in");
    expect(screen.getByRole("link", { name: /Open on canvas/ })).toHaveAttribute(
      "href",
      "#/teams/t1",
    );
    expect(await screen.findByText("about $0.09")).toBeInTheDocument();
    expect(
      screen.getByText(
        "30 examples with three agents, paid on your own keys. Based on what these models really used on your last 6 runs.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("$0.50")).toBeInTheDocument();
    expect(screen.getByText(/answers that aren't one of your six choices/)).toBeInTheDocument();
  });

  it("with no Domain at all says so, and can't start", async () => {
    open({ "GET /api/models/m1/drafting": { ...OPTIONS, domains: [] } });
    expect(
      await screen.findByText(/You have no Domains yet. Add your files to a Domain first./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Domains" })).toHaveAttribute(
      "href",
      "#/domains",
    );
    expect(screen.getByRole("button", { name: "Start drafting" })).toBeDisabled();
  });

  it("both counts at 0 disables Start drafting", async () => {
    open();
    await screen.findByText("about $0.09");
    fireEvent.change(screen.getByLabelText("Tests"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Training examples"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Start drafting" })).toBeDisabled();
  });

  it("a model that is already drafting can't start another", async () => {
    open({ "GET /api/models/m1/drafting": { ...OPTIONS, drafting: true } });
    expect(await screen.findByText("A team is already drafting for this model.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start drafting" })).toBeDisabled();
  });

  it("starts the run with the numbers; a missing key offers Add a key", async () => {
    const { onStarted, calls } = open({
      "POST /api/models/m1/drafting": () =>
        new Response(
          JSON.stringify({
            detail: {
              missing_providers: ["deepseek"],
              message: "You have no key for: deepseek. Add it under Engines first.",
            },
          }),
          { status: 422 },
        ),
    });
    await screen.findByText("about $0.09");
    fireEvent.click(screen.getByRole("button", { name: "Start drafting" }));
    expect(
      await screen.findByText("You have no key for: deepseek. Add it under Engines first."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a key" })).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
    const start = calls.find((c) => c.method === "POST" && c.path.endsWith("/drafting"));
    expect(start?.body).toEqual({ domain_id: "dom1", team_id: "t1", tests: 10, training: 20 });
  });

  it("a first estimate says so", async () => {
    open({
      "POST /api/models/m1/drafting/estimate": {
        ...ESTIMATE,
        from_history: false,
        hint: "A first estimate from each model's listed price. It gets closer after your first run.",
        unpriced: ["mistral/not-listed"],
      },
    });
    expect(
      await screen.findByText(/A first estimate from each model's listed price/),
    ).toBeInTheDocument();
    expect(screen.getByText(/No listed price for not-listed/)).toBeInTheDocument();
  });
});

describe("the Drafts tab", () => {
  const show = (d: Drafts = drafts(), over = {}) => {
    const calls = mockApi(base({ "GET /api/models/m1/drafts": d, ...over }));
    renderIn(<ModelDetailPage modelId="m1" tab="drafts" />);
    return calls;
  };

  it("a ready batch: its bar, the filters, the selection and what accepting will do", async () => {
    show();
    expect(
      await screen.findByText("Reviewer checked 10, sent back once, then approved"),
    ).toBeTruthy();
    expect(screen.getByText("Finished 3 min ago")).toBeInTheDocument();
    expect(screen.getByText("$0.08")).toBeInTheDocument();
    const seg = screen.getByRole("group", { name: "Which drafts to show" });
    expect(
      within(seg)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["All 4", "Tests 2", "Training 2", "Flagged 1"]);
    expect(
      screen.getByText("2 selected · flagged drafts and copies of your tests are left out"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept 2" })).toBeEnabled();
    expect(
      screen.getByText(
        "Accepting adds 1 test (test set v5) and 1 training example (training set v3) in one step. Each keeps its source.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Drafts/ })).toHaveAttribute("aria-selected", "true");
  });

  it("the three Reviewer lines and the blocked card", async () => {
    show();
    await screen.findByText("Reviewer checked 10, sent back once, then approved");
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Flagged")).toBeInTheDocument();
    expect(screen.getByText("Not sampled")).toBeInTheDocument();
    expect(
      screen.getByText("Passed the source check. The Reviewer checks a sample, not every draft."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This matches test 3, so it can't be trained on. Edit it into a different case, or reject it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Select draft 3")).not.toBeChecked();
    expect(screen.getAllByText("motor-claims-guide.pdf · page 4")).toHaveLength(4);
  });

  it("flipping a card asks the server and shows what it says", async () => {
    const calls = show(drafts(), {
      "POST /api/models/m1/drafts/d1/kind": { draft: aDraft({ kind: "training" }) },
    });
    await screen.findByText("Reviewer checked 10, sent back once, then approved");
    const group = screen.getByRole("group", { name: "Draft 1 is a" });
    fireEvent.click(within(group).getByRole("button", { name: "Training" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/drafts/d1/kind"))).toBe(true));
    expect(calls.find((c) => c.path.endsWith("/drafts/d1/kind"))?.body).toEqual({
      kind: "training",
    });
  });

  it("Accept sends the selected drafts in one step", async () => {
    const calls = show(drafts(), {
      "POST /api/models/m1/drafts/accept": {
        accepted_tests: 1,
        accepted_training: 1,
        test_version: 5,
        training_version: 3,
        refused: [],
      },
    });
    await screen.findByText("Reviewer checked 10, sent back once, then approved");
    fireEvent.click(screen.getByLabelText("Select draft 2"));
    expect(screen.getByRole("button", { name: "Accept 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select draft 2"));
    fireEvent.click(screen.getByRole("button", { name: "Accept 2" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/drafts/accept"))).toBe(true));
    expect(calls.find((c) => c.path.endsWith("/drafts/accept"))?.body).toEqual({
      draft_ids: ["d1", "d2"],
    });
    expect(await screen.findByText("Added 1 test and 1 training example.")).toBeInTheDocument();
  });

  it("Edit opens the drawer; the source is shown, not editable", async () => {
    const calls = show(drafts(), {
      "PUT /api/models/m1/drafts/d1": { draft: aDraft({ edited: true }) },
    });
    await screen.findByText("Reviewer checked 10, sent back once, then approved");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(await screen.findByRole("heading", { name: "Draft 1" })).toBeInTheDocument();
    expect(screen.getByText("The source stays as the team quoted it.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Input"), { target: { value: "A new case." } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
      input: "A new case.",
      answer: "Motor",
    });
  });

  it("a drafting batch: the count so far, and accepting waits", async () => {
    show(
      drafts({
        open: 0,
        batches: [
          aBatch({ state: "drafting", handed_in: 2, reviewer_line: null, drafts: [aDraft()] }),
        ],
      }),
    );
    expect(await screen.findByText(/2 of 4 so far/)).toBeInTheDocument();
    expect(screen.getAllByText("You can accept once the team hands in.").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Select draft 1")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Accept 0" })).toBeDisabled();
  });

  it("a stopped batch says the Reviewer didn't finish, and can be accepted", async () => {
    show(drafts({ batches: [aBatch({ state: "stopped", reviewer_line: null })] }));
    expect(
      await screen.findByText(
        "The run stopped before the Reviewer finished. These drafts passed the source check but weren't reviewed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept 2" })).toBeEnabled();
  });

  it("empty: No drafts to review, and Draft with a team", async () => {
    show(drafts({ batches: [], open: 0 }), {
      "GET /api/models/m1/drafting": OPTIONS,
      "POST /api/models/m1/drafting/estimate": ESTIMATE,
    });
    expect(await screen.findByText("No drafts to review")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Draft with a team" });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole("dialog", { name: "Draft with a team" })).toBeInTheDocument();
  });
});

describe("the Training examples tab", () => {
  const SET = {
    version: 2,
    is_current: true,
    change_note: "Added 18 examples from Example builder",
    created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    tests: 59,
    examples: [
      {
        example_id: "e1",
        example_key: "x1",
        position: 1,
        input: "Claiming for a laptop stolen on a train.",
        answer: "Fraud review",
        source: { file: "fraud-signals.md", quote: "Send to Fraud review any claim where…" },
        origin: "draft" as const,
        added_by: "Example builder",
      },
      {
        example_id: "e2",
        example_key: "x2",
        position: 2,
        input: "Want to add my newborn to the family policy.",
        answer: "Other",
        source: null,
        origin: "hand" as const,
        added_by: "You",
      },
    ],
  };
  const show = (over = {}) => {
    const calls = mockApi(base({ "GET /api/models/m1/training": SET, ...over }));
    renderIn(<ModelDetailPage modelId="m1" tab="training" />);
    return calls;
  };

  it("the version line, the note, the table and the header's buttons", async () => {
    show();
    const table = await screen.findByRole("region", { name: "Training examples" });
    expect(screen.getByText("Training set v2")).toBeInTheDocument();
    expect(screen.getByText("18 added from Example builder, 12 min ago")).toBeInTheDocument();
    expect(
      screen.getByText(/Your 59 tests are kept apart and never trained on/),
    ).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["#", "Input", "Answer", "Source", "Added by", "Actions"]);
    expect(within(table).getByText("fraud-signals.md")).toBeInTheDocument();
    expect(within(table).getByText("Example builder")).toBeInTheDocument();
    expect(within(table).getByText("You")).toBeInTheDocument();
    for (const name of ["Download", "Import CSV", "Add example", "Draft with a team"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("Showing 2 of 2 training examples")).toBeInTheDocument();
  });

  it("Download offers JSONL and CSV", async () => {
    show();
    await screen.findByRole("region", { name: "Training examples" });
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByRole("menuitem", { name: "JSONL" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "CSV" })).toBeInTheDocument();
  });

  it("Add example opens the drawer and saves", async () => {
    const calls = show({
      "POST /api/models/m1/training": {
        example: SET.examples[1],
        version: 3,
      },
    });
    await screen.findByRole("region", { name: "Training examples" });
    fireEvent.click(screen.getByRole("button", { name: "Add example" }));
    expect(await screen.findByRole("heading", { name: "New training example" })).toBeTruthy();
    expect(screen.getByText("Saving makes training set v3.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Input"), { target: { value: "A claim." } });
    fireEvent.click(screen.getByRole("button", { name: "Save example" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/training"))).toBe(true),
    );
    expect(calls.find((c) => c.method === "POST" && c.path.endsWith("/training"))?.body).toEqual({
      input: "A claim.",
      answer: "Motor",
    });
  });

  it("the lock refusal shows in place", async () => {
    show({
      "POST /api/models/m1/training": () =>
        new Response(
          JSON.stringify({ detail: "This matches test 2, so it can't be trained on." }),
          { status: 422 },
        ),
    });
    await screen.findByRole("region", { name: "Training examples" });
    fireEvent.click(screen.getByRole("button", { name: "Add example" }));
    fireEvent.change(await screen.findByLabelText("Input"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save example" }));
    expect(
      await screen.findByText("This matches test 2, so it can't be trained on."),
    ).toBeInTheDocument();
  });

  it("Import CSV is the training importer", async () => {
    show();
    await screen.findByRole("region", { name: "Training examples" });
    fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    expect(
      await screen.findByRole("dialog", { name: "Import training examples from a CSV" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You need input and answer/)).toBeInTheDocument();
  });

  it("History lists the training set versions", async () => {
    show({
      "GET /api/models/m1/training/versions": {
        versions: [
          {
            version: 2,
            change_note: "Added 18 examples from Example builder",
            created_at: null,
            examples: 19,
          },
          { version: 1, change_note: "Added example 1", created_at: null, examples: 1 },
        ],
      },
    });
    await screen.findByRole("region", { name: "Training examples" });
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText("Training set history")).toBeInTheDocument();
    expect(screen.getByText("Added example 1")).toBeInTheDocument();
    expect(screen.getByText(/19 examples/)).toBeInTheDocument();
  });

  it("empty: No training examples yet", async () => {
    show({ "GET /api/models/m1/training": { ...SET, version: 0, examples: [], created_at: null } });
    expect(await screen.findByText("No training examples yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add example" }).length).toBeGreaterThan(0);
  });
});

describe("the Tests tab's lock and sources", () => {
  it("the badge, a lock on every row and the Source column (no Scored by for a choice model)", async () => {
    mockApi(
      base({
        "GET /api/models/m1/tests": someTests({
          change_note: "Added 9 tests from Example builder",
          tests: [
            aTest({ added_by: "Added by you" }),
            aTest({
              case_id: "c2",
              case_key: "k2",
              position: 2,
              origin: "draft",
              source: {
                file: "travel-policy-wording.pdf",
                quote: "Missed connections…",
                locator: "page 9",
              },
            }),
            aTest({
              case_id: "c3",
              case_key: "k3",
              position: 3,
              added_by: "Imported from claims.csv",
            }),
          ],
        }),
      }),
    );
    renderIn(<ModelDetailPage modelId="m1" />);
    const table = await screen.findByRole("region", { name: "Tests" });
    const badge = screen.getByText("Never used for training");
    expect(badge).toHaveAttribute("title", "Tests are kept apart from training examples");
    expect(screen.getByText(/9 added from Example builder/)).toBeInTheDocument();
    expect(
      within(table).getAllByRole("img", { name: "Locked: never used for training" }),
    ).toHaveLength(3);
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toContain("Source");
    expect(headers).not.toContain("Scored by");
    expect(within(table).getByText("travel-policy-wording.pdf · p. 9")).toBeInTheDocument();
    expect(within(table).getByText("Added by you")).toBeInTheDocument();
    expect(within(table).getByText("Imported from claims.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draft with a team" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Training examples/ })).toBeInTheDocument();
  });

  it("a text model keeps Scored by and adds Source after it", async () => {
    mockApi(
      base({
        "GET /api/models/m1": model({ answer_kind: "text", choices: [] }),
        "GET /api/models/m1/tests": someTests({
          tests: [aTest({ scoring: "contains", must_contain: ["x"] })],
        }),
      }),
    );
    renderIn(<ModelDetailPage modelId="m1" />);
    const table = await screen.findByRole("region", { name: "Tests" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers.indexOf("Source")).toBe(headers.indexOf("Scored by") + 1);
  });
});

describe("Part D", () => {
  it("an error verdict is its own amber Error chip with the reason as its title", async () => {
    mockApi(
      base({
        "GET /api/models/m1/tests": someTests({
          last_runs: [
            {
              run_id: "a",
              model_slug: "deepseek/deepseek-chat",
              model_name: "deepseek-chat",
              completed_at: null,
            },
          ],
          tests: [aTest({ last_run: [{ verdict: "error", reason: "The model gave no answer." }] })],
        }),
      }),
    );
    renderIn(<ModelDetailPage modelId="m1" />);
    const table = await screen.findByRole("region", { name: "Tests" });
    const chip = within(table).getByText("Error");
    expect(chip).toHaveAttribute("title", "The model gave no answer.");
    expect(chip).toHaveClass("md-mk--err");
    expect(within(table).queryByText("Fail")).toBeNull();
  });

  it("New model's subtitle says what can change later", async () => {
    const { NewModelDialog } = await import("./NewModelDialog");
    mockApi(base());
    renderIn(<NewModelDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(
      await screen.findByText(
        "One job, described plainly. You can change the name and the job later.",
      ),
    ).toBeInTheDocument();
  });
});
