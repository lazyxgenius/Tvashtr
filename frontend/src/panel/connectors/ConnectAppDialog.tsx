/**
 * "Connect an app for <agent>" (CnF-FromAgent-2): the Featured connectors this account hasn't
 * connected yet, each with how it connects. Picking one hands over to the connect sheet (the same
 * one Browse opens); "Open Connectors" goes to Browse for everything else.
 */
import { ExternalLink } from "lucide-react";
import { useState } from "react";

import { Badge, Button, ButtonLink, Dialog, Input } from "../../design-system/components";
import { type CatalogEntry, listCatalog } from "../../lib/api/connectors";
import { routeToHash } from "../../lib/nav";
import { ConnectorTile } from "../../pages/connectors/ConnectorTile";
import { useLoaded } from "../runs/useLoaded";
import "../../pages/connectors/connectors.css";
import "./connectors.css";

export function ConnectAppDialog({
  agentName,
  connectedKeys,
  onPick,
  onBrowse,
  onClose,
}: {
  agentName: string;
  /** The `connector_key`s of the account's connections: those aren't offered again. */
  connectedKeys: ReadonlySet<string>;
  onPick: (entry: CatalogEntry) => void;
  /** Open Toolkit › Connectors › Browse through the drawer; without it the link is an address. */
  onBrowse?: () => void;
  onClose: () => void;
}) {
  // Featured comes first in the catalog and fits its first page.
  const catalog = useLoaded("catalog", () => listCatalog());
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const offered = (catalog.value?.items ?? []).filter(
    (e) => e.featured && e.available && !connectedKeys.has(e.key),
  );
  const shown = offered.filter((e) => e.name.toLowerCase().includes(words));

  return (
    <Dialog
      open
      title={`Connect an app for ${agentName}`}
      onClose={onClose}
      width={516}
      closeButton={false}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <ButtonLink
            variant="ghost"
            size="sm"
            href={routeToHash({ page: "connectors", view: "browse" })}
            iconLeft={<ExternalLink size={14} strokeWidth={1.6} aria-hidden />}
            onClick={(e) => {
              if (onBrowse) e.preventDefault();
              onClose();
              onBrowse?.();
            }}
          >
            Open Connectors
          </ButtonLink>
        </>
      }
    >
      <Input
        type="search"
        size="sm"
        aria-label="Search connectors"
        placeholder="Search connectors"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {catalog.state === "error" ? (
        <div className="nd-conn__error" role="alert">
          Couldn’t load the catalog.
          <Button variant="secondary" size="sm" onClick={catalog.retry}>
            Retry
          </Button>
        </div>
      ) : catalog.state !== "ready" ? (
        <p className="cn-hint" role="status">
          Loading connectors…
        </p>
      ) : shown.length === 0 ? (
        <p className="cn-hint">
          {offered.length === 0
            ? "Every featured connector is already connected."
            : `No featured connector matches “${query.trim()}”.`}
        </p>
      ) : (
        <ul className="nd-conn-pick">
          {shown.map((e) => (
            <li key={e.key} className="nd-conn-pick__row">
              <ConnectorTile connectorKey={e.key} name={e.name} />
              <span className="nd-conn-pick__name">{e.name}</span>
              {e.auth !== "none" && (
                <Badge variant="outline">{e.auth === "api_key" ? "API key" : "Sign in"}</Badge>
              )}
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Connect ${e.name}`}
                onClick={() => onPick(e)}
              >
                Connect
              </Button>
            </li>
          ))}
        </ul>
      )}
      <span className="nd-conn-pick__note">
        {`When you finish connecting, it’s ticked for ${agentName}. Save the agent to keep it.`}
      </span>
    </Dialog>
  );
}
