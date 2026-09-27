import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests, publishBadges } from "../../lib/workspaceStatus";
import { AgentDomainsLine, QueryDomainCardBody } from "./QueryDomainCardBody";
import { mockApi, sampleDomains } from "./domainsTestUtils";

const NAV = sampleDomains().map((d) => ({ id: d.domain_id, name: d.name, state: d.state }));

beforeEach(() => {
  __resetWorkspaceStatusForTests();
  __resetBackendStatusForTests();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Query domain card (DM-99)", () => {
  it("a new node needs a domain (Canvas-2)", () => {
    publishBadges({ domains: NAV });
    render(<QueryDomainCardBody config={{ domain_id: null, pass_to_spec: true }} />);
    // The canvas card's anatomy (Dm-QueryNode): the book glyph, the coral eyebrow, the title as
    // the agent cards' role line and the domain as their caption.
    expect(document.querySelector(".rf-node__head .rf-node__glyph svg")).not.toBeNull();
    expect(screen.getByText("Query domain", { selector: ".rf-node__eyebrow" })).toBeInTheDocument();
    expect(screen.getByText("Query domain", { selector: ".rf-node__role" })).toBeInTheDocument();
    expect(
      screen.getByText("Pick a domain", { selector: ".rf-node__caption" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Needs a domain")).toBeInTheDocument();
  });

  it("names its domain, passes the answer on and shows how the last run went (Step-5)", () => {
    publishBadges({ domains: NAV });
    render(
      <QueryDomainCardBody
        config={{ domain_id: "d-support", title: "Look up support docs", pass_to_spec: true }}
        lastOutcome="answered"
      />,
    );
    expect(
      screen.getByText("Look up support docs", { selector: ".rf-node__role" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Support docs", { selector: ".rf-node__caption" })).toBeInTheDocument();
    expect(screen.getByText("Answered")).toBeInTheDocument();
    expect(screen.getByText("Passes the answer on")).toBeInTheDocument();
  });

  it("flags no way out, and a deleted domain as needing one (Canvas-4, DM-102)", () => {
    publishBadges({ domains: NAV });
    const { rerender } = render(
      <QueryDomainCardBody config={{ domain_id: "d-support" }} errorCode="no_exit" />,
    );
    expect(screen.getByText("No way out")).toBeInTheDocument();
    expect(screen.queryByText("Passes the answer on")).toBeNull();
    rerender(<QueryDomainCardBody config={{ domain_id: "d-gone" }} />);
    expect(screen.getByText("Needs a domain")).toBeInTheDocument();
  });

  it("loads the domains once when nothing has yet", async () => {
    const calls = mockApi({ "GET /api/domains": { domains: sampleDomains() } });
    render(
      <>
        <QueryDomainCardBody config={{ domain_id: "d-vendor" }} />
        <QueryDomainCardBody config={{ domain_id: "d-support" }} />
      </>,
    );
    expect(await screen.findByText("Vendor contracts")).toBeInTheDocument();
    expect(screen.getByText("Support docs")).toBeInTheDocument();
    expect(calls.filter((c) => c.path === "/api/domains")).toHaveLength(1);
  });
});

describe("an agent card's domains line", () => {
  it("says which domain it can search", async () => {
    publishBadges({ domains: NAV });
    render(<AgentDomainsLine toolConfig={{ tvashtr: { domains: ["d-support"] } }} />);
    await waitFor(() => expect(screen.getByText("Can search Support docs")).toBeInTheDocument());
  });

  it("says nothing (and loads nothing) for an agent without domains", () => {
    const calls = mockApi({});
    const { container } = render(<AgentDomainsLine toolConfig={{ mcpServers: {} }} />);
    expect(container).toBeEmptyDOMElement();
    expect(calls).toHaveLength(0);
  });
});
