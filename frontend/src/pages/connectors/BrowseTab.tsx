/**
 * Toolkit › Connectors › Browse (Page-Browse-tab-Featured, Page-Browse-tab-scrolled,
 * Page-First-time-lands-on-Browse, CnF-Key-1): the first-time explainer, the category chips,
 * "Featured · Checked by Tvashtr" as a four-column grid that ends with the Custom connector card,
 * then "From the MCP Registry" as a list with Show more. A card says Connect, Connected (with
 * Open) or Coming soon.
 */
import { ChevronDown, Info, Plug, Search } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Badge, Button } from "../../design-system/components";
import type { CatalogEntry, Connection, ConnectionStatus } from "../../lib/api/connectors";
import { navigate } from "../../lib/nav";
import { EmptyState } from "../tools/EmptyState";
import { ConnectorTile } from "./ConnectorTile";
import { categoryLabel, registryCount } from "./connectorFormat";
import type { Catalog } from "./useCatalog";

export interface BrowseActions {
  onConnect: (entry: CatalogEntry) => void;
  onCustom: () => void;
}

/** This account's connection to an entry: the list when it has loaded, else the catalog's word. */
function connectionOf(
  entry: CatalogEntry,
  connections: Connection[] | null,
): { id: string; status: ConnectionStatus | null } | null {
  if (connections) return connections.find((c) => c.connector_key === entry.key) ?? null;
  return entry.connection_id ? { id: entry.connection_id, status: entry.connection_status } : null;
}

/** The badge beside a card's name: how you connect it. */
function authBadge(entry: CatalogEntry): ReactNode {
  if (!entry.available) return null;
  if (entry.auth === "oauth") return <Badge variant="outline">Sign in</Badge>;
  if (entry.auth === "api_key") return <Badge variant="outline">API key</Badge>;
  return null;
}

function EntryAction({
  entry,
  connections,
  variant,
  onConnect,
}: {
  entry: CatalogEntry;
  connections: Connection[] | null;
  variant: "primary" | "secondary";
  onConnect: (entry: CatalogEntry) => void;
}) {
  const mine = connectionOf(entry, connections);
  if (mine) {
    return (
      <>
        {mine.status === "needs_signin" ? (
          <Badge variant="warning">Needs attention</Badge>
        ) : (
          <Badge variant="success">Connected</Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ page: "connector", connectorId: mine.id })}
        >
          Open
        </Button>
      </>
    );
  }
  if (!entry.available) return <Badge variant="neutral">Coming soon</Badge>;
  return (
    <Button variant={variant} size="sm" onClick={() => onConnect(entry)}>
      Connect
    </Button>
  );
}

function FeaturedCard({
  entry,
  connections,
  onConnect,
}: {
  entry: CatalogEntry;
  connections: Connection[] | null;
  onConnect: (entry: CatalogEntry) => void;
}) {
  const titleId = useId();
  return (
    <article className="cn-card" aria-labelledby={titleId}>
      <div className="cn-card__head">
        <ConnectorTile connectorKey={entry.key} name={entry.name} />
        <div className="cn-card__id">
          <div className="cn-card__name" id={titleId}>
            {entry.name}
          </div>
          {entry.publisher && <div className="cn-card__by">{`By ${entry.publisher}`}</div>}
        </div>
        {authBadge(entry)}
      </div>
      <p className="cn-card__desc">{entry.description}</p>
      <div className="cn-card__foot">
        <EntryAction
          entry={entry}
          connections={connections}
          variant="primary"
          onConnect={onConnect}
        />
      </div>
    </article>
  );
}

function CustomCard({ onCustom }: { onCustom: () => void }) {
  const titleId = useId();
  return (
    <article className="cn-card cn-card--custom" aria-labelledby={titleId}>
      <div className="cn-card__head">
        <span className="cn-tile cn-tile--icon" aria-hidden="true">
          <Plug size={16} strokeWidth={1.6} />
        </span>
        <div className="cn-card__id">
          <div className="cn-card__name" id={titleId}>
            Custom connector
          </div>
          <div className="cn-card__by">Any server that signs in</div>
        </div>
      </div>
      <p className="cn-card__desc">
        Paste the address of any remote MCP server that signs in with OAuth.
      </p>
      <div className="cn-card__foot">
        <Button variant="secondary" size="sm" onClick={onCustom}>
          Add custom
        </Button>
      </div>
    </article>
  );
}

export function BrowseTab({
  catalog,
  connections,
  actions,
}: {
  catalog: Catalog;
  /** This account's connections (null while loading): what is already connected. */
  connections: Connection[] | null;
  actions: BrowseActions;
}) {
  const featuredId = useId();
  const registryId = useId();
  const { page, applied, category } = catalog;

  const chips = [null, ...(page?.categories ?? [])];
  const featured = page?.items.filter((e) => e.featured) ?? [];
  const registry = page?.items.filter((e) => !e.featured) ?? [];
  // Featured comes first and fits the first page, so the rest of `total` is the registry's.
  const registryTotal = page ? Math.max(page.total - featured.length, registry.length) : 0;
  const showGrid = featured.length > 0 || applied === "";

  return (
    <>
      {connections?.length === 0 && (
        <div className="cn-banner cn-banner--info" role="status">
          <Info size={16} strokeWidth={1.6} aria-hidden />
          <span className="cn-banner__text">
            Connect the apps your agents should read. Nothing is shared with an agent until you turn
            a connector on for it, and every connector starts read-only.
          </span>
        </div>
      )}
      {page && (
        <div className="cn-chips" role="group" aria-label="Category">
          {chips.map((c) => (
            <button
              key={c ?? "all"}
              type="button"
              className="cn-chip"
              aria-pressed={category === c}
              onClick={() => catalog.setCategory(c)}
            >
              {c === null ? "All" : categoryLabel(c)}
            </button>
          ))}
        </div>
      )}
      {catalog.failed ? (
        <section className="tk-card">
          <div className="tk-state" role="alert">
            <span>Couldn’t load the catalog.</span>
            <Button variant="secondary" size="sm" onClick={catalog.retry}>
              Retry
            </Button>
          </div>
        </section>
      ) : page === null ? (
        <div className="cn-grid" aria-busy="true" aria-label="Loading the catalog" />
      ) : (
        <>
          {showGrid ? (
            <section className="cn-section" aria-labelledby={featuredId}>
              <div className="cn-sechead">
                <h2 className="cn-sechead__title" id={featuredId}>
                  Featured
                </h2>
                <span className="cn-sechead__sub">Checked by Tvashtr</span>
              </div>
              <div className="cn-grid">
                {featured.map((entry) => (
                  <FeaturedCard
                    key={entry.key}
                    entry={entry}
                    connections={connections}
                    onConnect={actions.onConnect}
                  />
                ))}
                <CustomCard onCustom={actions.onCustom} />
              </div>
            </section>
          ) : registry.length > 0 ? (
            <span className="cn-nomatch">{`No featured connector matches “${applied}”.`}</span>
          ) : (
            <section className="tk-card">
              <EmptyState
                icon={<Search size={24} strokeWidth={1.6} />}
                title={`No connectors match “${applied}”`}
                actions={
                  <>
                    <Button variant="secondary" size="sm" onClick={() => catalog.setQuery("")}>
                      Clear search
                    </Button>
                    <Button size="sm" onClick={actions.onCustom}>
                      Custom connector
                    </Button>
                  </>
                }
              >
                Try another word, or add it as a custom connector if it signs in with OAuth.
              </EmptyState>
            </section>
          )}
          {registry.length > 0 && (
            <section className="cn-section" aria-labelledby={registryId}>
              <div className="cn-sechead">
                <h2 className="cn-sechead__title" id={registryId}>
                  From the MCP Registry
                </h2>
                <span className="cn-sechead__sub">
                  {registryCount(registryTotal, applied !== "")}
                </span>
              </div>
              <ul className="cn-reg">
                {registry.map((entry) => (
                  <li key={entry.key} className="cn-reg__row">
                    <ConnectorTile connectorKey={entry.key} name={entry.name} />
                    <div className="cn-reg__main">
                      <div className="cn-reg__title">
                        <span className="cn-reg__name">{entry.name}</span>
                        <span className="cn-reg__key">{entry.key}</span>
                      </div>
                      <div className="cn-reg__desc">
                        {entry.description}{" "}
                        <span className="cn-reg__host">{`· ${entry.host}`}</span>
                      </div>
                    </div>
                    {authBadge(entry)}
                    <EntryAction
                      entry={entry}
                      connections={connections}
                      variant="secondary"
                      onConnect={actions.onConnect}
                    />
                  </li>
                ))}
              </ul>
              {page.next_offset !== null && (
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft={<ChevronDown size={14} strokeWidth={1.6} aria-hidden />}
                    loading={catalog.loadingMore}
                    onClick={catalog.more}
                  >
                    Show more
                  </Button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
