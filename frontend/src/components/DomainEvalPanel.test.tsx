import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import * as api from "../lib/api";
import { DomainEvalPanel } from "./DomainEvalPanel";

vi.mock("../lib/api", () => ({
  listDomainEvalCases: vi.fn(),
  createDomainEvalCase: vi.fn(),
  deleteDomainEvalCase: vi.fn(),
  getLatestDomainEvalRun: vi.fn(),
  runDomainEval: vi.fn(),
}));

const m = api as unknown as {
  listDomainEvalCases: Mock;
  createDomainEvalCase: Mock;
  deleteDomainEvalCase: Mock;
  getLatestDomainEvalRun: Mock;
  runDomainEval: Mock;
};

describe("DomainEvalPanel", () => {
  beforeEach(() => {
    m.listDomainEvalCases.mockResolvedValue([]);
    m.getLatestDomainEvalRun.mockRejectedValue(new Error("no eval runs yet"));
    const createdCase = {
      case_id: "c1",
      domain_id: "d1",
      question: "Refund window?",
      expected_answer: null,
      expected_citation_doc_ids: [],
      expected_keywords: ["refund"],
      ordinal: 0,
      created_at: "2026-09-15T00:00:00Z",
    };
    m.createDomainEvalCase.mockImplementation(async () => {
      m.listDomainEvalCases.mockResolvedValue([createdCase]);
      return createdCase;
    });
    m.runDomainEval.mockResolvedValue({
      run_id: "r1",
      domain_id: "d1",
      status: "completed",
      scores: {
        cases_total: 1,
        cases_scored_hit: 0,
        cases_scored_keyword: 1,
        hit_at_k: null,
        keyword_hit: 1,
        top_k: 8,
        retrieval_mode: "dense",
        per_case: [],
      },
      error_message: null,
      created_at: "2026-09-15T00:00:00Z",
      completed_at: "2026-09-15T00:00:01Z",
    });
  });

  it("adds a case and runs eval", async () => {
    const user = userEvent.setup();
    render(<DomainEvalPanel domainId="d1" />);
    await waitFor(() => expect(m.listDomainEvalCases).toHaveBeenCalledWith("d1"));
    await user.type(screen.getByLabelText(/Question/i), "Refund window?");
    await user.type(screen.getByLabelText(/Keywords/i), "refund");
    await user.click(screen.getByRole("button", { name: /Add case/i }));
    await waitFor(() => expect(m.createDomainEvalCase).toHaveBeenCalled());
    m.listDomainEvalCases.mockResolvedValue([
      {
        case_id: "c1",
        domain_id: "d1",
        question: "Refund window?",
        expected_answer: null,
        expected_citation_doc_ids: [],
        expected_keywords: ["refund"],
        ordinal: 0,
        created_at: "2026-09-15T00:00:00Z",
      },
    ]);
    await user.click(screen.getByRole("button", { name: /Run eval/i }));
    await waitFor(() => expect(m.runDomainEval).toHaveBeenCalledWith("d1"));
    expect(screen.getByLabelText("Latest scores").textContent).toMatch(/keyword_hit/i);
  });

  it("shows Eval / graph-lite operator path copy (#7)", async () => {
    render(<DomainEvalPanel domainId="d1" />);
    await waitFor(() => expect(m.listDomainEvalCases).toHaveBeenCalled());
    const panel = screen.getByRole("region", { name: /Eval/i });
    expect(panel.textContent).toMatch(/hit@k|keyword_hit/i);
    expect(panel.textContent).toMatch(/graph-lite|Config/i);
  });
});
