/**
 * Toolkit › Connectors (`#/toolkit/connectors`, `#/toolkit/connectors/browse`): the page header
 * with Custom connector, the Connected N / Browse pill tabs driven by the address, each tab's
 * search box, and the tab's content. Owns this account's connections, which both tabs read: a
 * first visit with none lands on Browse. Also owns the sheets a button opens: the connect sheet
 * (connect, sign in again, replace a key, change project), the custom connector sheet, and the
 * Give access and Disconnect dialogs.
 */
import { Plug } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Input, Tabs, useToast } from "../../design-system/components";
import { type CatalogEntry, type Connection, listConnections } from "../../lib/api/connectors";
import { isDesktopApp } from "../../lib/desktopRepos";
import { navigate } from "../../lib/nav";
import { refreshBadges } from "../../lib/workspaceStatus";
import { StatusSelect } from "../tools/StatusSelect";
import type { StatusFilter } from "../tools/toolsState";
import { BrowseTab } from "./BrowseTab";
import { type ConnectDone, ConnectSheet } from "./ConnectSheet";
import { ConnectedTab } from "./ConnectedTab";
import { CustomConnectorSheet } from "./CustomConnectorSheet";
import { DisconnectDialog } from "./DisconnectDialog";
import { GiveAccessDialog } from "./GiveAccessDialog";
import { prepareSignInWindow } from "./connectSignIn";
import { accessGivenToast, connectedToast, searchPlaceholder, usesKey } from "./connectorFormat";
import { useCatalog } from "./useCatalog";
import "../tools/tools.css";
import "./connectors.css";

type ConnectorsView = "connected" | "browse";

/** What a button on either tab opens: a connect sheet, or a dialog about one connection. */
export type ConnectorOverlay =
  | { kind: "connect"; entry: CatalogEntry }
  | { kind: "custom" }
  // `prepared`: the sign-in window, opened in the click that asked for it.
  | { kind: "signin"; connection: Connection; prepared: Window | null }
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
  const { connections, error, reload, retry } = useConnections();
  const catalog = useCatalog(view === "browse");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [overlay, setOverlay] = useState<ConnectorOverlay>(null);
  // Connected during this visit: their rows say "New".
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const toast = useToast();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** After every change: the list, then the nav's count and "to fix". */
  const changed = async () => {
    await reload();
    void refreshBadges();
  };

  const closeSheet = () => {
    setOverlay(null);
    // A sign-in may have gone through behind a sheet that was closed.
    void changed();
  };

  const onDone = async (connection: Connection, what: ConnectDone) => {
    setOverlay(null);
    if (what === "connected") setFreshIds((ids) => [connection.id, ...ids]);
    await changed();
    if (what === "signed_in") return toast({ message: `${connection.name} is ready again.` });
    if (what === "project") {
      const project = connection.scope?.label.split(" · ")[0] ?? "the whole account";
      return toast({ message: `${connection.name} now uses ${project}.` });
    }
    navigate({ page: "connectors", view: "connected" }, { replace: true });
    toast({
      message: connectedToast(connection.name, isDesktopApp()),
      // A toast outlives the page: by then the connector's own page has the same button.
      action: isDesktopApp()
        ? undefined
        : {
            label: "Give an agent access",
            onClick: () =>
              mounted.current
                ? setOverlay({ kind: "give", connection })
                : navigate({ page: "connector", connectorId: connection.id }),
          },
    });
  };

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
          freshIds={freshIds}
          actions={{
            // The window opens in this click; a key connection needs none.
            onSignIn: (connection) =>
              setOverlay({
                kind: "signin",
                connection,
                prepared: usesKey(connection) ? null : prepareSignInWindow(),
              }),
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

      {overlay?.kind === "connect" && (
        <ConnectSheet
          key={overlay.entry.key}
          target={overlay}
          onClose={closeSheet}
          onDone={(c, what) => void onDone(c, what)}
        />
      )}
      {overlay?.kind === "signin" && (
        <ConnectSheet
          target={{ ...overlay, mode: "signin" }}
          onClose={closeSheet}
          onDone={(c, what) => void onDone(c, what)}
        />
      )}
      {overlay?.kind === "project" && (
        <ConnectSheet
          target={{ ...overlay, mode: "project" }}
          onClose={closeSheet}
          onDone={(c, what) => void onDone(c, what)}
        />
      )}
      {overlay?.kind === "custom" && (
        <CustomConnectorSheet onClose={closeSheet} onDone={(c) => void onDone(c, "connected")} />
      )}
      {overlay?.kind === "give" && (
        <GiveAccessDialog
          connection={overlay.connection}
          onClose={() => setOverlay(null)}
          onSaved={(added) => {
            setOverlay(null);
            toast({ message: accessGivenToast(added, overlay.connection.name) });
            void changed();
          }}
        />
      )}
      {overlay?.kind === "disconnect" && (
        <DisconnectDialog
          connection={overlay.connection}
          onClose={() => setOverlay(null)}
          onDisconnected={() => {
            setOverlay(null);
            toast({
              message: `${overlay.connection.name} is disconnected. It’s back in Browse if you need it.`,
            });
            void changed();
          }}
        />
      )}
    </>
  );
}
