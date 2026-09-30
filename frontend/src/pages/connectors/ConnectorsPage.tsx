/**
 * Toolkit › Connectors (`#/toolkit/connectors`, `#/toolkit/connectors/browse`): the page header
 * with Custom connector, the Connected N / Browse pill tabs driven by the address, each tab's
 * search box, and the tab's content. Owns this account's connections, which both tabs read: a
 * first visit with none lands on Browse.
 */
import { Plug } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Input, Tabs } from "../../design-system/components";
import { type CatalogEntry, type Connection, listConnections } from "../../lib/api/connectors";
import { navigate } from "../../lib/nav";
import { StatusSelect } from "../tools/StatusSelect";
import type { StatusFilter } from "../tools/toolsState";
import { BrowseTab } from "./BrowseTab";
import { ConnectedTab } from "./ConnectedTab";
import { searchPlaceholder } from "./connectorFormat";
import { useCatalog } from "./useCatalog";
import "../tools/tools.css";
import "./connectors.css";

type ConnectorsView = "connected" | "browse";

/** What a button on either tab opens: a connect sheet, or a dialog about one connection. */
export type ConnectorOverlay =
  | { kind: "connect"; entry: CatalogEntry }
  | { kind: "custom" }
  | { kind: "signin"; connection: Connection }
  | { kind: "project"; connection: Connection }
  | { kind: "give"; connection: Connection }
  | { kind: "disconnect"; connection: Connection }
  | null;

/** This account's connections, loaded once per visit; `reload` after a change. */
function useConnections() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState(false);
  const reload = useCallback(async (): Promise<Connection[] | null> => {
    setError(false);
    try {
      const next = await listConnections();
      setConnections(next);
      return next;
    } catch {
      setError(true);
      return null;
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const retry = () => {
    setConnections(null);
    void reload();
  };
  return { connections, error, reload, retry };
}

export function ConnectorsPage({ view }: { view: ConnectorsView }) {
  const { connections, error, retry } = useConnections();
  const catalog = useCatalog(view === "browse");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  // The sheets and dialogs this opens are mounted by the tasks that build them (F1.4, F1.6).
  const [, setOverlay] = useState<ConnectorOverlay>(null);

  // A first visit with nothing connected lands on Browse. Decided once, on the first answer: the
  // Connected tab stays reachable afterwards (it says nothing is connected yet).
  const landed = useRef(false);
  useEffect(() => {
    if (connections === null || landed.current) return;
    landed.current = true;
    if (view === "connected" && connections.length === 0) {
      navigate({ page: "connectors", view: "browse" }, { replace: true });
    }
  }, [connections, view]);

  const count = connections && connections.length > 0 ? connections.length : null;

  return (
    <>
      <div className="tk-head">
        <div>
          <h1 className="tk-head__title">Connectors</h1>
          <p className="tk-head__lede cn-lede">
            Sign in to the apps and data your agents should read: databases, docs, analytics and
            CRM. Connect once here, then choose which agents can use each one.
          </p>
        </div>
        <div className="tk-head__actions">
          <Button
            variant="secondary"
            iconLeft={<Plug size={15} strokeWidth={1.6} aria-hidden />}
            onClick={() => setOverlay({ kind: "custom" })}
          >
            Custom connector
          </Button>
        </div>
      </div>

      <div className="tk-bar">
        <Tabs
          variant="pill"
          aria-label="Connectors"
          value={view}
          onChange={(v) => navigate({ page: "connectors", view: v }, { replace: true })}
          items={[
            { value: "connected", label: "Connected", count },
            { value: "browse", label: "Browse" },
          ]}
        />
        <div className="tk-bar__filters">
          {view === "connected" ? (
            <>
              <Input
                size="sm"
                className="tk-search"
                placeholder="Search connectors"
                aria-label="Search connectors"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <StatusSelect value={status} onChange={setStatus} />
            </>
          ) : (
            <Input
              size="sm"
              className="tk-search cn-search"
              placeholder={searchPlaceholder(catalog.size)}
              aria-label="Search connectors"
              value={catalog.query}
              onChange={(e) => catalog.setQuery(e.target.value)}
            />
          )}
        </div>
      </div>

      {view === "connected" ? (
        <ConnectedTab
          connections={connections}
          error={error}
          onRetry={retry}
          query={query}
          status={status}
          onClearFilters={() => {
            setQuery("");
            setStatus("all");
          }}
          freshIds={[]}
          actions={{
            onSignIn: (connection) => setOverlay({ kind: "signin", connection }),
            onGiveAccess: (connection) => setOverlay({ kind: "give", connection }),
            onChangeProject: (connection) => setOverlay({ kind: "project", connection }),
            onDisconnect: (connection) => setOverlay({ kind: "disconnect", connection }),
          }}
        />
      ) : (
        <BrowseTab
          catalog={catalog}
          connections={connections}
          actions={{
            onConnect: (entry) => setOverlay({ kind: "connect", entry }),
            onCustom: () => setOverlay({ kind: "custom" }),
          }}
        />
      )}
    </>
  );
}
