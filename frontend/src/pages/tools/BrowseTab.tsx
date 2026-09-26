/**
 * Toolkit › Tools › Browse (Toolkit-ToolsBrowse, TkF-Catalog-1..4): the catalog as a two-column
 * card grid — the catalog's entries in API order, then the two ways to bring your own (Custom
 * server, Paste mcp.json).
 *
 * - An attachable entry (Web fetch) has "Add", which becomes a disabled "In your tools" once a
 *   tool of that name exists (TOOL-21). The page adds it and toasts (TOOL-22).
 * - The GitHub App entry reads `GET /api/github/status` (TOOL-23): "Needs GitHub App" + Install
 *   GitHub App (the alertdialog, TOOL-24), or "App installed" + Choose repos (TOOL-26). It is hidden
 *   on a self-hosted backend (TOOL-29) and until the status is known.
 */
import { Braces, Check, Globe, Server } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Button } from "../../design-system/components";
import { getHomeConfig } from "../../lib/api/home";
import { type CatalogEntry, type ToolItem, listToolCatalog } from "../../lib/api/tools";
import { CatalogCard } from "./CatalogCard";
import { InstallGithubAppDialog } from "./InstallGithubAppDialog";
import { openGithub } from "./githubReturn";
import { GithubMark } from "./toolIcons";
import { useGithubStatus } from "./useGithubStatus";

const GITHUB_APP = "needs_github_app";

/** Where the GitHub buttons go (`/api/config`; empty when the server has none). */
interface GithubUrls {
  install: string;
  manage: string;
}

const NO_URLS: GithubUrls = { install: "", manage: "" };

/** The App's install and manage URLs, loaded up front so "Open GitHub" can open a window in the
 *  click itself (a window opened after an await is blocked as a pop-up). */
function useGithubUrls(): GithubUrls {
  const [urls, setUrls] = useState<GithubUrls>(NO_URLS);
  useEffect(() => {
    let live = true;
    getHomeConfig().then(
      (c) => live && setUrls({ install: c.github_install_url, manage: c.github_manage_url }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return urls;
}

export interface BrowseActions {
  /** Create the entry's tool; resolves once the page has reacted (list, badge, toast). */
  onAdd: (entry: CatalogEntry) => Promise<void>;
  /** Custom server → the Add tool wizard with "A custom server" chosen. */
  onSetUp: () => void;
  /** Paste mcp.json → the paste sheet. */
  onPaste: () => void;
}

function glyphFor(entry: CatalogEntry): ReactNode {
  if (entry.key === "fetch") return <Globe size={18} strokeWidth={1.6} aria-hidden />;
  if (/github/i.test(entry.key)) return <GithubMark size={18} />;
  return <Server size={18} strokeWidth={1.6} aria-hidden />;
}

/** The catalog, in API order; `[]` with an error when it couldn't be read. */
function useCatalog() {
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    let live = true;
    setFailed(false);
    listToolCatalog().then(
      (entries) => live && setCatalog(entries),
      () => {
        if (!live) return;
        setCatalog([]);
        setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => load(), [load]);
  return { catalog, failed, retry: load };
}

function AddButton({
  entry,
  tools,
  onAdd,
}: {
  entry: CatalogEntry;
  tools: ToolItem[] | null;
  onAdd: BrowseActions["onAdd"];
}) {
  const [busy, setBusy] = useState(false);
  if (tools?.some((t) => t.name === entry.name)) {
    return (
      <Button variant="secondary" size="sm" className="tk-btn-inline" disabled>
        <Check size={13} strokeWidth={1.6} aria-hidden />
        <span>In your tools</span>
      </Button>
    );
  }
  const add = async () => {
    setBusy(true);
    try {
      await onAdd(entry);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="primary"
      size="sm"
      loading={busy}
      disabled={tools === null}
      onClick={() => void add()}
    >
      Add
    </Button>
  );
}

function GithubAppCard({ entry }: { entry: CatalogEntry }) {
  const { status, leaveForGithub } = useGithubStatus();
  const urls = useGithubUrls();
  const [installing, setInstalling] = useState(false);
  if (!status?.hosted) return null;

  const chooseRepos = () => {
    leaveForGithub();
    openGithub(urls.manage);
  };
  return (
    <>
      <CatalogCard
        icon={glyphFor(entry)}
        title={entry.title}
        badge={status.installed ? "App installed" : "Needs GitHub App"}
        badgeVariant={status.installed ? "success" : "warning"}
        description={entry.description}
        action={
          status.installed ? (
            <Button variant="secondary" size="sm" onClick={chooseRepos} disabled={!urls.manage}>
              Choose repos
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setInstalling(true)}>
              Install GitHub App
            </Button>
          )
        }
      />
      {installing && (
        <InstallGithubAppDialog
          url={urls.install}
          onClose={() => setInstalling(false)}
          onLeave={leaveForGithub}
        />
      )}
    </>
  );
}

export function BrowseTab({
  tools,
  actions,
}: {
  /** The installed tools (null while loading): "In your tools" is a name match. */
  tools: ToolItem[] | null;
  actions: BrowseActions;
}) {
  const { catalog, failed, retry } = useCatalog();
  if (catalog === null) return <div className="tk-catalog" aria-busy="true" />;

  return (
    <>
      {failed && (
        <section className="tk-card tk-catalog__error">
          <div className="tk-state" role="alert">
            <span>Couldn’t load the catalog.</span>
            <Button variant="secondary" size="sm" onClick={retry}>
              Retry
            </Button>
          </div>
        </section>
      )}
      <div className="tk-catalog">
        {catalog.map((entry) => {
          if (entry.access === GITHUB_APP) {
            return <GithubAppCard key={entry.key} entry={entry} />;
          }
          if (!entry.attachable) return null;
          return (
            <CatalogCard
              key={entry.key}
              icon={glyphFor(entry)}
              title={entry.title}
              badge={entry.badge}
              badgeVariant={entry.access === "free" ? "success" : "neutral"}
              description={entry.description}
              action={<AddButton entry={entry} tools={tools} onAdd={actions.onAdd} />}
            />
          );
        })}
        <CatalogCard
          icon={<Server size={18} strokeWidth={1.6} aria-hidden />}
          title="Custom server"
          badge="Any MCP server"
          description="Connect any server: a local command (like uvx or npx) or a remote URL, with secrets as ${NAME}."
          action={
            <Button variant="secondary" size="sm" onClick={actions.onSetUp}>
              Set up
            </Button>
          }
        />
        <CatalogCard
          icon={<Braces size={18} strokeWidth={1.6} aria-hidden />}
          title="Paste mcp.json"
          badge="Bulk"
          description="Bring servers over from Claude, Cursor or VS Code. We check it and list what we found before adding."
          action={
            <Button variant="secondary" size="sm" onClick={actions.onPaste}>
              Paste
            </Button>
          }
        />
      </div>
    </>
  );
}
