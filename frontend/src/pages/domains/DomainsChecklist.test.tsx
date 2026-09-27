import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { DomainsChecklist } from "./DomainsChecklist";
import { mockApi, sampleDomains } from "./domainsTestUtils";

beforeEach(() => {
  __resetWorkspaceStatusForTests();
  __resetBackendStatusForTests();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const section = () => screen.getByRole("region", { name: "Domains this agent can search" });

describe("Domains this agent can search (Dm-AgentAccess)", () => {
  it("lists every domain with its status, the ticked ones from the agent's list", async () => {
    mockApi({ "GET /api/domains": { domains: sampleDomains() } });
    render(<DomainsChecklist value={["d-support"]} onChange={() => {}} />);
    const s = section();
    expect(await within(s).findByRole("checkbox", { name: /Support docs/ })).toBeChecked();
    expect(within(s).getByText("Ready · 14 files")).toBeInTheDocument();
    expect(within(s).getByRole("checkbox", { name: /Vendor contracts/ })).not.toBeChecked();
    expect(within(s).getByText("Reading 4 of 6")).toBeInTheDocument();
    expect(within(s).getByText("1 file needs attention")).toBeInTheDocument();
    expect(within(s).getByText("No files yet")).toBeInTheDocument();
    expect(s).toHaveTextContent(
      "During a run this agent gets two tools: ask a domain (answer + sources) and find passages (no answer). It picks the domain by name — no IDs needed.",
    );
  });

  it("ticking adds the domain; unticking from 'every domain' keeps the others", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DomainsChecklist value={null} onChange={onChange} domains={sampleDomains()} />,
    );
    fireEvent.click(within(section()).getByRole("checkbox", { name: /Support docs/ }));
    expect(onChange).toHaveBeenLastCalledWith(["d-support"]);
    rerender(<DomainsChecklist value={true} onChange={onChange} domains={sampleDomains()} />);
    fireEvent.click(within(section()).getByRole("checkbox", { name: /Vendor contracts/ }));
    expect(onChange).toHaveBeenLastCalledWith(["d-support", "d-research", "d-q3"]);
  });

  it("an agent on a Desktop plan is told it gets no domain tools there", () => {
    render(
      <DomainsChecklist
        value={null}
        onChange={() => {}}
        domains={sampleDomains()}
        subscription="grok"
      />,
    );
    expect(
      within(section()).getByText(
        "On Tvashtr Desktop with your Grok plan it can’t search domains yet.",
      ),
    ).toBeInTheDocument();
  });
});
