import { describe, expect, it } from "vitest";

import { DOMAIN_TEMPLATE_ORDER, labelForDomainTemplate } from "./domains";

describe("domains helpers", () => {
  it("orders templates financial → legal → scientific → support → blank", () => {
    expect(DOMAIN_TEMPLATE_ORDER).toEqual([
      "financial",
      "legal",
      "scientific",
      "support",
      "blank",
    ]);
  });

  it("labels known templates", () => {
    expect(labelForDomainTemplate("legal")).toBe("Legal");
    expect(labelForDomainTemplate("support")).toBe("Support");
  });
});
