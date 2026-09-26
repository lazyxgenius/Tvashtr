/**
 * A domain's page (`#/domains/<id>[/<tab>]`).
 *
 * INTERIM (Domains G1): until the redesigned detail page lands (G2: header, setup strip, Sources
 * table, tabs), this opens the previous Domains screen straight on the domain, so every existing
 * action — files, reading, chat, tests, settings — keeps working behind the new list and nav.
 */
import { DomainsPage } from "../../components/DomainsPage";
import { requestHomeAction } from "../../lib/homeActions";
import { navigate } from "../../lib/nav";

export function DomainDetailPage({ domainId }: { domainId: string }) {
  return (
    <DomainsPage
      initialDomainId={domainId}
      onLeaveDetail={() => navigate({ page: "domains" })}
      onOpenEngines={() => navigate({ page: "engines", tab: "overview" })}
      onCreateTeam={() => requestHomeAction({ kind: "new-team" })}
    />
  );
}
