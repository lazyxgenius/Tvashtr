import { describe, expect, it } from "vitest";

import {
  answerMeta,
  hasMarkers,
  highlightRange,
  parseAnswer,
  parseInline,
  passageMeta,
  passageText,
  plainAnswer,
  sentenceCiting,
  suggestQuestions,
} from "./answerMarkers";

const ANSWER =
  "Customers can ask for a full refund within **30 days** of purchase [1]. After 30 days, monthly plans aren’t refunded, but annual plans get a prorated refund for the unused months [2]. Refunds go back to the original payment method within 5–10 business days [2].";

describe("parseInline / parseAnswer", () => {
  it("turns bold, code and markers into parts; a chip hugs the word before it", () => {
    expect(parseInline("Within **30 days** of `purchase` [1, 3].")).toEqual([
      { kind: "text", text: "Within " },
      { kind: "bold", text: "30 days" },
      { kind: "text", text: " of " },
      { kind: "code", text: "purchase" },
      { kind: "chip", n: 1 },
      { kind: "chip", n: 3 },
      { kind: "text", text: "." },
    ]);
  });

  it("splits paragraphs and simple lists", () => {
    const blocks = parseAnswer("Two ways:\n\n- Billing [1]\n- Email support [2]\n\n1. One\n2. Two");
    expect(blocks.map((b) => b.kind)).toEqual(["p", "ul", "ol"]);
    expect(blocks[1]).toEqual({
      kind: "ul",
      items: [
        [
          { kind: "text", text: "Billing" },
          { kind: "chip", n: 1 },
        ],
        [
          { kind: "text", text: "Email support" },
          { kind: "chip", n: 2 },
        ],
      ],
    });
  });
});

it("plainAnswer drops markers and Markdown marks (Copy)", () => {
  expect(plainAnswer("Within **30 days** [1], prorated [2, 3].")).toBe("Within 30 days, prorated.");
  expect(hasMarkers(ANSWER)).toBe(true);
  expect(hasMarkers("No sources here.")).toBe(false);
});

describe("OQ-10 highlight", () => {
  const refund =
    "…Customers may request a full refund within 30 days of their original purchase date. Requests are made from Billing → Refunds or by writing to support…";
  const billing =
    "…For annual subscriptions cancelled after the first 30 days, we refund the unused whole months on a prorated basis. Refunds are issued to the original payment method and usually arrive within 5–10 business days…";

  it("marks the passage sentence closest to the first answer sentence carrying the number", () => {
    const one = sentenceCiting(ANSWER, 1)!;
    expect(one).toBe("Customers can ask for a full refund within 30 days of purchase.");
    const [a, b] = highlightRange(refund, one)!;
    expect(refund.slice(a, b)).toBe(
      "Customers may request a full refund within 30 days of their original purchase date.",
    );
    const [c, d] = highlightRange(billing, sentenceCiting(ANSWER, 2)!)!;
    expect(billing.slice(c, d)).toBe(
      "For annual subscriptions cancelled after the first 30 days, we refund the unused whole months on a prorated basis.",
    );
  });

  it("marks nothing under two shared words, or for a number no sentence carries", () => {
    expect(highlightRange("Invoices go out monthly.", "Refunds take 30 days.")).toBeNull();
    expect(sentenceCiting(ANSWER, 4)).toBeNull();
  });
});

it("passage meta, text and answer meta", () => {
  expect(passageMeta({ page: null, piece_number: 3, pieces_in_file: 42 })).toBe("piece 3 of 42");
  expect(passageMeta({ page: 4, piece_number: 17, pieces_in_file: 86 })).toBe(
    "page 4 · piece 17 of 86",
  );
  expect(passageMeta({ page: null, piece_number: 2, pieces_in_file: null })).toBe("piece 2");
  expect(passageText({ excerpt: "A whole piece.", piece_number: 1 })).toBe("A whole piece.");
  expect(passageText({ excerpt: "cut mid  way", piece_number: 5 })).toBe("…cut mid way…");
  expect(answerMeta(1800, "OpenAI gpt-4o-mini")).toBe("1.8 s · OpenAI gpt-4o-mini");
  expect(answerMeta(2100, null)).toBe("2.1 s");
  expect(answerMeta(null, null)).toBe("");
});

describe("suggestQuestions (DM-56)", () => {
  it("asks about the design's four from Support docs' file names", () => {
    const files = [
      "refund-policy.md",
      "billing-faq.pdf",
      "getting-started.md",
      "api-limits.html",
      "account-security.pdf",
      "pricing-2026.pdf",
      "sso-setup.md",
      "webhooks.md",
      "data-export.pdf",
    ];
    expect(suggestQuestions(files)).toEqual([
      "What is the refund window?",
      "How do I set up SSO?",
      "What are the API rate limits?",
      "How do I export my data?",
    ]);
  });

  it("offers fewer or none when names don't fit, never a broken question", () => {
    expect(suggestQuestions(["setup.md", "notes.txt"])).toEqual([]);
    expect(suggestQuestions(["pricing.pdf", "webhooks.md"])).toEqual([
      "How much does each plan cost?",
    ]);
  });
});
